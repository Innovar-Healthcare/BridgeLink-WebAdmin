"use client";

/**
 * Editable table of Quartz cron jobs (expression + auto-generated description).
 *
 * Shared by the channel polling connectors (`PollingSection`) and the Data Pruner
 * schedule settings. Mirrors the Java `PollingSettingsPanel` cron jobs table:
 * each row is a `CronProperty` (expression + description), with add/remove controls.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import type { CronJob } from "@/app/(app)/channels/_lib/channel-xml";
import { describeCronExpression, isValidCronExpression } from "@/lib/cron-utils";
import { serverSupportsCronEndpoints, validateCron } from "@/lib/api/api-cron";
import type { CronValidationResult } from "@/lib/api/api-cron";
import { getCachedCronVerdict, setCachedCronVerdict } from "@/lib/cron-verdict-cache";
import { cn } from "@/lib/utils";

interface CronJobsTableProps {
  cronJobs: CronJob[];
  onChange: (jobs: CronJob[]) => void;
  /** className applied to the row <input> elements (lets callers match panel density). */
  inputClassName: string;
}

const CRON_FORMAT_HELP =
  "Cron expressions must be in Quartz format with at least 6 fields: Seconds Minutes Hours Day-of-Month Month Day-of-Week [Year]. Example: 0 */5 8-17 * * ? fires every 5 minutes from 8am to 5pm every day.";

export function CronJobsTable({ cronJobs, onChange, inputClassName }: CronJobsTableProps) {
  // Server verdicts (real Quartz, keyed by trimmed expression. Augments the
  // client `isValidCronExpression` highlight without blocking typing: when a verdict is
  // present it reconciles the row's red highlight *bidirectionally* — reddening a
  // client-"valid" expression Quartz rejects, and clearing a client-"invalid" one Quartz
  // accepts (e.g. the `L-3` day-of-month offset that cron-parser can't parse).
  //
  // Hydrated from the shared cron-verdict-cache on mount — a table that
  // remounts (e.g. switching pollingType away and back) or opens after another table
  // already resolved the same expression this session shows the reconciled highlight
  // immediately instead of flashing the client approximation while it re-fetches.
  const [serverVerdicts, setServerVerdicts] = useState<Record<string, CronValidationResult>>(() => {
    const initial: Record<string, CronValidationResult> = {};
    for (const job of cronJobs) {
      const expr = job.expression.trim();
      if (!expr) continue;
      const cached = getCachedCronVerdict(expr);
      if (cached) initial[expr] = cached;
    }
    return initial;
  });

  // Distinct non-blank expressions currently in the table (validated once each).
  const expressions = useMemo(
    () => Array.from(new Set(cronJobs.map((j) => j.expression.trim()).filter(Boolean))),
    [cronJobs]
  );
  const expressionsKey = expressions.join("\n");

  useEffect(() => {
    if (!serverSupportsCronEndpoints()) return;
    const pending = expressions.filter((e) => !Object.hasOwn(serverVerdicts, e));
    if (pending.length === 0) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      for (const expr of pending) {
        validateCron(expr)
          .then((res) => {
            // Write-through to the shared cache regardless of `cancelled`/mount state —
            // the save-gate validators read it independently of this
            // component's lifecycle, and the verdict for a given expression string is
            // valid whether or not this particular table instance is still around to
            // show it.
            setCachedCronVerdict(expr, res);
            if (cancelled) return;
            setServerVerdicts((prev) => ({ ...prev, [expr]: res }));
          })
          .catch(() => {
            // Transport/HTTP error — leave the client verdict in place for this row.
          });
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // expressionsKey captures the set of expressions to validate; serverVerdicts is read
    // as a snapshot to skip already-known ones and must not re-trigger the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expressionsKey]);

  return (
    // Fixed-width table that mirrors the Java client's 400px cron scroll pane
    // (PollingSettingsPanel "w 400!"): the columns split a constant width rather
    // than stretching to fill the panel. max-w-full is an anti-overflow backstop
    // for unusually narrow parents.
    <div className="w-[400px] max-w-full space-y-1.5">
      {/* Table header */}
      {cronJobs.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.5rem] gap-2 mb-0.5">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Expression
          </span>
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Description
          </span>
          <span />
        </div>
      )}
      {/* Table rows */}
      {cronJobs.map((job, idx) => {
        // Pink-highlight a row whose (non-blank) expression is not a valid Quartz
        // expression — mirrors Java PollingSettingsPanel's invalid-row highlight.
        // Blank rows aren't reddened live; the save-time validator still rejects them.
        // When a server verdict is available it wins over the client approximation
        // (both directions); otherwise fall back to the sync client check.
        const trimmed = job.expression.trim();
        const verdict = Object.hasOwn(serverVerdicts, trimmed)
          ? serverVerdicts[trimmed]
          : undefined;
        const invalid =
          trimmed !== "" && (verdict ? !verdict.valid : !isValidCronExpression(job.expression));
        const serverMessage = verdict && !verdict.valid ? verdict.message : null;
        return (
          <div
            key={idx}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.5rem] gap-2 items-center"
          >
            <HoverTooltip
              content={
                invalid
                  ? `Invalid cron expression.${serverMessage ? ` ${serverMessage}` : ""} ${CRON_FORMAT_HELP}`
                  : CRON_FORMAT_HELP
              }
            >
              <input
                type="text"
                value={job.expression}
                onChange={(e) => {
                  const expression = e.target.value;
                  // Don't clobber a hand-typed description: only refresh the auto
                  // description when the current one is empty or was itself
                  // auto-generated for the previous expression.
                  const wasAuto =
                    job.description === "" ||
                    job.description === describeCronExpression(job.expression);
                  const description = wasAuto
                    ? describeCronExpression(expression)
                    : job.description;
                  const next: CronJob[] = cronJobs.map((j, i) =>
                    i === idx ? { expression, description } : j
                  );
                  onChange(next);
                }}
                placeholder="*/5 * * * * ?"
                className={cn(
                  inputClassName,
                  "w-full min-w-0 font-mono",
                  invalid && "border-red-500 dark:border-red-400"
                )}
                aria-invalid={invalid}
                spellCheck={false}
              />
            </HoverTooltip>
            <input
              type="text"
              value={job.description}
              onChange={(e) => {
                const next: CronJob[] = cronJobs.map((j, i) =>
                  i === idx ? { ...j, description: e.target.value } : j
                );
                onChange(next);
              }}
              placeholder="Description…"
              className={cn(inputClassName, "w-full min-w-0")}
            />
            <HoverTooltip content="Remove">
              <button
                onClick={() => onChange(cronJobs.filter((_, i) => i !== idx))}
                className="flex items-center justify-center w-6 h-6 rounded text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </HoverTooltip>
          </div>
        );
      })}
      {/* Add button */}
      <button
        onClick={() => onChange([...cronJobs, { expression: "", description: "" }])}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded border border-dashed
        border-border text-gray-500 dark:text-gray-400
        hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400
        hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Add
      </button>
    </div>
  );
}
