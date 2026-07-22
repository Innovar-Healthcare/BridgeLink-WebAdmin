"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { saveAdminPref } from "@/lib/admin-prefs";
import {
  ATTACHMENT_VIEWER_OPTIONS,
  type AttachmentViewerType,
  mimeToViewer,
  hasMatchingViewer,
} from "./attachment-viewer-types";

interface AttachmentTypeDialogProps {
  /** Whether the dialog is open. Parent renders it only when picking a viewer. */
  open: boolean;
  /** The attachment's MIME / content-type string (drives the default selection). */
  contentType: string;
  /** Called with the chosen viewer when the user confirms. */
  onConfirm: (viewer: AttachmentViewerType) => void;
  /** Called when the user cancels or dismisses the dialog. */
  onCancel: () => void;
}

/**
 * Viewer-type picker for message attachments.
 *
 * Mirrors the Java client's AttachmentTypeDialog: the user picks which viewer to
 * use, pre-selected from the attachment's MIME type, so a wrong MIME no longer
 * dead-ends on a broken preview (force the Text viewer to inspect the raw data).
 * The "always automatically" opt-out disables this dialog by clearing the
 * `messageBrowserShowAttachmentTypeDialog` Administrator setting — matching Java.
 */
export function AttachmentTypeDialog({
  open,
  contentType,
  onConfirm,
  onCancel,
}: AttachmentTypeDialogProps) {
  const found = hasMatchingViewer(contentType);
  const [viewer, setViewer] = useState<AttachmentViewerType>(() => mimeToViewer(contentType));
  const [alwaysAuto, setAlwaysAuto] = useState(false);

  function handleConfirm() {
    // Only honor the opt-out when a viewer actually matched, mirroring Java
    // (the checkbox is hidden in the "not found" case).
    if (found && alwaysAuto) {
      saveAdminPref("messageBrowserShowAttachmentTypeDialog", false);
    }
    onConfirm(viewer);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Attachment Viewer</DialogTitle>
          <DialogDescription>
            {found
              ? `Select an attachment viewer to use for content type "${contentType}":`
              : `Attachment viewer for content type "${contentType || "(unknown)"}" not found. Select one from the menu below:`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <Select value={viewer} onValueChange={(v) => setViewer(v as AttachmentViewerType)}>
            <SelectTrigger className="w-full text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ATTACHMENT_VIEWER_OPTIONS.map((opt) => (
                <SelectItem key={opt.key} value={opt.key}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {found && (
            <FormCheckbox
              label="Always choose viewer automatically from MIME type"
              checked={alwaysAuto}
              onChange={setAlwaysAuto}
              size="sm"
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
