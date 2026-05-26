import { useEffect, useRef, useState, useCallback } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";

export function useWebSocket({ salonId, role }) {
  const [status, setStatus] = useState("connecting");
  const [data, setData] = useState(null);
  const wsRef = useRef(null);
  const retryRef = useRef(0);
  const closedByUserRef = useRef(false);

  const connect = useCallback(() => {
    closedByUserRef.current = false;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      setStatus("live");
      retryRef.current = 0;
      ws.send(JSON.stringify({ type: "subscribe", salonId, role }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "queue_update" && msg.salonId === salonId) {
          setData(msg.data);
        }
      } catch {}
    };

    ws.onclose = () => {
      setStatus("reconnecting");
      if (closedByUserRef.current) return;
      const delay = Math.min(1000 * Math.pow(2, retryRef.current), 15000);
      retryRef.current += 1;
      setTimeout(connect, delay);
    };

    ws.onerror = () => {
      try { ws.close(); } catch {}
    };
  }, [salonId, role]);

  useEffect(() => {
    if (!salonId) return;
    connect();
    return () => {
      closedByUserRef.current = true;
      try { wsRef.current?.close(); } catch {}
    };
  }, [salonId, connect]);

  return { status, data };
}
