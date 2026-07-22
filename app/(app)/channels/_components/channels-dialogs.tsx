"use client";

import React from "react";
import type { Channel, ChannelGroup } from "@/lib/types";
import { ImportChannelDialog } from "../_dialogs/import-channel-dialog";
import { ImportGroupDialog } from "../_dialogs/import-group-dialog";
import { NewGroupDialog } from "../_dialogs/new-group-dialog";
import { EditGroupDialog } from "../_dialogs/edit-group-dialog";
import { AssignGroupDialog } from "../_dialogs/assign-group-dialog";
import { ExportChannelDialog } from "../_dialogs/export-channel-dialog";
import { ExportChannelsDialog, type ExportChannelSpec } from "../_dialogs/export-channels-dialog";
import { ExportGroupsDialog, type ExportGroupSpec } from "../_dialogs/export-groups-dialog";
import { CloneChannelDialog } from "../_dialogs/clone-channel-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { InfoDialog } from "@/components/info-dialog";
import type { ConfirmDialogState, EnableReportState } from "../_lib/use-channel-operations";
import { pluginSlots } from "@/lib/plugin-slots";
import { useSlotEnabled } from "@/lib/plugin-gating";

interface ChannelsDialogsProps {
  channels: Channel[];
  channelGroups: ChannelGroup[];
  refresh: () => void;
  // Import
  importOpen: boolean;
  setImportOpen: (v: boolean) => void;
  importGroupOpen: boolean;
  setImportGroupOpen: (v: boolean) => void;
  importFromRepoOpen: boolean;
  setImportFromRepoOpen: (v: boolean) => void;
  // Groups
  newGroupOpen: boolean;
  setNewGroupOpen: (v: boolean) => void;
  assignGroupOpen: boolean;
  setAssignGroupOpen: (v: boolean) => void;
  assignGroupIds: Set<string>;
  editGroupOpen: boolean;
  setEditGroupOpen: (v: boolean) => void;
  editingGroup: ChannelGroup | null;
  setEditingGroup: (v: ChannelGroup | null) => void;
  // Clone
  cloneOpen: boolean;
  setCloneOpen: (v: boolean) => void;
  cloneSourceId: string;
  cloneSourceName: string;
  // Export single
  exportOpen: boolean;
  setExportOpen: (v: boolean) => void;
  exportChannelId: string;
  exportChannelName: string;
  // Export multiple
  exportChannelsOpen: boolean;
  setExportChannelsOpen: (v: boolean) => void;
  exportChannelsSpecs: ExportChannelSpec[];
  // Export groups
  exportGroupsOpen: boolean;
  setExportGroupsOpen: (v: boolean) => void;
  exportGroupSpecs: ExportGroupSpec[];
  // Confirm
  confirmDialog: ConfirmDialogState;
  setConfirmDialog: React.Dispatch<React.SetStateAction<ConfirmDialogState>>;
  // Enable-validation failure report
  enableReport: EnableReportState;
  setEnableReport: React.Dispatch<React.SetStateAction<EnableReportState>>;
}

