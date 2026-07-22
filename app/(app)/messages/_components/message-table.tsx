import React from "react";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import type { ColDef } from "@/lib/hooks/use-column-config";
import type { ConnectorMessage, Message } from "@/lib/types";
import { HeaderCell, SimpleHeaderCell } from "@/components/sortable-header-cell";
import {
  TableContainer,
  Table,
  TableHead,
  TableHeadRow,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableSkeletonRows } from "@/components/table-skeleton-rows";
import { EmptyState } from "@/components/empty-state";
import { ColumnPicker } from "@/components/column-picker";
import { HoverTooltip } from "@/components/hover-tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  PanelRight,
  PanelBottom,
} from "lucide-react";
import type { MsgCol } from "../_lib/message-columns";
import { getCellValue, META_COL_PREFIX } from "../_lib/message-columns";
import { formatTs } from "../_lib/message-helpers";
import { cn } from "@/lib/utils";
import type { ContentViewerLayout } from "@/components/messages/content-viewer";

// ─── Props ───────────────────────────────────────────────────────────────────

export interface MessageTableProps {
  // Data
  messages: Message[];
  /** Metadata column type by full column key ("meta:<name>") — drives type-aware rendering. */
  metaColTypes: Record<string, string>;
  visibleCols: ColDef<MsgCol>[];
  orderedCols: ColDef<MsgCol>[];
  colState: Record<MsgCol, { width: number; visible: boolean }>;

  // Column actions
  setWidth: (key: MsgCol, w: number) => void;
  setVisible: (key: MsgCol, v: boolean) => void;
  moveCol: (from: number, to: number) => void;
  resetToDefaults: () => void;

  // Pagination
  page: number;
  pageSize: number;
  hasNextPage: boolean;
  totalCount: number | null;
  totalPages: number | null;
  pageInput: string;
  onPageInputChange: (v: string) => void;
  onApplyPageJump: () => void;
  onGoToPage: (pageNum: number) => void;
  loading: boolean;

  // Selection
  selectedMessage: Message | null;
  selectedConnectorMetaDataId: number | null;
  collapsedMessageIds: Set<number>;
  onSelectConnector: (msg: Message, cm: ConnectorMessage) => void;
  onToggleExpand: (messageId: number, e: React.MouseEvent) => void;

  // Layout
  viewerLayout: ContentViewerLayout;
  onViewerLayoutToggle: () => void;

  // Context menu callbacks
  selectedChannelId: string;
  /**
   * Whether the selected channel is deployed. Mirrors the toolbar
   * (MessagesActionPanel.isChannelDeployed) and Java's single visibility state applied to both the
   * task pane and messagePopupMenu (Frame.java:1662-1681; MessageBrowser.java:411-414, 1934-1937):
   * Send / Reprocess Results / Reprocess Message / Resend Message are gated on it here too.
   */
  isChannelDeployed: boolean;
  onSearch: () => void;
  onSendDialog: () => void;
  onImportDialog: () => void;
  onExportDialog: () => void;
  onExportCsv: () => void;
  onRemoveAllMessages: () => void;
  onRemoveResults: () => void;
  onRemoveMessage: () => void;
  onReprocessResults: () => void;
  onReprocessMessage: () => void;
  onResendMessage: (metaDataId: number) => void;

