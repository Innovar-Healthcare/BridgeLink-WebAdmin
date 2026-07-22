"use client";

/**
 * CommitChannelDialog
 *
 * Shown after a channel save when version history auto-commit is enabled AND
 * the "prompt for commit message" setting is on. The user can edit the commit
 * message before confirming the commit-and-push.
 *
 * Mirrors the Java Swing JOptionPane.showInputDialog() prompt that appears in
 * ChannelPlugin.save() → doCommitAndPushCurrentChannel() when isEnableAutoCommitPrompt is true.
 */

import { useState } from "react";
import { FormDialog } from "@/components/form-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { commitAndPushChannel } from "../api-version-history";

interface CommitChannelDialogProps {
  open: boolean;
  /** Full channel XML to commit (same as used in writeChannelToRepo). */
  channelXml: string;
  /** Numeric ID of the currently logged-in user. */
  userId: number;
  /** Pre-filled commit message from plugin settings. */
  defaultMessage: string;
  /** Called when the dialog is dismissed without committing. */
  onClose: () => void;
  /** Called after a successful commit. */
  onCommitted: () => void;
}

export function CommitChannelDialog({
  open,
  channelXml,
  userId,
  defaultMessage,
  onClose,
  onCommitted,
}: CommitChannelDialogProps) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset message whenever the dialog transitions to open. Done during render via a
  // previous-value guard (the React "adjust state when a prop changes" idiom) instead of an
  // effect, per react-hooks/set-state-in-effect. wasOpen seeds to false so an already-open
  // mount still seeds.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMessage("");
      setError(null);
    }
  }

  async function handleSubmit() {
    const commitMessage = message.trim() || defaultMessage.trim();
    if (!commitMessage) {
      setError("Commit message cannot be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await commitAndPushChannel(channelXml, commitMessage, userId);
      onCommitted();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Commit failed. Check that the remote is reachable."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Commit Channel"
      description="Enter a commit message for this channel save. The change will be committed and pushed to the remote repository."
      onSubmit={handleSubmit}
      submitLabel="Commit & Push"
      saving={saving}
      submitDisabled={!message.trim() && !defaultMessage.trim()}
      error={error}
      maxWidth="sm:max-w-lg"
    >
      <div className="flex flex-col gap-2 py-1">
        <Label htmlFor="commit-msg" className="text-sm font-medium">
          Commit message
        </Label>
        <Textarea
          id="commit-msg"
          enableTabKey
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder={defaultMessage || "Describe the changes in this channel…"}
          className="resize-none text-sm font-mono"
          disabled={saving}
          autoFocus
        />
      </div>
    </FormDialog>
  );
}
