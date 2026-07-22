"use client";

/**
 * Files Tab (formerly Channels Tab)
 *
 * Two-pane layout:
 *   Left  — file tree grouped by folder (channels, codetemplates, libraries, globalscripts)
 *   Right — inline commit history for selected file + diff view
 *
 * Clicking a file in the left pane loads its full commit history inline on the
 * right, and auto-selects the most recent commit to show the diff immediately.
 *
 * An "Open in Editor" button appears in the right-pane info card (and in the
 * file row context menu) when the entity still exists on the BridgeLink server.
 * Channels navigate to /channels/<id>/edit; code templates navigate to
 * /code-templates?templateId=<id>.
 *
 * Uses GET /plugins/version-history/repoInfo for the file tree,
 * GET /plugins/version-history/history for per-file commit history, and
 * GET /plugins/version-history/content for XML at a specific revision.
 */

import { Fragment, startTransition, useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { RefreshCw, ExternalLink, GitCompare } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { HoverTooltip } from "@/components/hover-tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { getChannelIdsAndNames, updateChannelFromXml } from "@/lib/api/api-channels";
import {
  CodeTemplateNotFoundError,
  getCodeTemplateLibraries,
  updateCodeTemplateFromXml,
} from "@/lib/api/api-code-templates";
import type { CodeTemplateLibrary } from "@/lib/types";
import { LibrarySelectDialog, type LibrarySelectTarget } from "./library-select-dialog";

import {
  getRepoInfo,
  getEntityHistory,
  getEntityContentAtRevision,
  getFileContent,
  getFileContentAtHead,
  restoreFiles,
  commitAndPushFiles,
  getLibrariesAndTemplates,
  getShortHash,
  friendlyRepoError,
  type RepoInfo,
  type RepoFile,
  type CommitMetaData,
  type VhMode,
} from "../api-version-history";
import { useColumnConfig } from "@/lib/hooks/use-column-config";
import { COMMIT_COLS, COMMIT_COLS_COMPARE } from "./commit-columns";
import { folderMode, fmtBytes, type DiffMode, type SelectedFile } from "./tab-helpers";
import { FileTreePanel } from "./file-tree-panel";
import { CommitHistoryTable } from "./commit-history-table";
import { DiffPanel } from "./diff-panel";

// ─── Managed folders ──────────────────────────────────────────────────────────

/**
 * Top-level repository folders managed by BridgeLink. The repoInfo endpoint
 * returns every top-level folder (only .git is skipped server-side), so the
 * file tree filters to these unless "Show all" is checked — mirroring the Java
 * client's FilesTabPanel behavior. Folder names are server-owned protocol values.
 */
const MANAGED_FOLDERS = new Set(["channels", "codetemplates", "libraries", "globalscripts"]);

export function isManagedFolder(name: string): boolean {
  return MANAGED_FOLDERS.has(name.toLowerCase());
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FilesTab() {
  const router = useRouter();
  const { viewDensity } = useCompactMode();
  const commitColConfig = useColumnConfig(COMMIT_COLS, "bl-vh-commits-cols-v1");
  const commitColConfigCompare = useColumnConfig(
    COMMIT_COLS_COMPARE,
    "bl-vh-commits-compare-cols-v1"
  );
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // Folder filter — show only managed BridgeLink folders by default (matches Java
  // FilesTabPanel; not persisted across opens).
  const [showAll, setShowAll] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Server-side existence sets — used to gate the "Open in Editor" button.
  // null = not yet loaded; populated in parallel with repoInfo on mount.
  const [existingChannelIds, setExistingChannelIds] = useState<Map<string, string> | null>(null);
  const [existingTemplateIds, setExistingTemplateIds] = useState<Set<string> | null>(null);
  const [templateNames, setTemplateNames] = useState<Map<string, string> | null>(null);

  // Selected file (left pane selection)
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);

  // Commit history for selected file
  const [history, setHistory] = useState<CommitMetaData[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Selected history commit + diff
  const [selectedHistoryCommit, setSelectedHistoryCommit] = useState<CommitMetaData | null>(null);
  const [oldContent, setOldContent] = useState<string | null>(null);
  const [newContent, setNewContent] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Diff mode: compare against parent commit, working tree, or HEAD
  const [diffMode, setDiffMode] = useState<DiffMode>("parent");

  // Compare mode: diff between two arbitrary commits
  const [compareMode, setCompareMode] = useState(false);
  const [compareFrom, setCompareFrom] = useState<CommitMetaData | null>(null);
  const [compareTo, setCompareTo] = useState<CommitMetaData | null>(null);

  // Restore to revision
  const [restoreTarget, setRestoreTarget] = useState<CommitMetaData | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [postRestore, setPostRestore] = useState<{
    hash: string;
    path: string;
    entityName: string;
    isChannel: boolean;
  } | null>(null);
  const [postRestoreAction, setPostRestoreAction] = useState(false);

  // Full library objects (for library-selection dialog on orphaned template restore)
  const [existingLibraries, setExistingLibraries] = useState<CodeTemplateLibrary[]>([]);

  // Library selection dialog — shown when restoring a template that no longer exists on server
  const [librarySelectTarget, setLibrarySelectTarget] = useState<LibrarySelectTarget | null>(null);

  // Working-tree content cache for "already at this revision" check
  const [workingTreeContent, setWorkingTreeContent] = useState<string | null>(null);
  // Map of commitHash → true (matches working tree) | false (differs)
  const [restoreMatchMap, setRestoreMatchMap] = useState<Map<string, boolean>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch repo file tree and server-side entity existence in parallel
      const [info, chanMap, libs, repoTemplates] = await Promise.all([
        getRepoInfo(),
        getChannelIdsAndNames(),
        getCodeTemplateLibraries(),
        getLibrariesAndTemplates(),
      ]);
      setRepoInfo(info);
      setExistingChannelIds(chanMap);
      setExistingLibraries(libs);
      setExistingTemplateIds(new Set(libs.flatMap((l) => l.codeTemplateIds)));
      setTemplateNames(new Map(repoTemplates.templates.map((t) => [t.id, t.name])));
    } catch (e) {
      setError(friendlyRepoError(e, "Failed to load repository files"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startTransition(() => {
      void load();
    });
  }, [load]);

  function toggleFolder(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // Shared diff loading — accepts all needed values explicitly to avoid stale closures
  function loadDiff(
    commit: CommitMetaData,
    allHistory: CommitMetaData[],
    fileId: string,
    mode: VhMode,
    folderName: string,
    activeDiffMode: DiffMode = "parent"
  ) {
    setSelectedHistoryCommit(commit);
    setOldContent(null);
    setNewContent(null);
    setDiffError(null);
    setDiffLoading(true);

    const repoPath = `${folderName.toLowerCase()}/${fileId}`;
    const fetchNew = getEntityContentAtRevision(fileId, commit.hash, mode);

    let fetchOld: Promise<string>;
    if (activeDiffMode === "working-tree") {
      fetchOld = getFileContent(repoPath).catch(() => "");
    } else if (activeDiffMode === "head") {
      fetchOld = getFileContentAtHead(repoPath).catch(() => "");
    } else {
      const idx = allHistory.findIndex((c) => c.hash === commit.hash);
      const parentCommit = idx >= 0 && idx + 1 < allHistory.length ? allHistory[idx + 1] : null;
      fetchOld = parentCommit
        ? getEntityContentAtRevision(fileId, parentCommit.hash, mode)
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

  function handleSelectFile(file: RepoFile, folderName: string) {
    const mode = folderMode(folderName);
    setSelectedFile({ file, folderName, mode });
    setHistory([]);
    setHistoryError(null);
    setSelectedHistoryCommit(null);
    setOldContent(null);
    setNewContent(null);
    setDiffMode("parent");
    setCompareMode(false);
    setCompareFrom(null);
    setCompareTo(null);
    setHistoryLoading(true);
    // Reset restore match cache for the new file
    setWorkingTreeContent(null);
    setRestoreMatchMap(new Map());
    const repoPath = `${folderName.toLowerCase()}/${file.name}`;
    getFileContent(repoPath)
      .then(setWorkingTreeContent)
      .catch(() => setWorkingTreeContent(null));

    getEntityHistory(file.name, mode)
      .then((commits) => {
        setHistory(commits);
        // Auto-select the most recent commit and load its diff immediately
        if (commits.length > 0) {
          loadDiff(commits[0], commits, file.name, mode, folderName, "parent");
        }
      })
      .catch((e) => setHistoryError(e instanceof Error ? e.message : "Failed to load file history"))
      .finally(() => setHistoryLoading(false));
  }

  async function checkRestoreMatch(commit: CommitMetaData) {
    if (!selectedFile || restoreMatchMap.has(commit.hash) || workingTreeContent === null) return;
    try {
      const commitContent = await getEntityContentAtRevision(
        selectedFile.file.name,
        commit.hash,
        selectedFile.mode
      );
      setRestoreMatchMap((prev) =>
        new Map(prev).set(commit.hash, commitContent === workingTreeContent)
      );
    } catch {
      // leave unknown — don't disable the item if we can't check
    }
  }

  function handleSelectHistoryCommit(commit: CommitMetaData) {
    if (!selectedFile) return;
    const isTopCommit = history.length > 0 && history[0].hash === commit.hash;
    const effectiveMode = isTopCommit && diffMode === "head" ? "parent" : diffMode;
    if (effectiveMode !== diffMode) setDiffMode(effectiveMode);
    loadDiff(
      commit,
      history,
      selectedFile.file.name,
      selectedFile.mode,
      selectedFile.folderName,
      effectiveMode
    );
  }

  function handleDiffModeChange(mode: DiffMode) {
    setDiffMode(mode);
    if (!selectedFile || !selectedHistoryCommit) return;
    loadDiff(
      selectedHistoryCommit,
      history,
      selectedFile.file.name,
      selectedFile.mode,
      selectedFile.folderName,
      mode
    );
  }

  function toggleCompareMode() {
    const next = !compareMode;
    setCompareMode(next);
    if (!next) {
      // Exiting compare mode — reload current commit in normal mode
      setCompareFrom(null);
      setCompareTo(null);
      if (selectedFile && selectedHistoryCommit) {
        loadDiff(
          selectedHistoryCommit,
          history,
          selectedFile.file.name,
          selectedFile.mode,
          selectedFile.folderName,
          diffMode
        );
      }
    } else {
      // Entering compare mode — pre-select first two commits if available
      setOldContent(null);
      setNewContent(null);
      if (history.length >= 2) {
        setCompareFrom(history[1]);
        setCompareTo(history[0]);
        if (selectedFile) {
          loadCompareDiff(history[1], history[0], selectedFile.file.name, selectedFile.mode);
        }
      }
    }
  }

  function loadCompareDiff(from: CommitMetaData, to: CommitMetaData, fileId: string, mode: VhMode) {
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
      getEntityContentAtRevision(fileId, from.hash, mode).catch(() => ""),
      getEntityContentAtRevision(fileId, to.hash, mode).catch(() => ""),
    ])
      .then(([old, next]) => {
        setOldContent(old);
        setNewContent(next);
      })
      .catch((e) => setDiffError(e instanceof Error ? e.message : "Failed to load diff"))
      .finally(() => setDiffLoading(false));
  }

  function handleCompareSelect(commit: CommitMetaData) {
    if (!selectedFile) return;
    // GitHub-style: clicking selects as "To", previous "To" shifts to "From"
    const newFrom = compareTo ?? compareFrom;
    const newTo = commit;
    setCompareFrom(newFrom);
    setCompareTo(newTo);
    if (newFrom) {
      loadCompareDiff(newFrom, newTo, selectedFile.file.name, selectedFile.mode);
    }
  }

  async function handleRestore(commit: CommitMetaData) {
    if (!selectedFile) return;
    setRestoring(true);
    try {
      const folder = selectedFile.folderName.toLowerCase();
      const repoPath = `${folder}/${selectedFile.file.name}`;
      const isChannel = folder === "channels";
      const isTemplate = folder === "codetemplates";
      const entityName = resolveFileName(selectedFile.file.name, selectedFile.folderName);
      const content = await getEntityContentAtRevision(
        selectedFile.file.name,
        commit.hash,
        selectedFile.mode
      );
      await restoreFiles({ [repoPath]: content });
      if (isChannel) {
        await updateChannelFromXml(selectedFile.file.name, content);
      } else if (isTemplate) {
        try {
          await updateCodeTemplateFromXml(selectedFile.file.name, content);
        } catch (e) {
          if (e instanceof CodeTemplateNotFoundError) {
            // Template was deleted from the server — ask the user which library to restore it into
            setRestoreTarget(null);
            setLibrarySelectTarget({
              templateId: selectedFile.file.name,
              xml: content,
              repoPath,
              commitHash: commit.hash,
              entityName,
            });
            setWorkingTreeContent(content);
            setRestoreMatchMap(new Map());
            return;
          }
          throw e;
        }
      }
      toast.success(`Restored ${entityName} to revision ${getShortHash(commit.hash)}`);
      setRestoreTarget(null);
      setPostRestore({ hash: commit.hash, path: repoPath, entityName, isChannel });
      // Update working-tree cache so restore checks reflect the new state
      setWorkingTreeContent(content);
      setRestoreMatchMap(new Map());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to restore file");
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
        [postRestore.path],
        `Restore ${postRestore.entityName} to ${getShortHash(postRestore.hash)}`,
        1 // userId — admin
      );
      toast.success("Committed and pushed successfully");
      setPostRestore(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to commit");
    } finally {
      setPostRestoreAction(false);
    }
  }

  /**
   * Returns the editor href for a file if the entity still exists on the server,
   * or null if it has been deleted or is not a navigable entity type.
   */
  function editorHrefForFile(file: RepoFile, folderName: string): string | null {
    const id = file.name;
    const lower = folderName.toLowerCase();
    if (lower === "channels" && existingChannelIds?.has(id)) {
      return `/channels/${id}/edit`;
    }
    if (lower === "codetemplates" && existingTemplateIds?.has(id)) {
      return `/code-templates?templateId=${id}`;
    }
    return null;
  }

  const rowPy =
    viewDensity === "comfortable" ? "py-2" : viewDensity === "compact" ? "py-0.5" : "py-1";

  const filterLower = filter.trim().toLowerCase();

  function resolveFileName(fileName: string, folderName: string): string {
    const lower = folderName.toLowerCase();
    if (lower === "channels") return existingChannelIds?.get(fileName) ?? fileName;
    if (lower === "codetemplates") return templateNames?.get(fileName) ?? fileName;
    return fileName;
  }

  const folders = (repoInfo?.folders ?? [])
    .filter((f) => showAll || isManagedFolder(f.name))
    .filter((f) =>
      filterLower
        ? f.files.some((file) => {
            const display = resolveFileName(file.name, f.name).toLowerCase();
            return display.includes(filterLower) || file.name.toLowerCase().includes(filterLower);
          })
        : true
    );

  // Count only the folders currently in view (after the managed-folder filter) so the
  // badge reflects what's displayed, not the entire repository.
  const totalFiles = (repoInfo?.folders ?? [])
    .filter((f) => showAll || isManagedFolder(f.name))
    .reduce((s, f) => s + f.fileCount, 0);

  // Derive editor href for the currently selected file (for the info card button)
  const selectedEditorHref = selectedFile
    ? editorHrefForFile(selectedFile.file, selectedFile.folderName)
    : null;

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <HoverTooltip content="Reload tracked files">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </HoverTooltip>
        <Input
          density={viewDensity}
          className="w-56 text-sm"
          placeholder="Filter by file name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <HoverTooltip content="Show all files in the repository, including non-BridgeLink folders">
          <FormCheckbox
            density={viewDensity}
            label="Show all"
            checked={showAll}
            onChange={setShowAll}
          />
        </HoverTooltip>
        <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
          {totalFiles} file{totalFiles !== 1 ? "s" : ""}
        </span>
      </div>

      <ApiErrorAlert error={error} className="mb-2" />

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      )}

      {!loading && (
        <div className="flex flex-1 min-h-0 gap-2">
          {/* ── Left: file tree ── */}
          <FileTreePanel
            folders={folders}
            filterLower={filterLower}
            collapsed={collapsed}
            selectedFile={selectedFile}
            rowPy={rowPy}
            onToggleFolder={toggleFolder}
            onSelectFile={handleSelectFile}
            resolveFileName={resolveFileName}
            editorHrefForFile={editorHrefForFile}
          />

          {/* ── Right: detail panel ── */}
          <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
            {!selectedFile && (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
                Select a file to view its history
              </div>
            )}

            {selectedFile && (
              <>
                {/* File info + history card */}
                <div className="border border-border rounded p-3 shrink-0 bg-white dark:bg-gray-900">
                  {/* File metadata */}
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 mb-3">
                    <Fragment key="file">
                      <dt className="text-xs text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap">
                        File:
                      </dt>
                      <dd className="text-xs text-gray-800 dark:text-gray-200 truncate">
                        <HoverTooltip content={selectedFile.file.name}>
                          <span>
                            {resolveFileName(selectedFile.file.name, selectedFile.folderName)}
                          </span>
                        </HoverTooltip>
                      </dd>
                    </Fragment>
                    <Fragment key="folder">
                      <dt className="text-xs text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap">
                        Folder:
                      </dt>
                      <dd className="text-xs text-gray-800 dark:text-gray-200 capitalize">
                        {selectedFile.folderName}
                      </dd>
                    </Fragment>
                    <Fragment key="size">
                      <dt className="text-xs text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap">
                        Size:
                      </dt>
                      <dd className="text-xs text-gray-800 dark:text-gray-200 tabular-nums">
                        {fmtBytes(selectedFile.file.sizeBytes)}
                      </dd>
                    </Fragment>
                  </dl>

                  {/* Open in Editor button — only shown when entity exists on server */}
                  {selectedEditorHref && (
                    <div className="mb-3 pt-3 border-t border-border">
                      <HoverTooltip content="Open this entity in its editor">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(selectedEditorHref)}
                        >
                          <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                          Open in Editor
                        </Button>
                      </HoverTooltip>
                    </div>
                  )}

                  {/* Commit history table */}
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                      Commit history
                    </p>
                    {history.length >= 2 && (
                      <HoverTooltip
                        content={compareMode ? "Exit compare mode" : "Compare two revisions"}
                      >
                        <Button
                          variant={compareMode ? "default" : "outline"}
                          size="sm"
                          className="h-5 px-1.5 text-[10px]"
                          onClick={toggleCompareMode}
                        >
                          <GitCompare className="w-3 h-3 mr-1" />
                          Compare
                        </Button>
                      </HoverTooltip>
                    )}
                  </div>
                  <ApiErrorAlert error={historyError} />
                  {historyLoading && (
                    <div className="space-y-1">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-4 w-full" />
                      ))}
                    </div>
                  )}
                  {!historyLoading && history.length === 0 && !historyError && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      No commits found for this file.
                    </p>
                  )}
                  {!historyLoading && history.length > 0 && (
                    <CommitHistoryTable
                      history={history}
                      compareMode={compareMode}
                      compareFrom={compareFrom}
                      compareTo={compareTo}
                      selectedHistoryCommit={selectedHistoryCommit}
                      restoreMatchMap={restoreMatchMap}
                      commitColConfig={commitColConfig}
                      commitColConfigCompare={commitColConfigCompare}
                      onSelectHistoryCommit={handleSelectHistoryCommit}
                      onCompareSelect={handleCompareSelect}
                      onSetCompareFrom={setCompareFrom}
                      onSetCompareTo={setCompareTo}
                      onLoadCompareDiff={(from, to) =>
                        loadCompareDiff(from, to, selectedFile.file.name, selectedFile.mode)
                      }
                      onCheckRestoreMatch={checkRestoreMatch}
                      onRequestRestore={setRestoreTarget}
                    />
                  )}
                </div>

                {/* Diff panel */}
                <DiffPanel
                  compareMode={compareMode}
                  compareFrom={compareFrom}
                  compareTo={compareTo}
                  selectedHistoryCommit={selectedHistoryCommit}
                  history={history}
                  diffMode={diffMode}
                  diffLoading={diffLoading}
                  diffError={diffError}
                  oldContent={oldContent}
                  newContent={newContent}
                  onDiffModeChange={handleDiffModeChange}
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* Restore confirmation dialog */}
      {restoreTarget && selectedFile && (
        <ConfirmDialog
          title="Restore to this revision"
          description={
            <>
              Restore{" "}
              <strong>{resolveFileName(selectedFile.file.name, selectedFile.folderName)}</strong> to
              revision{" "}
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
          confirmLabel={restoring ? "Restoring…" : "Restore"}
          confirmVariant="default"
          onConfirm={() => void handleRestore(restoreTarget)}
          onCancel={() => {
            if (!restoring) setRestoreTarget(null);
          }}
        />
      )}

      {/* Library selection dialog — shown when restoring a template that no longer exists on server */}
      {librarySelectTarget && (
        <LibrarySelectDialog
          target={librarySelectTarget}
          libraries={existingLibraries}
          onSuccess={({ hash, path, entityName, refreshedLibraries }) => {
            setExistingLibraries(refreshedLibraries);
            setExistingTemplateIds(new Set(refreshedLibraries.flatMap((l) => l.codeTemplateIds)));
            setLibrarySelectTarget(null);
            setPostRestore({ hash, path, entityName, isChannel: false });
          }}
          onClose={() => setLibrarySelectTarget(null)}
        />
      )}

      {/* Post-restore commit dialog */}
      {postRestore && (
        <ConfirmDialog
          title="Restore complete"
          description={
            <>
              <strong>{postRestore.entityName}</strong> has been restored to revision{" "}
              <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">
                {getShortHash(postRestore.hash)}
              </code>
              {postRestore.isChannel ? (
                <> and is now live on the server.</>
              ) : (
                <> and has been updated on the server.</>
              )}
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-2">
                Would you like to commit and push this restore to git history?
              </p>
            </>
          }
          confirmLabel={postRestoreAction ? "Committing…" : "Commit & Push"}
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
