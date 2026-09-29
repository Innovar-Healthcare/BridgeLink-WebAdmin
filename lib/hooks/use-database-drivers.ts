"use client";

import { useEffect, useState } from "react";
import { getDatabaseDrivers, setDatabaseDrivers } from "../api/api-database";
import { registerCacheTeardown } from "@/lib/logout";
import type { DriverInfo } from "../types";

// ─── Module-level singleton cache ─────────────────────────────────────────────
// Mirrors the cache-store.ts pattern: all components share one fetch result.
// Drivers are rarely changed, so we fetch once and invalidate after each save.

interface DriverStore {
  drivers: DriverInfo[];
  loading: boolean;
  error: string;
  fetched: boolean;
}

function emptyStore(): DriverStore {
  return { drivers: [], loading: false, error: "", fetched: false };
}

let store: DriverStore = emptyStore();

/**
 * Drop the cached driver list so the next mount re-fetches. Registered as a session
 * teardown (login/logout/401) — the list is server state and must not survive into
 * another user's session.
 *
 * Deliberately does not notify listeners: teardown runs while the app tree is still
 * mounted, and the mount effect below has `[]` deps, so a re-render could not re-fetch
 * anyway — it would only risk rendering against a dead session.
 */
export function clearDatabaseDriversCache(): void {
  store = emptyStore();
}

registerCacheTeardown(clearDatabaseDriversCache);

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

function setStore(next: Partial<DriverStore>) {
  store = { ...store, ...next };
  notifyListeners();
}

async function doFetch() {
  if (store.loading) return;
  setStore({ loading: true, error: "" });
  try {
    const drivers = await getDatabaseDrivers();
    setStore({ drivers, loading: false, fetched: true });
  } catch (err) {
    setStore({
      loading: false,
      fetched: true,
      error: err instanceof Error ? err.message : "Failed to load drivers",
    });
  }
}

async function doSave(drivers: DriverInfo[]): Promise<void> {
  await setDatabaseDrivers(drivers);
  // Optimistically update the cache, then confirm with a refetch.
  setStore({ drivers, fetched: true });
  doFetch();
}

// ─── React hook ───────────────────────────────────────────────────────────────

/**
 * Returns the server-registered JDBC driver list, shared across all consumers.
 * First mount triggers a fetch; subsequent mounts reuse the cached list.
 * `save(next)` replaces the full list and refreshes all subscribers.
 */
export function useDatabaseDrivers() {
  const [, rerender] = useState(0);

  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    listeners.add(fn);

    if (!store.fetched && !store.loading) {
      doFetch();
    }

    return () => {
      listeners.delete(fn);
    };
  }, []);

  return {
    drivers: store.drivers,
    loading: store.loading,
    error: store.error,
    refetch: doFetch,
    save: doSave,
  };
}
