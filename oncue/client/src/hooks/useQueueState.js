import { useState, useCallback } from "react";

export function useQueueState(initial = null) {
  const [state, setState] = useState(initial);
  const merge = useCallback((data) => {
    setState((prev) => ({ ...(prev || {}), ...data }));
  }, []);
  return [state, merge, setState];
}
