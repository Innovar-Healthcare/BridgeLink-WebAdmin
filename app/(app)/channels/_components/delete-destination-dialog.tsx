"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DeleteDestinationDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Name of the destination about to be deleted — shown in the confirmation message. */
  destinationName: string;
  /** Called when the user cancels or closes the dialog. */
  onClose: () => void;
  /** Called when the user confirms the deletion. */
  onConfirm: () => void;
}

/**
 * Confirmation dialog for deleting a destination connector.
 * Extracted from ChannelEditorCore to keep that file focused.
 */
export function DeleteDestinationDialog({
  open,
  destinationName,
  onClose,
  onConfirm,
}: DeleteDestinationDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Delete Destination</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete &ldquo;{destinationName}&rdquo;? This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
