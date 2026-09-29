"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { InfoDialog } from "@/components/info-dialog";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { EmptyState } from "@/components/empty-state";
import { HoverTooltip } from "@/components/hover-tooltip";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getChannelThreads } from "@/lib/api/api-dashboard";
import { ApiError } from "@/lib/api/api-core";
import type { ChannelThreadInfo, ChannelThreadReport } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDurationBetween } from "../_lib/lifecycle-overdue";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChannelThreadsDialogProps {
  channelId: string;
  channelName: string;
  onClose: () => void;
  /**
   * Fetches the report. Defaults to the live API call; tests inject a stub so the
   * dialog can be rendered without a proxy.
   */
  fetchReport?: (channelId: string, maxFrames: number) => Promise<ChannelThreadReport>;
}

const FRAME_OPTIONS = [10, 30, 100] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** One line per java.lang.Thread.State, for the state chip tooltip. */
function threadStateDescription(state: string): string {
  switch (state) {
    case "RUNNABLE":
      return "Running, or inside a native call such as a socket read that has not returned.";
    case "BLOCKED":
      return "Waiting to enter a synchronized block another thread holds.";
    case "WAITING":
      return "Waiting indefinitely for another thread to notify it.";
    case "TIMED_WAITING":
      return "Waiting with a timeout, such as a sleep or a poll.";
    case "NEW":
      return "Created but not yet started.";
    case "TERMINATED":
      return "Finished.";
    default:
      return "Java thread state.";
  }
}

/** Tailwind classes for a java.lang.Thread.State badge. */
function threadStateClass(state: string): string {
  switch (state) {
    case "RUNNABLE":
      return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300";
    case "BLOCKED":
      return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
    case "WAITING":
    case "TIMED_WAITING":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  }
}

/** Plain-text rendering of the report, for pasting into a ticket. Frames only, no message content. */
export function threadReportToText(report: ChannelThreadReport): string {
  const lines: string[] = [];
  lines.push(`Channel: ${report.channelName} (${report.channelId})`);
  lines.push(
    `State: ${report.state} since ${new Date(report.stateSince).toISOString()} (${formatDurationBetween(report.stateSince, report.collectedAt)})`
  );
  lines.push(
    `Stop grace period: ${report.stopGracePeriodMillis > 0 ? `${report.stopGracePeriodMillis / 1000}s` : "unbounded"}${report.lifecycleOverdue ? " (exceeded)" : ""}`
  );
  if (report.lastTimeout) {
    lines.push("");
    lines.push(`Last timeout (${report.lastTimeout.phase}): ${report.lastTimeout.message}`);
  }
  lines.push("");
  lines.push(`${report.threads.length} thread(s):`);
  for (const t of report.threads) {
    const flags = [
      t.waitedOnByLifecycle ? `waited on by ${lifecyclePhaseLabel(report.lastTimeout?.phase)}` : "",
      t.abandoned ? "abandoned" : "",
      t.cancelledScript ? "cancelled script" : "",
      t.daemon ? "daemon" : "",
    ].filter(Boolean);
    lines.push("");
    lines.push(`"${t.name}" [${t.state}]${flags.length ? ` (${flags.join(", ")})` : ""}`);
    if (t.lockName) {
      lines.push(
        `  blocked on ${t.lockName}${t.lockOwnerName ? ` held by "${t.lockOwnerName}"` : ""}`
      );
    }
    for (const frame of t.stackTrace) lines.push(`  ${frame}`);
  }
  return lines.join("\n");
}

/**
 * How a lifecycle phase is written in prose. Core sends it capitalised ("Stop", "Halt", but also
 * "Start", "Deploy", "Undeploy", "Pause", "Resume" -- every operation that takes the lifecycle
 * lock can time out), and three places render it: the summary line, the thread chip and the
 * copied text. They share this so they cannot drift apart, which is the defect filed.
 */
export function lifecyclePhaseLabel(phase: string | undefined): string {
  return phase ? phase.toLowerCase() : "stop/halt";
}

// ─── Thread card ──────────────────────────────────────────────────────────────

