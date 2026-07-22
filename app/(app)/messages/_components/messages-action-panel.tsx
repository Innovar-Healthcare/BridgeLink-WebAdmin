"use client";

import {
  Send,
  RotateCcw,
  Trash2,
  FileInput,
  FileOutput,
  FileSpreadsheet,
  Reply,
} from "lucide-react";
import { AdaptiveBtn, AdaptiveSeparator } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import type { Message } from "@/lib/types";

interface MessagesActionPanelProps {
  position: ToolbarPosition;
  selectedChannelId: string;
  selectedMessage: Message | null;
  hasResults: boolean;
  actionLoading: boolean;
  /**
   * Whether the selected channel is currently deployed. Mirrors Java
   * MessageBrowser.isChannelDeployed (MessageBrowser.java:411-414, 1934-1937): Send and Reprocess
   * are shown only for deployed channels. Resend (a WebUI-only button) is gated the same way since
   * it re-sends to the channel. Import/Export/Remove* are intentionally not deploy-gated.
   */
  isChannelDeployed: boolean;
  onSend: () => void;
  onImport: () => void;
  onExport: () => void;
  onExportCsv: () => void;
  onRemoveAll: () => void;
  onRemoveResults: () => void;
  onRemove: () => void;
  onReprocessResults: () => void;
  onReprocess: () => void;
  onResend: () => void;
}

export function MessagesActionPanel({
  position,
  selectedChannelId,
  selectedMessage,
  hasResults,
  actionLoading,
  isChannelDeployed,
  onSend,
  onImport,
  onExport,
  onExportCsv,
  onRemoveAll,
  onRemoveResults,
  onRemove,
  onReprocessResults,
  onReprocess,
  onResend,
}: MessagesActionPanelProps) {
  const orientation: "vertical" | "horizontal" =
    position === "left" || position === "right" ? "vertical" : "horizontal";
  const hasChannel = !!selectedChannelId;
  const hasMessage = !!selectedMessage;

  return (
    <>
      {/* Send / Import / Export */}
      <AdaptiveBtn
        orientation={orientation}
        onClick={onSend}
        disabled={!hasChannel || !isChannelDeployed || actionLoading}
        icon={<Send className="w-4 h-4" />}
        label="Send"
        title={
          hasChannel && !isChannelDeployed
            ? "Channel must be deployed to send a message"
            : "Send a message to the selected channel"
        }
      />
      <AdaptiveSeparator orientation={orientation} />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onImport}
        disabled={!hasChannel || actionLoading}
        icon={<FileInput className="w-4 h-4" />}
        label="Import"
        title="Import messages from a file"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onExport}
        disabled={!hasResults || actionLoading}
        icon={<FileOutput className="w-4 h-4" />}
        label="Export"
        title="Export all messages in the current search"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onExportCsv}
        disabled={!hasResults || actionLoading}
        icon={<FileSpreadsheet className="w-4 h-4" />}
        label="Export CSV"
        title="Export the current table view to a CSV file"
      />
      <AdaptiveSeparator orientation={orientation} />
      {/* Remove group */}
      <AdaptiveBtn
        orientation={orientation}
        variant="destructive"
        onClick={onRemoveAll}
        disabled={!hasChannel || actionLoading}
        icon={<Trash2 className="w-4 h-4" />}
        label="Remove All"
        title="Remove all messages in this channel"
      />
      <AdaptiveBtn
        orientation={orientation}
        variant="destructive"
        onClick={onRemoveResults}
        disabled={!hasResults || actionLoading}
        icon={<Trash2 className="w-4 h-4" />}
        label="Remove Results"
        title="Remove all messages in the current search"
      />
      <AdaptiveBtn
        orientation={orientation}
        variant="destructive"
        onClick={onRemove}
        disabled={!hasMessage || actionLoading}
        icon={<Trash2 className="w-4 h-4" />}
        label="Remove Msg"
        title="Remove the selected message"
      />
      <AdaptiveSeparator orientation={orientation} />
      {/* Reprocess group */}
      <AdaptiveBtn
        orientation={orientation}
        onClick={onReprocessResults}
        disabled={!hasResults || !isChannelDeployed || actionLoading}
        icon={<RotateCcw className="w-4 h-4" />}
        label="Reprocess Results"
        title={
          hasResults && !isChannelDeployed
            ? "Channel must be deployed to reprocess"
            : "Reprocess all messages in the current search"
        }
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onReprocess}
        disabled={!hasMessage || !isChannelDeployed || actionLoading}
        icon={<RotateCcw className="w-4 h-4" />}
        label="Reprocess Msg"
        title={
          hasMessage && !isChannelDeployed
            ? "Channel must be deployed to reprocess"
            : "Reprocess the selected message"
        }
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onResend}
        disabled={!hasMessage || !isChannelDeployed || actionLoading}
        icon={<Reply className="w-4 h-4" />}
        label="Resend Msg"
        title={
          hasMessage && !isChannelDeployed
            ? "Channel must be deployed to resend"
            : "Resend the selected message (opens Send Message dialog pre-populated)"
        }
      />
    </>
  );
}
