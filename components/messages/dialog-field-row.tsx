import { type ReactNode } from "react";
import { Label } from "@/components/ui/label";

/**
 * One label + control row for the message import/export dialogs: a fixed-width
 * right-aligned label column, and a control side that WRAPS rather than
 * overflowing. Both halves matter at narrow dialog widths — without `min-w-0`
 * the controls widen the dialog's grid track and drag the footer out with them,
 * and without `flex-wrap` the control side (radios + Browse, a path field, the
 * variables sidebar) collides with the dialog edge,.
 *
 * Same shape as the `Row` helpers in the connector advanced-settings dialogs
 * (advanced-polling-settings-dialog, s3/sftp/smb-advanced-dialog).
 *
 * `basis-64` is what lets the whole control side drop to its own line on a very
 * narrow dialog: flex wrapping is decided on the basis, before shrinking.
 *
 * Pass an empty/omitted `label` for an indented row (checkbox, note) whose
 * content should align under the control column; the label column then renders
 * as a plain spacer.
 */
export function DialogFieldRow({
  label,
  gap,
  align = "center",
  children,
}: {
  label?: string;
  /** Density-derived gap class from the caller (`rowGap`). */
  gap: string;
  align?: "center" | "start";
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-wrap ${align === "start" ? "items-start" : "items-center"} ${gap}`}>
      {label ? (
        /* `justify-end`, not `text-right`: Label is `display: flex`, so text-align is inert on it. */
        <Label
          className={`w-32 shrink-0 justify-end text-sm font-medium ${align === "start" ? "pt-2" : ""}`}
        >
          {label}
        </Label>
      ) : (
        <div className="w-32 shrink-0" aria-hidden />
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 grow basis-64 min-w-0">
        {children}
      </div>
    </div>
  );
}
