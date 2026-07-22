"use client";

/**
 * Commits Tab (formerly Repository Log Tab)
 *
 * Two-pane layout:
 *   Left  — scrollable commit list (hash, subject, author, relative time)
 *   Right — commit detail panel + side-by-side file diff
 *
 * Selecting a commit loads its changed files and auto-selects the first file.
 * Selecting a file loads the diff by fetching file content at the selected
 * commit and its parent commit.
 */

import { Fragment, startTransition, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  RefreshCw,
  Copy,
  MessageSquare,
  FileText,
  ExternalLink,
  GitCompare,
  Clock,
} from "lucide-react";
import { toast } from "sonner";

import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { HoverTooltip } from "@/components/hover-tooltip";
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
import { getChannelIdsAndNames } from "@/lib/api/api-channels";
import { getCodeTemplateLibraries } from "@/lib/api/api-code-templates";

import {
  getRepoLog,
  getCommitChanges,
  getFileContentAtRevision,
  getShortHash,
  getMessageContent,
  getEntityType,
  getEntityName,
  getServerName,
  resolvePathDisplay,
  getLibrariesAndTemplates,
  friendlyRepoError,
  type CommitMetaData,
  type RepoItemChange,
} from "../api-version-history";
import { DiffView } from "./diff-view";
import { useCommitDateMode, formatCommitTime, absoluteCommitTime } from "./use-commit-date-mode";

// ─── Component ────────────────────────────────────────────────────────────────

