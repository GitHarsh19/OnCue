# OnCue

Live salon queue intelligence web app. A camera in the salon is analyzed periodically by a vision AI model; counts of waiting / in-service customers are broadcast over WebSocket to public and in-store displays, and an estimated wait time is computed.

## Repo layout

```
oncue/
├── package.json          # root: `npm run dev` runs server + client via concurrently
├── setup.sh              # one-shot installer (root + server + client deps, copies .env)
├── .env.example          # template for server/.env
├── server/               # Express + ws backend (Node, ESM)
│   ├── index.js          # HTTP + WebSocket server, room-per-salonId
│   ├── routes/
│   │   ├── analyze.js    # POST /api/analyze — AI vision call, counts + bbox detections
│   │   └── queue.js      # Queue CRUD routes
│   ├── store/
│   │   └── queueStore.js # in-memory Map<salonId, state>
│   └── logs/
│       └── analyze.jsonl # append-only log of every analysis result
└── client/               # Vite + React + Tailwind frontend
    └── src/
        ├── pages/
        │   ├── OwnerDashboard.jsx   # /owner — camera + controls + activity log
        │   ├── LiveDisplay.jsx      # /display — large in-store screen
        │   └── PublicView.jsx       # /:salonId — mobile customer view
        ├── components/
        │   ├── CameraFeed.jsx       # getUserMedia/video file, motion gate, JPEG capture, bbox + mirror-mask overlay
        │   ├── MirrorMaskEditor.jsx # modal polygon editor — owner draws mirror regions on a snapshot
        │   ├── QueueBoard.jsx       # waiting/in-service/served tile group on owner dashboard
        │   ├── StatusIndicator.jsx  # colored dot + label (live/connecting/reconnecting/stale/offline)
        │   ├── WaitTimeBadge.jsx
        │   └── ZoneCounter.jsx
        └── hooks/
            ├── useCamera.js          # camera or video file source, 1280x720 ideal
            ├── useAnimatedNumber.js  # shared cubic-out tween for live counters
            ├── useQueueState.js      # thin re-export of useWebSocket for non-owner views
            └── useWebSocket.js       # auto-reconnect, exponential backoff (max 15s)
```

## Tech stack

- **Frontend**: React 18, Vite, TailwindCSS, react-router-dom v6
- **Backend**: Node (ESM), Express, `ws`, `@google/generative-ai`, `openai`, `dotenv`, `cors`
- **AI**: Multi-provider vision — Gemini (default) or OpenAI, auto-detected from env keys
- **Storage**: in-memory `Map` (no DB) — single-process only
- **Realtime**: WebSocket rooms keyed by `salonId`

## Environment

`server/.env`:

```
PORT=3001

# Priority: GEMINI > OPENAI (add whichever key you have)
GEMINI_API_KEY=...
OPENAI_API_KEY=...

# Model overrides (optional)
GEMINI_MODEL=gemma-4-31b-it        # default in code; best real-world recall in testing. Override to `gemini-2.5-flash` etc. if needed.
OPENAI_MODEL=gpt-4o-mini
```

`client/.env` defaults: `VITE_API_URL=http://localhost:3001`, `VITE_WS_URL=ws://localhost:3001`.

## AI provider system

`server/routes/analyze.js` auto-detects providers from env keys. Priority: **GEMINI > OPENAI**.

- `callGemini()` — uses `@google/generative-ai` SDK with `responseMimeType: "application/json"` to force clean JSON output
- `callOpenAI()` — uses `openai` SDK with image_url content block
- `callAI()` — tries providers in order with **3-attempt retry** per provider for 503/overload errors (5s, 10s backoff), then falls back to next provider

Code default is **`gemma-4-31b-it`** (set in `analyze.js`) — produced the most reliable counts on real barbershop footage and handles backlit entries / partial-body cases best. Override with `GEMINI_MODEL=gemini-2.5-flash` (or other) in `server/.env` if needed.

On startup logs: `[analyze] provider=gemini` (or openai).
On fallback logs: `[analyze] fell back to provider=openai`.

