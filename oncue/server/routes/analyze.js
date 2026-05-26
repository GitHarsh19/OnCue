import { Router } from "express";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { updateFromAnalysis, snapshot, getMirrorRegions } from "../store/queueStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, "../logs/analyze.jsonl");

async function logAnalysis(entry) {
  try {
    await mkdir(dirname(LOG_PATH), { recursive: true });
    await appendFile(LOG_PATH, JSON.stringify(entry) + "\n");
  } catch (e) {
    console.error("log write failed:", e.message);
  }
}

// Ordered provider list — all configured providers, priority: GEMINI > OPENAI
const PROVIDERS = [
  process.env.GEMINI_API_KEY && "gemini",
  process.env.OPENAI_API_KEY && "openai",
].filter(Boolean);

const PROVIDER = PROVIDERS[0] ?? null;

const gemini = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemma-4-31b-it";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

console.log(`[analyze] provider=${PROVIDER ?? "none"}`);

const BASE_PROMPT = `You are a salon queue monitoring system. Analyze this camera image of a salon.

STEP 1 — IDENTIFY MIRRORS AND OTHER REFLECTIVE SURFACES FIRST (before counting anyone):
Barbershop mirrors are large flat wall-mounted surfaces, typically directly behind or in front of the barber chairs. Glass storefronts and glass doors are also reflective.

Concrete cues that a region is a mirror or reflection:
- A rectangular framed surface mounted flat against a wall, often with lights or shelves below it.
- TWO people who appear identical (same haircut, same cape, same pose) where one is inside a framed rectangle behind/across from the other — the one inside the rectangle is the reflection.
- A person facing AWAY from the camera in the foreground while a near-identical person faces TOWARD the camera through a framed surface — the framed one is the reflection.
- Text, logos, or signage that appears reversed/mirrored.
- A scene that looks like a duplicate or mirror-image of part of the room (depth feels "behind" the wall).
- Symmetric pairs of figures across a vertical line that runs through a flat wall surface.
- Bright rectangular regions on walls with sharper edges than the rest of the wall (mirror frame).

Treat the inside of any mirror or glass reflection as OUT OF BOUNDS — anything inside it is not a real person regardless of how clear it looks.

STEP 2 — COUNT ONLY REAL PEOPLE (never reflections):
A person is real if they exist in the physical foreground space outside any reflective surface.
A reflection is a DUPLICATE of someone already counted in their real position. Never count them.
When in doubt between "real" and "reflection", PREFER reflection — under-counting reflections is worse than under-counting reals here.

IMPORTANT — these still count as REAL people, do NOT skip them:
- Backs of heads / people facing AWAY from the camera (very common on waiting sofas).
- People only partially visible: torso only, head + shoulders only, head cropped at the top/bottom of the frame, knees-only.
- People sitting low on a couch where only hair / the back of the head shows above the cushion.
- Silhouettes / backlit figures in bright doorways or windows — if there is a human-shaped dark form in the entry, count it.
- People crowded close together — count each one individually, even if their bodies overlap.
- People in casual clothes mixed in with staff — assume customers unless they are clearly cutting hair, holding clippers, or wearing a barber's apron/uniform.

Scan the image methodically: top-left → top-right → middle row → bottom row. Pay special attention to the bottom edge of the frame and the bright entrance area; these are commonly missed.

Zones (apply only to real people):
- WAITING: Sitting/standing in the waiting area (sofas, benches, stools, chairs AWAY from barber stations) — including people facing away or only partially visible.
- SERVICE: In a barber/styling chair actively being cut (cape often visible).
- ENTRY: Standing/walking near the entrance, including silhouetted/backlit figures in a bright doorway.
- STAFF: Barbers, stylists, receptionists — only if they are clearly working on a customer, holding tools, or in uniform. Excluded from waiting/service/entry counts.

STEP 3 — OUTPUT:
Respond ONLY with valid JSON, no explanation:
{
  "waiting": <number of real waiting customers>,
  "service": <number of real customers in barber chairs>,
  "entry": <number of real people at entry>,
  "reflectionsExcluded": <number of reflected people you spotted and ignored>,
  "confidence": <"high" | "medium" | "low">,
  "notes": "<what mirrors you saw, how many reflections ignored, anything unusual>",
  "mirrorRegions": [
    { "x": <0..1>, "y": <0..1>, "w": <0..1>, "h": <0..1>, "kind": "mirror|glass" }
  ],
  "detections": [
    { "x": <0..1>, "y": <0..1>, "w": <0..1>, "h": <0..1>, "zone": "waiting|service|entry|staff", "label": "<short>" }
  ]
}

detections MUST only contain real people. mirrorRegions is for audit — list every reflective surface you saw. Use normalized coords 0.0–1.0, (0,0) = top-left.`;

