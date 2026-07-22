/**
 * Global drawer store — module-level singleton.
 *
 * Controls which plugin page (if any) is open in the slide-out drawer.
 * Mirrors the cache-store.ts pattern: plain module with listeners, no Zustand.
 */

interface DrawerState {
  activeSlug: string | null;
  /** Optional subtitle shown in the drawer header below the plugin label. */
  subtitle: string | null;
}

let store: DrawerState = { activeSlug: null, subtitle: null };
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getDrawerState(): DrawerState {
  return store;
}

export function openDrawer(slug: string): void {
  // Toggle: clicking the active item closes the drawer
  store = { activeSlug: store.activeSlug === slug ? null : slug, subtitle: null };
  notify();
}

export function closeDrawer(): void {
  store = { activeSlug: null, subtitle: null };
  notify();
}

/** Set the subtitle shown in the drawer header (e.g. current mode or message type). */
export function setDrawerSubtitle(subtitle: string | null): void {
  if (store.subtitle === subtitle) return;
  store = { ...store, subtitle };
  notify();
}
