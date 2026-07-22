"use client";

/**
 * NavigationGuard — prevents accidental loss of unsaved changes on client-side
 * navigation in the Next.js App Router (which has no router.events API).
 *
 * Usage:
 *   1. Wrap the app layout with <NavigationGuardProvider>.
 *   2. Pages with unsaved changes call registerGuard() on mount and
 *      unregisterGuard() on unmount.
 *   3. Navigation links / back buttons call guardedNavigate(href) instead of
 *      router.push(href). The sidebar does this automatically.
 *   4. Render <UnsavedChangesDialog /> inside the provider to handle the prompt.
 */

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Thrown by a guard's `save()` when the page intentionally aborts the save — e.g. the
 * user declined an overwrite-conflict prompt. UnsavedChangesDialog treats this as
 * "stay on the page" (no error shown, no navigation) rather than a save failure.
 */
export class NavigationSaveCancelled extends Error {
  constructor() {
    super("Navigation save cancelled by user");
    this.name = "NavigationSaveCancelled";
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface GuardEntry {
  /** Returns true when there are unsaved changes. Called at navigation time. */
  isDirty: () => boolean;
  /** Saves the current page state. Should throw on failure. Does NOT navigate. */
  save: () => Promise<void>;
  /** Short human-readable label, e.g. "channel changes" or "code templates". */
  label: string;
}

interface NavigationGuardContextValue {
  /** Register the current page as having potentially unsaved changes. */
  registerGuard(isDirtyFn: () => boolean, saveFn: () => Promise<void>, label: string): void;
  /** Unregister on page unmount. */
  unregisterGuard(): void;
  /**
   * Call instead of router.push() for any in-app navigation.
   * If the registered guard reports dirty state, sets pendingHref and lets the
   * UnsavedChangesDialog take over; otherwise navigates immediately.
   */
  guardedNavigate(href: string): void;
  /** The navigation destination waiting for the user's decision (null = no pending nav). */
  pendingHref: string | null;
  /** Clear pending navigation (called by dialog on Cancel or after completion). */
  clearPending(): void;
  /** The currently registered guard (null when no page has registered). */
  guard: GuardEntry | null;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function NavigationGuardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  // Use a ref so guardedNavigate always sees the latest registration without
  // needing to be re-created on every render.
  const guardRef = useRef<GuardEntry | null>(null);

  // React state drives the dialog open/close (pendingHref !== null → dialog opens).
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // Also expose the current guard entry as state so the dialog can read
  // the label and call save().  We keep it in sync with the ref.
  const [guard, setGuard] = useState<GuardEntry | null>(null);

  const registerGuard = useCallback(
    (isDirtyFn: () => boolean, saveFn: () => Promise<void>, label: string) => {
      const entry: GuardEntry = { isDirty: isDirtyFn, save: saveFn, label };
      guardRef.current = entry;
      setGuard(entry);
    },
    []
  );

  const unregisterGuard = useCallback(() => {
    guardRef.current = null;
    setGuard(null);
  }, []);

  const clearPending = useCallback(() => {
    setPendingHref(null);
  }, []);

  const guardedNavigate = useCallback(
    (href: string) => {
      const g = guardRef.current;
      if (!g || !g.isDirty()) {
        // No guard or no changes — navigate immediately.
        router.push(href);
        return;
      }
      // Has unsaved changes — show confirmation dialog.
      setPendingHref(href);
    },
    [router]
  );

  return (
    <NavigationGuardContext.Provider
      value={{ registerGuard, unregisterGuard, guardedNavigate, pendingHref, clearPending, guard }}
    >
      {children}
    </NavigationGuardContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNavigationGuard(): NavigationGuardContextValue {
  const ctx = useContext(NavigationGuardContext);
  if (!ctx) {
    throw new Error("useNavigationGuard must be used inside <NavigationGuardProvider>");
  }
  return ctx;
}
