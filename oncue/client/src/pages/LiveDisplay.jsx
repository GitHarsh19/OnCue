import { useMemo } from "react";
import { useWebSocket } from "../hooks/useWebSocket.js";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber.js";
import StatusIndicator from "../components/StatusIndicator.jsx";

const SALON_ID = "demo";

function relTime(iso) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export default function LiveDisplay() {
  const { status, data } = useWebSocket({ salonId: SALON_ID, role: "display" });
  const waiting = useAnimatedNumber(data?.waiting ?? 0, 700);

  const stale = useMemo(() => {
    if (!data?.lastUpdated) return false;
    return Date.now() - new Date(data.lastUpdated).getTime() > 10 * 60 * 1000;
  }, [data]);

  const cameraOffline = data && data.cameraOnline === false;
  const indicator = !data ? status : cameraOffline ? "offline" : stale ? "stale" : status;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between p-6">
        <div className="font-display text-2xl tracking-widest">💈 ONCUE</div>
        <StatusIndicator status={indicator} />
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-8 text-center">
        <div className="text-white/60 font-display text-2xl mb-12">Sharma's Barbershop</div>

        {cameraOffline ? (
          <div className="text-crimson font-mono text-4xl tracking-widest">CAMERA OFFLINE</div>
        ) : (
          <>
            <div className="text-white/60 uppercase tracking-[0.4em] text-lg mb-4">Waiting now</div>
            <div className="font-mono text-teal text-[10rem] sm:text-[12rem] leading-none mb-12 tabular-nums">
              {waiting}
            </div>
            <div className="w-32 border-t border-white/20 mb-12" />
            <div className="text-white/60 uppercase tracking-[0.4em] text-lg mb-3">Estimated wait</div>
            <div className="font-mono text-white text-5xl sm:text-6xl mb-12">
              {data?.estimatedWaitMins === 0 ? "no wait" : `~${data?.estimatedWaitMins ?? 0} min`}
            </div>
            <div className="text-white/50 font-mono text-lg">
              Customers served today: {data?.totalServedToday ?? 0}
            </div>
          </>
        )}
      </main>

      <footer className="p-6 flex items-center justify-between text-white/50 font-mono text-sm">
        <StatusIndicator status={indicator} />
        <div>Last updated: {relTime(data?.lastUpdated)}</div>
      </footer>
    </div>
  );
}
