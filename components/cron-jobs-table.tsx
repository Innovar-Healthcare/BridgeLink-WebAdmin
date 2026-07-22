"use client";

/**
 * Editable table of Quartz cron jobs (expression + auto-generated description).
 *
 * Shared by the channel polling connectors (`PollingSection`) and the Data Pruner
 * schedule settings. Mirrors the Java `PollingSettingsPanel` cron jobs table:
 * each row is a `CronProperty` (expression + description), with add/remove controls.
 */

import { Plus, Trash2 } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import type { CronJob } from "@/app/(app)/channels/_lib/channel-xml";
import { describeCronExpression, isValidCronExpression } from "@/lib/cron-utils";
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
        const invalid = job.expression.trim() !== "" && !isValidCronExpression(job.expression);
        return (
          <div
            key={idx}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.5rem] gap-2 items-center"
          >
            <HoverTooltip
              content={invalid ? `Invalid cron expression. ${CRON_FORMAT_HELP}` : CRON_FORMAT_HELP}
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
