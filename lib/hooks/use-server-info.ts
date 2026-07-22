"use client";

import { useState, useEffect } from "react";
import { getServerSettings } from "@/lib/api-client";

interface ServerInfo {
  serverName?: string;
  environmentName?: string;
  autoLogoutEnabled?: boolean;
  autoLogoutMinutes?: number;
}

export const SETTINGS_SAVED_EVENT = "bl-settings-saved";

/** Dispatch after any settings save so all mounted hooks re-fetch fresh data. */
export function dispatchSettingsSaved() {
  window.dispatchEvent(new Event(SETTINGS_SAVED_EVENT));
}

// Module-level singleton — fetch happens once per app session, not once per mount.
let _cache: ServerInfo | null = null;
let _promise: Promise<ServerInfo> | null = null;

function load(): Promise<ServerInfo> {
  if (_cache) return Promise.resolve(_cache);
  if (_promise) return _promise;
  _promise = getServerSettings()
    .then((s) => {
      _cache = {
        serverName: s.serverName,
        environmentName: s.environmentName,
        autoLogoutEnabled: s.administratorAutoLogoutIntervalEnabled ?? false,
        autoLogoutMinutes: s.administratorAutoLogoutIntervalField,
      };
      return _cache;
    })
    .catch(() => {
      _promise = null; // allow retry on next mount
      return {} as ServerInfo;
    });
  return _promise;
}

/** Call on logout to ensure fresh data after re-login to a different server. */
export function clearServerInfoCache() {
  _cache = null;
  _promise = null;
}

export function useServerInfo(): ServerInfo {
  const [info, setInfo] = useState<ServerInfo>(_cache ?? {});
  useEffect(() => {
    load().then(setInfo);

    const handler = () => {
      _cache = null;
      _promise = null;
      load().then(setInfo);
    };
    window.addEventListener(SETTINGS_SAVED_EVENT, handler);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, handler);
  }, []);
  return info;
}
