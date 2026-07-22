"use client";

import { useState } from "react";
import { FormDialog } from "@/components/form-dialog";
import type { ChannelGroup } from "@/lib/types";
import { useChannelGroupSave } from "../_lib/use-channel-group-save";

/** Virtual ID for the [Default Group] — channels not in any named group. */
const DEFAULT_GROUP_ID = "Default Group";

export function AssignGroupDialog({
  open,
  onClose,
  onAssigned,
  selectedIds,
  channelGroups,
}: {
  open: boolean;
  onClose: () => void;
  onAssigned: () => void;
  selectedIds: Set<string>;
  channelGroups: ChannelGroup[];
}) {
  const { saveGroups, conflictDialog } = useChannelGroupSave();
  const [groupId, setGroupId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form state each time the dialog transitions to open. Done during render
  // (the React "adjusting state when a prop changes" idiom) rather than in an effect,
  // which avoids the cascading-render warning from react-hooks/set-state-in-effect.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setGroupId(DEFAULT_GROUP_ID);
      setError(null);
    }
  }

  async function handleAssign() {
    setLoading(true);
    setError(null);
    try {
      const ids = [...selectedIds];
      // Remove selected channels from all named groups, then add to the chosen one
      const updatedGroups = channelGroups.map((g) => {
        // Strip the selected channels from every group first
        const remaining = (g.channels ?? []).filter((c) => !ids.includes(c.id));
        if (g.id === groupId) {
          // Add them to the target group (avoid duplicates)
          const existing = new Set(remaining.map((c) => c.id));
          const toAdd = ids.filter((id) => !existing.has(id));
          return { ...g, channels: [...remaining, ...toAdd.map((id) => ({ id }))] };
        }
        return { ...g, channels: remaining };
      });
      const result = await saveGroups(updatedGroups, []);
      if (result === "cancelled") return;
      onAssigned();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Sort named groups to match the Channels/Dashboard views (case-insensitive,
  // locale-aware; underscores before letters). [Default Group] is rendered as a
  // static first <option> below, so it is not part of this list.
  const namedGroups = channelGroups
    .filter((g) => g.id !== DEFAULT_GROUP_ID)
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return (
    <>
      {conflictDialog}
      <FormDialog
        open={open}
        onOpenChange={(v) => {
          if (!v) onClose();
        }}
        title="Assign to Group"
        onSubmit={handleAssign}
        submitLabel="Assign"
        saving={loading}
        error={error}
        maxWidth="sm:max-w-sm"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Assign <strong>{selectedIds.size}</strong> selected channel
            {selectedIds.size !== 1 ? "s" : ""} to a group.
          </p>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
            Target Group
          </label>
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="border border-border rounded px-2.5 py-1.5 text-sm bg-white dark:bg-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400 w-full"
            disabled={loading}
          >
            <option value={DEFAULT_GROUP_ID}>[Default Group]</option>
            {namedGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      </FormDialog>
    </>
  );
}