This deployment runs on a paid Gemini account, so the public free-tier RPD limits don't apply — model choice is driven by recall quality, not quota. The motion gate (160px pixel-diff, ≥2% change threshold) still suppresses requests on stable frames to keep cost down.

## How it works

1. Owner opens `/owner`. `CameraFeed` requests rear camera (`facingMode: "environment"`) or plays a local video file (loop mode for testing).
2. Every `autoIntervalMs` (default 30s, configurable in Settings), it captures a frame, runs a 160px-wide pixel-diff motion check, and skips analysis if <2% of pixels changed by >15 channel units.
3. Auto-polling can be toggled on/off from the Settings panel without stopping the camera feed. "Analyze now" always works regardless.
4. If motion detected or "Analyze now" pressed, the full-res JPEG (q=0.9) base64 is POSTed to `/api/analyze`. Higher quality preserves detail in overexposed entries / backlit doorways where small or silhouetted people otherwise get crushed.
5. Server loads the salon's saved `mirrorRegions`, injects their bounding-box descriptions into the prompt, and calls the AI provider. Prompt structure: identify mirrors → count only real people (with explicit recall guidance for backs-of-heads, partial bodies, silhouettes) → output JSON with detections.
6. Response is parsed via a balanced-brace JSON extractor that scans all top-level `{...}` blocks and selects the first one matching the counts schema (`waiting`/`service`/`entry` numeric). On parse failure the raw response (first 600 chars) is logged. On 503/overload the server retries up to 3×; on other failures it tries the next provider. After parsing, counts are checked with `Number.isFinite` for `waiting` and `service` — malformed model output returns HTTP 502 with `error: "AI returned malformed counts"` instead of writing `undefined` into the store.
7. Detections are filtered server-side: any whose center lies inside a `mirrorRegions` polygon is dropped (ray-cast point-in-polygon). Counts are recomputed by subtracting drops per zone — the masked polygons are the authoritative ground truth, the model is just a hint.
8. Counts go through `updateFromAnalysis` in `queueStore.js`, recomputing `estimatedWaitMins`, setting `lastUpdated`, marking `cameraOnline=true`, pushing a history entry.
9. Snapshot is broadcast to all subscribers of that `salonId` over WebSocket. HTTP response also returns `detections[]` for the bbox overlay on the camera feed.
10. Every analysis is appended to `server/logs/analyze.jsonl` with provider, counts, confidence, reflectionsExcluded, detections, droppedByMask, mirrorRegionsModel, and waitTime.

## AI prompt design

`BASE_PROMPT` lives in `server/routes/analyze.js`. `buildPrompt(mirrorRegions)` appends a per-salon "configured mirror regions" block describing each polygon's bounding box in normalized coords, so the model can pre-suppress reflections in those areas.

**STEP 1 — mirrors:** explicit cues (reversed text/logos, paired identical figures back-to-back, framed rectangles flush with walls, glass storefronts/windows). Anything inside counts as `reflectionsExcluded`, not a real person.

**STEP 2 — real people:** zones `waiting` / `service` / `entry` / `staff` (staff excluded from totals; staff = clearly working on a customer, holding tools, or in uniform). The prompt enumerates a recall-focused **"these still count"** list to combat under-counting:
- backs of heads / facing-away figures
- partial bodies (torso only, head + shoulders)
- people sitting low on a couch (only hair visible)
- silhouettes / backlit figures in bright doorways or windows
- crowded clusters where people overlap
- customers in casual clothes mixed in with staff

The model is told to scan methodically: top-left → top-right → middle row → bottom row.

**STEP 3 — JSON:** `waiting`, `service`, `entry`, `reflectionsExcluded`, `confidence`, `notes`, `detections[]`.

### JSON extraction

`extractJson()` is robust against models that emit multiple top-level objects (reasoning + counts) or wrap output in markdown fences. It walks the response, collects every balanced `{...}` block (tracking string state with escape handling), and picks the first object satisfying `hasCountsShape` (numeric `waiting`/`service`/`entry`). On miss it logs the raw response and falls back to the first object with a warning.

### Server-side mirror filter

