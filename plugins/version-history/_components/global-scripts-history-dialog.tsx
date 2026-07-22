"use client";

/**
 * Global Scripts History Dialog
 *
 * Version history dialog for all four global scripts (Deploy, Undeploy,
 * Preprocessor, Postprocessor). Shows a commit list on the left and a
 * per-script diff view on the right with a script-type selector.
 *
 * Mirrors Java's GlobalScriptsHistoryDialog + GlobalScriptsDiffPanel.
 * History is keyed by the literal string "scripts" with MODE_GLOBAL_SCRIPTS.
 *
 * Restore flow matches Java: populate in-memory state only; the user must
 * click Save to persist to the server.
 */

import { Fragment, startTransition, useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { RefreshCw, Copy, Undo2, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import type { GlobalScriptKey } from "@/lib/api/api-settings";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { HoverTooltip } from "@/components/hover-tooltip";
import { InfoTooltip } from "@/components/info-tooltip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

import {
  getEntityHistory,
  getEntityContentAtRevision,
  getShortHash,
  getMessageContent,
  getEntityType,
  getEntityName,
  getServerName,
  MODE_GLOBAL_SCRIPTS,
  type CommitMetaData,
} from "../api-version-history";
import { DiffView } from "./diff-view";
import { CommitLimitSelect, DEFAULT_COMMIT_LIMIT } from "./commit-limit-select";
import { useCommitDateMode, formatCommitTime, absoluteCommitTime } from "./use-commit-date-mode";
import { usePluginCapabilities } from "../use-plugin-capabilities";

// ─── Constants ────────────────────────────────────────────────────────────────

const SCRIPTS_ID = "scripts";

const SCRIPT_ORDER: GlobalScriptKey[] = ["Deploy", "Undeploy", "Preprocessor", "Postprocessor"];

type DiffMode = "current" | "parent";

// ─── XML parser ───────────────────────────────────────────────────────────────

/**
 * Parses the XStream Map XML returned by the content endpoint into a
 * Record<GlobalScriptKey, string>. The server serializes via ObjectXMLSerializer
 * which produces: <map><entry><string>key</string><string>value</string></entry>...</map>
 */
export function parseGlobalScriptsXml(xml: string): Record<GlobalScriptKey, string> {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const entries = doc.querySelectorAll("map > entry");
  const result: Record<GlobalScriptKey, string> = {
    Deploy: "",
    Undeploy: "",
    Preprocessor: "",
    Postprocessor: "",
  };
  entries.forEach((e) => {
    const kids = e.querySelectorAll(":scope > string");
    const key = kids[0]?.textContent ?? "";
    const val = kids[1]?.textContent ?? "";
    if (key in result) result[key as GlobalScriptKey] = val;
  });
  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface GlobalScriptsHistoryDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentScripts?: Record<GlobalScriptKey, string> | null;
  onReverted?: (scripts: Record<GlobalScriptKey, string>) => void;
}

export function GlobalScriptsHistoryDialog({
  open,
  onOpenChange,
  currentScripts,
  onReverted,
}: GlobalScriptsHistoryDialogProps) {
  const { dateMode } = useCommitDateMode();
  const { hasHistoryLimitParam } = usePluginCapabilities();
  // Max commits to load. Always enforced client-side; only sent to the server
  // when it supports the `limit` param. Local state only — not persisted.
  const [limit, setLimit] = useState(DEFAULT_COMMIT_LIMIT);
  const [commits, setCommits] = useState<CommitMetaData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedCommit, setSelectedCommit] = useState<CommitMetaData | null>(null);
  const [activeScript, setActiveScript] = useState<GlobalScriptKey>("Deploy");
  const [diffMode, setDiffMode] = useState<DiffMode>("current");

  // Cache parsed scripts per commit hash to avoid re-fetching on script tab switch
  const [contentCache, setContentCache] = useState<Map<string, Record<GlobalScriptKey, string>>>(
    new Map()
  );
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Restore
  const [restoreTarget, setRestoreTarget] = useState<CommitMetaData | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Collapse the left commit list to give more space to the diff view
  const [listCollapsed, setListCollapsed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedCommit(null);
    setContentCache(new Map());
    try {
      const data = await getEntityHistory(SCRIPTS_ID, MODE_GLOBAL_SCRIPTS, {
        limit,
        sendLimitToServer: hasHistoryLimitParam,
      });
      setCommits(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [limit, hasHistoryLimitParam]);

  useEffect(() => {
    if (open) startTransition(() => void load());
  }, [open, load]);

  async function fetchCommitContent(
    commit: CommitMetaData
  ): Promise<Record<GlobalScriptKey, string>> {
    const cached = contentCache.get(commit.hash);
    if (cached) return cached;

    const xml = await getEntityContentAtRevision(SCRIPTS_ID, commit.hash, MODE_GLOBAL_SCRIPTS);
    const parsed = parseGlobalScriptsXml(xml);
    setContentCache((prev) => new Map(prev).set(commit.hash, parsed));
    return parsed;
  }

  async function handleSelectCommit(commit: CommitMetaData) {
    setSelectedCommit(commit);
    setDiffError(null);
    setDiffLoading(true);
    try {
      await fetchCommitContent(commit);
    } catch (e) {
      setDiffError(e instanceof Error ? e.message : "Failed to load revision");
    } finally {
      setDiffLoading(false);
    }
  }

  function getDiffSides(
    commit: CommitMetaData,
    script: GlobalScriptKey,
    mode: DiffMode
  ): { oldContent: string; newContent: string } | null {
    const commitScripts = contentCache.get(commit.hash);
    if (!commitScripts) return null;

    const newContent = commitScripts[script];

    if (mode === "current") {
      const oldContent = currentScripts?.[script] ?? "";
      return { oldContent, newContent };
    } else {
      // Parent → Commit
      const idx = commits.findIndex((c) => c.hash === commit.hash);
      const parentCommit = idx >= 0 && idx + 1 < commits.length ? commits[idx + 1] : null;
      const parentScripts = parentCommit ? contentCache.get(parentCommit.hash) : undefined;
      if (!parentScripts) return null;
      return { oldContent: parentScripts[script], newContent };
    }
  }

  async function ensureParentLoaded(commit: CommitMetaData) {
    const idx = commits.findIndex((c) => c.hash === commit.hash);
    const parentCommit = idx >= 0 && idx + 1 < commits.length ? commits[idx + 1] : null;
    if (parentCommit && !contentCache.get(parentCommit.hash)) {
      await fetchCommitContent(parentCommit);
    }
  }

  async function handleDiffModeChange(mode: DiffMode) {
    setDiffMode(mode);
    if (selectedCommit && mode === "parent") {
      setDiffLoading(true);
      try {
        await ensureParentLoaded(selectedCommit);
      } catch (e) {
        setDiffError(e instanceof Error ? e.message : "Failed to load parent revision");
      } finally {
        setDiffLoading(false);
      }
    }
  }

  async function handleRestore(commit: CommitMetaData) {
    setRestoring(true);
    try {
      const restored = await fetchCommitContent(commit);
      setRestoreTarget(null);
      onReverted?.(restored);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to restore");
      setRestoreTarget(null);
    } finally {
      setRestoring(false);
    }
  }

  // Determine whether we have the content needed for the current diff view
  const sides =
    selectedCommit && !diffLoading && !diffError
      ? getDiffSides(selectedCommit, activeScript, diffMode)
      : null;

  const needsParentLoad =
    selectedCommit &&
    diffMode === "parent" &&
    !diffLoading &&
    !contentCache.get(
      (() => {
        const idx = commits.findIndex((c) => c.hash === selectedCommit.hash);
        return idx >= 0 && idx + 1 < commits.length ? commits[idx + 1].hash : "";
      })()
    );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[1600px] h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 pt-4 pb-3 border-b border-border shrink-0">
            <DialogTitle className="text-base">Global Scripts History</DialogTitle>
            <DialogDescription className="text-xs">
              {commits.length} commit{commits.length !== 1 ? "s" : ""}
            </DialogDescription>
          </DialogHeader>

          {/* Toolbar */}
          <div className="flex items-center gap-2 px-5 py-2 border-b border-border shrink-0">
            <HoverTooltip content="Reload history">
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </HoverTooltip>
            <CommitLimitSelect value={limit} onChange={setLimit} disabled={loading} />
          </div>

          {/* Main content area */}
          <div className="flex-1 min-h-0 flex px-5 py-3 gap-3">
            <ApiErrorAlert error={error} />

            {loading && (
              <div className="flex-1 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            )}

            {!loading && (
              <>
                {/* Left: commit list (collapsible) */}
                {!listCollapsed && (
                  <div className="w-[260px] shrink-0 overflow-y-auto border border-border rounded flex flex-col">
                    {commits.length === 0 && !error && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-10">
                        No history found
                      </p>
                    )}
                    {commits.map((commit) => {
                      const isSelected = selectedCommit?.hash === commit.hash;
                      const subject = getMessageContent(commit.message);
                      const displayTime = formatCommitTime(commit.timestamp, dateMode);
                      return (
                        <ContextMenu key={commit.hash}>
                          <ContextMenuTrigger asChild>
                            <button
                              onClick={() => void handleSelectCommit(commit)}
                              className={cn(
                                "w-full text-left px-3 py-1.5 border-b border-border hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors",
                                isSelected &&
                                  "bg-blue-100 dark:bg-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                              )}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400 shrink-0">
                                  {getShortHash(commit.hash)}
                                </span>
                                <span className="text-xs font-medium truncate text-gray-900 dark:text-gray-100">
                                  {subject || commit.hash}
                                </span>
                              </div>
                              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 flex gap-1.5">
                                <span>{commit.committer}</span>
                                <span>&middot;</span>
                                <span title={absoluteCommitTime(commit.timestamp)}>
                                  {displayTime}
                                </span>
                              </div>
                            </button>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem
                              onClick={() => {
                                void navigator.clipboard.writeText(commit.hash);
                                toast.success("Commit hash copied");
                              }}
                            >
                              <Copy className="w-4 h-4 mr-2" />
                              Copy Commit Hash
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem onClick={() => setRestoreTarget(commit)}>
                              <Undo2 className="w-4 h-4 mr-2" />
                              Restore to this revision
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })}
                  </div>
                )}

                {/* Toggle button to collapse/expand the commit list */}
                <button
                  onClick={() => setListCollapsed((v) => !v)}
                  className="self-stretch flex items-center px-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded border border-border shrink-0 transition-colors"
                  title={listCollapsed ? "Show commit list" : "Hide commit list"}
                >
                  {listCollapsed ? (
                    <ChevronRight className="w-3 h-3" />
                  ) : (
                    <ChevronLeft className="w-3 h-3" />
                  )}
                </button>

                {/* Right: diff view */}
                <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
                  {!selectedCommit && (
                    <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
                      Select a commit to view changes
                    </div>
                  )}

                  {selectedCommit && (
                    <>
                      {/* Commit metadata */}
                      <div className="border border-border rounded p-3 shrink-0 bg-white dark:bg-gray-900">
                        <CommitMetaGrid commit={selectedCommit} />
                      </div>

                      {/* Script selector */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          Script:
                        </span>
                        <div className="inline-flex rounded border border-border overflow-hidden">
                          {SCRIPT_ORDER.map((key) => (
                            <button
                              key={key}
                              onClick={() => setActiveScript(key)}
                              className={cn(
                                "px-2 py-0.5 text-[11px] font-medium transition-colors border-r last:border-r-0 border-border",
                                activeScript === key
                                  ? "bg-blue-600 text-white"
                                  : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                              )}
                            >
                              {key}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Diff mode selector */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          Compare:
                        </span>
                        <div className="inline-flex rounded border border-border overflow-hidden">
                          {(
                            [
                              {
                                key: "current" as DiffMode,
                                label: "Current \u2192 Commit",
                                tip: "Compares the current version on the server against this historical commit",
                              },
                              {
                                key: "parent" as DiffMode,
                                label: "Parent \u2192 Commit",
                                tip: "Compare the previous commit against this commit to see what changed",
                              },
                            ] as const
                          ).map(({ key, label, tip }) => (
                            <HoverTooltip key={key} content={tip}>
                              <button
                                onClick={() => void handleDiffModeChange(key)}
                                className={cn(
                                  "px-2 py-0.5 text-[11px] font-medium transition-colors border-r last:border-r-0 border-border",
                                  diffMode === key
                                    ? "bg-blue-600 text-white"
                                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                                )}
                              >
                                {label}
                              </button>
                            </HoverTooltip>
                          ))}
                        </div>
                        <InfoTooltip
                          text="Current = the version currently on the server. Parent = the commit before the selected one."
                          side="bottom"
                          iconSize="w-3 h-3"
                        />
                      </div>

                      {/* Diff */}
                      <div className="flex-1 min-h-0">
                        {diffLoading && (
                          <div className="space-y-2 pt-1">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Skeleton key={i} className="h-4 w-full" />
                            ))}
                          </div>
                        )}
                        {!diffLoading && diffError && <ApiErrorAlert error={diffError} />}
                        {!diffLoading && !diffError && needsParentLoad && (
                          <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded h-full">
                            No parent commit available
                          </div>
                        )}
                        {!diffLoading && !diffError && sides && (
                          <DiffView
                            oldContent={sides.oldContent}
                            newContent={sides.newContent}
                            oldLabel={
                              diffMode === "current"
                                ? "Current"
                                : `before ${getShortHash(selectedCommit.hash)}`
                            }
                            newLabel={getShortHash(selectedCommit.hash)}
                          />
                        )}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter className="px-5 py-3 border-t border-border shrink-0">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore confirmation */}
      {restoreTarget && (
        <ConfirmDialog
          title="Restore to this revision"
          description={
            <>
              Restore all global scripts to revision{" "}
              <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">
                {getShortHash(restoreTarget.hash)}
              </code>{" "}
              from {format(new Date(restoreTarget.timestamp), "MMM d, yyyy HH:mm")}?
              <br />
              <span className="text-gray-500 text-xs mt-1 block">
                The restored scripts will be loaded into the editor. Click Save to persist them to
                the server.
              </span>
            </>
          }
          confirmLabel={restoring ? "Restoring\u2026" : "Restore"}
          confirmVariant="default"
          onConfirm={() => void handleRestore(restoreTarget)}
          onCancel={() => {
            if (!restoring) setRestoreTarget(null);
          }}
        />
      )}
    </>
  );
}

// ─── Commit metadata grid ─────────────────────────────────────────────────────

function CommitMetaGrid({ commit }: { commit: CommitMetaData }) {
  const date = format(new Date(commit.timestamp), "MMM d, yyyy HH:mm");
  const type = getEntityType(commit.message);
  const name = getEntityName(commit.message);
  const server = getServerName(commit.message);
  const subject = getMessageContent(commit.message);

  const rows: Array<[string, string]> = [
    ["Commit", getShortHash(commit.hash)],
    ["Author", commit.committer],
    ["Date", date],
    ["Message", subject],
  ];
  if (type) rows.push(["Type", type]);
  if (name) rows.push(["Name", name]);
  if (server) rows.push(["Server", server]);

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="text-xs text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap">
            {label}:
          </dt>
          <dd className="text-xs text-gray-800 dark:text-gray-200 truncate" title={value}>
            {value}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}
