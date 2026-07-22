/**
 * Transient hand-off for an imported channel that should open in the channel
 * editor for review before being saved.
 *
 * The import dialogs live on the /channels page; the channel editor is a
 * separate route. To match the Java client — which opens an imported channel in
 * the editor and only persists it when the user clicks Save — the dialog stashes
 * the resolved channel XML here, then navigates to the editor route. The editor
 * consumes (reads-and-clears) the pending import in its init effect and seeds
 * itself with it.
 *
 * This is a module-level singleton (same pattern as cache-store.ts). It is held
 * only in memory and clears on a hard reload, which is the desired behavior for
 * unsaved data — a stale import must not resurrect after a refresh.
 */
import { registerCacheTeardown } from "@/lib/logout";

export interface PendingChannelImport {
  /** Fully-resolved channel XML (id/name/revision already settled by the dialog). */
  xml: string;
  /** "new" → POST /channels; "overwrite" → PUT /channels/{id}?override=true. */
  mode: "new" | "overwrite";
  /** Target channel id — required when mode === "overwrite". */
  channelId?: string;
}

let pending: PendingChannelImport | null = null;

/** Stash an imported channel for the editor to pick up after navigation. */
export function setPendingChannelImport(p: PendingChannelImport): void {
  pending = p;
}

/** Read and clear the pending import. Returns null if none is queued. */
export function takePendingChannelImport(): PendingChannelImport | null {
  const p = pending;
  pending = null;
  return p;
}

/** Discard any queued import without consuming it. */
export function clearPendingChannelImport(): void {
  pending = null;
}

// A stashed import holds channel XML; drop it on session teardown so it can't be
// handed off to the next user who opens the editor.
registerCacheTeardown(clearPendingChannelImport);