Independent of the prompt, every detection runs through `isInsideAnyMirror(d, regions)` — a ray-cast point-in-polygon test against the saved `mirrorRegions`. Hits are dropped from `detections[]` and subtracted from per-zone counts. This means the polygon mask is a **hard filter**, not a hint: even if the model still hallucinates a person inside a mirror, it never reaches the queue store. `droppedByMask` and `droppedByZone` go into `analyze.jsonl` for auditing.

### Mirror mask editor

`MirrorMaskEditor.jsx` is a modal opened from OwnerDashboard's "Mirror mask" button. Owner clicks vertices on a still snapshot of the current camera view to outline each mirror/glass surface, hits "Close polygon" (≥3 points required) to commit, and "Save mask" to persist via `POST /api/queue/:salonId/settings { mirrorRegions }`. Saved regions render as faint crimson dashed polygons over the live `<video>` in `CameraFeed`, and are persisted on the salon record in `queueStore`.

**Known detection limitations:**
- People partially out of frame (bottom edge) are often missed — partly mitigated by the recall block in the prompt
- Bright/overexposed entry areas make detection unreliable — partly mitigated by the JPEG q=0.9 capture
- Wide-angle CCTV cameras distort people near the edges
- If the owner hits "Save mask" without committing the in-progress polygon ("Close polygon"), the draft is discarded silently

## Wait-time formula

`server/store/queueStore.js#calculateWaitTime`:

```
if inService < stylists: 0                            // open chair, sit now
else: ceil((waiting + 1) / stylists) * avgServiceMins // (waiting+1)-th in line
```

Wait time is computed for a **new customer arriving now**, not the last person already in queue. Sanity check: 2 in chair + 2 waiting + 2 stylists + 20 min avg → `ceil(3/2)*20 = 40 min` (in-chair finish, then the 2 already waiting take both chairs and serve in parallel).

Defaults: `stylists=2`, `avgServiceMins=20`.

**Stylists count is human-only** — AI model analysis must never set it. Only the Settings panel or `updateSettings()` route may change it. `updateFromAnalysis()` has an explicit comment enforcing this.

### Sticky-drop filter

`updateFromAnalysis()` runs each new count through `applyStickyDrop()` (per zone). If the model reports a drop of **≥2** in `waiting` or `inService`, the previous value is held and the lower number is stashed as `pendingCounts[zone]`. The drop only commits when the **next** analysis agrees within ±1. While a drop is pending, `lastConfidence` is forced to `"low"` and `lastNotes` is annotated. Increases and small drops (≤1) pass through immediately. Every human-driven mutator (`manualUpdate`, `clearQueue`, `customerDone`, `addWaiting`, `startService`) clears `pendingCounts` so the operator's number is authoritative and a stale pending drop can never override them.

This smooths over single-frame misses (e.g. barber blocks the customer in chair for one analysis) without adding extra requests.

## WebSocket protocol

Subscribe: client sends `{ type: "subscribe", salonId, role: "owner"|"display"|"public" }`.
Broadcast: server pushes `snapshot(salonId)` on every state change.
Owner subscribe → `setCameraOnline(salonId, true)`. Owner disconnect → `setCameraOnline(salonId, false)` + broadcast.

## REST endpoints

- `POST /api/analyze` → `{ salonId, frameBase64 }` → `{ success, provider, counts, waitTime, confidence, reflectionsExcluded, notes, detections[] }`
- `GET  /api/queue/:salonId` → snapshot
- `POST /api/queue/:salonId/manual` → `{ waiting, inService }` — set both counts directly
- `POST /api/queue/:salonId/settings` → `{ stylists, avgServiceMins, mirrorRegions }` — salon config; `mirrorRegions` is `[{ points: [{x,y}, ...] }, ...]` in normalized 0..1 coords
- `POST /api/queue/:salonId/customer-done` → decrement inService, increment totalServedToday
- `POST /api/queue/:salonId/add-waiting` → +1 waiting
- `POST /api/queue/:salonId/remove-waiting` → -1 waiting (min 0)
- `POST /api/queue/:salonId/start-service` → move 1 from waiting → inService (respects stylists cap)
- `POST /api/queue/:salonId/reset-day` → reset totalServedToday to 0
- `POST /api/queue/:salonId/clear` → set waiting=0, inService=0

