import { useState, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { userScopedKey } from "@/lib/auth";

/**
 * Reads a value from localStorage synchronously. Returns `undefined` when
 * running on the server or when no value has been stored yet.
 */
function readLocal<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return JSON.parse(raw) as T;
  } catch {
    /* ignore parse errors */
  }
  return undefined;
}

/**
 * Like useState, but persists to localStorage so the value survives a full
 * browser restart (unlike useSessionState, which is cleared on tab close).
 * Keys are user-scoped (via userScopedKey) so different users on the same
 * browser don't share state.
 *
 * `migrateFromSession` (default true): on first mount, if localStorage has no
 * value for this key but sessionStorage does (from a prior useSessionState),
 * that value is adopted once so an in-flight session isn't lost when a caller
 * migrates a key from session- to local-storage.
 */
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
  migrateFromSession = true
): [T, Dispatch<SetStateAction<T>>] {
  const scopedKey = typeof window !== "undefined" ? userScopedKey(key) : key;

  const [value, setValue] = useState<T>(() => {
    const local = readLocal<T>(scopedKey);
    if (local !== undefined) return local;
    if (migrateFromSession && typeof window !== "undefined") {
      try {
        const raw = sessionStorage.getItem(scopedKey);
        if (raw !== null) {
          // One-time adoption: clear the session copy so it can't resurrect if
          // the localStorage value is later cleared/corrupted in this tab.
          sessionStorage.removeItem(scopedKey);
          return JSON.parse(raw) as T;
        }
      } catch {
        /* ignore */
      }
    }
    return defaultValue;
  });

  useEffect(() => {
    try {
      localStorage.setItem(scopedKey, JSON.stringify(value));
    } catch {
      /* ignore quota errors */
    }
  }, [scopedKey, value]);

  return [value, setValue];
}
