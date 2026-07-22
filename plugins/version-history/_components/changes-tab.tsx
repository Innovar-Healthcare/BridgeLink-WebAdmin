"use client";

/**
 * Local Changes Tab
 *
 * Two-panel layout:
 *   Left  — file tree with checkboxes (Changed + Unversioned Files sections)
 *   Right — side-by-side diff for the selected file (HEAD vs CURRENT)
 *
 * Supports:
 *   - Selecting individual files or Select All / Deselect All
 *   - Commit & Push selected files with a commit message dialog
 *   - Right-click context menu per file (Copy Path, View Diff, Discard Changes, Open in Editor)
 *   - Discard Changes (modified/deleted) with confirmation
 */

import { startTransition, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, GitCommit, ExternalLink, Copy, FileText, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { HoverTooltip } from "@/components/hover-tooltip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "@/components/form-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { getSession } from "@/lib/auth";
import { getChannelIdsAndNames } from "@/lib/api/api-channels";
import { clearRepoChangesCache } from "@/lib/hooks/use-repo-changes";

import {
  getRepoChanges,
  getFileContent,
  getFileContentAtHead,
  commitAndPushFiles,
  restoreFiles,
  resolvePathDisplay,
  getLibrariesAndTemplates,
  friendlyRepoError,
  type RepoChanges,
} from "../api-version-history";
import { DiffView } from "./diff-view";

// ─── Types ────────────────────────────────────────────────────────────────────

type ChangeType = "modified" | "deleted" | "untracked";

interface FileEntry {
  path: string;
  type: ChangeType;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildFileList(changes: RepoChanges): FileEntry[] {
  return [
    ...changes.modifiedFiles.map((p) => ({ path: p, type: "modified" as const })),
    ...changes.deletedFiles.map((p) => ({ path: p, type: "deleted" as const })),
    ...changes.untrackedFiles.map((p) => ({ path: p, type: "untracked" as const })),
  ];
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function FileTypeBadge({ type }: { type: ChangeType }) {
  const label = type === "modified" ? "M" : type === "deleted" ? "D" : "U";
  const cls =
    type === "modified"
      ? "text-yellow-600 dark:text-yellow-400"
      : type === "deleted"
        ? "text-red-600 dark:text-red-400"
        : "text-gray-500 dark:text-gray-400";
  const tooltip =
    type === "modified" ? "Modified" : type === "deleted" ? "Deleted" : "Untracked (new file)";
  return (
    <HoverTooltip content={tooltip}>
      <span className={cn("text-[10px] font-bold w-4 shrink-0 text-center select-none", cls)}>
        [{label}]
      </span>
    </HoverTooltip>
  );
}

// ─── Diff panel ───────────────────────────────────────────────────────────────

interface DiffPanelProps {
  file: FileEntry | null;
  channelNames: Map<string, string> | null;
  templateNames: Map<string, string> | null;
  onRefresh: () => void;
}

function DiffPanel({ file, channelNames, templateNames, onRefresh }: DiffPanelProps) {
  const [oldContent, setOldContent] = useState<string | null>(null);
  const [newContent, setNewContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);

  const loadDiff = useCallback(async (entry: FileEntry) => {
    setLoading(true);
    setError(null);
    setOldContent(null);
    setNewContent(null);
    try {
      const fetchHead =
        entry.type !== "untracked" ? getFileContentAtHead(entry.path) : Promise.resolve("");
      const fetchCurrent =
        entry.type !== "deleted" ? getFileContent(entry.path) : Promise.resolve("");
      const [head, current] = await Promise.all([fetchHead, fetchCurrent]);
      setOldContent(head);
      setNewContent(current);
      setLoadedPath(entry.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load diff");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startTransition(() => {
      if (file) {
        void loadDiff(file);
      } else {
        setOldContent(null);
        setNewContent(null);
        setLoadedPath(null);
        setError(null);
      }
    });
  }, [file, loadDiff]);

  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
        Select a file to view changes
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-1">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-2 py-1 bg-gray-50 dark:bg-gray-800 border border-border rounded text-xs shrink-0">
        <FileTypeBadge type={file.type} />
        <span
          className="font-mono text-gray-700 dark:text-gray-300 truncate flex-1"
          title={file.path}
        >
          {resolvePathDisplay(file.path, channelNames, templateNames)}
        </span>
        <HoverTooltip content="Reload diff">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 ml-auto shrink-0"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          </Button>
        </HoverTooltip>
      </div>

      {loading && (
        <div className="flex-1 space-y-2 pt-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      )}

      {error && <ApiErrorAlert error={error} />}

      {!loading && !error && oldContent !== null && newContent !== null && (
        <div className="flex-1 min-h-0">
          <DiffView
            oldContent={oldContent}
            newContent={newContent}
            oldLabel={
              loadedPath
                ? `HEAD  ${resolvePathDisplay(loadedPath, channelNames, templateNames)}`
                : "HEAD"
            }
            newLabel={
              loadedPath
                ? `CURRENT  ${resolvePathDisplay(loadedPath, channelNames, templateNames)}`
                : "CURRENT"
            }
            copyContent={newContent || undefined}
          />
        </div>
      )}
    </div>
  );
}

// ─── Commit dialog ────────────────────────────────────────────────────────────

interface CommitDialogProps {
  open: boolean;
  fileCount: number;
  saving: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (message: string) => void;
}

function CommitDialog({
  open,
  fileCount,
  saving,
  error,
  onOpenChange,
  onSubmit,
}: CommitDialogProps) {
  // message state resets naturally: CommitDialog is remounted via key prop in
  // parent each time the dialog opens, so useState("") always starts fresh.
  const [message, setMessage] = useState("");

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Commit Message"
      description={`Enter a commit message for ${fileCount} selected file${fileCount !== 1 ? "s" : ""}. Changes will be committed and pushed to the remote repository.`}
      onSubmit={() => onSubmit(message)}
      submitLabel="Commit & Push"
      saving={saving}
      submitDisabled={!message.trim()}
      error={error}
      maxWidth="sm:max-w-lg"
    >
      <div className="flex flex-col gap-2 py-1">
        <Label htmlFor="commit-msg" className="text-sm font-medium">
          Commit message
        </Label>
        <Textarea
          id="commit-msg"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder="Describe the changes being committed…"
          className="resize-none text-sm font-mono"
          disabled={saving}
          autoFocus
        />
      </div>
    </FormDialog>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ChangesTabProps {
  onCountChange?: (count: number) => void;
}

export function ChangesTab({ onCountChange }: ChangesTabProps) {
  const { viewDensity } = useCompactMode();
  const router = useRouter();

  // Data
  const [changes, setChanges] = useState<RepoChanges | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Selected file for diff
  const [activeFile, setActiveFile] = useState<FileEntry | null>(null);
  const [diffKey, setDiffKey] = useState(0);

  // Channel ID map for "Open in Editor" and name resolution
  const [channelIds, setChannelIds] = useState<Map<string, string> | null>(null);
  const [templateNames, setTemplateNames] = useState<Map<string, string> | null>(null);

  // Commit dialog — commitOpenKey increments each time the dialog opens so
  // CommitDialog remounts fresh (resetting its message state) without a useEffect.
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitOpenKey, setCommitOpenKey] = useState(0);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  // Discard confirm
  const [discardTarget, setDiscardTarget] = useState<FileEntry | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const rowPy =
    viewDensity === "comfortable" ? "py-2" : viewDensity === "compact" ? "py-0.5" : "py-1";

  const load = useCallback(
    async (clearSelection = false) => {
      setLoading(true);
      setError(null);
      try {
        const [data, chanMap, repoTemplates] = await Promise.all([
          getRepoChanges(),
          channelIds === null ? getChannelIdsAndNames() : Promise.resolve(channelIds),
          templateNames === null ? getLibrariesAndTemplates() : Promise.resolve(null),
        ]);
        setChanges(data);
        if (chanMap !== channelIds) setChannelIds(chanMap);
        if (repoTemplates) {
          setTemplateNames(new Map(repoTemplates.templates.map((t) => [t.id, t.name])));
        }
        const count =
          data.modifiedFiles.length + data.deletedFiles.length + data.untrackedFiles.length;
        onCountChange?.(count);
        if (clearSelection) {
          setSelected(new Set());
          setActiveFile(null);
        } else {
          // Remove any selected paths that no longer exist
          const allPaths = new Set([
            ...data.modifiedFiles,
            ...data.deletedFiles,
            ...data.untrackedFiles,
          ]);
          setSelected((prev) => {
            const next = new Set([...prev].filter((p) => allPaths.has(p)));
            return next;
          });
          setActiveFile((prev) => (prev && allPaths.has(prev.path) ? prev : null));
        }
      } catch (e) {
        setError(friendlyRepoError(e, "Failed to load changes"));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onCountChange]
  );

  useEffect(() => {
    startTransition(() => {
      void load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allFiles = changes ? buildFileList(changes) : [];
  const changedFiles = allFiles.filter((f) => f.type !== "untracked");
  const untrackedFiles = allFiles.filter((f) => f.type === "untracked");

  const selectedCount = selected.size;
  const totalCount = allFiles.length;

  function toggleFile(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(allFiles.map((f) => f.path)));
  }

  function deselectAll() {
    setSelected(new Set());
  }

  function handleFileClick(file: FileEntry) {
    setActiveFile(file);
    setDiffKey((k) => k + 1);
  }

  function editorHrefForPath(path: string): string | null {
    const slashIdx = path.indexOf("/");
    if (slashIdx === -1) return null;
    const folder = path.slice(0, slashIdx);
    const id = path.slice(slashIdx + 1);
    if (!id) return null;
    if (folder === "channels" && channelIds?.has(id)) return `/channels/${id}/edit`;
    if (folder === "codetemplates") return `/code-templates?templateId=${id}`;
    return null;
  }

  // ── Commit ──────────────────────────────────────────────────────────────────

  async function handleCommit(message: string) {
    if (!message.trim() || selected.size === 0) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const userId = getSession()?.userId ?? 1;
      await commitAndPushFiles([...selected], message.trim(), userId);
      clearRepoChangesCache();
      toast.success(`Committed ${selected.size} file${selected.size !== 1 ? "s" : ""}`);
      setCommitOpen(false);
      void load(true);
    } catch (e) {
      setCommitError(
        e instanceof Error ? e.message : "Commit failed. Check that the remote is reachable."
      );
    } finally {
      setCommitting(false);
    }
  }

  // ── Discard ─────────────────────────────────────────────────────────────────

  async function handleDiscard(file: FileEntry) {
    setDiscarding(true);
    try {
      const headContent = await getFileContentAtHead(file.path);
      await restoreFiles({ [file.path]: headContent });
      clearRepoChangesCache();
      toast.success(`Discarded changes to ${file.path}`);
      setDiscardTarget(null);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to discard changes");
    } finally {
      setDiscarding(false);
    }
  }

  // ── File row ─────────────────────────────────────────────────────────────────

  function FileRow({ file }: { file: FileEntry }) {
    const isActive = activeFile?.path === file.path;
    const isChecked = selected.has(file.path);
    const editorHref = editorHrefForPath(file.path);
    const canDiscard = file.type !== "untracked";

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="row"
            onClick={() => handleFileClick(file)}
            className={cn(
              "flex items-center gap-2 px-2 cursor-pointer select-none transition-colors",
              rowPy,
              isActive
                ? "bg-blue-100 dark:bg-blue-900/40"
                : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
            )}
          >
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => toggleFile(file.path)}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="shrink-0 h-3.5 w-3.5 cursor-pointer accent-blue-600"
              aria-label={`Select ${file.path}`}
            />
            <FileTypeBadge type={file.type} />
            <span
              className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate flex-1 min-w-0"
              title={file.path}
            >
              {resolvePathDisplay(file.path, channelIds, templateNames)}
            </span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => handleFileClick(file)}>
            <FileText className="w-4 h-4 mr-2" />
            View Diff
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              void navigator.clipboard.writeText(file.path);
              toast.success("Path copied");
            }}
          >
            <Copy className="w-4 h-4 mr-2" />
            Copy File Path
          </ContextMenuItem>
          {canDiscard && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
                onClick={() => setDiscardTarget(file)}
              >
                <Undo2 className="w-4 h-4 mr-2" />
                Discard Changes
              </ContextMenuItem>
            </>
          )}
          {editorHref && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => router.push(editorHref)}>
                <ExternalLink className="w-4 h-4 mr-2" />
                Open in Editor
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  // ── Section ──────────────────────────────────────────────────────────────────

  // Plain render-helper (not a `<Section>` component) so the React Compiler doesn't treat it
  // as a component created during render (react-hooks/static-components). Called directly below.
  function renderSection({
    label,
    files,
    dotClass,
  }: {
    label: string;
    files: FileEntry[];
    dotClass: string;
  }) {
    if (files.length === 0) return null;
    return (
      <div className="border border-border rounded overflow-hidden">
        <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 dark:bg-gray-800 border-b border-border">
          <span className={cn("w-2 h-2 rounded-full shrink-0", dotClass)} />
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{label}</span>
          <span className="text-xs text-gray-400 dark:text-gray-500">({files.length})</span>
        </div>
        <div className="divide-y divide-border">
          {files.map((f) => (
            <FileRow key={f.path} file={f} />
          ))}
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Top toolbar */}
        <div className="flex items-center gap-2 mb-2 shrink-0">
          <HoverTooltip content="Reload working-tree changes">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn("w-4 h-4 mr-1.5", loading && "animate-spin")} />
              Refresh
            </Button>
          </HoverTooltip>
          {!loading && changes && (
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
              {totalCount} file{totalCount !== 1 ? "s" : ""} changed
            </span>
          )}
        </div>

        <ApiErrorAlert error={error} className="mb-2" />

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )}

        {!loading && changes && totalCount === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400">
            <p className="text-sm font-medium">No pending changes</p>
            <p className="text-xs mt-1">The working tree is clean.</p>
          </div>
        )}

        {!loading && changes && totalCount > 0 && (
          <div className="flex flex-1 min-h-0 gap-3">
            {/* ── Left: file tree ── */}
            <div className="w-72 shrink-0 flex flex-col min-h-0">
              {/* Scrollable file list */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {renderSection({
                  label: "Changed",
                  files: changedFiles,
                  dotClass: "bg-yellow-400",
                })}
                {renderSection({
                  label: "Unversioned Files",
                  files: untrackedFiles,
                  dotClass: "bg-gray-400",
                })}
              </div>

              {/* Bottom bar */}
              <div className="shrink-0 pt-2 border-t border-border mt-2 space-y-2">
                <div className="flex gap-2">
                  <HoverTooltip content="Select all files">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs h-7"
                      onClick={selectAll}
                      disabled={selectedCount === totalCount}
                    >
                      Select All
                    </Button>
                  </HoverTooltip>
                  <HoverTooltip content="Deselect all files">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs h-7"
                      onClick={deselectAll}
                      disabled={selectedCount === 0}
                    >
                      Deselect All
                    </Button>
                  </HoverTooltip>
                </div>
                <HoverTooltip
                  content={
                    selectedCount === 0
                      ? "Select at least one file to commit"
                      : `Commit and push ${selectedCount} selected file${selectedCount !== 1 ? "s" : ""}`
                  }
                >
                  <Button
                    className="w-full h-8 text-xs"
                    onClick={() => {
                      setCommitError(null);
                      setCommitOpenKey((k) => k + 1);
                      setCommitOpen(true);
                    }}
                    disabled={selectedCount === 0}
                  >
                    <GitCommit className="w-3.5 h-3.5 mr-1.5" />
                    Commit &amp; Push
                    {selectedCount > 0 && (
                      <span className="ml-1.5 rounded-full bg-white/20 px-1.5 text-[10px] font-semibold leading-4">
                        {selectedCount}
                      </span>
                    )}
                  </Button>
                </HoverTooltip>
              </div>
            </div>

            {/* ── Right: diff viewer ── */}
            <div className="flex-1 min-w-0 flex flex-col min-h-0">
              <DiffPanel
                key={diffKey}
                file={activeFile}
                channelNames={channelIds}
                templateNames={templateNames}
                onRefresh={() => setDiffKey((k) => k + 1)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Commit message dialog — key resets internal message state on each open */}
      <CommitDialog
        key={commitOpenKey}
        open={commitOpen}
        fileCount={selectedCount}
        saving={committing}
        error={commitError}
        onOpenChange={(o) => {
          if (!o && !committing) setCommitOpen(false);
        }}
        onSubmit={(msg) => void handleCommit(msg)}
      />

      {/* Discard changes confirmation — always-rendered pattern */}
      {discardTarget && (
        <ConfirmDialog
          title="Discard Changes"
          description={`Discard all local changes to "${resolvePathDisplay(discardTarget.path, channelIds, templateNames)}"? This will restore the file to its last committed state and cannot be undone.`}
          confirmLabel={discarding ? "Discarding…" : "Discard Changes"}
          confirmVariant="destructive"
          onConfirm={() => void handleDiscard(discardTarget)}
          onCancel={() => {
            if (!discarding) setDiscardTarget(null);
          }}
        />
      )}
    </>
  );
}