export function RepoLogTab() {
  const { viewDensity } = useCompactMode();
  const { dateMode, toggleDateMode } = useCommitDateMode();
  const router = useRouter();

  // Commit list state
  const [commits, setCommits] = useState<CommitMetaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Entity existence maps for "Open in Editor" navigation
  const [existingChannelIds, setExistingChannelIds] = useState<Map<string, string> | null>(null);
  const [existingTemplateIds, setExistingTemplateIds] = useState<Set<string> | null>(null);
  const [templateNames, setTemplateNames] = useState<Map<string, string> | null>(null);

  // Selected commit + its changed files
  const [selectedCommit, setSelectedCommit] = useState<CommitMetaData | null>(null);
  const [commitFiles, setCommitFiles] = useState<RepoItemChange[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  // Selected file + diff state
  const [selectedFile, setSelectedFile] = useState<RepoItemChange | null>(null);
  const [oldContent, setOldContent] = useState<string | null>(null);
  const [newContent, setNewContent] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Compare mode: diff between two arbitrary commits
  const [compareMode, setCompareMode] = useState(false);
  const [compareFrom, setCompareFrom] = useState<CommitMetaData | null>(null);
  const [compareTo, setCompareTo] = useState<CommitMetaData | null>(null);
  const [compareFiles, setCompareFiles] = useState<RepoItemChange[]>([]);
  const [compareFilesLoading, setCompareFilesLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedCommit(null);
    setCommitFiles([]);
    setSelectedFile(null);
    setOldContent(null);
    setNewContent(null);
    try {
      const [data, chanMap, libs, repoTemplates] = await Promise.all([
        getRepoLog(1000),
        getChannelIdsAndNames(),
        getCodeTemplateLibraries(),
        getLibrariesAndTemplates(),
      ]);
      setCommits(data);
      setExistingChannelIds(chanMap);
      setExistingTemplateIds(new Set(libs.flatMap((l) => l.codeTemplateIds)));
      setTemplateNames(new Map(repoTemplates.templates.map((t) => [t.id, t.name])));
    } catch (e) {
      setError(friendlyRepoError(e, "Failed to load repository log"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startTransition(() => {
      void load();
    });
  }, [load]);

  // Shared diff loading — accepts commit and commits list explicitly to avoid
  // stale closure issues when called from within async callbacks.
  function loadDiff(commit: CommitMetaData, file: RepoItemChange, allCommits: CommitMetaData[]) {
    setSelectedFile(file);
    setOldContent(null);
    setNewContent(null);
    setDiffError(null);
    setDiffLoading(true);

    const idx = allCommits.findIndex((c) => c.hash === commit.hash);
    const parentCommit = idx >= 0 && idx + 1 < allCommits.length ? allCommits[idx + 1] : null;

    const fetchNew = getFileContentAtRevision(file.path, commit.hash);
    const fetchOld =
      parentCommit && file.changeType !== "ADDED"
        ? getFileContentAtRevision(file.path, parentCommit.hash)
        : Promise.resolve("");

    Promise.all([fetchOld, fetchNew])
      .then(([old, next]) => {
        setOldContent(old);
        setNewContent(next);
      })
      .catch((e) => setDiffError(e instanceof Error ? e.message : "Failed to load diff"))
      .finally(() => setDiffLoading(false));
  }

  function handleSelectCommit(commit: CommitMetaData) {
    setSelectedCommit(commit);
    setCommitFiles([]);
    setFilesError(null);
    setSelectedFile(null);
    setOldContent(null);
    setNewContent(null);
    setFilesLoading(true);

    getCommitChanges(commit.hash)
      .then((files) => {
        setCommitFiles(files);
        // Auto-select the first file so the diff loads immediately
        if (files.length > 0) {
          loadDiff(commit, files[0], commits);
        }
      })
      .catch((e) => setFilesError(e instanceof Error ? e.message : "Failed to load files"))
      .finally(() => setFilesLoading(false));
  }

  function handleSelectFile(file: RepoItemChange) {
    if (!selectedCommit) return;
    loadDiff(selectedCommit, file, commits);
  }

  function toggleCompareMode() {
    const next = !compareMode;
    setCompareMode(next);
    if (!next) {
      setCompareFrom(null);
      setCompareTo(null);
      setCompareFiles([]);
      // Restore normal view if a commit was selected
      if (selectedCommit && selectedFile) {
        loadDiff(selectedCommit, selectedFile, commits);
      }
    } else {
      setSelectedCommit(null);
      setCommitFiles([]);
      setSelectedFile(null);
      setOldContent(null);
      setNewContent(null);
    }
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
      setCompareFiles([]);
      return;
    }
    handleSelectCommit(commit);
  }

  function handleCompareSelect(commit: CommitMetaData) {
    // GitHub-style: clicking selects as "To", previous "To" shifts to "From"
    const newFrom = compareTo ?? compareFrom;
    const newTo = commit;
    setCompareFrom(newFrom);
    setCompareTo(newTo);
    setSelectedFile(null);
    setOldContent(null);
    setNewContent(null);
    if (newFrom && newFrom.hash !== newTo.hash) {
      loadCompareFiles(newFrom, newTo);
    } else {
      setCompareFiles([]);
    }
  }

  function loadCompareFiles(from: CommitMetaData, to: CommitMetaData) {
    setCompareFilesLoading(true);
    setCompareFiles([]);
    // Get changed files from both commits and merge unique paths
    Promise.all([getCommitChanges(from.hash), getCommitChanges(to.hash)])
      .then(([fromFiles, toFiles]) => {
        const seen = new Set<string>();
        const merged: RepoItemChange[] = [];
        for (const f of [...toFiles, ...fromFiles]) {
          if (!seen.has(f.path)) {
            seen.add(f.path);
            merged.push(f);
          }
        }
        setCompareFiles(merged);
        if (merged.length > 0) {
          loadCompareDiff(from, to, merged[0]);
        }
      })
      .catch(() => setCompareFiles([]))
      .finally(() => setCompareFilesLoading(false));
  }

  function loadCompareDiff(from: CommitMetaData, to: CommitMetaData, file: RepoItemChange) {
    setSelectedFile(file);
    setOldContent(null);
    setNewContent(null);
    setDiffError(null);
    setDiffLoading(true);

    Promise.all([
      getFileContentAtRevision(file.path, from.hash).catch(() => ""),
      getFileContentAtRevision(file.path, to.hash).catch(() => ""),
    ])
      .then(([old, next]) => {
        setOldContent(old);
        setNewContent(next);
      })
      .catch((e) => setDiffError(e instanceof Error ? e.message : "Failed to load diff"))
      .finally(() => setDiffLoading(false));
  }

  function handleCompareFileSelect(file: RepoItemChange) {
    if (!compareFrom || !compareTo) return;
    loadCompareDiff(compareFrom, compareTo, file);
  }

  function editorHrefForPath(path: string): string | null {
    const slashIdx = path.indexOf("/");
    if (slashIdx === -1) return null;
    const folder = path.slice(0, slashIdx);
    const id = path.slice(slashIdx + 1);
    if (!id) return null;
    if (folder === "channels" && existingChannelIds?.has(id)) return `/channels/${id}/edit`;
    if (folder === "codetemplates" && existingTemplateIds?.has(id))
      return `/code-templates?templateId=${id}`;
    return null;
  }

  const rowPy =
    viewDensity === "comfortable" ? "py-2" : viewDensity === "compact" ? "py-1" : "py-1.5";

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-2">
        <HoverTooltip content="Reload repository log">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </HoverTooltip>
        {commits.length >= 2 && (
          <HoverTooltip
            content={
              compareMode
                ? "Exit compare mode"
                : "Compare two commits (or Ctrl/Cmd+click two in the list)"
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
        <HoverTooltip
          content={
            selectedCommit ? "Copy the selected commit's hash" : "Select a commit to copy its hash"
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
        <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
          {commits.length} commit{commits.length !== 1 ? "s" : ""}
        </span>
      </div>

      <ApiErrorAlert error={error} className="mb-2" />

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {!loading && (
        <div className="flex flex-1 min-h-0 gap-2">
          {/* ── Left: commit list ── */}
          <div className="w-[300px] shrink-0 overflow-y-auto border border-border rounded flex flex-col">
            {commits.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-10">
                No commits found
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
                    <ContextMenuItem
                      onClick={() => {
                        void navigator.clipboard.writeText(subject || commit.hash);
                        toast.success("Commit message copied");
                      }}
                    >
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Copy Commit Message
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>

          {/* ── Right: detail + diff ── */}
          <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
            {!compareMode && !selectedCommit && (
              <div className="flex-1 flex flex-col gap-1 items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
                <span>Select a commit to view details</span>
                <span className="text-xs">Tip: Ctrl/Cmd+click two commits to compare them</span>
              </div>
            )}

            {/* Compare mode: waiting for selections */}
            {compareMode && !(compareFrom && compareTo) && (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
                Select two commits to compare
              </div>
            )}

            {/* Compare mode: same revision */}
            {compareMode && compareFrom && compareTo && compareFrom.hash === compareTo.hash && (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
                Same revision selected — no changes to display
              </div>
            )}

            {/* Compare mode: files + diff */}
            {compareMode && compareFrom && compareTo && compareFrom.hash !== compareTo.hash && (
              <>
                <div className="border border-border rounded p-3 shrink-0 bg-white dark:bg-gray-900">
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                    Comparing {getShortHash(compareFrom.hash)} → {getShortHash(compareTo.hash)}
                  </p>
                  {compareFilesLoading && (
                    <div className="space-y-1">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-4 w-full" />
                      ))}
                    </div>
                  )}
                  {!compareFilesLoading && compareFiles.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      No files changed between these commits.
                    </p>
                  )}
                  {!compareFilesLoading && compareFiles.length > 0 && (
                    <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                      {compareFiles.map((f) => (
                        <li key={f.path}>
                          <button
                            onClick={() => handleCompareFileSelect(f)}
                            className={cn(
                              "w-full text-left flex items-center gap-2 px-1 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors",
                              selectedFile?.path === f.path && "bg-blue-50 dark:bg-blue-900/30"
                            )}
                          >
                            <ChangeTypeBadge type={f.changeType} />
                            <span
                              className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate"
                              title={f.path}
                            >
                              {resolvePathDisplay(f.path, existingChannelIds, templateNames)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex-1 min-h-0">
                  {!selectedFile && !diffLoading && (
                    <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
                      Select a file to view diff
                    </div>
                  )}
                  {diffLoading && (
                    <div className="space-y-2 pt-2">
                      {Array.from({ length: 6 }).map((_, i) => (
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
                        oldLabel={getShortHash(compareFrom.hash)}
                        newLabel={getShortHash(compareTo.hash)}
                        copyContent={newContent}
                      />
                    )}
                </div>
              </>
            )}

            {/* Normal mode: single commit detail */}
            {!compareMode && selectedCommit && (
              <>
                {/* Commit metadata card */}
                <div className="border border-border rounded p-3 shrink-0 bg-white dark:bg-gray-900">
                  <CommitMetaGrid commit={selectedCommit} />

                  {/* Changed files */}
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                      Changed files
                    </p>
                    <ApiErrorAlert error={filesError} />
                    {filesLoading && (
                      <div className="space-y-1">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <Skeleton key={i} className="h-4 w-full" />
                        ))}
                      </div>
                    )}
                    {!filesLoading && commitFiles.length === 0 && !filesError && (
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        No files listed for this commit.
                      </p>
                    )}
                    {!filesLoading && commitFiles.length > 0 && (
                      <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                        {commitFiles.map((f) => (
                          <li key={f.path}>
                            <ContextMenu>
                              <ContextMenuTrigger asChild>
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
                                    {resolvePathDisplay(f.path, existingChannelIds, templateNames)}
                                  </span>
                                </button>
                              </ContextMenuTrigger>
                              <ContextMenuContent>
                                <ContextMenuItem
                                  onClick={() => {
                                    void navigator.clipboard.writeText(f.path);
                                    toast.success("File path copied");
                                  }}
                                >
                                  <Copy className="w-4 h-4 mr-2" />
                                  Copy File Path
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem onClick={() => handleSelectFile(f)}>
                                  <FileText className="w-4 h-4 mr-2" />
                                  View Diff
                                </ContextMenuItem>
                                {editorHrefForPath(f.path) && (
                                  <>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem
                                      onClick={() => router.push(editorHrefForPath(f.path)!)}
                                    >
                                      <ExternalLink className="w-4 h-4 mr-2" />
                                      Open in Editor
                                    </ContextMenuItem>
                                  </>
                                )}
                              </ContextMenuContent>
                            </ContextMenu>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {/* Open in Editor button */}
                {selectedFile && editorHrefForPath(selectedFile.path) && (
                  <div className="shrink-0">
                    <HoverTooltip content="Open this entity in its editor">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(editorHrefForPath(selectedFile.path)!)}
                      >
                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                        Open in Editor
                      </Button>
                    </HoverTooltip>
                  </div>
                )}

                {/* Diff view */}
                <div className="flex-1 min-h-0">
                  {!selectedFile && !diffLoading && (
                    <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
                      Select a file to view diff
                    </div>
                  )}
                  {diffLoading && (
                    <div className="space-y-2 pt-2">
                      {Array.from({ length: 6 }).map((_, i) => (
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
                        oldLabel={`before ${getShortHash(selectedCommit.hash)}`}
                        newLabel={getShortHash(selectedCommit.hash)}
                        copyContent={newContent}
                      />
                    )}
                </div>
              </>
            )}
          </div>
        </div>
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
          <dd className="text-xs text-gray-800 dark:text-gray-200 truncate">
            <HoverTooltip content={value}>
              <span>{value}</span>
            </HoverTooltip>
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
