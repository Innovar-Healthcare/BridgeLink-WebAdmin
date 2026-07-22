"use client";

/**
 * Channel History Panel
 *
 * Rendered as a plugin tab inside the Channel Editor (tabs mode).
 * Shows all commits for the current channel in a two-pane layout:
 *   Left  — scrollable commit list
 *   Right — commit detail + changed files + side-by-side diff
 *
 * Mirrors Java's ChannelHistoryTabPanel / CommitMetaDataTable.
 * API: GET /plugins/version-history/history?fileName=<channelId>&mode=MODE_CHANNEL
 */

import { Fragment, startTransition, useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { RefreshCw, GitCompare, Undo2, Copy, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { getChannelIdsAndNames, updateChannelFromXml } from "@/lib/api/api-channels";

import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { HoverTooltip } from "@/components/hover-tooltip";
import { InfoTooltip } from "@/components/info-tooltip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  getCommitChanges,
  getFileContent,
  getFileContentAtHead,
  getFileContentAtRevision,
  restoreFiles,
  commitAndPushFiles,
  getLibrariesAndTemplates,
  getShortHash,
  getMessageContent,
  getEntityType,
  getEntityName,
  getServerName,
  resolvePathDisplay,
  friendlyRepoError,
  MODE_CHANNEL,
  type CommitMetaData,
  type RepoItemChange,
} from "../api-version-history";

import { DiffView } from "./diff-view";
import { CommitLimitSelect, DEFAULT_COMMIT_LIMIT } from "./commit-limit-select";
import { useCommitDateMode, formatCommitTime, absoluteCommitTime } from "./use-commit-date-mode";
import { usePluginCapabilities } from "../use-plugin-capabilities";

type DiffMode = "parent" | "working-tree" | "head";

// ─── Component ────────────────────────────────────────────────────────────────

export function ChannelHistoryPanel({
  channelId,
  channelName,
}: {
  channelId: string;
  channelName: string;
}) {
  const { viewDensity } = useCompactMode();
  const { dateMode, toggleDateMode } = useCommitDateMode();
  const { hasHistoryLimitParam } = usePluginCapabilities();
  const router = useRouter();

  // Max commits to load. Always enforced client-side; only sent to the server
  // when it supports the `limit` param. Local state only — not persisted.
  const [limit, setLimit] = useState(DEFAULT_COMMIT_LIMIT);

  const [commits, setCommits] = useState<CommitMetaData[]>([]);
  const [channelNames, setChannelNames] = useState<Map<string, string> | null>(null);
  const [templateNames, setTemplateNames] = useState<Map<string, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedCommit, setSelectedCommit] = useState<CommitMetaData | null>(null);
  const [commitFiles, setCommitFiles] = useState<RepoItemChange[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<RepoItemChange | null>(null);
  const [oldContent, setOldContent] = useState<string | null>(null);
  const [newContent, setNewContent] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Diff mode selector (normal mode only)
  const [diffMode, setDiffMode] = useState<DiffMode>("parent");

  // Compare mode
  const [compareMode, setCompareMode] = useState(false);
  const [compareFrom, setCompareFrom] = useState<CommitMetaData | null>(null);
  const [compareTo, setCompareTo] = useState<CommitMetaData | null>(null);

  // Changed files filter — show only current channel file by default
  const [showAllFiles, setShowAllFiles] = useState(false);

  // Restore to revision
  const [restoreTarget, setRestoreTarget] = useState<CommitMetaData | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [postRestore, setPostRestore] = useState<{ hash: string } | null>(null);
  const [postRestoreAction, setPostRestoreAction] = useState(false);

  // Collapse the left commit list to give more space to the diff view
  const [listCollapsed, setListCollapsed] = useState(false);

  // Working-tree content cache for "already at this revision" check
  const [workingTreeContent, setWorkingTreeContent] = useState<string | null>(null);
  // Map of commitHash → true (matches working tree) | false (differs)
  const [restoreMatchMap, setRestoreMatchMap] = useState<Map<string, boolean>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedCommit(null);
    setCommitFiles([]);
    setSelectedFile(null);
    setOldContent(null);
    setNewContent(null);
    try {
      const [data, names, repoTemplates] = await Promise.all([
        getEntityHistory(channelId, MODE_CHANNEL, {
          limit,
          sendLimitToServer: hasHistoryLimitParam,
        }),
        getChannelIdsAndNames(),
        getLibrariesAndTemplates(),
      ]);
      setCommits(data);
      setChannelNames(names);
      setTemplateNames(new Map(repoTemplates.templates.map((t) => [t.id, t.name])));
    } catch (e) {
      setError(friendlyRepoError(e, "Failed to load history"));
    } finally {
      setLoading(false);
    }
  }, [channelId, limit, hasHistoryLimitParam]);

  useEffect(() => {
    startTransition(() => {
      void load();
    });
  }, [load]);

  // Fetch current working-tree content once so we can detect "already at this revision"
  useEffect(() => {
    getFileContent(`channels/${channelId}`)
      .then(setWorkingTreeContent)
      .catch(() => setWorkingTreeContent(null));
  }, [channelId]);

  async function checkRestoreMatch(commit: CommitMetaData) {
    if (restoreMatchMap.has(commit.hash) || workingTreeContent === null) return;
    try {
      const commitContent = await getEntityContentAtRevision(channelId, commit.hash, MODE_CHANNEL);
      setRestoreMatchMap((prev) =>
        new Map(prev).set(commit.hash, commitContent === workingTreeContent)
      );
    } catch {
      // leave unknown — don't disable the item if we can't check
    }
  }

  function handleSelectCommit(commit: CommitMetaData) {
    setSelectedCommit(commit);
    void checkRestoreMatch(commit);
    setCommitFiles([]);
    setFilesError(null);
    setSelectedFile(null);
    setOldContent(null);
    setNewContent(null);
    setDiffMode("parent");
    setShowAllFiles(false);
    setFilesLoading(true);
    getCommitChanges(commit.hash)
      .then((files) => {
        setCommitFiles(files);
        // Auto-select the current channel's file so the diff loads immediately
        const channelFile = files.find((f) => f.path === `channels/${channelId}`);
        if (channelFile) {
          handleSelectFile(channelFile, "parent", commit);
        }
      })
      .catch((e) => setFilesError(e instanceof Error ? e.message : "Failed to load files"))
      .finally(() => setFilesLoading(false));
  }

  function handleSelectFile(
    file: RepoItemChange,
    activeDiffMode: DiffMode = diffMode,
    activeCommit: CommitMetaData | null = selectedCommit
  ) {
    if (!activeCommit) return;
    setSelectedFile(file);
    setOldContent(null);
    setNewContent(null);
    setDiffError(null);
    setDiffLoading(true);

    const idx = commits.findIndex((c) => c.hash === activeCommit.hash);
    const parentCommit = idx >= 0 && idx + 1 < commits.length ? commits[idx + 1] : null;

    const fetchNew = getFileContentAtRevision(file.path, activeCommit.hash);
    let fetchOld: Promise<string>;
    if (activeDiffMode === "working-tree") {
      fetchOld = getFileContent(file.path).catch(() => "");
    } else if (activeDiffMode === "head") {
      fetchOld = getFileContentAtHead(file.path).catch(() => "");
    } else {
      fetchOld =
        parentCommit && file.changeType !== "ADDED"
          ? getFileContentAtRevision(file.path, parentCommit.hash)
          : Promise.resolve("");
    }

    Promise.all([fetchOld, fetchNew])
      .then(([old, next]) => {
        setOldContent(old);
        setNewContent(next);
      })
      .catch((e) => setDiffError(e instanceof Error ? e.message : "Failed to load diff"))
      .finally(() => setDiffLoading(false));
  }

  function handleDiffModeChange(mode: DiffMode) {
    setDiffMode(mode);
    if (selectedFile) {
      handleSelectFile(selectedFile, mode);
    }
  }

  function toggleCompareMode() {
    const next = !compareMode;
    setCompareMode(next);
    if (!next) {
      setCompareFrom(null);
      setCompareTo(null);
      if (selectedCommit && selectedFile) {
        handleSelectFile(selectedFile);
      }
    } else {
      setSelectedCommit(null);
      setCommitFiles([]);
      setSelectedFile(null);
      setOldContent(null);
      setNewContent(null);
      if (commits.length >= 2) {
        setCompareFrom(commits[1]);
        setCompareTo(commits[0]);
        loadCompareEntityDiff(commits[1], commits[0]);
      }
    }
  }

  function loadCompareEntityDiff(from: CommitMetaData, to: CommitMetaData) {
    setOldContent(null);
    setNewContent(null);
    setDiffError(null);
    setDiffLoading(true);
    setSelectedFile(null);
    setCommitFiles([]);

    if (from.hash === to.hash) {
      setOldContent("");
      setNewContent("");
      setDiffLoading(false);
      return;
    }

    Promise.all([
      getEntityContentAtRevision(channelId, from.hash, MODE_CHANNEL).catch(() => ""),
      getEntityContentAtRevision(channelId, to.hash, MODE_CHANNEL).catch(() => ""),
    ])
      .then(([old, next]) => {
        setOldContent(old);
        setNewContent(next);
      })
      .catch((e) => setDiffError(e instanceof Error ? e.message : "Failed to load diff"))
      .finally(() => setDiffLoading(false));
  }

  // Row click: plain click selects a commit; Ctrl/Cmd+click jumps straight into
  // compare mode seeded with this commit (Java-client parity, #4).
  function handleRowClick(e: React.MouseEvent, commit: CommitMetaData) {
    if (compareMode) {
      handleCompareSelect(commit);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      setCompareMode(true);
      setSelectedCommit(null);
      setCommitFiles([]);
      setSelectedFile(null);
      setOldContent(null);
      setNewContent(null);
      setCompareFrom(null);
      setCompareTo(commit);
      return;
    }
    handleSelectCommit(commit);
  }

  function handleCompareSelect(commit: CommitMetaData) {
    const newFrom = compareTo ?? compareFrom;
    const newTo = commit;
    setCompareFrom(newFrom);
    setCompareTo(newTo);
    if (newFrom) {
      loadCompareEntityDiff(newFrom, newTo);
    }
  }

  async function handleRestore(commit: CommitMetaData) {
    setRestoring(true);
    try {
      const repoPath = `channels/${channelId}`;
      const content = await getEntityContentAtRevision(channelId, commit.hash, MODE_CHANNEL);
      await restoreFiles({ [repoPath]: content });
      await updateChannelFromXml(channelId, content);
      toast.success(`Restored ${channelName} to revision ${getShortHash(commit.hash)}`);
      setRestoreTarget(null);
      setPostRestore({ hash: commit.hash });
      // Update working-tree cache so restore checks reflect the new state
      setWorkingTreeContent(content);
      setRestoreMatchMap(new Map());
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to restore");
      setRestoreTarget(null);
    } finally {
      setRestoring(false);
    }
  }

  async function handlePostRestoreCommit() {
    if (!postRestore) return;
    setPostRestoreAction(true);
    try {
      await commitAndPushFiles(
        [`channels/${channelId}`],
        `Restore ${channelName} to ${getShortHash(postRestore.hash)}`,
        1
      );
      toast.success("Committed and pushed successfully");
      setPostRestore(null);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to commit");
    } finally {
      setPostRestoreAction(false);
    }
  }

  const rowPy =
    viewDensity === "comfortable" ? "py-2" : viewDensity === "compact" ? "py-1" : "py-1.5";

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-2">
        <HoverTooltip content="Reload history">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </HoverTooltip>
        <CommitLimitSelect value={limit} onChange={setLimit} disabled={loading} />
        {commits.length >= 2 && (
          <HoverTooltip
            content={
              compareMode
                ? "Exit compare mode"
                : "Compare two revisions (or Ctrl/Cmd+click two in the list)"
            }
          >
            <Button
              variant={compareMode ? "default" : "outline"}
              size="sm"
              onClick={toggleCompareMode}
            >
              <GitCompare className="w-4 h-4 mr-1.5" />
              Compare
            </Button>
          </HoverTooltip>
        )}
        <HoverTooltip
          content={
            dateMode === "relative"
              ? "Showing relative times — click for exact dates"
              : "Showing exact dates — click for relative times"
          }
        >
          <Button variant="outline" size="sm" onClick={toggleDateMode}>
            <Clock className="w-4 h-4 mr-1.5" />
            {dateMode === "relative" ? "Relative" : "Exact"}
          </Button>
        </HoverTooltip>
        {!compareMode && (
          <>
            <HoverTooltip
              content={
                selectedCommit
                  ? "Copy the selected commit's hash"
                  : "Select a commit to copy its hash"
              }
            >
              <Button
                variant="outline"
                size="sm"
                disabled={!selectedCommit}
                onClick={() => {
                  if (!selectedCommit) return;
                  void navigator.clipboard.writeText(selectedCommit.hash);
                  toast.success("Commit hash copied");
                }}
              >
                <Copy className="w-4 h-4 mr-1.5" />
                Copy Hash
              </Button>
            </HoverTooltip>
            <HoverTooltip
              content={
                !selectedCommit
                  ? "Select a commit to restore"
                  : restoreMatchMap.get(selectedCommit.hash) === true
                    ? "Working tree already matches this revision"
                    : "Restore the selected revision"
              }
            >
              <Button
                variant="outline"
                size="sm"
                disabled={!selectedCommit || restoreMatchMap.get(selectedCommit.hash) === true}
                onClick={() => selectedCommit && setRestoreTarget(selectedCommit)}
              >
                <Undo2 className="w-4 h-4 mr-1.5" />
                Restore
              </Button>
            </HoverTooltip>
          </>
        )}
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Version history for <span className="font-medium">{channelName}</span>
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
          {commits.length} commit{commits.length !== 1 ? "s" : ""}
        </span>
      </div>

      <ApiErrorAlert error={error} />

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {!loading && (
        <div className="flex flex-1 min-h-0 gap-2">
          {/* ── Left: commit list (collapsible) ── */}
          {!listCollapsed && (
            <div className="w-[280px] shrink-0 overflow-y-auto border border-border rounded flex flex-col">
              {commits.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-10">
                  No commits found for this channel
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
                  <ContextMenu
                    key={commit.hash}
                    onOpenChange={(open) => {
                      if (open) void checkRestoreMatch(commit);
                    }}
                  >
                    <ContextMenuTrigger asChild>
                      <button
                        onClick={(e) => handleRowClick(e, commit)}
                        className={cn(
                          "w-full text-left px-3 border-b border-border hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors",
                          rowPy,
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
                          <span>·</span>
                          <span title={absoluteCommitTime(commit.timestamp)}>{displayTime}</span>
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
                      <ContextMenuItem
                        disabled={restoreMatchMap.get(commit.hash) === true}
                        onClick={() => setRestoreTarget(commit)}
                      >
                        <Undo2 className="w-4 h-4 mr-2" />
                        {restoreMatchMap.get(commit.hash) === true
                          ? "Already at this revision"
                          : "Restore to this revision"}
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

          {/* ── Right: detail + diff ── */}
          <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
            {!compareMode && !selectedCommit && (
              <div className="flex-1 flex flex-col gap-1 items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
                <span>Select a commit to view details</span>
                <span className="text-xs">Tip: Ctrl/Cmd+click two commits to compare them</span>
              </div>
            )}

            {compareMode && !(compareFrom && compareTo) && (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
                Select two commits to compare
              </div>
            )}

            {compareMode && compareFrom && compareTo && compareFrom.hash === compareTo.hash && (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
                Same revision selected — no changes to display
              </div>
            )}

            {/* Compare mode: direct entity diff */}
            {compareMode && compareFrom && compareTo && compareFrom.hash !== compareTo.hash && (
              <div className="flex-1 min-h-0">
                {diffLoading && (
                  <div className="space-y-2 pt-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-4 w-full" />
                    ))}
                  </div>
                )}
                {diffError && <ApiErrorAlert error={diffError} />}
                {!diffLoading && !diffError && oldContent !== null && newContent !== null && (
                  <DiffView
                    oldContent={oldContent}
                    newContent={newContent}
                    oldLabel={getShortHash(compareFrom.hash)}
                    newLabel={getShortHash(compareTo.hash)}
                  />
                )}
              </div>
            )}

            {/* Normal mode: single commit detail */}
            {!compareMode && selectedCommit && (
              <>
                {/* Commit metadata */}
                <div className="border border-border rounded p-3 shrink-0 bg-white dark:bg-gray-900">
                  <CommitMetaGrid commit={selectedCommit} />

                  <div className="mt-3">
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                      Changed files
                    </p>
                    <ApiErrorAlert error={filesError} />
                    {filesLoading && (
                      <div className="space-y-1">
                        {Array.from({ length: 2 }).map((_, i) => (
                          <Skeleton key={i} className="h-4 w-full" />
                        ))}
                      </div>
                    )}
                    {!filesLoading && commitFiles.length === 0 && !filesError && (
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        No files listed for this commit.
                      </p>
                    )}
                    {!filesLoading &&
                      commitFiles.length > 0 &&
                      (() => {
                        const channelPath = `channels/${channelId}`;
                        const channelFiles = commitFiles.filter((f) => f.path === channelPath);
                        const otherCount = commitFiles.length - channelFiles.length;
                        const visibleFiles =
                          showAllFiles || channelFiles.length === 0 ? commitFiles : channelFiles;
                        return (
                          <>
                            <ul className="space-y-0.5 max-h-28 overflow-y-auto">
                              {visibleFiles.map((f) => (
                                <li key={f.path}>
                                  <button
                                    onClick={() => handleSelectFile(f)}
                                    className={cn(
                                      "w-full text-left flex items-center gap-2 px-1 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors",
                                      selectedFile?.path === f.path &&
                                        "bg-blue-50 dark:bg-blue-900/30"
                                    )}
                                  >
                                    <ChangeTypeBadge type={f.changeType} />
                                    <span
                                      className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate"
                                      title={f.path}
                                    >
                                      {resolvePathDisplay(f.path, channelNames, templateNames)}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                            {otherCount > 0 && (
                              <button
                                onClick={() => setShowAllFiles(!showAllFiles)}
                                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline mt-1"
                              >
                                {showAllFiles
                                  ? "Show only this channel"
                                  : `+${otherCount} more file${otherCount !== 1 ? "s" : ""} in this commit`}
                              </button>
                            )}
                          </>
                        );
                      })()}
                  </div>
                </div>

                {/* Diff mode selector + diff view */}
                <div className="flex-1 min-h-0 flex flex-col">
                  {selectedFile && (
                    <div className="flex items-center gap-2 mb-1.5 shrink-0">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                        Compare:
                      </span>
                      <div className="inline-flex rounded border border-border overflow-hidden">
                        {(
                          [
                            {
                              key: "parent" as DiffMode,
                              label: "Parent \u2192 Commit",
                              tip: "Shows what changed in this commit compared to the previous commit",
                            },
                            {
                              key: "working-tree" as DiffMode,
                              label: "Current \u2192 Commit",
                              tip: "Compares the last server-saved version of this channel against this commit",
                            },
                            ...(commits.length === 0 || commits[0].hash !== selectedCommit.hash
                              ? ([
                                  {
                                    key: "head" as DiffMode,
                                    label: "Last Saved \u2192 Commit",
                                    tip: "Compares the most recently committed version of this file against this commit",
                                  },
                                ] as const)
                              : []),
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
                        text="Current = the last version saved to the server. Last Saved = the most recently committed version in git. Parent = the commit before the selected one."
                        side="bottom"
                        iconSize="w-3 h-3"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-h-0">
                    {!selectedFile && !diffLoading && (
                      <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
                        Select a file to view diff
                      </div>
                    )}
                    {diffLoading && (
                      <div className="space-y-2 pt-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Skeleton key={i} className="h-4 w-full" />
                        ))}
                      </div>
                    )}
                    {diffError && <ApiErrorAlert error={diffError} />}
                    {!diffLoading &&
                      !diffError &&
                      selectedFile &&
                      oldContent !== null &&
                      newContent !== null && (
                        <DiffView
                          oldContent={oldContent}
                          newContent={newContent}
                          oldLabel={
                            diffMode === "working-tree"
                              ? "Current"
                              : diffMode === "head"
                                ? "Last Saved"
                                : `before ${getShortHash(selectedCommit.hash)}`
                          }
                          newLabel={getShortHash(selectedCommit.hash)}
                        />
                      )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Restore confirmation dialog */}
      {restoreTarget && (
        <ConfirmDialog
          title="Restore to this revision"
          description={
            <>
              Restore <strong>{channelName}</strong> to revision{" "}
              <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">
                {getShortHash(restoreTarget.hash)}
              </code>{" "}
              from {format(new Date(restoreTarget.timestamp), "MMM d, yyyy HH:mm")}?
              <br />
              <span className="text-gray-500 text-xs mt-1 block">
                This will overwrite the file in the working tree. The change will appear in the
                Local Changes tab.
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

      {/* Post-restore commit dialog */}
      {postRestore && (
        <ConfirmDialog
          title="Restore complete"
          description={
            <>
              <strong>{channelName}</strong> has been restored to revision{" "}
              <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">
                {getShortHash(postRestore.hash)}
              </code>{" "}
              and is now live on the server.
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-2">
                Would you like to commit and push this restore to git history?
              </p>
            </>
          }
          confirmLabel={postRestoreAction ? "Committing\u2026" : "Commit & Push"}
          confirmVariant="default"
          onConfirm={() => void handlePostRestoreCommit()}
          onCancel={() => {
            if (!postRestoreAction) setPostRestore(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Commit metadata grid ──────────────────────────────────────────────────────

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

// ─── Change type badge ────────────────────────────────────────────────────────

function ChangeTypeBadge({ type }: { type: string }) {
  const label =
    type === "MODIFIED" ? "M" : type === "ADDED" ? "A" : type === "DELETED" ? "D" : type[0];
  const cls =
    type === "ADDED"
      ? "text-green-700 dark:text-green-400"
      : type === "DELETED"
        ? "text-red-600 dark:text-red-400"
        : "text-yellow-600 dark:text-yellow-400";
  return (
    <span className={cn("text-[10px] font-bold w-4 shrink-0 text-center", cls)} title={type}>
      [{label}]
    </span>
  );
}