## Owner dashboard controls

**Camera area:**
- Analyze now — force immediate analysis
- Customer done +1 — quick-access served counter
- Manual override — set waiting/inService directly
- Settings — stylists, avg service mins, analyze interval, auto-polling toggle
- Mirror mask — opens `MirrorMaskEditor` over a current snapshot; shows count of saved regions on the button

**Admin panel (always visible):**
- +1 Waiting / −1 Waiting
- Start service (moves 1 waiting → inService)
- Customer done
- Reset day (confirm dialog)
- Clear queue (confirm dialog)

**Test source:** Local video file picker — loads any video file as the camera source, loops automatically. Used for testing against recorded barbershop footage without a live camera.

**Demo mode:** Disables camera and auto-posts rotating `demoScenarios` array to `/manual` every 30s. For demos without any camera or AI key.

## Settings panel (OwnerDashboard)

- **Stylists** — number of barbers working (human-set only)
- **Avg service mins** — used in wait-time formula
- **Analyze interval (seconds)** — how often auto-polling fires (default 30s, min 10s)
- **Auto polling toggle** — on/off switch; camera still shows live when off, just no automatic AI calls

Settings re-sync from the server snapshot on **every** WebSocket update, but only while the Settings panel is closed — so reconnects pick up server-side state, but an in-progress edit isn't clobbered mid-keystroke.

## Bounding-box overlay

`CameraFeed.jsx` renders an absolutely-positioned overlay on the `<video>` element. Boxes use normalized coords (0..1) from the latest `/api/analyze` response.

Color coding:
- `waiting` → amber `#FFB020`
- `service` → teal `#00D4AA`
- `entry`   → blue `#7AA2FF`
- `staff`   → crimson `#FF5C7A`

Box TTL: 5 seconds after analysis completes, then cleared. Detections are **only replaced on a successful response** — they are not wiped at request start, so failed analyses leave the previous boxes visible until their TTL expires (no flicker between polls). Status badge: **Analyzing** (pulsing) → **Updated** (2s) → **Live**.

## UI design system

- Colors: navy `#0F1B2D` (bg), teal `#00D4AA` (primary), crimson for errors, amber for warn
- Fonts: Syne (display), IBM Plex Mono (body/numbers)
- Heavy use of uppercase wide-tracked labels (`tracking-widest`) and `tabular-nums` for live counters
- Animated number transitions on `LiveDisplay` and `ZoneCounter` via `requestAnimationFrame` cubic-out easing (shared `useAnimatedNumber` hook in `client/src/hooks/`)

## Status indicator states

- `live` — connected and fresh data (teal, pulsing)
- `connecting` — initial WebSocket handshake (amber, pulsing)
- `reconnecting` — connection dropped, exponential backoff in progress (amber, pulsing)
- `stale` — last update >10 min ago (amber)
- `offline` — camera marked offline by server (crimson)

`PublicView` and `LiveDisplay` derive: `!data ? status : cameraOffline ? "offline" : stale ? "stale" : status`.

## Open hours (PublicView)

Hardcoded `OPEN_HOUR=9`, `CLOSE_HOUR=21` (local time). Determines Open/Closed badge.

## Known limitations

- In-memory store — state lost on server restart, no horizontal scaling
- Single hardcoded `SALON_ID = "demo"` in `OwnerDashboard.jsx` and `LiveDisplay.jsx`; `PublicView` reads from URL param
- No auth
- Partially visible people (frame edges, bright entry) are frequently missed by the model — use manual controls as override
- Code default is `gemma-4-31b-it` (best real-world recall in testing); override via `GEMINI_MODEL` in `server/.env` if you want a different model

## Run

```
./setup.sh        # installs everything, creates server/.env from template
# edit server/.env — add GEMINI_API_KEY and optionally GEMINI_MODEL
npm run dev       # server :3001, Vite client :5173
```

Routes: `/owner`, `/display`, `/:salonId` (public).
