"use client";

/**
 * SaveDiscardCancelDialog — presentational 3-way "save your changes?" prompt
 * matching the Java UI's Yes / No / Cancel pattern (JOptionPane in
 * Frame.confirmLeave). Owns no navigation or save logic — the parent supplies
 * `open`, the question text, and the three resolution callbacks.
 *
 * Used by:
 *   - UnsavedChangesDialog (route navigation guard)
 *   - the Settings page (intra-page sub-tab switches, mirroring SettingsPane)
 */

import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface SaveDiscardCancelDialogProps {
  /** Whether the dialog is shown. */
  open: boolean;
  /** Dialog title. Defaults to "Unsaved Changes". */
  title?: string;
  /** The question/body shown to the user, e.g. "Would you like to save the Server settings changes?". */
  description: React.ReactNode;
  /** True while a save is in progress — disables all buttons and shows a spinner on Save. */
  saving?: boolean;
  /** Error to surface above the footer (e.g. a failed save). */
  error?: string | null;
  /** Label for the primary (Yes) button. Defaults to "Yes, Save". */
  saveLabel?: string;
  /** Label for the secondary (No) button. Defaults to "No, Discard". */
  discardLabel?: string;
  /** Save and proceed (Yes). */
  onSave: () => void;
  /** Discard and proceed (No). */
  onDiscard: () => void;
  /** Abort — stay put (Cancel, or dismiss). */
  onCancel: () => void;
}

export function SaveDiscardCancelDialog({
  open,
  title = "Unsaved Changes",
  description,
  saving = false,
  error = null,
  saveLabel = "Yes, Save",
  discardLabel = "No, Discard",
  onSave,
  onDiscard,
  onCancel,
}: SaveDiscardCancelDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !saving) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-3 py-2 text-sm text-red-700 dark:text-red-400 whitespace-pre-wrap">
            {error}
          </div>
        )}

        <DialogFooter className="sm:justify-between gap-2">
          {/* Cancel — stay put */}
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>

          <div className="flex gap-2">
            {/* No — discard and proceed */}
            <Button variant="outline" size="sm" onClick={onDiscard} disabled={saving}>
              {discardLabel}
            </Button>

            {/* Yes — save then proceed */}
            <Button size="sm" onClick={onSave} disabled={saving}>
              {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {saveLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
