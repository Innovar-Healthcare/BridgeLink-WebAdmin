"use client";

/**
 * Channel-commit pub-sub bus (extracted from channel-commit-overlay.tsx for
 *.
 *
 * The "channels.post-save" slot handler in the plugin manifest must call
 * `setPendingChannelCommit()` synchronously on every channel save, so that
 * setter has to be import-cheap. The `ChannelCommitOverlay` that consumes these
 * signals, by contrast, is a heavy component (it pulls in CommitChannelDialog)
 * and is lazy-loaded via lazyPluginComponent. Keeping the tiny module-level
 * store here — separate from the overlay — lets `index.ts` eager-import the
 * setter without dragging the overlay's component graph into the app-shell
 * bundle. Mirrors the claude-ai `overlay-trigger.ts` extraction.
 *
 * Both the eager setter and the lazily-loaded overlay import THIS module, so
 * they share the same singleton store instance.
 */

import { useEffect, useReducer } from "react";
import { registerCacheTeardown } from "@/lib/logout";

export interface PendingCommit {
  channelXml: string;
  userId: number;
  defaultMessage: string;
  resolve: () => void;
}

let _pending: PendingCommit | null = null;
const _subs = new Set<() => void>();

/**
 * Signal the overlay to show the commit dialog and return a Promise that
 * resolves when the dialog is closed (committed or cancelled). The caller
 * (postChannelSaveHandler) awaits this so that Save & Deploy waits for the
 * user to interact before proceeding to deploy.
 *
 * If no overlay is mounted (plugin disabled, race on unmount), resolves
 * immediately so the save flow does not hang.
 */
export function setPendingChannelCommit(data: Omit<PendingCommit, "resolve">): Promise<void> {
  return new Promise<void>((resolve) => {
    if (_subs.size === 0) {
      resolve();
      return;
    }
    _pending = { ...data, resolve };
    _subs.forEach((cb) => cb());
  });
}

/** Clear the pending commit (called when user dismisses or commits). */
export function clearPendingChannelCommit(): void {
  const resolve = _pending?.resolve;
  _pending = null;
  _subs.forEach((cb) => cb());
  resolve?.();
}

/**
 * Drop the pending commit on session teardown (login/logout/401).
 *
 * `_pending` holds the full channel XML plus the saving user's `userId`, and
 * `usePendingChannelCommit()` reads the module variable on first render — so without
 * this, an idle-logout while the commit dialog is open leaves user A's channel content
 * sitting in memory, and the next user to open a channel editor gets A's commit dialog
 * pre-filled, with a Commit button that would write to the version-history repo under
 * A's user id.
 *
 * Deliberately neither notifies subscribers nor calls `resolve()`, unlike
 * `clearPendingChannelCommit()`. Resolving would let the suspended
 * `postChannelSaveHandler` continue into its deploy step against the session teardown
 * just ended; that 401 hard-redirects to `/login?returnUrl=...` instead of the clean
 * `/login` the logout paths produce. Leaving the save flow suspended on a page that is
 * already navigating to /login is the cheaper of the two.
 */
function resetPendingChannelCommit(): void {
  _pending = null;
}

registerCacheTeardown(resetPendingChannelCommit);

/** Hook: subscribe to pending-commit signals and return the current value. */
export function usePendingChannelCommit(): PendingCommit | null {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _subs.add(forceUpdate);
    return () => {
      _subs.delete(forceUpdate);
    };
  }, []);
  return _pending;
}
