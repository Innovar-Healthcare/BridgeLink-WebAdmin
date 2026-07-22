"use client";

import { useCallback, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { bulkUpdateChannelGroups } from "@/lib/api-client";
import type { ChannelGroup } from "@/lib/types";

/** Outcome of a channel-group save attempt. `"cancelled"` means the user declined an overwrite. */
export type ChannelGroupSaveResult = "saved" | "cancelled";

// Exact wording from Java ChannelPanel.attemptUpdate (ChannelPanel.java:751).
export const CHANNEL_GROUP_CONFLICT_MESSAGE =
  "One or more channel groups have been modified since you last refreshed. Do you want to overwrite the changes?";

/**
 * Shared channel-group save flow that mirrors Java `ChannelPanel.attemptUpdate`:
 * attempt the bulk update with `override=false` first, and only if the server reports the
 * local set is out of sync, prompt the user before retrying with `override=true`.
 *
 * Usage: call `saveGroups(...)` from a save handler and mount `conflictDialog` in the component
 * tree. `saveGroups` resolves `"saved"` once the update is applied or `"cancelled"` if the user
 * declines the overwrite; it throws on genuine API errors (callers keep their existing catch).
 */
export function useChannelGroupSave() {
  const [conflictOpen, setConflictOpen] = useState(false);
  const resolverRef = useRef<((overwrite: boolean) => void) | null>(null);

  const saveGroups = useCallback(
    async (groups: ChannelGroup[], removedGroupIds: string[]): Promise<ChannelGroupSaveResult> => {
      const applied = await bulkUpdateChannelGroups(groups, removedGroupIds, false);
      if (applied) return "saved";

      // Server rejected the save as out-of-sync. Ask before forcing the overwrite.
      const overwrite = await new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setConflictOpen(true);
      });
      setConflictOpen(false);
      resolverRef.current = null;
      if (!overwrite) return "cancelled";

      await bulkUpdateChannelGroups(groups, removedGroupIds, true);
      return "saved";
    },
    []
  );

  const conflictDialog = conflictOpen ? (
    <ConfirmDialog
      title="Overwrite Changes?"
      description={CHANNEL_GROUP_CONFLICT_MESSAGE}
      confirmLabel="Overwrite"
      confirmVariant="default"
      onConfirm={() => resolverRef.current?.(true)}
      onCancel={() => resolverRef.current?.(false)}
    />
  ) : null;

  return { saveGroups, conflictDialog };
}
