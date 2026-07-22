"use client";

/**
 * Library History Dialog
 *
 * Full-featured version history dialog for a single code template library.
 * Two-pane layout: commit list on the left, diff view on the right.
 * Supports single-commit diff (vs current or parent) and compare mode.
 *
 * Mirrors the TemplateHistoryDialog pattern, using MODE_CODE_TEMPLATE_LIBRARY.
 */

import { Fragment, startTransition, useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { RefreshCw, GitCompare, Copy, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { serializeLibraryForRepo } from "@/lib/api/api-code-templates";
import type { CodeTemplateLibrary } from "@/lib/types";
import { ApiErrorAlert } from "@/components/api-error-alert";
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
  MODE_CODE_TEMPLATE_LIBRARY,
  type CommitMetaData,
} from "../api-version-history";
import { DiffView } from "./diff-view";
import { useCommitDateMode, formatCommitTime, absoluteCommitTime } from "./use-commit-date-mode";

type DiffMode = "current" | "parent";

interface LibraryHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraryId: string;
  libraryName: string;
  currentLibrary?: CodeTemplateLibrary;
}

export function LibraryHistoryDialog({
  open,
  onOpenChange,
  libraryId,
  libraryName,
  currentLibrary,
}: LibraryHistoryDialogProps) {
  const { dateMode } = useCommitDateMode();
  const [commits, setCommits] = useState<CommitMetaData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedCommit, setSelectedCommit] = useState<CommitMetaData | null>(null);
  const [oldContent, setOldContent] = useState<string | null>(null);
  const [newContent, setNewContent] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<DiffMode>("current");

  // Compare mode
  const [compareMode, setCompareMode] = useState(false);
  const [compareFrom, setCompareFrom] = useState<CommitMetaData | null>(null);
  const [compareTo, setCompareTo] = useState<CommitMetaData | null>(null);

  // Collapse the left commit list to give more space to the diff view
  const [listCollapsed, setListCollapsed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedCommit(null);
    setOldContent(null);
    setNewContent(null);
    try {
      const data = await getEntityHistory(libraryId, MODE_CODE_TEMPLATE_LIBRARY);
      setCommits(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [libraryId]);

  useEffect(() => {
    if (open) startTransition(() => void load());
  }, [open, load]);

  function loadDiff(commit: CommitMetaData, mode: DiffMode = diffMode) {
    setOldContent(null);
    setNewContent(null);
    setDiffError(null);
    setDiffLoading(true);

    const fetchCommit = getEntityContentAtRevision(
      libraryId,
      commit.hash,
      MODE_CODE_TEMPLATE_LIBRARY
    );

    let fetchOther: Promise<string>;
    if (mode === "current") {
      fetchOther = Promise.resolve(currentLibrary ? serializeLibraryForRepo(currentLibrary) : "");
    } else {
      const idx = commits.findIndex((c) => c.hash === commit.hash);
      const parentCommit = idx >= 0 && idx + 1 < commits.length ? commits[idx + 1] : null;
      fetchOther = parentCommit
        ? getEntityContentAtRevision(libraryId, parentCommit.hash, MODE_CODE_TEMPLATE_LIBRARY)
        : Promise.resolve("");
    }

    Promise.all([fetchOther, fetchCommit])
      .then(([old, next]) => {
        setOldContent(old);
        setNewContent(next);
      })
      .catch((e) => setDiffError(e instanceof Error ? e.message : "Failed to load diff"))
      .finally(() => setDiffLoading(false));
  }

  function handleSelectCommit(commit: CommitMetaData) {
    setSelectedCommit(commit);
    loadDiff(commit);
  }

  function handleDiffModeChange(mode: DiffMode) {
    setDiffMode(mode);
    if (selectedCommit) loadDiff(selectedCommit, mode);
  }

  function toggleCompareMode() {
    const next = !compareMode;
    setCompareMode(next);
    if (!next) {
      setCompareFrom(null);
      setCompareTo(null);
      if (selectedCommit) loadDiff(selectedCommit);
    } else {
      setSelectedCommit(null);
      setOldContent(null);
      setNewContent(null);
      if (commits.length >= 2) {
        setCompareFrom(commits[1]);
        setCompareTo(commits[0]);
        loadCompareDiff(commits[1], commits[0]);
      }
    }
  }

  function loadCompareDiff(from: CommitMetaData, to: CommitMetaData) {
    setOldContent(null);
    setNewContent(null);
    setDiffError(null);
    setDiffLoading(true);

    if (from.hash === to.hash) {
      setOldContent("");
      setNewContent("");
      setDiffLoading(false);
      return;
    }

    Promise.all([
      getEntityContentAtRevision(libraryId, from.hash, MODE_CODE_TEMPLATE_LIBRARY).catch(() => ""),
      getEntityContentAtRevision(libraryId, to.hash, MODE_CODE_TEMPLATE_LIBRARY).catch(() => ""),
    ])
      .then(([old, next]) => {
        setOldContent(old);
        setNewContent(next);
      })
      .catch((e) => setDiffError(e instanceof Error ? e.message : "Failed to load diff"))
      .finally(() => setDiffLoading(false));
  }

  function handleCompareSelect(commit: CommitMetaData) {
    const newFrom = compareTo ?? compareFrom;
    const newTo = commit;
    setCompareFrom(newFrom);
    setCompareTo(newTo);
    if (newFrom) loadCompareDiff(newFrom, newTo);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[1600px] h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border shrink-0">
          <DialogTitle className="text-base">Library History &mdash; {libraryName}</DialogTitle>
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
          {commits.length >= 2 && (
            <HoverTooltip content={compareMode ? "Exit compare mode" : "Compare two revisions"}>
              <Button
                variant={compareMode ? "default" : "outline"}
                size="sm"
                onClick={toggleCompareMode}
              >
                <GitCompare className="w-3.5 h-3.5 mr-1.5" />
                Compare
              </Button>
            </HoverTooltip>
          )}
        </div>

        {/* Main content */}
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
                    const isSelected = compareMode
                      ? compareFrom?.hash === commit.hash || compareTo?.hash === commit.hash
                      : selectedCommit?.hash === commit.hash;
                    const subject = getMessageContent(commit.message);
                    const displayTime = formatCommitTime(commit.timestamp, dateMode);
                    const isFrom = compareMode && compareFrom?.hash === commit.hash;
                    const isTo = compareMode && compareTo?.hash === commit.hash;
                    return (
                      <ContextMenu key={commit.hash}>
                        <ContextMenuTrigger asChild>
                          <button
                            onClick={() =>
                              compareMode ? handleCompareSelect(commit) : handleSelectCommit(commit)
                            }
                            className={cn(
                              "w-full text-left px-3 py-1.5 border-b border-border hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors",
                              isSelected &&
                                "bg-blue-100 dark:bg-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {compareMode && (
                                <span
                                  className={cn(
                                    "text-[9px] font-bold shrink-0 w-7 text-center rounded px-0.5",
                                    isFrom
                                      ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                                      : isTo
                                        ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                        : "text-transparent"
                                  )}
                                >
                                  {isFrom ? "FROM" : isTo ? "TO" : "\u00A0"}
                                </span>
                              )}
                              <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400 shrink-0">
                                {getShortHash(commit.hash)}
                              </span>
                              <span className="text-xs font-medium truncate text-gray-900 dark:text-gray-100">
                                {subject || commit.hash}
                              </span>
                            </div>
                            <div
                              className={cn(
                                "text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 flex gap-1.5",
                                compareMode && "ml-9"
                              )}
                            >
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
                {!compareMode && !selectedCommit && (
                  <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
                    Select a commit to view changes
                  </div>
                )}

                {compareMode && !(compareFrom && compareTo) && (
                  <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
                    Select two commits to compare
                  </div>
                )}

                {compareMode && compareFrom && compareTo && compareFrom.hash === compareTo.hash && (
                  <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
                    Same revision selected &mdash; no changes to display
                  </div>
                )}

                {compareMode && compareFrom && compareTo && compareFrom.hash !== compareTo.hash && (
                  <div className="flex-1 min-h-0">
                    <DiffContent
                      loading={diffLoading}
                      error={diffError}
                      oldContent={oldContent}
                      newContent={newContent}
                      oldLabel={getShortHash(compareFrom.hash)}
                      newLabel={getShortHash(compareTo.hash)}
                    />
                  </div>
                )}

                {!compareMode && selectedCommit && (
                  <>
                    <div className="border border-border rounded p-3 shrink-0 bg-white dark:bg-gray-900">
                      <CommitMetaGrid commit={selectedCommit} />
                    </div>

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
                              tip: "Compares the previous commit against this commit to see what changed",
                            },
                          ] as const
                        ).map(({ key, label, tip }) => (
                          <HoverTooltip key={key} content={tip}>
                            <button
                              onClick={() => handleDiffModeChange(key)}
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

                    <div className="flex-1 min-h-0">
                      <DiffContent
                        loading={diffLoading}
                        error={diffError}
                        oldContent={oldContent}
                        newContent={newContent}
                        oldLabel={
                          diffMode === "current"
                            ? "Current"
                            : `before ${getShortHash(selectedCommit.hash)}`
                        }
                        newLabel={getShortHash(selectedCommit.hash)}
                      />
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
  );
}

// ─── Diff content helper ──────────────────────────────────────────────────────

function DiffContent({
  loading,
  error,
  oldContent,
  newContent,
  oldLabel,
  newLabel,
}: {
  loading: boolean;
  error: string | null;
  oldContent: string | null;
  newContent: string | null;
  oldLabel: string;
  newLabel: string;
}) {
  if (loading) {
    return (
      <div className="space-y-2 pt-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    );
  }
  if (error) return <ApiErrorAlert error={error} />;
  if (oldContent !== null && newContent !== null) {
    return (
      <DiffView
        oldContent={oldContent}
        newContent={newContent}
        oldLabel={oldLabel}
        newLabel={newLabel}
      />
    );
  }
  return null;
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
