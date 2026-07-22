"use client";

/**
 * CommitMessageDialog — shared commit-message prompt for the Version History plugin.
 *
 * Mirrors Java's single `CommitMessageDialog` (client/.../dialog/CommitMessageDialog.java),
 * which is reused across Global Scripts, Code Template History, and Save Libraries.
 * "Push" always follows "Commit" — there is no separate option.
 *
 * Built on the shared FormDialog shell (Cancel + primary submit, spinner while
 * saving, blocks dismiss during save, inline error). The parent owns the commit
 * itself; this component only collects the message and calls `onSubmit`.
 */

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "@/components/form-dialog";

interface CommitMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog title, e.g. "Commit & Push — Global Scripts". */
  title: string;
  /** Optional description shown under the title. */
  description?: React.ReactNode;
  /** Initial commit message (e.g. the configured default message). */
  defaultMessage?: string;
  /** True while the commit is in flight — disables inputs and blocks dismiss. */
  saving: boolean;
  /** Error from the last commit attempt, shown above the footer. */
  error: string | null;
  /** Called with the entered message when the user clicks Commit & Push. */
  onSubmit: (message: string) => void;
}

export function CommitMessageDialog({
  open,
  onOpenChange,
  title,
  description,
  defaultMessage = "",
  saving,
  error,
  onSubmit,
}: CommitMessageDialogProps) {
  // Message state resets on each open via the `key` prop the parent passes when
  // remounting, so useState(defaultMessage) always starts from the latest default.
  const [message, setMessage] = useState(defaultMessage);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        description ??
        "Enter a commit message. Changes will be committed and pushed to the remote repository."
      }
      onSubmit={() => onSubmit(message)}
      submitLabel="Commit & Push"
      saving={saving}
      submitDisabled={!message.trim()}
      error={error}
      maxWidth="sm:max-w-lg"
    >
      <div className="flex flex-col gap-2 py-1">
        <Label htmlFor="commit-msg" className="text-sm font-medium">
          Commit message
        </Label>
        <Textarea
          id="commit-msg"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="Describe the changes being committed…"
          className="resize-none text-sm font-mono"
          disabled={saving}
          autoFocus
        />
      </div>
    </FormDialog>
  );
}