  // For empty state
  error: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MessageTable({
  messages,
  metaColTypes,
  visibleCols,
  orderedCols,
  colState,
  setWidth,
  setVisible,
  moveCol,
  resetToDefaults,
  page,
  pageSize,
  hasNextPage,
  totalCount,
  totalPages,
  pageInput,
  onPageInputChange,
  onApplyPageJump,
  onGoToPage,
  loading,
  selectedMessage,
  selectedConnectorMetaDataId,
  collapsedMessageIds,
  onSelectConnector,
  onToggleExpand,
  viewerLayout,
  onViewerLayoutToggle,
  selectedChannelId,
  isChannelDeployed,
  onSearch,
  onSendDialog,
  onImportDialog,
  onExportDialog,
  onExportCsv,
  onRemoveAllMessages,
  onRemoveResults,
  onRemoveMessage,
  onReprocessResults,
  onReprocessMessage,
  onResendMessage,
  error,
}: MessageTableProps) {
  const { viewDensity } = useCompactMode();

  /** Render cells for a connector row (used for both parent and child). */
  function renderCells(cm: ConnectorMessage, msg: Message, isChild: boolean) {
    // Unprocessed messages render italic + gray in every cell, mirroring Java's
    // MessageBrowserItalicCellRenderer (driven by message.isProcessed()).
    const notProcessed = msg.processed === false;
    const unproc = notProcessed ? "italic !text-gray-400 dark:!text-gray-500" : "";

    return visibleCols.map((col) => {
      // Child rows: id column always shows dash
      if (isChild && col.key === "id") {
        return (
          <TableCell key={col.key} mono className={cn("text-gray-400 dark:text-gray-600", unproc)}>
            {"\u2014"}
          </TableCell>
        );
      }
      const val = getCellValue(col.key, cm, msg);
      if (col.key === "status") {
        return (
          <TableCell key={col.key} className={unproc}>
            <StatusBadge status={cm.status} variant="message" className="max-w-full" />
          </TableCell>
        );
      }
      if (col.key === "errors") {
        const hasErr = val != null && val !== "";
        return (
          <TableCell key={col.key}>
            {hasErr ? (
              <span
                className={cn("text-red-600 dark:text-red-400 font-medium", unproc, {
                  "font-normal": notProcessed,
                })}
              >
                {val}
              </span>
            ) : (
              <span className={cn("text-gray-400 dark:text-gray-500", unproc)}>{"\u2014"}</span>
            )}
          </TableCell>
        );
      }
      // Standard date columns + TIMESTAMP-typed custom metadata columns.
      const isTimestampMeta =
        col.key.startsWith(META_COL_PREFIX) && metaColTypes[col.key] === "TIMESTAMP";
      if (
        col.key === "receivedDate" ||
        col.key === "responseDate" ||
        col.key === "sendDate" ||
        col.key === "origReceivedDate" ||
        isTimestampMeta
      ) {
        return (
          <TableCell
            key={col.key}
            className={cn("text-gray-500 dark:text-gray-400 whitespace-nowrap", unproc)}
          >
            {formatTs(val as string | undefined)}
          </TableCell>
        );
      }
      if (
        col.key === "id" ||
        col.key === "origId" ||
        col.key === "importId" ||
        col.key === "sendAttempts"
      ) {
        return (
          <TableCell
            key={col.key}
            mono
            align={col.align === "right" ? "right" : "left"}
            className={cn("text-gray-500 dark:text-gray-400", unproc)}
          >
            {val ?? "\u2014"}
          </TableCell>
        );
      }
      return (
        <TableCell
          key={col.key}
          align={col.align === "right" ? "right" : "left"}
          className={cn("text-gray-700 dark:text-gray-300", unproc)}
        >
          {val ?? "\u2014"}
        </TableCell>
      );
    });
  }

  function renderContextMenuItems() {
    return (
      <ContextMenuContent>
        <ContextMenuItem onSelect={onSearch}>Refresh</ContextMenuItem>
        <ContextMenuItem
          onSelect={onSendDialog}
          disabled={!selectedChannelId || !isChannelDeployed}
        >
          Send Message
        </ContextMenuItem>
        <ContextMenuItem onSelect={onImportDialog} disabled={!selectedChannelId}>
          Import Messages
        </ContextMenuItem>
        <ContextMenuItem onSelect={onExportDialog} disabled={messages.length === 0}>
          Export Results
        </ContextMenuItem>
        <ContextMenuItem onSelect={onExportCsv} disabled={messages.length === 0}>
          Export CSV
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={onRemoveAllMessages}
          disabled={!selectedChannelId}
          className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
        >
          Remove All Messages
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={onRemoveResults}
          disabled={messages.length === 0}
          className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
        >
          Remove Results
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={onRemoveMessage}
          disabled={!selectedMessage}
          className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
        >
          Remove Message
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={onReprocessResults}
          disabled={messages.length === 0 || !isChannelDeployed}
        >
          Reprocess Results
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={onReprocessMessage}
          disabled={!selectedMessage || !isChannelDeployed}
        >
          Reprocess Message
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => onResendMessage(selectedConnectorMetaDataId ?? 0)}
          disabled={!selectedMessage || !isChannelDeployed}
        >
          Resend Message
        </ContextMenuItem>
      </ContextMenuContent>
    );
  }

