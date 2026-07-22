"use client";

/**
 * ChannelCommitOverlay — mounts the auto-commit dialog in the channel editor
 *
 * The overlay fills the "channel-editor.overlay" slot in the plugin manifest
 * and is mounted by the channel editor as a generic extension point. It renders
 * nothing until signalled by the "channels.post-save" handler via module-level
 * pub-sub.
 *
 * Flow (auto-commit with prompt enabled):
 *   1. Channel editor saves → calls the "channels.post-save" slot handler (xml, mode)
 *   2. Handler: writeChannelToRepo → clearRepoChangesCache → check settings → setPendingCommit()
 *   3. setPendingCommit() notifies all mounted ChannelCommitOverlay instances
 *   4. Overlay opens CommitChannelDialog with the pending XML + default message
 *   5. User submits → commitAndPushChannel → clearRepoChangesCache → clearPendingCommit()
 */

import { clearRepoChangesCache } from "@/lib/hooks/use-repo-changes";
import { CommitChannelDialog } from "./commit-channel-dialog";
import { clearPendingChannelCommit, usePendingChannelCommit } from "./channel-commit-bus";

// The pending-commit pub-sub store lives in ./channel-commit-bus so the eager
// "channels.post-save" handler can import its setter without pulling this heavy
// overlay (and CommitChannelDialog) into the initial bundle.

// ─── Overlay component ────────────────────────────────────────────────────────

/**
 * Mounted by the channel editor as a generic plugin overlay slot.
 * Renders the CommitChannelDialog when a pending commit is signalled.
 */
export function ChannelCommitOverlay() {
  const pending = usePendingChannelCommit();

  return (
    <CommitChannelDialog
      open={!!pending}
      channelXml={pending?.channelXml ?? ""}
      userId={pending?.userId ?? 1}
      defaultMessage={pending?.defaultMessage ?? ""}
      onClose={clearPendingChannelCommit}
      onCommitted={() => {
        clearPendingChannelCommit();
        clearRepoChangesCache();
      }}
    />
  );
}
