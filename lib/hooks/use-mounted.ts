"use client";

import { useEffect, useState } from "react";

/**
 * Returns true only after the component has mounted on the client.
 * Use this to avoid SSR/hydration mismatches for client-only content
 * (timestamps, locale-formatted dates, etc.)
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Intentional: setState in effect is the correct pattern here.
    // A lazy initializer would return true on the server (SSR), causing a
    // hydration mismatch. The effect only runs on the client after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  return mounted;
}
