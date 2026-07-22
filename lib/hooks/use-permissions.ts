"use client";

import { useState, useEffect, useCallback } from "react";
import { pluginRegistry } from "@/lib/plugin-registry";
import type { PermissionLevel } from "@/lib/plugin-registry";

export type { PermissionLevel };

export interface Permissions {
  /** Returns false only when the permission is exactly "No Permission". */
  hasPermission: (key: string) => boolean;
  /** Returns the raw permission level for future view-only gating. */
  getPermissionLevel: (key: string) => PermissionLevel;
  /** Returns true when the permission level is exactly "View" (read-only). */
  isViewOnly: (key: string) => boolean;
  /** True while the initial permission fetch is in progress. */
  loading: boolean;
  /** Re-fetch permissions (e.g. after RBAC settings are saved). */
  refresh: () => void;
}

// Module-level cache so multiple hook consumers share one fetch.
let _cache: Map<string, PermissionLevel> | null = null;
let _promise: Promise<Map<string, PermissionLevel> | null> | null = null;

/** Clear the permission cache (call on logout). */
export function clearPermissionsCache() {
  _cache = null;
  _promise = null;
}

async function loadPermissions(): Promise<Map<string, PermissionLevel> | null> {
  if (_cache !== undefined && _cache !== null) return _cache;
  if (_promise) return _promise;

  _promise = (async () => {
    try {
      if (!pluginRegistry.permissionsProvider) {
        // No RBAC plugin registered → allow-all
        _cache = null;
        return null;
      }
      const result = await pluginRegistry.permissionsProvider();
      _cache = result;
      return result;
    } catch {
      // On error (plugin not installed, network issue) → allow-all
      _promise = null;
      return null;
    }
  })();

  return _promise;
}

function getLevel(perms: Map<string, PermissionLevel> | null, key: string): PermissionLevel {
  if (!perms) return "Editor"; // null map = allow-all
  return perms.get(key) ?? "Editor"; // unknown key = allowed
}

export function usePermissions(): Permissions {
  const [perms, setPerms] = useState<Map<string, PermissionLevel> | null>(_cache);
  const [loading, setLoading] = useState(_cache === null && _promise === null);

  const doLoad = useCallback(() => {
    setLoading(true);
    loadPermissions()
      .then(setPerms)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    doLoad();
  }, [doLoad]);

  const refresh = useCallback(() => {
    _cache = null;
    _promise = null;
    doLoad();
  }, [doLoad]);

  const hasPermission = useCallback(
    (key: string): boolean => {
      return getLevel(perms, key) !== "No Permission";
    },
    [perms]
  );

  const getPermissionLevel = useCallback(
    (key: string): PermissionLevel => {
      return getLevel(perms, key);
    },
    [perms]
  );

  const isViewOnly = useCallback(
    (key: string): boolean => {
      return getLevel(perms, key) === "View";
    },
    [perms]
  );

  return { hasPermission, getPermissionLevel, isViewOnly, loading, refresh };
}
