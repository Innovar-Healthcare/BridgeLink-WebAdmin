"use client";

/**
 * Status Tab
 *
 * Displays Git repository info via GET /plugins/version-history/repoInfo.
 * Mirrors Java's GitStatusTabPanel.
 *
 * Shows: local repo path, remote URL, branch, total size, folder breakdown.
 *
 * On version-history 3.0.1 / BridgeLink 26.3.1+ the toolbar also exposes
 * Reload (fetch + ahead/behind count), Pull, and Push actions. On older
 * servers we render a single Refresh button so the tab keeps working without
 * surfacing options that would hit missing endpoints.
 */

import { startTransition, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  GitBranch,
  FolderOpen,
  HardDrive,
  Link,
} from "lucide-react";

import { ApiErrorAlert } from "@/components/api-error-alert";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { HoverTooltip } from "@/components/hover-tooltip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import {
  friendlyRepoError,
  getRemoteStatus,
  getRepoInfo,
  pullRemote,
  pushRemote,
  type RemoteStatus,
  type RepoInfo,
} from "../api-version-history";
import { usePluginCapabilities } from "../use-plugin-capabilities";
import { DataTable } from "@/components/data-table";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";

type FolderCol = "folder" | "files" | "size";

const FOLDER_COLS: ColDef<FolderCol>[] = [
  { key: "folder", label: "Folder", defaultWidth: 240, minWidth: 100, defaultVisible: true },
  { key: "files", label: "Files", defaultWidth: 80, minWidth: 60, defaultVisible: true },
  { key: "size", label: "Size", defaultWidth: 100, minWidth: 60, defaultVisible: true },
];

