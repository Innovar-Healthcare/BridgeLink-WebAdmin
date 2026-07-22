"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Modal progress dialog shown while a Lookup Manager Group/Value import streams
 * to the server in batches. Mirrors the Java Swing client's "Importing CSV"
 * dialog (ValuePanel.java:804-820): a determinate progress bar, an
 * "Imported X of Y entries" label, and a Cancel button.
 *
 * While the import runs the dialog cannot be dismissed via overlay click or Esc
 * — only the Cancel button stops it — matching the Java modal dialog.
 */
export function ImportProgressDialog({
  open,
  imported,
  total,
  onCancel,
}: {
  open: boolean;
  imported: number;
  total: number;
  onCancel: () => void;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((imported / total) * 100)) : 0;

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>Importing values</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-muted-foreground text-sm">
            Imported {imported} of {total} entries
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
