"use client";

/**
 * Commit-limit selector for version-history commit lists.
 *
 * Mirrors the `commitLimitCombo` in Java's ChannelHistoryTabPanel,
 * CodeTemplateHistoryDialogWithTaskPane, and GlobalScriptsHistoryDialog — all
 * three use the same option set {5, 10, 20, 50, 100, 200, 500} defaulting to 10.
 * FilesTabPanel and the lightweight history viewer have no combo and are not
 * given one here.
 *
 * The selection is enforced client-side (newest-first truncation) regardless of
 * whether the connected server honors the `limit` query param, so the control
 * works against every BridgeLink version. See `getEntityHistory()` and
 * `hasHistoryLimitParam` in use-plugin-capabilities.ts.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Commit-count options, matching the Java Swing combo box exactly. */
export const COMMIT_LIMIT_OPTIONS = [5, 10, 20, 50, 100, 200, 500] as const;

/** Default selected commit count, matching the Java Swing combo box. */
export const DEFAULT_COMMIT_LIMIT = 10;

export function CommitLimitSelect({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (limit: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Show</span>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))} disabled={disabled}>
        <SelectTrigger className="h-8 w-[72px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COMMIT_LIMIT_OPTIONS.map((opt) => (
            <SelectItem key={opt} value={String(opt)} className="text-xs">
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
