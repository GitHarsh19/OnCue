import { useAnimatedNumber } from "../hooks/useAnimatedNumber.js";

export default function ZoneCounter({ label, value, accent = false, big = false }) {
  const display = useAnimatedNumber(value);
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-white/10 last:border-b-0">
      <div className="text-xs uppercase tracking-[0.2em] text-white/60">{label}</div>
      <div
        className={`font-mono ${big ? "text-5xl" : "text-3xl"} ${accent ? "text-teal" : "text-white"}`}
      >
        {display}
      </div>
    </div>
  );
}
