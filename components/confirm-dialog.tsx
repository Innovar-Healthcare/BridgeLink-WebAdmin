"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";

// ─── Simple Confirmation Dialog ───────────────────────────────────────────────

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "destructive",
  onConfirm,
  onCancel,
}: {
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  /** Label for the cancel/dismiss button. Default: "Cancel". Use "No" for Yes/No prompts. */
  cancelLabel?: string;
  /** Button variant for the confirm action. Default: "destructive". Use "default" for non-destructive confirmations. */
  confirmVariant?: "destructive" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={() => onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button size="sm" variant={confirmVariant} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Type-to-Confirm Dialog (for destructive bulk operations) ─────────────────

/**
 * Requires the user to type an exact confirmation word before the action button
 * is enabled. Used for irreversible bulk operations (e.g. "REMOVEALL",
 * "REMOVEGROUP").
 */
export function TypeToConfirmDialog({
  title,
  description,
  confirmWord,
  confirmLabel = "OK",
  onConfirm,
  onCancel,
}: {
  title: string;
  description: React.ReactNode;
  /** The exact string the user must type to unlock the action button. */
  confirmWord: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { viewDensity } = useCompactMode();
  const [text, setText] = useState("");
  const ready = text === confirmWord;

  return (
    <Dialog open onOpenChange={() => onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Type ${confirmWord} to confirm`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ready) onConfirm();
          }}
          density={viewDensity}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="destructive" disabled={!ready} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