function describeMirrorRegions(regions) {
  if (!regions || regions.length === 0) return "";
  const lines = regions.map((r, i) => {
    const pts = r.points.map((p) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`).join(" → ");
    return `  Mirror ${i + 1}: polygon vertices ${pts}`;
  });
  return `

KNOWN MIRROR REGIONS (configured by the salon owner — these are GUARANTEED to be mirrors in this fixed camera view; everything inside them is a reflection, never a real person):
${lines.join("\n")}

Do NOT place any detections whose center falls inside these regions. The server will also filter them, but you should not produce them in the first place.`;
}

function buildPrompt(mirrorRegions) {
  return BASE_PROMPT + describeMirrorRegions(mirrorRegions);
}

function extractJson(text) {
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();

  // Collect every top-level balanced JSON object in the text.
  const objects = [];
  for (const slice of allTopLevelJsonObjects(cleaned)) {
    try { objects.push(JSON.parse(slice)); } catch {}
  }

  // Also try parsing the whole thing (handles the simple single-object and array cases).
  try {
    const whole = JSON.parse(cleaned);
    if (Array.isArray(whole)) objects.push(...whole.filter((o) => o && typeof o === "object"));
    else if (whole && typeof whole === "object") objects.push(whole);
  } catch {}

  if (objects.length === 0) {
    throw new Error("no JSON found in: " + cleaned.slice(0, 300));
  }

  // Pick the object that matches our expected schema. Fall back to the first one.
  const match = objects.find(hasCountsShape);
  if (match) return match;
  console.warn(`[analyze] no schema-matching object found; first object keys: ${Object.keys(objects[0]).join(",")}; raw: ${cleaned.slice(0, 300)}`);
  return objects[0];
}

function hasCountsShape(o) {
  return o && typeof o === "object"
    && typeof o.waiting === "number"
    && typeof o.service === "number"
    && typeof o.entry === "number";
}

function* allTopLevelJsonObjects(s) {
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf("{", i);
    if (start === -1) return;
    let depth = 0, inStr = false, escape = false, end = -1;
    for (let j = start; j < s.length; j++) {
      const c = s[j];
      if (inStr) {
        if (escape) escape = false;
        else if (c === "\\") escape = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end === -1) return;
    yield s.slice(start, end + 1);
    i = end + 1;
  }
}


async function callGemini(base64, prompt) {
  const model = gemini.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: "application/json" },
  });
  const res = await model.generateContent([
    { inlineData: { mimeType: "image/jpeg", data: base64 } },
    prompt,
  ]);
  const raw = res.response.text();
  try {
    return extractJson(raw);
  } catch (err) {
    console.warn(`[gemini] parse failed. raw response: ${raw.slice(0, 600)}`);
    throw err;
  }
}

async function callOpenAI(base64, prompt) {
  const res = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
        { type: "text", text: prompt },
      ],
    }],
    max_tokens: 900,
  });
  return extractJson(res.choices[0]?.message?.content ?? "");
}

function callProvider(provider, base64, prompt) {
  if (provider === "gemini") return callGemini(base64, prompt);
  if (provider === "openai") return callOpenAI(base64, prompt);
  throw new Error("Unknown provider: " + provider);
}

// Ray-casting point-in-polygon for normalized coords.
function pointInPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    const intersect = ((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isInsideAnyMirror(d, regions) {
  if (!regions || regions.length === 0) return false;
  const cx = d.x + d.w / 2;
  const cy = d.y + d.h / 2;
  return regions.some((r) => pointInPolygon(cx, cy, r.points));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err) {
  const msg = err.message || "";
  return msg.includes("503") || msg.includes("529") || msg.includes("overloaded");
}

async function callAI(base64, prompt) {
  if (PROVIDERS.length === 0) throw new Error("No AI provider configured");
  let lastErr;
  for (const provider of PROVIDERS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await callProvider(provider, base64, prompt);
        if (provider !== PROVIDER) console.log(`[analyze] fell back to provider=${provider}`);
        return { result, usedProvider: provider };
      } catch (err) {
        lastErr = err;
        if (isRetryable(err) && attempt < 2) {
          const wait = (attempt + 1) * 5000;
          console.warn(`[${provider}] overloaded, retrying in ${wait / 1000}s...`);
          await sleep(wait);
        } else {
          console.warn(`[${provider}] failed, trying next:`, err.message.slice(0, 120));
          break;
        }
      }
    }
  }
  throw lastErr;
}

const router = Router();

export default function makeAnalyzeRouter(broadcast) {
  router.post("/analyze", async (req, res) => {
    const { salonId, frameBase64 } = req.body || {};
    if (!salonId || !frameBase64) {
      return res.status(400).json({ success: false, error: "salonId and frameBase64 required" });
    }
    if (!PROVIDER) {
      return res.status(500).json({ success: false, error: "No AI API key configured (GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY)" });
    }

    const cleaned = frameBase64.replace(/^data:image\/\w+;base64,/, "");
    const mirrorRegions = getMirrorRegions(salonId);
    const prompt = buildPrompt(mirrorRegions);

    let parsed, usedProvider;
    try {
      ({ result: parsed, usedProvider } = await callAI(cleaned, prompt));
    } catch (err) {
      console.error(`[analyze] all providers failed:`, err.message);
      return res.status(502).json({ success: false, error: "AI analysis unavailable" });
    }

    const rawDetections = Array.isArray(parsed.detections)
      ? parsed.detections
          .filter((d) => d && typeof d.x === "number" && typeof d.y === "number" && typeof d.w === "number" && typeof d.h === "number")
          .map((d) => ({
            x: Math.max(0, Math.min(1, d.x)),
            y: Math.max(0, Math.min(1, d.y)),
            w: Math.max(0, Math.min(1, d.w)),
            h: Math.max(0, Math.min(1, d.h)),
            zone: d.zone || "unknown",
            label: d.label || "",
          }))
      : [];

    // Hard server-side filter: drop any detection whose center is inside a known mirror polygon.
    const detections = [];
    let droppedByMask = 0;
    const droppedByZone = { waiting: 0, service: 0, entry: 0, staff: 0, unknown: 0 };
    for (const d of rawDetections) {
      if (isInsideAnyMirror(d, mirrorRegions)) {
        droppedByMask++;
        droppedByZone[d.zone in droppedByZone ? d.zone : "unknown"]++;
      } else {
        detections.push(d);
      }
    }

    // Recompute counts from filtered detections when the model produced any detections;
    // otherwise trust the model's tallies. This keeps the mask authoritative.
    let counts;
    if (rawDetections.length > 0) {
      counts = {
        waiting: Math.max(0, (parsed.waiting ?? 0) - droppedByZone.waiting),
        service: Math.max(0, (parsed.service ?? 0) - droppedByZone.service),
        entry: Math.max(0, (parsed.entry ?? 0) - droppedByZone.entry),
      };
    } else {
      counts = { waiting: parsed.waiting, service: parsed.service, entry: parsed.entry };
    }

    if (!Number.isFinite(counts.waiting) || !Number.isFinite(counts.service)) {
      console.warn(`[analyze] rejecting non-numeric counts:`, counts);
      return res.status(502).json({ success: false, error: "AI returned malformed counts" });
    }

    updateFromAnalysis(salonId, counts, { confidence: parsed.confidence, notes: parsed.notes });

    const state = snapshot(salonId);
    broadcast(salonId, state);

    const reflectionsExcluded = (parsed.reflectionsExcluded ?? 0) + droppedByMask;
    if (droppedByMask > 0) {
      console.log(`[analyze] mask filtered ${droppedByMask} detection(s) inside mirror regions`);
    }

    logAnalysis({
      t: new Date().toISOString(),
      salonId,
      provider: usedProvider,
      counts,
      confidence: parsed.confidence,
      reflectionsExcluded,
      droppedByMask,
      mirrorRegionsModel: parsed.mirrorRegions ?? [],
      notes: parsed.notes,
      detections,
      waitTime: state.estimatedWaitMins,
    });

    res.json({
      success: true,
      provider: usedProvider,
      counts,
      waitTime: state.estimatedWaitMins,
      confidence: parsed.confidence,
      reflectionsExcluded,
      notes: parsed.notes,
      detections,
    });
  });

  return router;
}
