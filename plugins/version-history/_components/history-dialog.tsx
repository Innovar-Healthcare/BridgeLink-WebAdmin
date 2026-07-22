"use client";

/**
 * History Dialog
 *
 * Shows all commits for a single entity (channel or code template).
 * Opens from the Channels tab when the user clicks the "History" button.
 * Fetched via GET /plugins/version-history/history?fileName=<id>&mode=<mode>.
 * Mirrors Java's ChannelHistoryTabPanel / CommitMetaDataTable.
 *
 * Click a commit row → opens ContentDialog to view XML at that revision.
 */

import { useEffect, useState } from "react";
import { format } from "date-fns";

import { InfoDialog } from "@/components/info-dialog";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { HoverTooltip } from "@/components/hover-tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/data-table";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";

import {
  getEntityHistory,
  getShortHash,
  getMessageContent,
  type CommitMetaData,
  type VhMode,
} from "../api-version-history";
import { ContentDialog } from "./content-dialog";

interface HistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
  entityName: string;
  mode: VhMode;
}

type HistoryCol = "hash" | "date" | "committer" | "message";

const HISTORY_COLS: ColDef<HistoryCol>[] = [
  { key: "hash", label: "Hash", defaultWidth: 80, minWidth: 60, defaultVisible: true },
  { key: "date", label: "Date", defaultWidth: 150, minWidth: 100, defaultVisible: true },
  { key: "committer", label: "Committer", defaultWidth: 130, minWidth: 80, defaultVisible: true },
  { key: "message", label: "Message", defaultWidth: 300, minWidth: 100, defaultVisible: true },
];

export function HistoryDialog({
  open,
  onOpenChange,
  entityId,
  entityName,
  mode,
}: HistoryDialogProps) {
  const [commits, setCommits] = useState<CommitMetaData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colConfig = useColumnConfig(HISTORY_COLS, "bl-version-history-cols-v1");
  const sortState = useSortable<HistoryCol>("date", "desc");

  // Content (XML) viewer sub-dialog
  const [contentOpen, setContentOpen] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<CommitMetaData | null>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getEntityHistory(entityId, mode);
        setCommits(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load history");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, entityId, mode]);

  function handleRowClick(commit: CommitMetaData) {
    setSelectedCommit(commit);
    setContentOpen(true);
  }

  return (
    <>
      <InfoDialog
        open={open}
        onOpenChange={onOpenChange}
        title={`History — ${entityName}`}
        description={`${commits.length} commit${commits.length !== 1 ? "s" : ""}`}
        maxWidth="sm:max-w-2xl"
      >
        <ApiErrorAlert error={error} />
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )}
        {!loading && commits.length === 0 && !error && (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
            No history found for this entity.
          </p>
        )}
        {!loading && commits.length > 0 && (
          <div className="max-h-[55vh] overflow-y-auto">
            <DataTable<CommitMetaData, HistoryCol>
              variant="sortable"
              cols={HISTORY_COLS}
              rows={sortState.sorted(commits, (c) => {
                switch (sortState.sort.key) {
                  case "hash":
                    return c.hash;
                  case "date":
                    return c.timestamp;
                  case "committer":
                    return c.committer;
                  case "message":
                    return getMessageContent(c.message);
                  default:
                    return undefined;
                }
              })}
              colConfig={colConfig}
              sortState={sortState}
              rowKey={(c) => c.hash}
              onRowClick={handleRowClick}
              cellMono={{ hash: true }}
              empty="No history found for this entity."
              renderCell={(c, col) => {
                if (col === "hash") {
                  return (
                    <HoverTooltip content={c.hash}>
                      <span>{getShortHash(c.hash)}</span>
                    </HoverTooltip>
                  );
                }
                if (col === "date") {
                  return (
                    <span className="tabular-nums">
                      {format(new Date(c.timestamp), "yyyy-MM-dd HH:mm")}
                    </span>
                  );
                }
                if (col === "committer") return c.committer;
                return (
                  <HoverTooltip content={getMessageContent(c.message) || undefined}>
                    <span>{getMessageContent(c.message)}</span>
                  </HoverTooltip>
                );
              }}
            />
          </div>
        )}
      </InfoDialog>

      {selectedCommit && (
        <ContentDialog
          open={contentOpen}
          onOpenChange={setContentOpen}
          entityId={entityId}
          entityName={entityName}
          revision={selectedCommit.hash}
          mode={mode}
        />
      )}
    </>
  );
}
