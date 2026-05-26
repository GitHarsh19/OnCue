import { useEffect, useRef, useState } from "react";
import CameraFeed from "../components/CameraFeed.jsx";
import QueueBoard from "../components/QueueBoard.jsx";
import StatusIndicator from "../components/StatusIndicator.jsx";
import MirrorMaskEditor from "../components/MirrorMaskEditor.jsx";
import { useWebSocket } from "../hooks/useWebSocket.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
const SALON_ID = "demo";

const demoScenarios = [
  { waiting: 0, inService: 1 },
  { waiting: 2, inService: 2 },
  { waiting: 4, inService: 2 },
  { waiting: 3, inService: 2 },
  { waiting: 1, inService: 2 },
  { waiting: 0, inService: 1 },
];

export default function OwnerDashboard() {
  const cameraRef = useRef(null);
  const { status, data } = useWebSocket({ salonId: SALON_ID, role: "owner" });
  const [log, setLog] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [stylists, setStylists] = useState(2);
  const [avgServiceMins, setAvgServiceMins] = useState(20);
  const [analyzeIntervalSecs, setAnalyzeIntervalSecs] = useState(30);
  const [autoPolling, setAutoPolling] = useState(true);
  const [manualWaiting, setManualWaiting] = useState(0);
  const [manualInService, setManualInService] = useState(0);
  const [videoFile, setVideoFile] = useState(null);
  const [maskEditorOpen, setMaskEditorOpen] = useState(false);
  const [maskSnapshot, setMaskSnapshot] = useState(null);
  const mirrorRegions = data?.mirrorRegions ?? [];

  function openMaskEditor() {
    const snap = cameraRef.current?.captureSnapshot?.();
    if (!snap) {
      pushLog({ msg: "Camera not ready — start camera or load a video first", kind: "warn", t: new Date() });
      return;
    }
    setMaskSnapshot(snap);
    setMaskEditorOpen(true);
  }

  async function saveMirrorRegions(regions) {
    await post("settings", { mirrorRegions: regions });
    pushLog({ msg: `Mirror mask saved (${regions.length} region${regions.length === 1 ? "" : "s"})`, kind: "ok", t: new Date() });
  }

  function pushLog(entry) {
    setLog((l) => [entry, ...l].slice(0, 5));
  }

  async function post(path, body) {
    await fetch(`${API_URL}/api/queue/${SALON_ID}/${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  const customerDone = () => post("customer-done");
  const addWaiting = () => { post("add-waiting"); pushLog({ msg: "+1 waiting", kind: "ok", t: new Date() }); };
  const removeWaiting = () => { post("remove-waiting"); pushLog({ msg: "-1 waiting", kind: "info", t: new Date() }); };
  const startService = () => { post("start-service"); pushLog({ msg: "Started service", kind: "ok", t: new Date() }); };
  const resetDay = () => {
    if (!confirm("Reset today's served count to 0?")) return;
    post("reset-day");
    pushLog({ msg: "Day reset", kind: "warn", t: new Date() });
  };
  const clearQueue = () => {
    if (!confirm("Clear waiting and in-service to 0?")) return;
    post("clear");
    pushLog({ msg: "Queue cleared", kind: "warn", t: new Date() });
  };

  async function saveSettings() {
    await post("settings", { stylists: Number(stylists), avgServiceMins: Number(avgServiceMins) });
    setShowSettings(false);
  }

  async function saveManual() {
    await post("manual", { waiting: Number(manualWaiting), inService: Number(manualInService) });
    setShowManual(false);
  }

  // Sync settings from server snapshot, but pause while the user has the
  // Settings panel open so we don't clobber their in-progress edits.
  useEffect(() => {
    if (!data || showSettings) return;
    if (typeof data.stylists === "number") setStylists(data.stylists);
    if (typeof data.avgServiceMins === "number") setAvgServiceMins(data.avgServiceMins);
  }, [data, showSettings]);

  useEffect(() => {
    if (!demoMode) return;
    let i = 0;
    const tick = async () => {
      const s = demoScenarios[i % demoScenarios.length];
      i++;
      await fetch(`${API_URL}/api/queue/${SALON_ID}/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      pushLog({ msg: `[demo] waiting=${s.waiting} inService=${s.inService}`, kind: "info", t: new Date() });
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [demoMode]);

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl tracking-wide">OnCue</h1>
          <div className="text-white/60 text-sm">Sharma's Barbershop · Owner</div>
        </div>
        <div className="flex items-center gap-4">
          <StatusIndicator status={status === "live" ? "live" : status} />
        </div>
      </header>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <CameraFeed
            ref={cameraRef}
            salonId={SALON_ID}
            enabled={!demoMode && autoPolling}
            onLog={pushLog}
            videoFile={videoFile}
            autoIntervalMs={analyzeIntervalSecs * 1000}
            mirrorRegions={mirrorRegions}
          />
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
            <button
              onClick={() => cameraRef.current?.analyzeNow()}
              className="bg-teal text-navy font-mono uppercase text-xs tracking-widest py-3 rounded-md hover:opacity-90"
              disabled={demoMode}
            >
              Analyze now
            </button>
            <button
              onClick={customerDone}
              className="bg-white/10 text-white font-mono uppercase text-xs tracking-widest py-3 rounded-md hover:bg-white/20"
            >
              Customer done +1
            </button>
            <button
              onClick={() => setShowManual((v) => !v)}
              className="bg-white/10 text-white font-mono uppercase text-xs tracking-widest py-3 rounded-md hover:bg-white/20"
            >
              Manual override
            </button>
            <button
              onClick={openMaskEditor}
              disabled={demoMode}
              className="bg-white/10 text-white font-mono uppercase text-xs tracking-widest py-3 rounded-md hover:bg-white/20 disabled:opacity-30"
              title="Draw polygons over mirrors so detections inside them are filtered out"
            >
              Mirror mask{mirrorRegions.length > 0 ? ` (${mirrorRegions.length})` : ""}
            </button>
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="bg-white/10 text-white font-mono uppercase text-xs tracking-widest py-3 rounded-md hover:bg-white/20"
            >
              Settings
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <input
              id="demoMode"
              type="checkbox"
              checked={demoMode}
              onChange={(e) => setDemoMode(e.target.checked)}
            />
            <label htmlFor="demoMode" className="text-white/70 font-mono uppercase text-xs tracking-widest">
              Demo mode (no camera needed)
            </label>
          </div>
          <div className="mt-3 bg-white/5 border border-white/10 rounded-lg p-3 space-y-2">
            <div className="text-xs uppercase tracking-widest text-white/60">Test source (video file)</div>
            <input
              type="file"
              accept="video/*"
              onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
              className="text-xs text-white/80 font-mono"
            />
            {videoFile && (
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-teal truncate">▶ {videoFile.name}</span>
                <button
                  onClick={() => setVideoFile(null)}
                  className="text-white/60 hover:text-white underline"
                >
                  Use camera
                </button>
              </div>
            )}
            <div className="text-[10px] text-white/40 font-mono">
              Loops automatically. Same analyze interval as camera.
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <QueueBoard data={data} />

          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <div className="text-xs uppercase tracking-widest text-white/60 mb-3">Admin · manual controls</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={addWaiting}
                className="bg-teal/20 hover:bg-teal/30 text-teal border border-teal/40 font-mono uppercase text-xs tracking-widest py-2 rounded-md"
              >
                +1 Waiting
              </button>
              <button
                onClick={removeWaiting}
                className="bg-white/10 hover:bg-white/20 text-white font-mono uppercase text-xs tracking-widest py-2 rounded-md"
              >
                −1 Waiting
              </button>
              <button
                onClick={startService}
                className="bg-teal/20 hover:bg-teal/30 text-teal border border-teal/40 font-mono uppercase text-xs tracking-widest py-2 rounded-md"
              >
                Start service
              </button>
              <button
                onClick={customerDone}
                className="bg-white/10 hover:bg-white/20 text-white font-mono uppercase text-xs tracking-widest py-2 rounded-md"
              >
                Customer done
              </button>
              <button
                onClick={resetDay}
                className="bg-amber/20 hover:bg-amber/30 text-amber border border-amber/40 font-mono uppercase text-xs tracking-widest py-2 rounded-md"
              >
                Reset day
              </button>
              <button
                onClick={clearQueue}
                className="bg-crimson/20 hover:bg-crimson/30 text-crimson border border-crimson/40 font-mono uppercase text-xs tracking-widest py-2 rounded-md"
              >
                Clear queue
              </button>
            </div>
          </div>

          {showSettings && (
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
              <h3 className="font-display text-lg">Settings</h3>
              <label className="block text-xs uppercase tracking-widest text-white/60">Stylists</label>
              <input
                type="number" min="1" value={stylists}
                onChange={(e) => setStylists(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 font-mono"
              />
              <label className="block text-xs uppercase tracking-widest text-white/60">Avg service mins</label>
              <input
                type="number" min="1" value={avgServiceMins}
                onChange={(e) => setAvgServiceMins(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 font-mono"
              />
              <div className="flex items-center justify-between">
                <label className="text-xs uppercase tracking-widest text-white/60">Auto polling</label>
                <button
                  onClick={() => setAutoPolling((v) => !v)}
                  className={`w-11 h-6 rounded-full transition-colors ${autoPolling ? "bg-teal" : "bg-white/20"} relative`}
                >
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${autoPolling ? "left-6" : "left-1"}`} />
                </button>
              </div>
              <label className="block text-xs uppercase tracking-widest text-white/60">Analyze interval (seconds)</label>
              <input
                type="number" min="10" max="300" value={analyzeIntervalSecs}
                onChange={(e) => setAnalyzeIntervalSecs(Number(e.target.value))}
                className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 font-mono"
              />
              <div className="text-[10px] text-white/40 font-mono">Lower interval = more frequent updates. 30s is a good default.</div>
              <button onClick={saveSettings} className="bg-teal text-navy font-mono uppercase text-xs tracking-widest py-2 px-4 rounded-md">
                Save
              </button>
            </div>
          )}

          {showManual && (
            <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
              <h3 className="font-display text-lg">Manual override</h3>
              <label className="block text-xs uppercase tracking-widest text-white/60">Waiting</label>
              <input
                type="number" min="0" value={manualWaiting}
                onChange={(e) => setManualWaiting(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 font-mono"
              />
              <label className="block text-xs uppercase tracking-widest text-white/60">In service</label>
              <input
                type="number" min="0" value={manualInService}
                onChange={(e) => setManualInService(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 font-mono"
              />
              <button onClick={saveManual} className="bg-teal text-navy font-mono uppercase text-xs tracking-widest py-2 px-4 rounded-md">
                Apply
              </button>
            </div>
          )}

          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <div className="text-xs uppercase tracking-widest text-white/60 mb-2">Activity</div>
            <ul className="space-y-1 text-sm font-mono">
              {log.length === 0 && <li className="text-white/40">No activity yet.</li>}
              {log.map((l, i) => (
                <li
                  key={i}
                  className={
                    l.kind === "error" ? "text-crimson" :
                    l.kind === "warn" ? "text-amber" :
                    l.kind === "ok" ? "text-teal" :
                    l.kind === "muted" ? "text-white/40" : "text-white/80"
                  }
                >
                  <span className="text-white/40 mr-2">{l.t.toLocaleTimeString()}</span>{l.msg}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {maskEditorOpen && (
        <MirrorMaskEditor
          snapshotUrl={maskSnapshot}
          initialRegions={mirrorRegions}
          onSave={saveMirrorRegions}
          onClose={() => setMaskEditorOpen(false)}
        />
      )}
    </div>
  );
}
