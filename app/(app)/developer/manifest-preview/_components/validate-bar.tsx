"use client";

/**
 * Shared Validate control for the preview components. A button that
 * runs the caller's validator, plus the pass/fail status line and the per-field
 * error list. Extracted from connector-panel-preview so every contribution
 * kind's preview surfaces validation identically. The parent owns the `errors`
 * state (and any invalid-field highlight set); this component only renders it.
 */

import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ValidateError {
  /** Field key; empty for a whole-step / non-field-scoped message. */
  field: string;
  message: string;
}

export function ValidateBar({
  onValidate,
  errors,
  label = "Validate",
}: {
  onValidate: () => void;
  /** null = not validated yet; [] = validated clean; non-empty = failures. */
  errors: ValidateError[] | null;
  label?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2" role="status" aria-live="polite">
        <Button type="button" variant="outline" size="sm" onClick={onValidate}>
          {label}
        </Button>
        {errors && errors.length === 0 && (
          <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
            <CheckCircle2 className="size-3.5" /> No validation errors.
          </span>
        )}
        {errors && errors.length > 0 && (
          <span className="text-xs text-red-600 dark:text-red-400">
            {errors.length} {errors.length === 1 ? "error" : "errors"}
          </span>
        )}
      </div>
      {errors && errors.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-red-600 dark:text-red-400">
          {errors.map((e, i) => (
            <li key={i}>
              {e.field ? (
                <>
                  <span className="font-mono">{e.field}</span>: {e.message}
                </>
              ) : (
                e.message
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
