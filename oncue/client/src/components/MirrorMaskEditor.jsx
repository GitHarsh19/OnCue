import { useEffect, useRef, useState } from "react";

// Modal editor: owner clicks to drop polygon vertices on a snapshot of the camera view,
// closes the polygon, and saves. Saved polygons are stored as normalized 0..1 coords on the
// salon settings and used both in the AI prompt and as a server-side filter.
export default function MirrorMaskEditor({ snapshotUrl, initialRegions = [], onSave, onClose }) {
  const wrapRef = useRef(null);
  const [regions, setRegions] = useState(initialRegions);
  const [draft, setDraft] = useState([]); // points for in-progress polygon
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    function measure() {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  function handleClick(e) {
    const rect = wrapRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setDraft((d) => [...d, { x: clamp01(x), y: clamp01(y) }]);
  }

  function finishPolygon() {
    if (draft.length < 3) return;
    setRegions((r) => [...r, { points: draft }]);
    setDraft([]);
  }

  function undoPoint() {
    setDraft((d) => d.slice(0, -1));
  }

  function clearAll() {
    if (!confirm("Clear all mirror regions?")) return;
    setRegions([]);
    setDraft([]);
  }

  function removeRegion(i) {
    setRegions((r) => r.filter((_, idx) => idx !== i));
  }

  async function save() {
    await onSave(regions);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-navy border border-white/10 rounded-lg max-w-4xl w-full max-h-[92vh] overflow-auto">
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl">Mirror mask editor</h2>
            <div className="text-white/60 text-xs font-mono mt-1">
              Click to drop points around each mirror or glass surface. Min 3 points per region.
              Detections inside these regions are filtered server-side.
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white text-2xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-4">
          {snapshotUrl ? (
            <div
              ref={wrapRef}
              onClick={handleClick}
              className="relative w-full bg-black rounded overflow-hidden cursor-crosshair select-none"
              style={{ aspectRatio: "16 / 9" }}
            >
              <img
                src={snapshotUrl}
                alt="snapshot"
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              />
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
              >
                {regions.map((r, i) => (
                  <polygon
                    key={i}
                    points={r.points.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="rgba(255, 92, 122, 0.25)"
                    stroke="#FF5C7A"
                    strokeWidth="0.004"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {draft.length > 0 && (
                  <polyline
                    points={draft.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="rgba(0, 212, 170, 0.15)"
                    stroke="#00D4AA"
                    strokeWidth="0.004"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {draft.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r="0.008"
                    fill="#00D4AA"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
              {/* numbered region labels */}
              {regions.map((r, i) => {
                const cx = r.points.reduce((s, p) => s + p.x, 0) / r.points.length;
                const cy = r.points.reduce((s, p) => s + p.y, 0) / r.points.length;
                return (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: `${cx * 100}%`,
                      top: `${cy * 100}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                    className="pointer-events-none text-crimson font-mono text-xs bg-black/70 px-1.5 py-0.5 rounded"
                  >
                    M{i + 1}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="aspect-video bg-black/60 rounded flex items-center justify-center text-white/60 text-sm font-mono">
              No snapshot — start the camera or load a video file first.
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={finishPolygon}
              disabled={draft.length < 3}
              className="bg-teal text-navy font-mono uppercase text-xs tracking-widest py-2 px-3 rounded disabled:opacity-30"
            >
              Close polygon ({draft.length} pts)
            </button>
            <button
              onClick={undoPoint}
              disabled={draft.length === 0}
              className="bg-white/10 hover:bg-white/20 text-white font-mono uppercase text-xs tracking-widest py-2 px-3 rounded disabled:opacity-30"
            >
              Undo point
            </button>
            <button
              onClick={clearAll}
              disabled={regions.length === 0 && draft.length === 0}
              className="bg-crimson/20 hover:bg-crimson/30 text-crimson border border-crimson/40 font-mono uppercase text-xs tracking-widest py-2 px-3 rounded disabled:opacity-30"
            >
              Clear all
            </button>
          </div>

          {regions.length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-widest text-white/60 mb-2">Saved regions</div>
              <ul className="space-y-1 text-sm font-mono">
                {regions.map((r, i) => (
                  <li key={i} className="flex items-center justify-between bg-white/5 rounded px-3 py-1.5">
                    <span>M{i + 1} · {r.points.length} points</span>
                    <button
                      onClick={() => removeRegion(i)}
                      className="text-crimson hover:underline text-xs uppercase tracking-widest"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/10 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="bg-white/10 hover:bg-white/20 text-white font-mono uppercase text-xs tracking-widest py-2 px-4 rounded"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="bg-teal text-navy font-mono uppercase text-xs tracking-widest py-2 px-4 rounded"
          >
            Save mask
          </button>
        </div>
      </div>
    </div>
  );
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}
