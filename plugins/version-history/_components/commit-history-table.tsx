"use client";

import { format } from "date-fns";
import { Copy, History, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { HoverTooltip } from "@/components/hover-tooltip";
import {
  TableContainer,
  Table,
  TableColGroup,
  TableHead,
  TableHeadRow,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/data-table";
import { HeaderCell } from "@/components/sortable-header-cell";
import { useColumnConfig } from "@/lib/hooks/use-column-config";
import { getShortHash, getMessageContent, type CommitMetaData } from "../api-version-history";
import { type CommitCol } from "./commit-columns";

interface CommitHistoryTableProps {
  history: CommitMetaData[];
  compareMode: boolean;
  compareFrom: CommitMetaData | null;
  compareTo: CommitMetaData | null;
  selectedHistoryCommit: CommitMetaData | null;
  restoreMatchMap: Map<string, boolean>;
  commitColConfig: ReturnType<typeof useColumnConfig<CommitCol>>;
  commitColConfigCompare: ReturnType<typeof useColumnConfig<CommitCol>>;
  onSelectHistoryCommit: (c: CommitMetaData) => void;
  onCompareSelect: (c: CommitMetaData) => void;
  onSetCompareFrom: (c: CommitMetaData) => void;
  onSetCompareTo: (c: CommitMetaData) => void;
  onLoadCompareDiff: (from: CommitMetaData, to: CommitMetaData) => void;
  onCheckRestoreMatch: (c: CommitMetaData) => void;
  onRequestRestore: (c: CommitMetaData) => void;
}

export function CommitHistoryTable({
  history,
  compareMode,
  compareFrom,
  compareTo,
  selectedHistoryCommit,
  restoreMatchMap,
  commitColConfig,
  commitColConfigCompare,
  onSelectHistoryCommit,
  onCompareSelect,
  onSetCompareFrom,
  onSetCompareTo,
  onLoadCompareDiff,
  onCheckRestoreMatch,
  onRequestRestore,
}: CommitHistoryTableProps) {
  const activeColConfig = compareMode ? commitColConfigCompare : commitColConfig;

  return (
    <TableContainer className="max-h-44">
      <Table>
        <TableColGroup cols={activeColConfig.visibleCols} colState={activeColConfig.colState} />
        <TableHead>
          <TableHeadRow>
            {activeColConfig.visibleCols.map((c) => (
              <HeaderCell
                key={c.key}
                col={c.key}
                colDef={c}
                width={activeColConfig.colState[c.key].width}
                onResize={activeColConfig.setWidth}
              />
            ))}
          </TableHeadRow>
        </TableHead>
        <TableBody>
          {history.map((commit) => {
            const isSelected = compareMode
              ? compareFrom?.hash === commit.hash || compareTo?.hash === commit.hash
              : selectedHistoryCommit?.hash === commit.hash;
            const subject = getMessageContent(commit.message);
            return (
              <ContextMenu
                key={commit.hash}
                onOpenChange={(open) => {
                  if (open) onCheckRestoreMatch(commit);
                }}
              >
                <ContextMenuTrigger asChild>
                  <TableRow
                    variant={isSelected ? "selected" : "default"}
                    title={
                      compareMode
                        ? "Click to select for comparison"
                        : "Click to view diff at this revision"
                    }
                    onClick={() =>
                      compareMode ? onCompareSelect(commit) : onSelectHistoryCommit(commit)
                    }
                    style={{ cursor: "pointer" }}
                  >
                    {activeColConfig.visibleCols.map((c) => {
                      if (c.key === "from") {
                        return (
                          <TableCell key={c.key} align="center">
                            <input
                              type="radio"
                              name="compare-from"
                              checked={compareFrom?.hash === commit.hash}
                              onChange={() => {
                                onSetCompareFrom(commit);
                                if (compareTo) {
                                  onLoadCompareDiff(commit, compareTo);
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-3 h-3 accent-blue-600"
                            />
                          </TableCell>
                        );
                      }
                      if (c.key === "to") {
                        return (
                          <TableCell key={c.key} align="center">
                            <input
                              type="radio"
                              name="compare-to"
                              checked={compareTo?.hash === commit.hash}
                              onChange={() => {
                                onSetCompareTo(commit);
                                if (compareFrom) {
                                  onLoadCompareDiff(compareFrom, commit);
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-3 h-3 accent-blue-600"
                            />
                          </TableCell>
                        );
                      }
                      if (c.key === "hash") {
                        return (
                          <TableCell key={c.key} mono>
                            <HoverTooltip content={commit.hash}>
                              <span>{getShortHash(commit.hash)}</span>
                            </HoverTooltip>
                          </TableCell>
                        );
                      }
                      if (c.key === "date") {
                        return (
                          <TableCell key={c.key}>
                            {format(new Date(commit.timestamp), "MMM d, yyyy HH:mm")}
                          </TableCell>
                        );
                      }
                      if (c.key === "author") {
                        return <TableCell key={c.key}>{commit.committer}</TableCell>;
                      }
                      return (
                        <TableCell key={c.key}>
                          <HoverTooltip content={subject}>
                            <span>{subject}</span>
                          </HoverTooltip>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => onSelectHistoryCommit(commit)}>
                    <History className="w-4 h-4 mr-2" />
                    View Diff
                  </ContextMenuItem>
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
                    onClick={() => onRequestRestore(commit)}
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
        </TableBody>
      </Table>
    </TableContainer>
  );
}
