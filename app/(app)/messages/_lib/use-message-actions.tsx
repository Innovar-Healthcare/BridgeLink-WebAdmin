import { useCallback, type ReactNode } from "react";
import {
  getMessage,
  sendMessagesInBackground,
  reprocessMessage,
  removeMessage,
  removeMessagesByFilter,
  reprocessMessagesWithFilter,
} from "@/lib/api-client";
import type { MessageFilter } from "@/lib/api-client";
import type { Message } from "@/lib/types";
import type { ColDef } from "@/lib/hooks/use-column-config";
import type { SendMessageInitialData } from "@/components/messages/send-message-dialog";
import type { ReprocessOptions } from "@/components/reprocess-results-dialog";
import { toast } from "sonner";
import {
  buildResendInitialData,
  hasRawContent,
  resolveSourceInboundDataType,
} from "./message-send";
import { exportMessagesCsv } from "./message-csv-export";
import type { MsgCol } from "./message-columns";

/** Shape of the single-message remove/confirm dialog state owned by the page. */
export interface ConfirmDialogState {
  title: string;
  description: ReactNode;
  onConfirm: () => void;
}

/** Shape of the Remove-All-Messages dialog target owned by the page. */
export interface RemoveAllTarget {
  channelId: string;
  channelName: string;
  channelState: string;
}

/**
 * Dependencies for the message action handlers. Setters accept a plain value (the handlers never use
 * the updater form), which is assignable from the corresponding `useState` dispatch. Refs and setters
 * are stable; the values change each render, so the handlers are recreated each render (as they were
 * when inlined in the page) — none are referentially memoized except the two that were before.
 */
export interface MessageActionsDeps {
  selectedChannelId: string;
  selectedMessage: Message | null;
  fullMessage: Message | null;
  selectedConnectorMetaDataId: number | null;
  isCURESPHILoggingOn: boolean;
  channels: Map<string, string>;
  /** selectedChannelStatus?.state — undefined when the channel is not deployed. */
  selectedChannelState: string | undefined;
  page: number;
  reprocessMode: "single" | "bulk" | null;
  visibleCols: ColDef<MsgCol>[];
  activeFilterRef: React.RefObject<MessageFilter | null>;
  /** True once the user has run an explicit search — gates export (see handleExportCsv). */
  userHasSearchedRef: React.RefObject<boolean>;
  search: (pageNum?: number) => void;
  setActionLoading: (v: boolean) => void;
  setActionError: (v: string) => void;
  setReprocessMode: (v: "single" | "bulk" | null) => void;
  setSendInitialData: (v: SendMessageInitialData | undefined) => void;
  setSendDialogOpen: (v: boolean) => void;
  setConfirmDialog: (v: ConfirmDialogState | null) => void;
  setRemoveAllTarget: (v: RemoveAllTarget | null) => void;
  setRemoveResultsConfirmOpen: (v: boolean) => void;
  setSelectedMessage: (v: Message | null) => void;
  setFullMessage: (v: Message | null) => void;
  setSelectedConnectorMetaDataId: (v: number | null) => void;
}

/**
 * The Message Browser toolbar / context-menu / dialog action handlers. Extracted verbatim from the
 * page component to keep `messages/page.tsx` under the file-size gate; behavior is unchanged.
 */
