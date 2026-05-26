import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { useCamera } from "../hooks/useCamera.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

function hasSignificantMotion(prev, curr, threshold = 15) {
  if (!prev) return true;
  let diffCount = 0;
  for (let i = 0; i < curr.data.length; i += 4) {
    const diff = Math.abs(curr.data[i] - prev.data[i]);
    if (diff > threshold) diffCount++;
  }
  const percentChanged = (diffCount / (curr.data.length / 4)) * 100;
  return percentChanged > 2;
}

const CameraFeed = forwardRef(function CameraFeed(
  { salonId, autoIntervalMs = 15000, enabled = true, onResult, onLog, videoFile = null, mirrorRegions = [] },
  ref
) {
  const { videoRef, error, ready } = useCamera({ videoFile });
  const canvasRef = useRef(null);
  const prevImageRef = useRef(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [lastAt, setLastAt] = useState(null);
  const [detections, setDetections] = useState([]);
  const [justUpdated, setJustUpdated] = useState(false);
  const clearTimerRef = useRef(null);
  const updatedTimerRef = useRef(null);

  const BOX_TTL_MS = 5000;
  const UPDATED_TTL_MS = 2000;

  const log = (msg, kind = "info") => onLog?.({ msg, kind, t: new Date() });

  async function captureAndAnalyze({ force = false } = {}) {
    if (!ready || analyzing) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);

    const sw = 160, sh = Math.round((h / w) * 160);
    const offscreen = document.createElement("canvas");
    offscreen.width = sw; offscreen.height = sh;
    const octx = offscreen.getContext("2d");
    octx.drawImage(video, 0, 0, sw, sh);
    const currImage = octx.getImageData(0, 0, sw, sh);

    if (!force && !hasSignificantMotion(prevImageRef.current, currImage)) {
      log("Scene stable, skipping analysis", "muted");
      prevImageRef.current = currImage;
      return;
    }
    prevImageRef.current = currImage;

    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    const base64 = dataUrl.split(",")[1];

    setAnalyzing(true);
    try {
      const res = await fetch(`${API_URL}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salonId, frameBase64: base64 }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        log(json.error || "Analysis failed", "error");
      } else {
        setLastAt(new Date());
        const dets = Array.isArray(json.detections) ? json.detections : [];
        setDetections(dets);
        setJustUpdated(true);
        if (updatedTimerRef.current) clearTimeout(updatedTimerRef.current);
        updatedTimerRef.current = setTimeout(() => setJustUpdated(false), UPDATED_TTL_MS);
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
        if (dets.length > 0) {
          clearTimerRef.current = setTimeout(() => setDetections([]), BOX_TTL_MS);
        }
        const reflMsg = json.reflectionsExcluded > 0 ? ` mirrors:${json.reflectionsExcluded}` : "";
        log(
          `waiting=${json.counts.waiting} service=${json.counts.service} entry=${json.counts.entry}${reflMsg} (${json.confidence})`,
          json.confidence === "low" ? "warn" : "ok"
        );
        onResult?.(json);
      }
    } catch (e) {
      log(`Network error: ${e.message}`, "error");
    } finally {
      setAnalyzing(false);
    }
  }

  function captureSnapshot() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  useImperativeHandle(ref, () => ({
    analyzeNow: () => captureAndAnalyze({ force: true }),
    captureSnapshot,
  }));

  useEffect(() => {
    if (!enabled || !ready) return;
    const id = setInterval(() => captureAndAnalyze({ force: false }), autoIntervalMs);
    return () => clearInterval(id);
  }, [enabled, ready, autoIntervalMs, salonId]);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      if (updatedTimerRef.current) clearTimeout(updatedTimerRef.current);
    };
  }, []);

  return (
    <div className="relative w-full aspect-video bg-black/60 rounded-lg overflow-hidden border border-white/10">
      {error ? (
        <div className="absolute inset-0 p-6 flex flex-col gap-2 items-center justify-center text-center">
          <div className="text-crimson font-mono text-sm">CAMERA ERROR</div>
          <div className="text-white/80 text-sm max-w-md">{error}</div>
          <div className="text-white/50 text-xs mt-2">
            Click the lock icon in your browser's address bar → Site settings → allow Camera, then refresh.
          </div>
        </div>
      ) : (
        <>
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          {mirrorRegions.length > 0 && (
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
            >
              {mirrorRegions.map((r, i) => (
                <polygon
                  key={i}
                  points={r.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="rgba(255, 92, 122, 0.12)"
                  stroke="#FF5C7A"
                  strokeWidth="0.003"
                  strokeDasharray="0.01,0.008"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          )}
          {detections.length > 0 && (
            <div className="absolute inset-0 pointer-events-none">
              {detections.map((d, i) => {
                const color =
                  d.zone === "waiting" ? "#FFB020" :
                  d.zone === "service" ? "#00D4AA" :
                  d.zone === "entry"   ? "#7AA2FF" :
                  d.zone === "staff"   ? "#FF5C7A" : "#FFFFFF";
                return (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: `${d.x * 100}%`,
                      top: `${d.y * 100}%`,
                      width: `${d.w * 100}%`,
                      height: `${d.h * 100}%`,
                      border: `1px solid ${color}`,
                      borderRadius: 3,
                      opacity: 0.85,
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        top: -13,
                        left: -1,
                        background: color + "cc",
                        color: "#0F1B2D",
                        fontSize: 8,
                        fontFamily: "ui-monospace, monospace",
                        padding: "0 3px",
                        borderRadius: 2,
                        whiteSpace: "nowrap",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        fontWeight: 700,
                        lineHeight: "13px",
                      }}
                    >
                      {d.zone[0].toUpperCase()}{d.label ? ` ${d.label[0].toUpperCase()}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {analyzing && <div className="scanline" />}
          <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/50 backdrop-blur px-2 py-1 rounded-md">
            <span className={`w-2 h-2 rounded-full ${analyzing ? "bg-teal pulse-dot" : justUpdated ? "bg-teal" : "bg-white/50"}`} />
            <span className="text-xs font-mono uppercase tracking-widest">
              {analyzing ? "Analyzing" : justUpdated ? "Updated" : ready ? "Live" : "Starting"}
            </span>
          </div>
          {lastAt && (
            <div className="absolute bottom-3 right-3 text-xs font-mono text-white/70 bg-black/40 px-2 py-1 rounded">
              Last: {lastAt.toLocaleTimeString()}
            </div>
          )}
        </>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
});

export default CameraFeed;
