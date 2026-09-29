"use client";

/**
 * Catalog derive layer for the script reference data.
 *
 * Bridges three pieces:
 *   - the raw server list in the shared cache-store (`scriptReferences`),
 *   - the server→client adapter (`assembleCatalog`),
 *   - the frozen client `CATEGORIES` used as the fallback.
 *
 * Two read paths, both returning the SAME `RefCategory[]` shape so every consumer is
 * source-agnostic:
 *   - {@link useScriptReferenceCatalog} — React hook; subscribes to the store so the
 *     catalog re-renders when the fetch lands, and triggers that fetch once per session.
 *   - {@link getScriptReferenceCatalog} — plain synchronous getter for the non-React
 *     Monaco completion provider (`monaco-rhino.ts`), which reads it fresh on each
 *     keystroke and so picks up the loaded catalog without re-registration.
 *
 * When the connected Core predates the endpoint, or the fetch hasn't landed (or failed),
 * both return the full frozen client `CATEGORIES` — old servers look exactly as before.
 */

import { useEffect, useMemo } from "react";
import { getCache, updateScriptReferences } from "@/lib/cache-store";
import { getSession } from "@/lib/auth";
import { useCacheSelector } from "@/lib/hooks/use-cache";
import {
  fetchScriptReferences,
  serverSupportsScriptReferences,
} from "@/lib/api/api-script-references";
import { assembleCatalog } from "@/lib/script-references-adapter";
import { CATEGORIES, CLIENT_ONLY_CATEGORIES, type RefCategory } from "@/lib/reference-data";
import { logWarn } from "@/lib/dev-logger";

// Memoize the assembled catalog by the raw-refs array identity, so the per-keystroke
// Monaco reads don't re-bucket ~200 items every time. Reset implicitly when the store
// swaps in a new array (fetch landing) or clears to null (login).
let memoInput: RefCategory[] | null = null;
let memoRefsIdentity: unknown = null;

/** Dedupe concurrent first-load fetches across simultaneously-mounted hooks. */
let inFlight: Promise<void> | null = null;

/**
 * Fetch the server catalog once per session. No-op when the server predates the endpoint,
 * when a fetch already landed, or when one is already in flight. Failures are non-fatal —
 * consumers keep the frozen client catalog.
 */
export function loadScriptReferences(): void {
  if (!serverSupportsScriptReferences()) return;
  if (getCache().scriptReferences || inFlight) return;
  const requestedServer = getSession()?.serverUrl;
  inFlight = fetchScriptReferences()
    .then((refs) => {
      // Discard if the session changed under us (logout / server switch mid-fetch), so a
      // stale catalog can't repopulate the just-cleared store and stick for the next session.
      if (getSession()?.serverUrl === requestedServer) updateScriptReferences(refs);
    })
    .catch((err) => {
      logWarn("script-references", "catalog fetch failed; using frozen client catalog", err);
    })
    .finally(() => {
      inFlight = null;
    });
}

/**
 * Derive the `RefCategory[]` catalog from a raw server list: server-derived + client-only
 * when loaded (and the server supports it), otherwise the frozen client `CATEGORIES`.
 * Memoized by the refs array identity so repeated calls with unchanged input are cheap.
 */
function deriveCatalog(refs: ReturnType<typeof getCache>["scriptReferences"]): RefCategory[] {
  // Empty array (a server-side glitch) is treated as "not loaded" so the panel never
  // collapses to just the client-only categories.
  if (!refs || refs.length === 0 || !serverSupportsScriptReferences()) return CATEGORIES;
  if (refs === memoRefsIdentity && memoInput) return memoInput;
  memoRefsIdentity = refs;
  memoInput = assembleCatalog(refs, CLIENT_ONLY_CATEGORIES);
  return memoInput;
}

/**
 * The current reference catalog as `RefCategory[]`. Synchronous getter for the non-React
 * Monaco completion provider — reads the shared store fresh on each call.
 */
export function getScriptReferenceCatalog(): RefCategory[] {
  return deriveCatalog(getCache().scriptReferences);
}

/**
 * React hook returning the reference catalog, triggering the one-time server fetch on
 * mount and re-rendering when it lands. Callers apply their own category/context filtering
 * on top, exactly as they did against the static `CATEGORIES` import.
 */
export function useScriptReferenceCatalog(): RefCategory[] {
  const refs = useCacheSelector((s) => s.scriptReferences);
  useEffect(() => {
    loadScriptReferences();
  }, []);
  return useMemo(() => deriveCatalog(refs), [refs]);
}
