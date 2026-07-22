"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { logout } from "@/lib/api-client";
import { useServerInfo } from "@/lib/hooks/use-server-info";
import { clearClientCaches } from "@/lib/logout";

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
];

/** Minimum ms between activity timestamp updates to avoid excessive writes. */
const THROTTLE_MS = 5_000;

/** How often (ms) to check whether the idle timeout has been exceeded. */
const CHECK_INTERVAL_MS = 30_000;

/**
 * Monitors user activity and auto-logs out after the server-configured idle interval.
 * No-op when auto-logout is disabled in server settings.
 */
export function useIdleLogout() {
  const { autoLogoutEnabled, autoLogoutMinutes } = useServerInfo();
  const router = useRouter();

  const lastActivityRef = useRef(0);
  const lastUpdateRef = useRef(0);
  const loggingOutRef = useRef(false);

  useEffect(() => {
    if (!autoLogoutEnabled || !autoLogoutMinutes || autoLogoutMinutes <= 0) return;

    // Initialize activity timestamps on mount
    lastActivityRef.current = Date.now();
    lastUpdateRef.current = Date.now();

    const timeoutMs = autoLogoutMinutes * 60 * 1000;

    function resetActivity() {
      const now = Date.now();
      if (now - lastUpdateRef.current < THROTTLE_MS) return;
      lastActivityRef.current = now;
      lastUpdateRef.current = now;
    }

    async function performLogout() {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;
      try {
        await logout();
      } catch {
        // ignore — clear session regardless
      }
      clearClientCaches();
      router.replace("/login");
    }

    function checkIdle() {
      if (loggingOutRef.current) return;
      const idle = Date.now() - lastActivityRef.current;
      if (idle >= timeoutMs) {
        performLogout();
      }
    }

    // Attach activity listeners
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, resetActivity, { passive: true });
    }

    // Periodic idle check
    const intervalId = setInterval(checkIdle, CHECK_INTERVAL_MS);

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, resetActivity);
      }
      clearInterval(intervalId);
    };
  }, [autoLogoutEnabled, autoLogoutMinutes, router]);
}
