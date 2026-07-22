"use client";

import type { ConnectorInfo } from "@/components/messages/advanced-filter-panel";
import {
  SendMessageDialog,
  type SendMessageInitialData,
} from "@/components/messages/send-message-dialog";
import { ImportMessagesDialog } from "@/components/messages/import-messages-dialog";
import { ExportResultsDialog } from "@/components/messages/export-results-dialog";
import { RemoveAllMessagesDialog } from "@/components/remove-all-messages-dialog";
import {
  ReprocessOptionsDialog,
  type ReprocessOptions,
} from "@/components/reprocess-results-dialog";
import { ConfirmDialog, RemoveResultsConfirmDialog } from "./message-dialogs";
import type { MessageFilter } from "@/lib/api-client";
import { loadAdminPrefs } from "@/lib/admin-prefs";
import type { ReactNode } from "react";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MessagesPageDialogsProps {
  // Send message
  connectorInfos: ConnectorInfo[];
  sendDialogOpen: boolean;
  onSendDialogOpenChange: (open: boolean) => void;
  selectedChannelName: string;
  onSend: (
    contents: string[],
    destinationMetaDataIds: number[] | null,
    sourceMap: Record<string, string>
  ) => void;
  /** Pre-population data for the Resend Message flow. Undefined = blank Send Message dialog. */
  sendInitialData?: SendMessageInitialData;

  // Import messages
  importDialogOpen: boolean;
  onImportDialogOpenChange: (open: boolean) => void;
  selectedChannelId: string;
  onImported: () => void;

  // Export results
  exportDialogOpen: boolean;
  onExportDialogOpenChange: (open: boolean) => void;
  /** Filter PINNED at search time (null before the first search); mirrors Java getMessageFilter(). */
  messageFilter: MessageFilter | null;
  pageSize: number;
  hasMessages: boolean;
  isFirstLoad: boolean;

  // Confirm (single message remove)
  confirmDialog: {
    title: string;
    description: ReactNode;
    onConfirm: () => void;
  } | null;
  onConfirmDialogCancel: () => void;

  // Remove all messages
  removeAllTarget: {
    channelId: string;
    channelName: string;
    channelState: string;
  } | null;
  onRemoveAllClose: () => void;
  onRemoveAllDone: () => void;

  // Remove results
  removeResultsConfirmOpen: boolean;
  onRemoveResultsConfirm: () => void;
  onRemoveResultsCancel: () => void;
  removeResultsChannelName: string;

  // Reprocess options
  reprocessMode: "single" | "bulk" | null;
  onReprocessClose: () => void;
  onReprocessConfirm: (options: ReprocessOptions) => Promise<void>;
  reprocessChannelName: string;
  reprocessDestinations: ConnectorInfo[];
  /** Selected connector for single-message reprocess (pre-checks only that destination). */
  reprocessPreselectedDestinationId: number | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MessagesPageDialogs({
  connectorInfos,
  sendDialogOpen,
  onSendDialogOpenChange,
  selectedChannelName,
  onSend,
  sendInitialData,
  importDialogOpen,
  onImportDialogOpenChange,
  selectedChannelId,
  onImported,
  exportDialogOpen,
  onExportDialogOpenChange,
  messageFilter,
  pageSize,
  hasMessages,
  isFirstLoad,
  confirmDialog,
  onConfirmDialogCancel,
  removeAllTarget,
  onRemoveAllClose,
  onRemoveAllDone,
  removeResultsConfirmOpen,
  onRemoveResultsConfirm,
  onRemoveResultsCancel,
  removeResultsChannelName,
  reprocessMode,
  onReprocessClose,
  onReprocessConfirm,
  reprocessChannelName,
  reprocessDestinations,
  reprocessPreselectedDestinationId,
}: MessagesPageDialogsProps) {
  return (
    <>
      {/* Send Message Dialog */}
      <SendMessageDialog
        open={sendDialogOpen}
        onOpenChange={onSendDialogOpenChange}
        channelName={selectedChannelName}
        connectors={connectorInfos}
        onSend={onSend}
        initialData={sendInitialData}
      />

      {/* Import Messages Dialog */}
      {selectedChannelId && (
        <ImportMessagesDialog
          open={importDialogOpen}
          onOpenChange={onImportDialogOpenChange}
          channelId={selectedChannelId}
          channelName={selectedChannelName}
          onImported={onImported}
        />
      )}

      {/* Export Results Dialog */}
      {selectedChannelId && (
        <ExportResultsDialog
          open={exportDialogOpen}
          onOpenChange={onExportDialogOpenChange}
          channelId={selectedChannelId}
          channelName={selectedChannelName}
          messageFilter={messageFilter}
          pageSize={pageSize}
          hasMessages={hasMessages}
          isFirstLoad={isFirstLoad}
        />
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          description={confirmDialog.description}
          onConfirm={confirmDialog.onConfirm}
          onCancel={onConfirmDialogCancel}
        />
      )}

      {/* Remove All Messages Dialog */}
      {removeAllTarget && (
        <RemoveAllMessagesDialog
          channels={[removeAllTarget]}
          onClose={onRemoveAllClose}
          onDone={onRemoveAllDone}
        />
      )}

      {/* Remove Results — type REMOVEALL to confirm */}
      {removeResultsConfirmOpen && (
        <RemoveResultsConfirmDialog
          channelName={removeResultsChannelName}
          onConfirm={onRemoveResultsConfirm}
          onCancel={onRemoveResultsCancel}
        />
      )}

      {/* Reprocessing Options dialog — used for both single message and bulk reprocess */}
      {reprocessMode !== null && (
        <ReprocessOptionsDialog
          channelName={reprocessChannelName}
          destinations={reprocessDestinations}
          showWarning={
            reprocessMode === "bulk" && loadAdminPrefs().showReprocessRemoveMessagesWarning
          }
          preselectedDestinationId={
            reprocessMode === "single" ? reprocessPreselectedDestinationId : null
          }
          onClose={onReprocessClose}
          onConfirm={onReprocessConfirm}
        />
      )}
    </>
  );
}
