import ZoneCounter from "./ZoneCounter.jsx";

export default function QueueBoard({ data }) {
  const d = data || {};
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-4">
      <ZoneCounter label="Waiting" value={d.waiting ?? 0} accent />
      <ZoneCounter label="In chair" value={d.inService ?? 0} />
      <ZoneCounter label="Wait time (min)" value={d.estimatedWaitMins ?? 0} />
      <ZoneCounter label="Served today" value={d.totalServedToday ?? 0} />
    </div>
  );
}
