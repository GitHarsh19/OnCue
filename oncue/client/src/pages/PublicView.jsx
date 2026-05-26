import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useWebSocket } from "../hooks/useWebSocket.js";
import StatusIndicator from "../components/StatusIndicator.jsx";

const OPEN_HOUR = 9;
const CLOSE_HOUR = 21;

function isOpen() {
  const h = new Date().getHours();
  return h >= OPEN_HOUR && h < CLOSE_HOUR;
}

export default function PublicView() {
  const { salonId } = useParams();
  const { status, data } = useWebSocket({ salonId, role: "public" });

  const stale = useMemo(() => {
    if (!data?.lastUpdated) return false;
    return Date.now() - new Date(data.lastUpdated).getTime() > 10 * 60 * 1000;
  }, [data]);

  const cameraOffline = data && data.cameraOnline === false;
  const indicator = !data ? status : cameraOffline ? "offline" : stale ? "stale" : status;
  const open = isOpen();

  function share() {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: "OnCue", url }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(url);
      alert("Link copied to clipboard");
    }
  }

  return (
    <div className="min-h-screen p-4 flex flex-col items-center">
      <div className="w-full max-w-md space-y-4">
        <header className="flex items-center justify-between pt-2">
          <div className="font-display text-xl">💈 OnCue</div>
          <StatusIndicator status={indicator} />
        </header>

        <div className="bg-white/5 border border-white/10 rounded-xl p-6 text-center">
          <div className="text-white/60 text-sm font-mono uppercase tracking-widest mb-2">
            Sharma's Barbershop
          </div>
          <div className={`text-xs font-mono uppercase tracking-widest mb-4 ${open ? "text-teal" : "text-crimson"}`}>
            {open ? "Open now" : "Closed"}
          </div>

          {cameraOffline ? (
            <div className="text-crimson font-mono text-xl py-8">Camera offline</div>
          ) : (
            <>
              <div className="text-white/60 uppercase tracking-[0.3em] text-xs mb-2">Waiting now</div>
              <div className="font-mono text-teal text-7xl leading-none mb-4 tabular-nums">
                {data?.waiting ?? 0}
              </div>
              <div className="text-white/60 uppercase tracking-[0.3em] text-xs mb-1">Estimated wait</div>
              <div className="font-mono text-white text-3xl mb-2">
                {data?.estimatedWaitMins === 0 ? "no wait" : `~${data?.estimatedWaitMins ?? 0} min`}
              </div>
              <div className="text-white/50 font-mono text-sm mt-4">
                Served today: {data?.totalServedToday ?? 0}
              </div>
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={share}
            className="bg-white/10 hover:bg-white/20 text-white font-mono uppercase text-xs tracking-widest py-3 rounded-md"
          >
            Share
          </button>
          <a
            href="https://maps.google.com/?q=Sharma's+Barbershop"
            target="_blank"
            rel="noreferrer"
            className="bg-teal text-navy font-mono uppercase text-xs tracking-widest py-3 rounded-md text-center"
          >
            Get directions
          </a>
        </div>

        <div className="text-center text-white/40 font-mono text-xs pt-4">
          Salon ID: {salonId}
        </div>
      </div>
    </div>
  );
}