export function ChannelsDialogs({
  channels,
  channelGroups,
  refresh,
  importOpen,
  setImportOpen,
  importGroupOpen,
  setImportGroupOpen,
  importFromRepoOpen,
  setImportFromRepoOpen,
  newGroupOpen,
  setNewGroupOpen,
  assignGroupOpen,
  setAssignGroupOpen,
  assignGroupIds,
  editGroupOpen,
  setEditGroupOpen,
  editingGroup,
  setEditingGroup,
  cloneOpen,
  setCloneOpen,
  cloneSourceId,
  cloneSourceName,
  exportOpen,
  setExportOpen,
  exportChannelId,
  exportChannelName,
  exportChannelsOpen,
  setExportChannelsOpen,
  exportChannelsSpecs,
  exportGroupsOpen,
  setExportGroupsOpen,
  exportGroupSpecs,
  confirmDialog,
  setConfirmDialog,
  enableReport,
  setEnableReport,
}: ChannelsDialogsProps) {
  const ImportFromRepoDialog = pluginSlots["channels.import-repo-dialog"];
  const importFromRepoEnabled = useSlotEnabled("channels.import-repo-dialog");
  return (
    <>
      <ImportChannelDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        existingNames={new Set(channels.map((c) => String(c.name).toLowerCase()))}
        existingChannels={
          new Map(
            channels.map((c) => [String(c.name).toLowerCase(), { id: c.id, revision: c.revision }])
          )
        }
      />
      <ImportGroupDialog
        open={importGroupOpen}
        onClose={() => setImportGroupOpen(false)}
        channels={channels}
        existingGroups={channelGroups}
        refresh={refresh}
      />
      {ImportFromRepoDialog && importFromRepoEnabled && (
        <ImportFromRepoDialog open={importFromRepoOpen} onOpenChange={setImportFromRepoOpen} />
      )}
      <NewGroupDialog
        open={newGroupOpen}
        onClose={() => setNewGroupOpen(false)}
        onCreated={refresh}
        existingGroups={channelGroups}
      />
      <AssignGroupDialog
        open={assignGroupOpen}
        onClose={() => setAssignGroupOpen(false)}
        onAssigned={refresh}
        selectedIds={assignGroupIds}
        channelGroups={channelGroups}
      />
      <EditGroupDialog
        open={editGroupOpen}
        onClose={() => {
          setEditGroupOpen(false);
          setEditingGroup(null);
        }}
        onSaved={refresh}
        group={editingGroup}
        channelGroups={channelGroups}
      />
      <CloneChannelDialog
        open={cloneOpen}
        onClose={() => setCloneOpen(false)}
        onCloned={refresh}
        sourceName={cloneSourceName}
        sourceId={cloneSourceId}
        existingNames={new Set(channels.map((c) => String(c.name).toLowerCase()))}
      />
      <ExportChannelDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        channelId={exportChannelId}
        channelName={exportChannelName}
      />
      <ExportChannelsDialog
        open={exportChannelsOpen}
        onClose={() => setExportChannelsOpen(false)}
        channels={exportChannelsSpecs}
      />
      <ExportGroupsDialog
        open={exportGroupsOpen}
        onClose={() => setExportGroupsOpen(false)}
        specs={exportGroupSpecs}
      />
      {confirmDialog.open && (
        <ConfirmDialog
          title={confirmDialog.title}
          description={confirmDialog.description}
          confirmLabel={confirmDialog.confirmLabel}
          confirmVariant={confirmDialog.confirmVariant}
          onConfirm={() => {
            setConfirmDialog((d) => ({ ...d, open: false }));
            confirmDialog.onConfirm();
          }}
          onCancel={() => setConfirmDialog((d) => ({ ...d, open: false }))}
        />
      )}
      {/* Enable-validation failure report — mirrors Java doEnableChannel. */}
      <InfoDialog
        open={enableReport.open}
        onOpenChange={(open) => setEnableReport((r) => ({ ...r, open }))}
        title={
          enableReport.failures.length === 1 ? "Cannot Enable Channel" : "Some Channels Not Enabled"
        }
      >
        {enableReport.failures.length === 1 ? (
          <div className="space-y-2 text-sm">
            <p>
              The channel was not configured properly. Please fix the following problem(s) in the
              channel before trying to enable it again:
            </p>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted p-2 text-xs">
              {enableReport.failures[0].messages.join("\n")}
            </pre>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p>The following channels are invalid or not configured properly:</p>
            <ul className="max-h-60 overflow-auto space-y-1">
              {enableReport.failures.map((f) => (
                <li key={f.id} className="font-mono text-xs">
                  {f.name} ({f.id})
                </li>
              ))}
            </ul>
          </div>
        )}
      </InfoDialog>
    </>
  );
}
