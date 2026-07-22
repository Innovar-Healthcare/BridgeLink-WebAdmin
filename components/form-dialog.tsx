"use client";

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
import { cn } from "@/lib/utils";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";

interface FormDialogProps {
  /** Controls visibility. */
  open: boolean;
  /** Called when the dialog requests closing (Escape, backdrop, Cancel).
   *  Automatically blocked when `saving` is true. */
  onOpenChange: (open: boolean) => void;
  /** Dialog title. */
  title: string;
  /** Optional subtitle below the title. */
  description?: React.ReactNode;
  /** Form body content. */
  children: React.ReactNode;
  /** Called when the user clicks the primary action button. */
  onSubmit: () => void;
  /** Primary action button label. Default: "Save". */
  submitLabel?: string;
  /** Cancel button label. Default: "Cancel". */
  cancelLabel?: string;
  /** When true: submit button shows spinner, both buttons disabled,
   *  Escape and click-outside blocked. */
  saving?: boolean;
  /** When true, submit button is disabled (e.g. form validation incomplete). */
  submitDisabled?: boolean;
  /** Error message displayed above the footer. Renders nothing when null/undefined. */
  error?: string | null;
  /** Max-width Tailwind class. Default: "sm:max-w-md". */
  maxWidth?: string;
  /** Optional extra content in the footer (left side). */
  footerLeft?: React.ReactNode;
  /** Extra Tailwind classes applied to the submit button. */
  submitClassName?: string;
}

/**
 * FormDialog — a standardized dialog shell for form-based interactions.
 *
 * Built on shadcn/Radix Dialog primitives; provides focus trapping, Escape,
 * click-outside, ARIA, and animation for free.
 *
 * Usage:
 * ```tsx
 * <FormDialog
 *   open={open}
 *   onOpenChange={setOpen}
 *   title="Edit Group"
 *   onSubmit={handleSave}
 *   saving={saving}
 *   error={error}
 * >
 *   <YourFormFields />
 * </FormDialog>
 * ```
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  saving = false,
  submitDisabled = false,
  error,
  maxWidth = "sm:max-w-md",
  footerLeft,
  submitClassName,
}: FormDialogProps) {
  const { viewDensity } = useCompactMode();
  const bodyPy =
    viewDensity === "comfortable" ? "py-3" : viewDensity === "compact" ? "py-1" : "py-2";
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!saving) onOpenChange(o);
      }}
    >
      <DialogContent
        className={maxWidth}
        showCloseButton={!saving}
        {...(!description && { "aria-describedby": undefined })}
        onInteractOutside={(e) => {
          if (saving) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (saving) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription asChild>
              <div>{description}</div>
            </DialogDescription>
          )}
        </DialogHeader>

        <form
          className="min-w-0"
          onSubmit={(e) => {
            e.preventDefault();
            if (!saving && !submitDisabled) onSubmit();
          }}
        >
          <div className={bodyPy}>{children}</div>

          {error && (
            <div className="mb-3 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-3 py-2 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          <DialogFooter className={footerLeft ? "sm:justify-between gap-2" : undefined}>
            {footerLeft && <div className="flex items-center">{footerLeft}</div>}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                {cancelLabel}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={saving || submitDisabled}
                className={cn(submitClassName)}
              >
                {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {submitLabel}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
