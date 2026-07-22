"use client";

import { useState, useEffect } from "react";
import { getServerSettings } from "@/lib/api-client";
import { SETTINGS_SAVED_EVENT } from "@/lib/hooks/use-server-info";
import { registerCacheTeardown } from "@/lib/logout";

// ─── Color parsing helpers ────────────────────────────────────────────────────

function serverColorToHex(
  c:
    | {
        red?: number;
        green?: number;
        blue?: number;
        r?: number;
        g?: number;
        b?: number;
        value?: number;
        alpha?: number;
      }
    | null
    | undefined
): string | null {
  if (!c) return null;
  let r: number | undefined, g: number | undefined, b: number | undefined;
  if (c.value !== undefined) {
    r = (c.value >> 16) & 0xff;
    g = (c.value >> 8) & 0xff;
    b = c.value & 0xff;
  } else {
    r = c.red ?? c.r;
    g = c.green ?? c.g;
    b = c.blue ?? c.b;
  }
  if (r === undefined || g === undefined || b === undefined) return null;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ─── Module-level cache (one fetch per app session) ───────────────────────────

let _serverDefaultHex: string | null | undefined = undefined; // undefined = not loaded
let _serverPromise: Promise<string | null> | null = null;

function loadServerDefault(): Promise<string | null> {
  if (_serverDefaultHex !== undefined) return Promise.resolve(_serverDefaultHex);
  if (_serverPromise) return _serverPromise;
  _serverPromise = getServerSettings()
    .then((s) => {
      _serverDefaultHex = serverColorToHex(s.defaultAdministratorBackgroundColor) ?? null;
      return _serverDefaultHex;
    })
    .catch(() => {
      _serverPromise = null;
      return null;
    });
  return _serverPromise;
}

/** Call on logout to allow fresh data after re-login. */
export function clearBackgroundColorCache() {
  _serverDefaultHex = undefined;
  _serverPromise = null;
}
// Server theme default is per-server; reset it on session teardown.
registerCacheTeardown(clearBackgroundColorCache);

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the effective background color hex string (e.g. "#9eb1c9"), sourced
 * from the server-wide default (defaultAdministratorBackgroundColor, set on the
 * Server settings tab), or null if none is configured.
 *
 * This is the single source of truth for the theme color — there is no per-user
 * override. Placement of the tint is controlled separately by useColorPlacement.
 */
async function resolveColor(): Promise<string | null> {
  return (await loadServerDefault()) ?? null;
}

export function useBackgroundColor(): string | null {
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveColor().then((c) => {
      if (!cancelled) setColor(c);
    });

    const handler = () => {
      _serverDefaultHex = undefined;
      _serverPromise = null;
      resolveColor().then(setColor);
    };
    window.addEventListener(SETTINGS_SAVED_EVENT, handler);
    return () => {
      cancelled = true;
      window.removeEventListener(SETTINGS_SAVED_EVENT, handler);
    };
  }, []);

  return color;
}
