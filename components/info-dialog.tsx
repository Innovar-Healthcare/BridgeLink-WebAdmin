"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogMaximizeButton,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { useDialogDragResize } from "@/lib/hooks/use-dialog-drag-resize";
import { cn } from "@/lib/utils";

interface InfoDialogProps {
  /** Controls visibility. */
  open: boolean;
  /** Called when the dialog requests closing. */
  onOpenChange: (open: boolean) => void;
  /** Dialog title. */
  title: string;
  /** Optional subtitle below the title. */
  description?: React.ReactNode;
  /** Read-only content. */
  children: React.ReactNode;
  /** Max-width Tailwind class. Default: "sm:max-w-lg". */
  maxWidth?: string;
  /** Optional extra buttons in the footer (left side), e.g. Copy, Refresh. */
  footerLeft?: React.ReactNode;
  /**
   * Opt into a draggable + resizable + maximizable dialog (closer to the Java
   * client's free-floating viewers). When enabled, the body becomes the scroll
   * container and fills the resized box — children should render natural-height
   * content (e.g. add `min-h-full` to a `<pre>` so its border fills the box).
   * Falls back to a normal centered dialog on small viewports. Default false.
   */
  resizable?: boolean;
  /** Initial width in px when `resizable` (default 672). */
  defaultWidth?: number;
  /** Initial height in px when `resizable` (default ≈ 60vh). */
  defaultHeight?: number;
  /** Minimum width in px when `resizable` (default 380). */
  minWidth?: number;
  /** Minimum height in px when `resizable` (default 200). */
  minHeight?: number;
}

/**
 * InfoDialog — a standardized dialog shell for read-only / informational content.
 *
 * Built on shadcn/Radix Dialog primitives; provides focus trapping, Escape,
 * click-outside, ARIA, and animation for free.
 *
 * Footer always renders a single "Close" button on the right. Use `footerLeft`
 * for utility actions (Copy, Refresh, etc.).
 *
 * Usage:
 * ```tsx
 * <InfoDialog
 *   open={open}
 *   onOpenChange={setOpen}
 *   title="Extension Details"
 *   footerLeft={<CopyButton value={text} />}
 * >
 *   <YourReadOnlyContent />
 * </InfoDialog>
 * ```
 */
export function InfoDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  maxWidth = "sm:max-w-lg",
  footerLeft,
  resizable = false,
  defaultWidth,
  defaultHeight,
  minWidth,
  minHeight,
}: InfoDialogProps) {
  const { viewDensity } = useCompactMode();
  const bodyPy =
    viewDensity === "comfortable" ? "py-3" : viewDensity === "compact" ? "py-1" : "py-2";

  const { contentProps, handleProps, maximize, enabled } = useDialogDragResize({
    open,
    defaultWidth,
    defaultHeight,
    minWidth,
    minHeight,
    draggable: resizable,
    resizable,
    maximizable: resizable,
  });
  const dragResizeActive = resizable && enabled;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={maxWidth}
        {...(!description && { "aria-describedby": undefined })}
        {...(resizable ? contentProps : {})}
      >
        <DialogHeader {...(resizable ? handleProps : {})}>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription asChild>
              <div>{description}</div>
            </DialogDescription>
          )}
        </DialogHeader>
        {resizable && maximize.available ? (
          <DialogMaximizeButton maximized={maximize.isMaximized} onToggle={maximize.toggle} />
        ) : null}

        <div
          className={
            resizable
              ? cn(
                  // The body is the single scroll container in both modes: it
                  // flex-fills the resized box on desktop, and caps height on
                  // small viewports so long content still scrolls.
                  dragResizeActive ? "flex-1 min-h-0 overflow-auto" : "overflow-auto max-h-[70vh]"
                )
              : // Non-resizable: cap the body height and scroll so long content
                // (e.g. the About dialog) fits and stays reachable on small
                // screens, keeping the title/footer rows visible.
                cn(bodyPy, "overflow-y-auto max-h-[70vh]")
          }
        >
          {children}
        </div>

        <DialogFooter
          className={cn(
            footerLeft ? "sm:justify-between gap-2" : undefined,
            resizable && "shrink-0"
          )}
        >
          {footerLeft && <div className="flex items-center">{footerLeft}</div>}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
