"use client";

/**
 * Template History Dialog
 *
 * Full-featured version history dialog for a single code template.
 * Two-pane layout: commit list on the left, diff view on the right.
 * Supports single-commit diff (vs current or parent), compare mode
 * (two commits), and revert to a previous revision.
 *
 * Mirrors Java's CodeTemplateHistoryDialogWithTaskPane.
 */

import { Fragment, startTransition, useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import {
  RefreshCw,
  GitCompare,
  GitBranch,
  Copy,
  Undo2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

import { getSession } from "@/lib/auth";
import { clearRepoChangesCache } from "@/lib/hooks/repo-changes-cache";
import { updateCodeTemplateFromXml, exportTemplateToXml } from "@/lib/api/api-code-templates";
import type { CodeTemplate } from "@/lib/types";
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
  restoreFiles,
  commitAndPushCodeTemplate,
  getShortHash,
  getMessageContent,
  getEntityType,
  getEntityName,
  getServerName,
  MODE_CODE_TEMPLATE,
  type CommitMetaData,
} from "../api-version-history";
import { DiffView } from "./diff-view";
import { CommitController } from "./commit-controller";
import { CommitLimitSelect, DEFAULT_COMMIT_LIMIT } from "./commit-limit-select";
import { useCommitDateMode, formatCommitTime, absoluteCommitTime } from "./use-commit-date-mode";
import { usePluginCapabilities } from "../use-plugin-capabilities";

type DiffMode = "current" | "parent";

interface TemplateHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  templateName: string;
  currentTemplate?: CodeTemplate;
  onReverted?: () => void;
}

