import { useEffect, useRef, useState } from "react";

export function useAnimatedNumber(value, duration = 600) {
  const [display, setDisplay] = useState(value ?? 0);
  const fromRef = useRef(value ?? 0);

  useEffect(() => {
    const from = fromRef.current;
    const to = value ?? 0;
    if (from === to) return;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return display;
}