  return (
    <>
      {/* Pagination + Column Picker */}
      <div className="px-4 py-2 border-b border-border bg-white dark:bg-gray-900 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>
          {messages.length > 0
            ? `Results ${page * pageSize + 1}\u2013${page * pageSize + messages.length}${totalCount !== null ? ` of ${totalCount.toLocaleString()}` : ""}`
            : "No results"}
        </span>
        <div className="flex items-center gap-2">
          <ColumnPicker
            cols={orderedCols}
            colState={colState}
            onToggle={(key) => setVisible(key, !colState[key].visible)}
            onReset={resetToDefaults}
            onMove={moveCol}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title={viewerLayout === "right" ? "Switch to bottom layout" : "Switch to right layout"}
            onClick={onViewerLayoutToggle}
          >
            {viewerLayout === "right" ? (
              <PanelBottom className="w-3.5 h-3.5" />
            ) : (
              <PanelRight className="w-3.5 h-3.5" />
            )}
          </Button>
          <div className="flex items-center gap-1">
            {/* First page */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onGoToPage(0)}
              disabled={page === 0 || loading}
              title="First page"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </Button>

            {/* Prev page */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onGoToPage(page - 1)}
              disabled={page === 0 || loading}
              title="Previous page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>

            {/* Page number input */}
            <span className="flex items-center gap-1">
              <span className="text-xs">Page</span>
              <HoverTooltip content="Enter a page number and press Enter to jump to that page.">
                <Input
                  type="number"
                  min={1}
                  max={totalPages ?? undefined}
                  value={pageInput}
                  onChange={(e) => onPageInputChange(e.target.value)}
                  onBlur={onApplyPageJump}
                  onKeyDown={(e) => e.key === "Enter" && onApplyPageJump()}
                  density={viewDensity}
                  className="h-6 w-12 text-xs text-center px-1"
                  disabled={loading}
                />
              </HoverTooltip>
              {totalPages !== null && (
                <span className="text-xs text-gray-500 dark:text-gray-400">of {totalPages}</span>
              )}
            </span>

            {/* Next page */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onGoToPage(page + 1)}
              disabled={!hasNextPage || loading}
              title="Next page"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>

            {/* Last page — only when total is known */}
            {totalPages !== null && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onGoToPage(totalPages - 1)}
                disabled={!hasNextPage || loading || page === totalPages - 1}
                title="Last page"
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <TableContainer className="flex-1">
        <Table className="text-sm">
          <colgroup>
            {/* Expand/collapse toggle column */}
            <col style={{ width: 24 }} />
            {visibleCols.map((col) => (
              <col key={col.key} style={{ width: colState[col.key].width }} />
            ))}
          </colgroup>
          <TableHead>
            <TableHeadRow>
              <SimpleHeaderCell className="w-6" style={{ width: 24 }} />
              {visibleCols.map((col) => (
                <HeaderCell
                  key={col.key}
                  col={col.key}
                  colDef={col}
                  width={colState[col.key].width}
                  onResize={setWidth}
                />
              ))}
            </TableHeadRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableSkeletonRows
                count={10}
                columns={visibleCols}
                rowHeight="h-3.5"
                density={viewDensity}
                leadingCols={1}
              />
            ) : (
              messages.flatMap((msg) => {
                const allConnectors = Object.values(msg.connectorMessages ?? {}).sort(
                  (a, b) => a.metaDataId - b.metaDataId
                );
                const sourceConnector = allConnectors.find((cm) => cm.metaDataId === 0) ?? null;
                const destinations = allConnectors.filter((cm) => cm.metaDataId > 0);
                const hasChildren = destinations.length > 0;
                const isCollapsed = collapsedMessageIds.has(msg.messageId);

                const isParentSelected =
                  selectedMessage?.messageId === msg.messageId &&
                  selectedConnectorMetaDataId === (sourceConnector?.metaDataId ?? -1);

                const contextMenuItems = renderContextMenuItems();

                // Parent row — shows source connector data (or dashes if filtered out)
                const parentRow = sourceConnector ? (
                  <ContextMenu key={`parent-${msg.messageId}`}>
                    <ContextMenuTrigger asChild>
                      <TableRow
                        variant={isParentSelected ? "selected" : "default"}
                        className={`border-t-2 border-t-gray-300 dark:border-t-gray-600 cursor-pointer ${
                          isParentSelected ? "border-l-2 border-l-blue-500" : ""
                        }`}
                        onClick={() => onSelectConnector(msg, sourceConnector)}
                        onDoubleClick={() => onResendMessage(sourceConnector.metaDataId)}
                        onContextMenu={() => onSelectConnector(msg, sourceConnector)}
                      >
                        <TableCell width={24} align="center" className="px-1">
                          {hasChildren && (
                            <button
                              onClick={(e) => onToggleExpand(msg.messageId, e)}
                              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                              title={isCollapsed ? "Expand" : "Collapse"}
                            >
                              {isCollapsed ? (
                                <ChevronRight className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </TableCell>
                        {renderCells(sourceConnector, msg, false)}
                      </TableRow>
                    </ContextMenuTrigger>
                    {contextMenuItems}
                  </ContextMenu>
                ) : (
                  // No source in results (e.g. filtered to SENT only) — show empty parent
                  <ContextMenu key={`parent-${msg.messageId}`}>
                    <ContextMenuTrigger asChild>
                      <TableRow
                        onClick={() =>
                          onToggleExpand(msg.messageId, {
                            stopPropagation: () => {},
                          } as React.MouseEvent)
                        }
                      >
                        <TableCell width={24} align="center" className="px-1">
                          {hasChildren && (
                            <button
                              onClick={(e) => onToggleExpand(msg.messageId, e)}
                              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                              title={isCollapsed ? "Expand" : "Collapse"}
                            >
                              {isCollapsed ? (
                                <ChevronRight className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </TableCell>
                        {visibleCols.map((col) => (
                          <TableCell
                            key={col.key}
                            mono
                            className="text-gray-400 dark:text-gray-600"
                          >
                            {col.key === "id" ? msg.messageId : "\u2014"}
                          </TableCell>
                        ))}
                      </TableRow>
                    </ContextMenuTrigger>
                    {contextMenuItems}
                  </ContextMenu>
                );

                // Child rows — destinations (shown only when expanded)
                const childRows =
                  hasChildren && !isCollapsed
                    ? destinations.map((cm) => {
                        const isChildSelected =
                          selectedMessage?.messageId === msg.messageId &&
                          selectedConnectorMetaDataId === cm.metaDataId;
                        return (
                          <ContextMenu key={`${msg.messageId}-${cm.metaDataId}`}>
                            <ContextMenuTrigger asChild>
                              <TableRow
                                variant={isChildSelected ? "selected" : "default"}
                                className={`cursor-pointer ${
                                  isChildSelected ? "border-l-2 border-l-blue-500" : ""
                                }`}
                                onClick={() => onSelectConnector(msg, cm)}
                                onDoubleClick={() => onResendMessage(cm.metaDataId)}
                                onContextMenu={() => onSelectConnector(msg, cm)}
                              >
                                <TableCell width={24} />
                                {renderCells(cm, msg, true)}
                              </TableRow>
                            </ContextMenuTrigger>
                            {contextMenuItems}
                          </ContextMenu>
                        );
                      })
                    : [];

                return [parentRow, ...childRows];
              })
            )}
          </TableBody>
        </Table>

        {!loading && messages.length === 0 && !error && (
          <EmptyState
            message={
              selectedChannelId
                ? "No messages found for this search."
                : "Select a channel to browse messages."
            }
          />
        )}
      </TableContainer>
    </>
  );
}