export function TemplateHistoryDialog({
  open,
  onOpenChange,
  templateId,
  templateName,
  currentTemplate,
  onReverted,
}: TemplateHistoryDialogProps) {
  const { dateMode } = useCommitDateMode();
  const { hasHistoryLimitParam } = usePluginCapabilities();
  // Max commits to load. Always enforced client-side; only sent to the server
  // when it supports the `limit` param. Local state only — not persisted.
  const [limit, setLimit] = useState(DEFAULT_COMMIT_LIMIT);
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

  // Restore
  const [restoreTarget, setRestoreTarget] = useState<CommitMetaData | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [postRestore, setPostRestore] = useState<{ hash: string } | null>(null);
  const [postRestoreAction, setPostRestoreAction] = useState(false);

  // Commit & Push the current template (mirrors Java's commitThenPush)
  const [commitOpen, setCommitOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedCommit(null);
    setOldContent(null);
    setNewContent(null);
    try {
      const data = await getEntityHistory(templateId, MODE_CODE_TEMPLATE, {
        limit,
        sendLimitToServer: hasHistoryLimitParam,
      });
      setCommits(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [templateId, limit, hasHistoryLimitParam]);

  useEffect(() => {
    if (open) startTransition(() => void load());
  }, [open, load]);

  function loadDiff(commit: CommitMetaData, mode: DiffMode = diffMode) {
    setOldContent(null);
    setNewContent(null);
    setDiffError(null);
    setDiffLoading(true);

    const fetchCommit = getEntityContentAtRevision(templateId, commit.hash, MODE_CODE_TEMPLATE);

    let fetchOther: Promise<string>;
    if (mode === "current") {
      // Use the in-memory template (already loaded on the page) as the current server version.
      // This is the most accurate "current" since it reflects the latest state on the server
      // without requiring an extra API call.
      fetchOther = Promise.resolve(currentTemplate ? exportTemplateToXml(currentTemplate) : "");
    } else {
      // Compare parent commit vs selected commit
      const idx = commits.findIndex((c) => c.hash === commit.hash);
      const parentCommit = idx >= 0 && idx + 1 < commits.length ? commits[idx + 1] : null;
      fetchOther = parentCommit
        ? getEntityContentAtRevision(templateId, parentCommit.hash, MODE_CODE_TEMPLATE)
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
    if (selectedCommit) {
      loadDiff(selectedCommit, mode);
    }
  }

  function toggleCompareMode() {
    const next = !compareMode;
    setCompareMode(next);
    if (!next) {
      setCompareFrom(null);
      setCompareTo(null);
      if (selectedCommit) {
        loadDiff(selectedCommit);
      }
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
      getEntityContentAtRevision(templateId, from.hash, MODE_CODE_TEMPLATE).catch(() => ""),
      getEntityContentAtRevision(templateId, to.hash, MODE_CODE_TEMPLATE).catch(() => ""),
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
    if (newFrom) {
      loadCompareDiff(newFrom, newTo);
    }
  }

  async function handleRestore(commit: CommitMetaData) {
    setRestoring(true);
    try {
      const repoPath = `codetemplates/${templateId}`;
      const content = await getEntityContentAtRevision(templateId, commit.hash, MODE_CODE_TEMPLATE);
      await restoreFiles({ [repoPath]: content });
      await updateCodeTemplateFromXml(templateId, content);
      toast.success(`Restored ${templateName} to revision ${getShortHash(commit.hash)}`);
      setRestoreTarget(null);
      setPostRestore({ hash: commit.hash });
      onReverted?.();
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
      await commitAndPushCodeTemplate(
        templateId,
        `Restore ${templateName} to ${getShortHash(postRestore.hash)}`,
        getSession()?.userId ?? 1
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[1600px] h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 pt-4 pb-3 border-b border-border shrink-0">
            <DialogTitle className="text-base">
              Code Template History &mdash; {templateName}
            </DialogTitle>
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
            <HoverTooltip content="Commit the current code template and push to the repository">
              <Button variant="outline" size="sm" onClick={() => setCommitOpen(true)}>
                <GitBranch className="w-3.5 h-3.5 mr-1.5" />
                Commit &amp; Push
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
                                compareMode
                                  ? handleCompareSelect(commit)
                                  : handleSelectCommit(commit)
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
                  {/* Empty states */}
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

                  {compareMode &&
                    compareFrom &&
                    compareTo &&
                    compareFrom.hash === compareTo.hash && (
                      <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
                        Same revision selected &mdash; no changes to display
                      </div>
                    )}

                  {/* Compare mode diff */}
                  {compareMode &&
                    compareFrom &&
                    compareTo &&
                    compareFrom.hash !== compareTo.hash && (
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

                  {/* Normal mode: single commit detail */}
                  {!compareMode && selectedCommit && (
                    <>
                      {/* Commit metadata */}
                      <div className="border border-border rounded p-3 shrink-0 bg-white dark:bg-gray-900">
                        <CommitMetaGrid commit={selectedCommit} />
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
                          text="Current = the version currently on the server (including any unsaved editor changes). Parent = the commit before the selected one."
                          side="bottom"
                          iconSize="w-3 h-3"
                        />
                      </div>

                      {/* Diff */}
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

      {/* Commit & Push the current template (gated by auto-commit settings) */}
      <CommitController
        open={commitOpen}
        onOpenChange={setCommitOpen}
        title={`Commit & Push — ${templateName}`}
        description="Commit the current code template and push it to the remote repository."
        successMessage="Committed and pushed successfully."
        commit={async (message) => {
          await commitAndPushCodeTemplate(templateId, message, getSession()?.userId ?? 1);
          clearRepoChangesCache();
        }}
        onCommitted={() => void load()}
      />

      {/* Restore confirmation */}
      {restoreTarget && (
        <ConfirmDialog
          title="Restore to this revision"
          description={
            <>
              Restore <strong>{templateName}</strong> to revision{" "}
              <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">
                {getShortHash(restoreTarget.hash)}
              </code>{" "}
              from {format(new Date(restoreTarget.timestamp), "MMM d, yyyy HH:mm")}?
              <br />
              <span className="text-gray-500 text-xs mt-1 block">
                This will update the code template on the server and in the repository working tree.
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

      {/* Post-restore commit offer */}
      {postRestore && (
        <ConfirmDialog
          title="Restore complete"
          description={
            <>
              <strong>{templateName}</strong> has been restored to revision{" "}
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
    </>
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
