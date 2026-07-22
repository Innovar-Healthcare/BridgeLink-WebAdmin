import { useState, useEffect, useMemo, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { userScopedKey } from "@/lib/auth";

/**
 * Reads a value from sessionStorage synchronously. Returns `undefined` when
 * running on the server or when no value has been stored yet.
 */
function readSession<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw !== null) return JSON.parse(raw) as T;
  } catch {
    /* ignore parse errors */
  }
  return undefined;
}

/**
 * Like useState, but persists to sessionStorage so the value survives
 * same-session navigation (e.g. switching between Dashboard and Channels).
 *
 * Keys are automatically scoped to the logged-in user (e.g. "admin:bl-filter-...")
 * so different users on the same browser don't share filter/search state.
 *
 * State is initialized synchronously from sessionStorage via the lazy-initializer
 * so navigating back to a page restores filter values immediately — no extra
 * render cycle / flash of default state.  The first server render always uses
 * `defaultValue` (window is undefined on the server) so hydration stays clean.
 */
export function useSessionState<T>(key: string, defaultValue: T): [T, Dispatch<SetStateAction<T>>] {
  // Scope the key to the current user so filters don't leak across logins
  const scopedKey = typeof window !== "undefined" ? userScopedKey(key) : key;

  const [value, setValue] = useState<T>(() => readSession<T>(scopedKey) ?? defaultValue);

  // Keep sessionStorage in sync whenever the value changes.
  useEffect(() => {
    try {
      sessionStorage.setItem(scopedKey, JSON.stringify(value));
    } catch {
      /* ignore quota errors */
    }
  }, [scopedKey, value]);

  return [value, setValue];
}

/**
 * Variant of useSessionState for Set<string>.
 * Serialises as a JSON array; exposes the same (set, setter) interface
 * expected by MultiSelectDropdown's onChange prop.
 */
export function useSessionSet(key: string): [Set<string>, (next: Set<string>) => void] {
  const [arr, setArr] = useSessionState<string[]>(key, []);
  const set = useMemo(() => new Set(arr), [arr]);
  const setSet = useCallback((next: Set<string>) => setArr([...next]), [setArr]);
  return [set, setSet];
}
