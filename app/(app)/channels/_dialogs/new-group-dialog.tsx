"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { generateUUID } from "@/lib/utils";
import type { ChannelGroup } from "@/lib/types";
import { Textarea } from "@/components/ui/textarea";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { useChannelGroupSave } from "../_lib/use-channel-group-save";

export function NewGroupDialog({
  open,
  onClose,
  onCreated,
  existingGroups,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  existingGroups: ChannelGroup[];
}) {
  const { viewDensity } = useCompactMode();
  const { saveGroups, conflictDialog } = useChannelGroupSave();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset form state each time the dialog transitions to open. Done during render
  // (the React "adjusting state when a prop changes" idiom) rather than in an effect,
  // which avoids the cascading-render warning from react-hooks/set-state-in-effect.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      setDescription("");
      setError(null);
    }
  }

  // Focus the name input when the dialog opens. Ref access stays in an effect
  // (not the render-time reset above) per react-hooks/refs.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  async function handleCreate() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const duplicate = existingGroups.some(
      (g) => g.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
      setError(`A channel group named "${trimmedName}" already exists.`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Must send ALL existing named groups + the new one.
      // The server replaces the entire group set with whatever is submitted.
      const newGroup: ChannelGroup = {
        id: generateUUID(),
        name: trimmedName,
        description: description.trim() || undefined,
        revision: 1,
        channels: [],
      };
      const result = await saveGroups([...existingGroups, newGroup], []);
      if (result === "cancelled") return;
      onCreated();
      onClose();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const match = raw.match(/<detailMessage>([^<]+)<\/detailMessage>/);
      setError(match ? match[1] : raw);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {conflictDialog}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v && !loading) onClose();
        }}
      >
        <DialogContent
          className="flex flex-col p-0 gap-0 sm:max-w-none"
          aria-describedby={undefined}
          style={{
            width: "580px",
            height: "400px",
            minWidth: "420px",
            minHeight: "300px",
            maxWidth: "calc(100vw - 2rem)",
            maxHeight: "calc(100vh - 4rem)",
            resize: "both",
            overflow: "hidden",
          }}
          onInteractOutside={(e) => {
            if (loading) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (loading) e.preventDefault();
          }}
        >
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>New Group</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 px-6 pb-3 flex flex-col gap-3 overflow-hidden">
            <div className="flex flex-col gap-1 shrink-0">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                Group Name <span className="text-red-500">*</span>
              </label>
              <input
                ref={inputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="Enter group name"
                className="border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-full bg-white dark:bg-gray-700 dark:text-gray-200"
                disabled={loading}
              />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-h-0">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                Description
              </label>
              <Textarea
                density={viewDensity}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter description (optional)"
                className="border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-full h-full bg-white dark:bg-gray-700 dark:text-gray-200 resize-none"
                disabled={loading}
              />
            </div>
            {error && (
              <div className="px-3 py-2 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded shrink-0">
                {error}
              </div>
            )}
          </div>
          <DialogFooter className="px-6 pb-5 pt-2 shrink-0">
            <Button variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim() || loading}>
              {loading ? "Creating\u2026" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
