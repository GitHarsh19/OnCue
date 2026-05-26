export default function WaitTimeBadge({ minutes }) {
  const m = typeof minutes === "number" ? minutes : 0;
  const label = m === 0 ? "no wait" : `~${m} min`;
  return (
    <div className="inline-flex items-baseline gap-2 font-mono text-teal">
      <span className="text-4xl">{label}</span>
    </div>
  );
}