function ThreadCard({
  thread,
  defaultOpen,
  timeoutPhase,
}: {
  thread: ChannelThreadInfo;
  defaultOpen: boolean;
  /** The operation that actually timed out, for example "Stop" or "Halt", from the last timeout. */
  timeoutPhase?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const highlighted = thread.waitedOnByLifecycle || thread.abandoned;

  return (
    <div
      className={cn(
        "rounded border border-border bg-background",
        highlighted && "border-amber-400 dark:border-amber-600"
      )}
      data-testid="thread-card"
    >
      <button
        type="button"
        className="w-full flex items-start gap-2 px-2 py-1.5 text-left hover:bg-muted/60"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          {open ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-xs break-all">{thread.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <HoverTooltip content={threadStateDescription(thread.state)}>
              <span
                className={cn(
                  "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium",
                  threadStateClass(thread.state)
                )}
              >
                {thread.state}
              </span>
            </HoverTooltip>
            {thread.waitedOnByLifecycle && (
              <HoverTooltip content="The most recent channel lifecycle operation timed out waiting on this thread.">
                <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  <AlertTriangle className="w-3 h-3" /> waited on by{" "}
                  {lifecyclePhaseLabel(timeoutPhase)}
                </span>
              </HoverTooltip>
            )}
            {thread.abandoned && (
              <HoverTooltip content="A halt gave up waiting on this thread and marked the channel Stopped anyway. It keeps running until the far end lets go.">
                <span className="inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
                  abandoned
                </span>
              </HoverTooltip>
            )}
            {thread.cancelledScript && (
              <HoverTooltip content="A channel script whose execution was cancelled, but whose thread is still blocked inside a Java call the script engine cannot reach.">
                <span className="inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-[11px] font-medium text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">
                  cancelled script
                </span>
              </HoverTooltip>
            )}
            {thread.lockName && (
              <span className="text-[11px] text-muted-foreground break-all">
                blocked on <span className="font-mono">{thread.lockName}</span>
                {thread.lockOwnerName ? (
                  <>
                    {" "}
                    held by <span className="font-mono">{thread.lockOwnerName}</span>
                  </>
                ) : null}
              </span>
            )}
          </span>
        </span>
      </button>
      {open && (
        <pre className="m-0 max-h-72 overflow-auto border-t border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed font-mono whitespace-pre">
          {thread.stackTrace.length > 0 ? thread.stackTrace.join("\n") : "(no stack frames)"}
        </pre>
      )}
    </div>
  );
}

// ─── Dialog ───────────────────────────────────────────────────────────────────

/**
 * Thread diagnostics for one channel: what a channel stuck in Stopping or Starting is
 * stuck on. Reads GET /channels/{id}/_threads and shows the channel's lifecycle state, how long it
 * has been in it, what the last stop or halt timed out waiting on, and every live thread with its
 * state, lock and stack frames. Stack frames only: nothing here can show message content.
 */
export function ChannelThreadsDialog({
  channelId,
  channelName,
  onClose,
  fetchReport = getChannelThreads,
}: ChannelThreadsDialogProps) {
  const [report, setReport] = useState<ChannelThreadReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [maxFrames, setMaxFrames] = useState<number>(30);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchReport(channelId, maxFrames));
    } catch (e) {
      // Core answers 404 with no body when the channel is not deployed; a pre-26.9 Core has no
      // such route and 404s too. Both are more useful said plainly than as "Unknown server error".
      if (e instanceof ApiError && e.status === 404) {
        setError(
          "Thread diagnostics need BridgeLink 26.9 or later, or this channel is no longer deployed."
        );
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, [channelId, maxFrames, fetchReport]);

  useEffect(() => {
    // Mount and refetch on a frame-count change (same shape as the messages page's channel load)
    startTransition(() => {
      void load();
    });
  }, [load]);

  async function copyReport() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(threadReportToText(report));
      toast.success("Thread report copied");
    } catch {
      toast.error("Could not copy to the clipboard");
    }
  }

  const graceLabel =
    report && report.stopGracePeriodMillis > 0
      ? `${report.stopGracePeriodMillis / 1000}s`
      : report
        ? "unbounded"
        : "";

  return (
    <InfoDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Thread Diagnostics"
      description={channelName}
      resizable
      defaultWidth={860}
      defaultHeight={600}
      minWidth={520}
      minHeight={320}
      footerLeft={
        <div className="flex items-center gap-2">
          <HoverTooltip content="Fetch the threads again.">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
              Refresh
            </Button>
          </HoverTooltip>
          <HoverTooltip content="Copy the whole report as plain text, for a ticket or a support bundle. Stack frames only, no message content.">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copyReport()}
              disabled={!report}
            >
              <Copy className="w-3.5 h-3.5" />
              Copy
            </Button>
          </HoverTooltip>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Frames</span>
            <HoverTooltip content="How many stack frames to fetch per thread.">
              <select
                className="rounded border border-input bg-background px-1 py-0.5 text-xs"
                value={maxFrames}
                onChange={(e) => setMaxFrames(Number(e.target.value))}
                aria-label="Stack frames per thread"
              >
                {FRAME_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </HoverTooltip>
          </label>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <ApiErrorAlert error={error} className="" />

        {loading && !report && (
          <div className="space-y-2" data-testid="threads-loading">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {report && (
          <>
            {/* Summary */}
            <div
              className={cn(
                "rounded border px-3 py-2",
                report.lifecycleOverdue
                  ? "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/30"
                  : "border-border bg-muted/40"
              )}
              data-testid="threads-summary"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <StatusBadge status={report.state} variant="channel" />
                <span className="text-xs text-muted-foreground">
                  in this state for{" "}
                  <span className="font-medium text-foreground">
                    {formatDurationBetween(report.stateSince, report.collectedAt)}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  stop grace period{" "}
                  <span className="font-medium text-foreground">{graceLabel}</span>
                </span>
                {report.lifecycleOverdue && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    past the grace period
                  </span>
                )}
              </div>
              {report.lastTimeout && (
                <div className="mt-2 text-xs" data-testid="threads-last-timeout">
                  <div className="font-medium">
                    Last {lifecyclePhaseLabel(report.lastTimeout.phase)} timed out waiting on{" "}
                    <span className="font-mono break-all">
                      {report.lastTimeout.threadName ?? "(no single thread)"}
                    </span>
                    {report.lastTimeout.threadState ? ` [${report.lastTimeout.threadState}]` : ""}
                  </div>
                  <div className="mt-0.5 text-muted-foreground">
                    {new Date(report.lastTimeout.timestamp).toLocaleString()}
                  </div>
                </div>
              )}
            </div>

            {/* Threads */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {report.threads.length} live thread{report.threads.length === 1 ? "" : "s"} belong
                to this channel
              </span>
              <span className="text-[11px] text-muted-foreground">
                collected {new Date(report.collectedAt).toLocaleTimeString()}
              </span>
            </div>
            {report.threads.length === 0 ? (
              <EmptyState
                variant="panel"
                message="No live threads belong to this channel right now."
              />
            ) : (
              <div className="space-y-2">
                {report.threads.map((t) => (
                  <ThreadCard
                    key={t.id}
                    thread={t}
                    timeoutPhase={report.lastTimeout?.phase}
                    defaultOpen={
                      t.waitedOnByLifecycle || t.abandoned || report.threads.length === 1
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </InfoDialog>
  );
}
