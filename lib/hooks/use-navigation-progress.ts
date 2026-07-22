"use client";

import { useSyncExternalStore } from "react";

// ─── Module-level store ──────────────────────────────────────────────────────

let navigating = false;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function startNavigation() {
  if (!navigating) {
    navigating = true;
    notify();
  }
  // Safety fallback: always clear after 30s in case endNavigation() is never called
  if (safetyTimer) clearTimeout(safetyTimer);
  safetyTimer = setTimeout(endNavigation, 30_000);
}

export function endNavigation() {
  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
  if (navigating) {
    navigating = false;
    notify();
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  return navigating;
}

// ─── Hook for components ─────────────────────────────────────────────────────

export function useNavigationProgress() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