interface FolderRow {
  name: string;
  fileCount: number;
  sizeBytes: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StatusTab() {
  const [info, setInfo] = useState<RepoInfo | null>(null);
  const [remote, setRemote] = useState<RemoteStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pullConfirmOpen, setPullConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folderColConfig = useColumnConfig(FOLDER_COLS, "bl-vh-status-folders-cols-v1");
  const folderSortState = useSortable<FolderCol>("folder", "asc");
  const { hasRemoteActions } = usePluginCapabilities(true);

  const loadRepoInfo = useCallback(async () => {
    setInfo(await getRepoInfo());
  }, []);

  /**
   * Refresh: legacy behavior — pull repo info only.
   */
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadRepoInfo();
    } catch (e) {
      setError(friendlyRepoError(e, "Failed to load repository info"));
    } finally {
      setLoading(false);
    }
  }, [loadRepoInfo]);

  /**
   * Reload: fetch from remote + repo info. Pull and Push call this on success
   * so the displayed ahead/behind counts stay accurate.
   */
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [info, status] = await Promise.all([getRepoInfo(), getRemoteStatus()]);
      setInfo(info);
      setRemote(status);
    } catch (e) {
      setError(friendlyRepoError(e, "Failed to refresh repository status"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startTransition(() => {
      if (hasRemoteActions) {
        void reload();
      } else {
        void refresh();
      }
    });
  }, [hasRemoteActions, refresh, reload]);

  async function handlePull() {
    setPullConfirmOpen(false);
    setPulling(true);
    setError(null);
    try {
      await pullRemote();
      toast.success("Pulled from remote");
      await reload();
    } catch (e) {
      setError(friendlyRepoError(e, "Pull failed"));
    } finally {
      setPulling(false);
    }
  }

  async function handlePush() {
    setPushing(true);
    setError(null);
    try {
      await pushRemote();
      toast.success("Pushed to remote");
      await reload();
    } catch (e) {
      setError(friendlyRepoError(e, "Push failed"));
    } finally {
      setPushing(false);
    }
  }

  const busy = loading || pulling || pushing;

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {hasRemoteActions ? (
          <>
            <HoverTooltip content="Fetch from remote and refresh repository info">
              <Button variant="outline" size="sm" onClick={() => void reload()} disabled={busy}>
                <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
                Reload
              </Button>
            </HoverTooltip>
            <HoverTooltip content="Pull from remote. Merge conflicts are auto-resolved using the remote version; local unpushed commits are preserved.">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPullConfirmOpen(true)}
                disabled={busy}
              >
                <ArrowDownToLine className={`w-4 h-4 mr-1.5 ${pulling ? "animate-pulse" : ""}`} />
                Pull
              </Button>
            </HoverTooltip>
            <HoverTooltip content="Push local commits to remote (fetch + rebase + push).">
              <Button variant="outline" size="sm" onClick={() => void handlePush()} disabled={busy}>
                <ArrowUpFromLine className={`w-4 h-4 mr-1.5 ${pushing ? "animate-pulse" : ""}`} />
                Push
              </Button>
            </HoverTooltip>
            {remote && (
              <span className="text-xs text-gray-500 dark:text-gray-400 ml-2 font-mono">
                ↑ {remote.aheadCount} / ↓ {remote.behindCount}
              </span>
            )}
          </>
        ) : (
          <HoverTooltip content="Reload repository info">
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </HoverTooltip>
        )}
      </div>

      <ApiErrorAlert error={error} className="" />

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {!loading && info && (
        <>
          {/* Repo details card */}
          <div className="border border-border rounded-md overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-border">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Repository Info
              </h3>
            </div>
            <div className="divide-y divide-border">
              <InfoRow
                icon={<FolderOpen className="w-4 h-4 text-gray-400" />}
                label="Local Path"
                value={info.localRepoPath}
                mono
              />
              <InfoRow
                icon={<Link className="w-4 h-4 text-gray-400" />}
                label="Remote URL"
                value={info.remoteUrl || "—"}
                mono
              />
              <InfoRow
                icon={<GitBranch className="w-4 h-4 text-gray-400" />}
                label="Branch"
                value={info.branch || "—"}
              />
              <InfoRow
                icon={<HardDrive className="w-4 h-4 text-gray-400" />}
                label="Total Size"
                value={formatBytes(info.totalSizeBytes)}
              />
            </div>
          </div>

          {/* Folder breakdown */}
          {info.folders && info.folders.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Folders</h3>
              <DataTable<FolderRow, FolderCol>
                variant="sortable"
                cols={FOLDER_COLS}
                rows={folderSortState.sorted(
                  info.folders.map((f) => ({
                    name: f.name,
                    fileCount: f.fileCount,
                    sizeBytes: f.files.reduce((sum, x) => sum + x.sizeBytes, 0),
                  })),
                  (r) => {
                    switch (folderSortState.sort.key) {
                      case "folder":
                        return r.name;
                      case "files":
                        return r.fileCount;
                      case "size":
                        return r.sizeBytes;
                      default:
                        return undefined;
                    }
                  }
                )}
                colConfig={folderColConfig}
                sortState={folderSortState}
                rowKey={(r) => r.name}
                cellAlign={{ files: "right", size: "right" }}
                cellMono={{ folder: true }}
                renderCell={(row, col) => {
                  if (col === "folder") return row.name;
                  if (col === "files") return row.fileCount;
                  return formatBytes(row.sizeBytes);
                }}
              />
            </div>
          )}
        </>
      )}

      {pullConfirmOpen && (
        <ConfirmDialog
          title="Pull from Remote"
          description="Pull the latest changes from the remote branch. Any merge conflicts are auto-resolved by taking the remote version; your unpushed local commits will be preserved. Continue?"
          confirmLabel={pulling ? "Pulling…" : "Pull"}
          confirmVariant="default"
          onConfirm={() => void handlePull()}
          onCancel={() => {
            if (!pulling) setPullConfirmOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ─── Info row helper ──────────────────────────────────────────────────────────

function InfoRow({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <span className="text-sm text-gray-500 dark:text-gray-400 w-24 flex-shrink-0">{label}</span>
      <HoverTooltip content={value}>
        <span
          className={`text-sm text-gray-800 dark:text-gray-200 truncate flex-1 ${mono ? "font-mono text-xs" : ""}`}
        >
          {value}
        </span>
      </HoverTooltip>
    </div>
  );
}
