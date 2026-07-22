"use client";

import { useEffect, useState } from "react";

/**
 * Returns whether the document is currently visible (the tab is in the
 * foreground). Use this to pause background polling on hidden tabs.
 *
 * SSR-safe: returns `true` on the server and on the first client render, then
 * subscribes to `visibilitychange` after mount so a tab that loads hidden is
 * corrected on the next event.
 */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
}
