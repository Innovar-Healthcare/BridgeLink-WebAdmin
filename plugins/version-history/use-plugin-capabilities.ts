/**
 * Capability detection for the version-history plugin.
 *
 * The WebUI ships a single build that targets both BridgeLink 26.3.0 (legacy
 * version-history plugin) and 26.3.1+ (version-history 3.0.1 with HTTPS/PAT
 * auth and Pull/Push/Reload endpoints). This hook returns flags the UI uses
 * to gate the new surfaces so users never see options that would silently
 * fail against an older server.
 *
 * Primary gate: server version compare against the session's `serverVersion`.
 * Fallback: when the version gate says "old" but the user navigates to a page
 * that would benefit from the new endpoints, probe `/remoteStatus` once and
 * upgrade the flag if it answers. Cached in sessionStorage so we don't probe
 * on every render.
 */

import { useEffect, useState } from "react";
import { PROXY_BASE } from "@/lib/api/api-core";
import { getSession } from "@/lib/auth";
import { isVersionAtLeast } from "@/lib/utils";

const MIN_SERVER_VERSION = "26.3.1";
const CACHE_KEY = "bl-version-history-caps-v1";

/**
 * The `limit` query param on the history endpoint is honored only by 26.6.0+
 * servers, which truncate the commit list server-side. Older servers silently
 * ignore the unknown param (JAX-RS drops unrecognized `@QueryParam`s and returns
 * the full, unlimited list with a 200 and no distinguishing signal). See the
 * `hasHistoryLimitParam` note below for why this is a pure static gate.
 */
const MIN_SERVER_VERSION_HISTORY_LIMIT = "26.6.0";

export interface VersionHistoryCapabilities {
  /** Pull/Push/Reload endpoints available on the server. */
  hasRemoteActions: boolean;
  /** HTTPS/PAT auth fields and SSH key-path field supported by the server. */
  hasHttpsAuth: boolean;
  /** Server honors the `limit` query param on the history endpoint (26.6.0+). */
  hasHistoryLimitParam: boolean;
}

function readCache(): boolean | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(CACHE_KEY);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

function writeCache(supported: boolean) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(CACHE_KEY, supported ? "true" : "false");
}

/**
 * Probe `GET /plugins/version-history/remoteStatus` to determine whether the
 * server has the 3.0.1 plugin endpoints. 200 → supported, 503 (Git not
 * connected) → endpoint exists so still supported, 404 → endpoint missing.
 * Any other error is treated as "unknown" and does not flip the cached flag.
 */
async function probeRemoteStatus(): Promise<boolean | null> {
  try {
    const serverUrl = getSession()?.serverUrl ?? "";
    const res = await fetch(`${PROXY_BASE}/plugins/version-history/remoteStatus`, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
      },
    });
    if (res.status === 404) return false;
    if (res.ok || res.status === 503) return true;
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns capability flags for the version-history plugin. `enableProbe`
 * controls whether the fallback endpoint probe runs when the version gate is
 * false — pass true only from surfaces that would benefit from the new UI
 * (Status tab, Settings dialog).
 */
export function usePluginCapabilities(enableProbe: boolean = false): VersionHistoryCapabilities {
  const versionFlag = isVersionAtLeast(getSession()?.serverVersion, MIN_SERVER_VERSION);

  // Pure static version gate — unlike `hasRemoteActions`, there is no HTTP signal
  // to probe for `limit` support (old servers ignore the unknown query param and
  // still answer 200 with the full list), so a version compare is the only tell.
  const hasHistoryLimitParam = isVersionAtLeast(
    getSession()?.serverVersion,
    MIN_SERVER_VERSION_HISTORY_LIMIT
  );

  const [supported, setSupported] = useState<boolean>(() => {
    if (versionFlag) return true;
    return readCache() ?? false;
  });

  // Write through the version-derived "true" verdict to the cache so a later
  // mount with `enableProbe=true` skips the probe even before render.
  useEffect(() => {
    if (versionFlag) writeCache(true);
  }, [versionFlag]);

  useEffect(() => {
    if (versionFlag) return;
    if (!enableProbe) return;
    if (readCache() !== null) return;

    let cancelled = false;
    void probeRemoteStatus().then((result) => {
      if (cancelled || result === null) return;
      writeCache(result);
      setSupported(result);
    });
    return () => {
      cancelled = true;
    };
  }, [versionFlag, enableProbe]);

  return { hasRemoteActions: supported, hasHttpsAuth: supported, hasHistoryLimitParam };
}
