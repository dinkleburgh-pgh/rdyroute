import { useState, useCallback } from "react";

const PREFIX = "readyroutev2_collapse_";

export function useCollapseState(key: string, defaultOpen = true) {
  const lsKey = PREFIX + key;
  const [open, setOpenState] = useState(() => {
    try {
      const raw = localStorage.getItem(lsKey);
      return raw !== null ? raw === "true" : defaultOpen;
    } catch { return defaultOpen; }
  });

  const toggle = useCallback(() => {
    setOpenState((prev) => {
      const next = !prev;
      try { localStorage.setItem(lsKey, String(next)); } catch { }
      return next;
    });
  }, [lsKey]);

  return { open, toggle };
}