export function useMessageActions(deps: MessageActionsDeps) {
  const {
    selectedChannelId,
    selectedMessage,
    fullMessage,
    selectedConnectorMetaDataId,
    isCURESPHILoggingOn,
    channels,
    selectedChannelState,
    page,
    reprocessMode,
    visibleCols,
    activeFilterRef,
    userHasSearchedRef,
    search,
    setActionLoading,
    setActionError,
    setReprocessMode,
    setSendInitialData,
    setSendDialogOpen,
    setConfirmDialog,
    setRemoveAllTarget,
    setRemoveResultsConfirmOpen,
    setSelectedMessage,
    setFullMessage,
    setSelectedConnectorMetaDataId,
  } = deps;

  function handleSendMessage(
    contents: string[],
    destinationMetaDataIds: number[] | null,
    sourceMap: Record<string, string>
  ) {
    if (!selectedChannelId) return;
    // Fire-and-forget (mirrors the Java EditMessageDialog): dispatch in the
    // background and refresh once it settles — a processed message may be visible.
    void sendMessagesInBackground(selectedChannelId, contents, {
      destinationMetaDataIds: destinationMetaDataIds ?? undefined,
      sourceMap,
      onSuccess: (n) => toast.success(n > 1 ? `${n} messages sent.` : "Message sent."),
      onError: (m) => toast.error(`Failed to send message: ${m}`),
      onSettled: () => search(page),
    });
  }

  function handleReprocessMessage() {
    if (!selectedMessage || !selectedChannelId) return;
    // Java canReprocessMessage (Frame.java:4091-4099, MessageBrowser.java:1743-1756): block when the
    // cached message's source connector (metaDataId 0) has no RAW content. Java is lenient when the
    // message isn't cached; fullMessage is always the currently selected message's content (nulled
    // on every selection change), so checking it non-null mirrors that leniency.
    if (fullMessage && !hasRawContent(fullMessage, 0)) {
      toast.error(
        `Message ${selectedMessage.messageId} cannot be reprocessed because no source raw content was found.`
      );
      return;
    }
    setReprocessMode("single");
  }

  async function handleResendMessage(metaDataId?: number) {
    if (!selectedMessage || !selectedChannelId) return;
    setActionLoading(true);
    setActionError("");
    try {
      const fullMsg = await getMessage(selectedChannelId, selectedMessage.messageId);
      // Use the explicitly passed metaDataId (from double-click/context menu), fall back to the
      // currently selected connector, then default to source (0). buildResendInitialData mirrors
      // Java's MessageBrowser double-click: a destination (> 0) scopes content + pre-selection to
      // that one destination; source (0) pre-selects all destinations (null).
      const targetId = metaDataId ?? selectedConnectorMetaDataId ?? 0;
      // Java only opens edit-and-resend when the drilled-into connector has RAW content
      // (MessageBrowser.java:1307). Java no-ops silently; we surface a toast for clarity.
      if (!hasRawContent(fullMsg, targetId)) {
        toast.error(`Message ${selectedMessage.messageId} has no raw content to resend.`);
        return;
      }
      setSendInitialData(buildResendInitialData(fullMsg, targetId));
      setSendDialogOpen(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to load message for resend");
    } finally {
      setActionLoading(false);
    }
  }

  // Fresh "Send Message" (not a resend). Mirrors Java Frame.doSendMessage: resolve the channel's
  // source-connector inbound data type for the editor's syntax highlighting, then open a blank
  // dialog with all destinations pre-selected (destinationMetaDataIds = null).
  async function handleOpenFreshSend() {
    if (!selectedChannelId) return;
    setActionLoading(true);
    setActionError("");
    try {
      const dataType = await resolveSourceInboundDataType(selectedChannelId);
      setSendInitialData({ content: "", dataType, destinationMetaDataIds: null, sourceMap: {} });
      setSendDialogOpen(true);
    } finally {
      setActionLoading(false);
    }
  }

  async function doRemoveMessage() {
    if (!selectedMessage || !selectedChannelId) return;
    setActionLoading(true);
    setActionError("");
    try {
      // Scope the removal to the selected connector (Java Frame.doRemoveMessage). 0 = source =
      // whole message (server cascades to destinations); a destination id removes only that
      // connector message. When CURES PHI logging is on, include the connector's PATIENT_ID so
      // the server's PHI delete-audit records the patient association.
      const metaDataId = selectedConnectorMetaDataId ?? 0;
      let patientId: string | undefined;
      if (isCURESPHILoggingOn) {
        const pid =
          fullMessage?.connectorMessages?.[String(metaDataId)]?.metaDataMap?.["PATIENT_ID"];
        if (pid != null) patientId = String(pid);
      }
      await removeMessage(selectedChannelId, selectedMessage.messageId, metaDataId, patientId);
      setSelectedMessage(null);
      setFullMessage(null);
      setSelectedConnectorMetaDataId(null);
      search(page);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to remove message");
    } finally {
      setActionLoading(false);
    }
  }

  function handleRemoveMessage() {
    if (!selectedMessage || !selectedChannelId) return;
    // Java Frame.doRemoveMessage always confirms a single-message removal; the
    // showReprocessRemoveMessagesWarning preference gates only the bulk type-to-confirm steps.
    setConfirmDialog({
      title: "Remove Message",
      description: (
        <span>
          Are you sure you want to remove message {selectedMessage.messageId}? This action cannot be
          undone.
          <br />
          <br />
          Removing a Source message will also remove all of its destinations.
          <br />
          <br />
          The channel must be stopped to remove a message that is currently being processed.
        </span>
      ),
      onConfirm: async () => {
        setConfirmDialog(null);
        doRemoveMessage();
      },
    });
  }

  function handleRemoveAllMessages() {
    if (!selectedChannelId) return;
    const channelName = channels.get(selectedChannelId) ?? selectedChannelId;
    // Mirror Java Frame.doRemoveAllMessages: the restart checkbox is enabled only when the channel
    // is deployed and not STOPPED. An undeployed channel (absent from dashboard statuses) defaults
    // to "STOPPED" so the dialog disables the checkbox, matching restartCheckboxEnabled = false.
    setRemoveAllTarget({
      channelId: selectedChannelId,
      channelName,
      channelState: selectedChannelState ?? "STOPPED",
    });
  }

  function handleRemoveResults() {
    if (!selectedChannelId) return;
    setRemoveResultsConfirmOpen(true);
  }

  async function doRemoveResults() {
    if (!selectedChannelId || !activeFilterRef.current) return;
    setRemoveResultsConfirmOpen(false);
    setActionLoading(true);
    setActionError("");
    try {
      await removeMessagesByFilter(selectedChannelId, activeFilterRef.current);
      setSelectedMessage(null);
      setFullMessage(null);
      setSelectedConnectorMetaDataId(null);
      search(page);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to remove results");
    } finally {
      setActionLoading(false);
    }
  }

  function handleReprocessResults() {
    if (!selectedChannelId) return;
    setReprocessMode("bulk");
  }

  // Export CSV must use the filter PINNED at search time (activeFilterRef.current,
  // incl. the session maxMessageId), never a freshly rebuilt buildFilter() from live
  // UI state — matching Java doExportMessages/getMessageFilter and the Remove/Reprocess
  // Results paths. Reading buildFilter() here would export criteria that were never
  // searched/displayed (and audited) once the user edits the filter bar without re-searching.
  const handleExportCsv = useCallback(() => {
    // Refuse until the user runs an explicit search: the channel-open auto-load pins a (default)
    // filter, so activeFilterRef being non-null is not a valid "a search has run" signal. Mirrors
    // Java MessageExportDialog.java:185-186 (refuses while isChannelMessagesPanelFirstLoadSearch).
    if (!selectedChannelId || !activeFilterRef.current || !userHasSearchedRef.current) {
      toast.info("There are no messages to export. Please perform a search before exporting.");
      return;
    }
    void exportMessagesCsv(visibleCols, selectedChannelId, activeFilterRef.current);
  }, [selectedChannelId, visibleCols, activeFilterRef, userHasSearchedRef]);

  async function doReprocess(options: ReprocessOptions) {
    if (!selectedChannelId) return;
    const mode = reprocessMode;
    setReprocessMode(null);
    setActionLoading(true);
    setActionError("");
    try {
      if (mode === "single" && selectedMessage) {
        await reprocessMessage(
          selectedChannelId,
          selectedMessage.messageId,
          options.replace,
          options.reprocessMetaDataIds
        );
      } else if (mode === "bulk" && activeFilterRef.current) {
        await reprocessMessagesWithFilter(
          selectedChannelId,
          activeFilterRef.current,
          options.replace,
          options.reprocessMetaDataIds
        );
      }
      search(page);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to reprocess");
    } finally {
      setActionLoading(false);
    }
  }

  return {
    handleSendMessage,
    handleReprocessMessage,
    handleResendMessage,
    handleOpenFreshSend,
    handleRemoveMessage,
    handleRemoveAllMessages,
    handleRemoveResults,
    doRemoveResults,
    handleReprocessResults,
    handleExportCsv,
    doReprocess,
  };
}
