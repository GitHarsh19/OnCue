export default function StatusIndicator({ status, label }) {
  const map = {
    live: { color: "bg-teal", text: "LIVE", pulse: true },
    stale: { color: "bg-amber", text: "STALE", pulse: false },
    offline: { color: "bg-crimson", text: "OFFLINE", pulse: false },
    reconnecting: { color: "bg-amber", text: "RECONNECTING", pulse: true },
    connecting: { color: "bg-amber", text: "CONNECTING", pulse: true },
  };
  const s = map[status] || map.offline;
  return (
    <div className="flex items-center gap-2 text-xs uppercase tracking-widest">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${s.color} ${s.pulse ? "pulse-dot" : ""}`} />
      <span className="font-mono text-white/80">{label || s.text}</span>
    </div>
  );
}
