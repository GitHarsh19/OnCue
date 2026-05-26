const store = new Map();

function defaultSalon() {
  return {
    waiting: 0,
    inService: 0,
    totalServedToday: 0,
    estimatedWaitMins: 0,
    lastUpdated: null,
    cameraOnline: false,
    history: [],
    stylists: 2,
    avgServiceMins: 20,
    lastConfidence: null,
    lastNotes: null,
    // Each region: { points: [{x,y}, ...] } in normalized 0..1 coords. Used to ignore
    // detections that fall inside fixed mirror surfaces in the salon.
    mirrorRegions: [],
    // Holds a suspected drop awaiting one more analysis to confirm. Per-zone.
    pendingCounts: { waiting: null, inService: null },
  };
}

export function getSalon(salonId) {
  if (!store.has(salonId)) store.set(salonId, defaultSalon());
  return store.get(salonId);
}

export function calculateWaitTime(waiting, inService, stylists, avgServiceMins) {
  const s = Math.max(1, stylists);
  // Open chair: a new customer sits down immediately.
  if (inService < s) return 0;
  // All chairs busy. A new arrival is the (waiting+1)-th in the wait line.
  // Every avgServiceMins, `s` chairs free up, so cycles to wait = ceil((waiting+1)/s).
  // E.g. 2 in-chair + 2 waiting + 2 stylists → ceil(3/2)=2 cycles → 2*avg.
  return Math.ceil((waiting + 1) / s) * avgServiceMins;
}

export function updateFromAnalysis(salonId, counts, meta = {}) {
  const s = getSalon(salonId);
  // stylists is human-only — model analysis must never change it
  let suspect = false;
  if (typeof counts.waiting === "number" && counts.waiting >= 0) {
    const next = applyStickyDrop(s.waiting, counts.waiting, s.pendingCounts, "waiting");
    s.waiting = next.value;
    suspect = suspect || next.suspect;
  }
  if (typeof counts.service === "number" && counts.service >= 0) {
    const next = applyStickyDrop(s.inService, counts.service, s.pendingCounts, "inService");
    s.inService = next.value;
    suspect = suspect || next.suspect;
  }
  s.estimatedWaitMins = calculateWaitTime(s.waiting, s.inService, s.stylists, s.avgServiceMins);
  s.lastUpdated = new Date().toISOString();
  s.cameraOnline = true;
  s.lastConfidence = suspect ? "low" : (meta.confidence ?? null);
  s.lastNotes = suspect
    ? `Held ${meta.notes ? meta.notes + " — " : ""}suspected drop, awaiting confirmation`
    : (meta.notes ?? null);
  s.history.unshift({
    t: s.lastUpdated,
    waiting: s.waiting,
    inService: s.inService,
    entry: counts.entry ?? null,
    confidence: s.lastConfidence,
  });
  s.history = s.history.slice(0, 20);
  return s;
}

// If the model reports a drop of ≥2 in a zone, hold the previous value and require
// the next analysis to agree (within ±1) before committing. Small drops and any
// increases pass through immediately.
function applyStickyDrop(prev, next, pending, key) {
  const drop = prev - next;
  if (drop < 2) {
    pending[key] = null;
    return { value: next, suspect: false };
  }
  const prior = pending[key];
  if (prior !== null && Math.abs(prior - next) <= 1) {
    pending[key] = null;
    return { value: next, suspect: false };
  }
  pending[key] = next;
  return { value: prev, suspect: true };
}

export function manualUpdate(salonId, { waiting, inService }) {
  const s = getSalon(salonId);
  if (typeof waiting === "number") s.waiting = Math.max(0, waiting);
  if (typeof inService === "number") s.inService = Math.max(0, inService);
  s.pendingCounts = { waiting: null, inService: null };
  s.estimatedWaitMins = calculateWaitTime(s.waiting, s.inService, s.stylists, s.avgServiceMins);
  s.lastUpdated = new Date().toISOString();
  return s;
}

export function customerDone(salonId) {
  const s = getSalon(salonId);
  if (s.inService > 0) s.inService -= 1;
  s.totalServedToday += 1;
  s.pendingCounts = { waiting: null, inService: null };
  s.estimatedWaitMins = calculateWaitTime(s.waiting, s.inService, s.stylists, s.avgServiceMins);
  s.lastUpdated = new Date().toISOString();
  return s;
}

export function addWaiting(salonId, n = 1) {
  const s = getSalon(salonId);
  s.waiting = Math.max(0, s.waiting + n);
  s.pendingCounts = { waiting: null, inService: null };
  s.estimatedWaitMins = calculateWaitTime(s.waiting, s.inService, s.stylists, s.avgServiceMins);
  s.lastUpdated = new Date().toISOString();
  return s;
}

export function startService(salonId) {
  const s = getSalon(salonId);
  if (s.waiting <= 0) return s;
  if (s.stylists > 0 && s.inService >= s.stylists) return s;
  s.waiting -= 1;
  s.inService += 1;
  s.pendingCounts = { waiting: null, inService: null };
  s.estimatedWaitMins = calculateWaitTime(s.waiting, s.inService, s.stylists, s.avgServiceMins);
  s.lastUpdated = new Date().toISOString();
  return s;
}

export function resetDay(salonId) {
  const s = getSalon(salonId);
  s.totalServedToday = 0;
  s.lastUpdated = new Date().toISOString();
  return s;
}

export function clearQueue(salonId) {
  const s = getSalon(salonId);
  s.waiting = 0;
  s.inService = 0;
  s.pendingCounts = { waiting: null, inService: null };
  s.estimatedWaitMins = 0;
  s.lastUpdated = new Date().toISOString();
  return s;
}

export function updateSettings(salonId, { stylists, avgServiceMins, mirrorRegions }) {
  const s = getSalon(salonId);
  if (typeof stylists === "number" && stylists >= 1) s.stylists = Math.round(stylists);
  if (typeof avgServiceMins === "number" && avgServiceMins > 0) s.avgServiceMins = avgServiceMins;
  if (Array.isArray(mirrorRegions)) s.mirrorRegions = sanitizeMirrorRegions(mirrorRegions);
  s.estimatedWaitMins = calculateWaitTime(s.waiting, s.inService, s.stylists, s.avgServiceMins);
  return s;
}

function sanitizeMirrorRegions(regions) {
  return regions
    .map((r) => {
      const pts = Array.isArray(r?.points) ? r.points : [];
      const clean = pts
        .filter((p) => typeof p?.x === "number" && typeof p?.y === "number")
        .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }));
      return clean.length >= 3 ? { points: clean } : null;
    })
    .filter(Boolean);
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

export function getMirrorRegions(salonId) {
  return getSalon(salonId).mirrorRegions;
}

export function setCameraOnline(salonId, online) {
  const s = getSalon(salonId);
  s.cameraOnline = online;
  return s;
}

export function snapshot(salonId) {
  const s = getSalon(salonId);
  return {
    waiting: s.waiting,
    inService: s.inService,
    totalServedToday: s.totalServedToday,
    estimatedWaitMins: s.estimatedWaitMins,
    lastUpdated: s.lastUpdated,
    cameraOnline: s.cameraOnline,
    stylists: s.stylists,
    avgServiceMins: s.avgServiceMins,
    lastConfidence: s.lastConfidence,
    lastNotes: s.lastNotes,
    mirrorRegions: s.mirrorRegions,
    history: s.history.slice(0, 5),
  };
}
