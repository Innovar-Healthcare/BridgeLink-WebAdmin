"use client";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { SendMessageDialog } from "@/components/messages/send-message-dialog";
import {
  ClearStatisticsDialog,
  QueueDisabledWarningDialog,
  RemoveAllMessagesDialog,
} from "./dashboard-dialogs";
import { DependencyWarningDialog } from "./dependency-warning-dialog";
import { ChannelThreadsDialog } from "./channel-threads-dialog";
import { serverSupportsStuckChannelDiagnostics } from "@/lib/api/api-dashboard";
import type { useDashboardActions } from "@/lib/hooks/use-dashboard-actions";

type Actions = ReturnType<typeof useDashboardActions>;

interface DashboardDialogHostProps {
  actions: Pick<
    Actions,
    | "sendDialogTarget"
    | "setSendDialogTarget"
    | "handleDashboardSendMessage"
    | "showQueueDisabledWarning"
    | "setShowQueueDisabledWarning"
    | "clearStatsTarget"
    | "setClearStatsTarget"
    | "removeAllTarget"
    | "setRemoveAllTarget"
    | "depPrompt"
    | "threadsTarget"
    | "setThreadsTarget"
    | "haltConfirm"
    | "confirmHalt"
    | "cancelHalt"
  >;
  /** Refreshes the dashboard after a dialog changed server state. */
  load: () => Promise<void>;
}

/**
 * Every dialog the dashboard page hosts, driven by the state in useDashboardActions. Lives here
 * so page.tsx stays under the ESLint line budget. The halt confirmation mirrors the Java client's
 * "Are you sure you want to halt this channel?" (Frame.doHalt) and adds what a halt costs, because
 * a bounded halt can abandon threads.
 */
export function DashboardDialogHost({ actions, load }: DashboardDialogHostProps) {
  const {
    sendDialogTarget,
    setSendDialogTarget,
    handleDashboardSendMessage,
    showQueueDisabledWarning,
    setShowQueueDisabledWarning,
    clearStatsTarget,
    setClearStatsTarget,
    removeAllTarget,
    setRemoveAllTarget,
    depPrompt,
    threadsTarget,
    setThreadsTarget,
    haltConfirm,
    confirmHalt,
    cancelHalt,
  } = actions;

  return (
    <>
      {sendDialogTarget && (
        <SendMessageDialog
          open
          onOpenChange={(open) => {
            if (!open) setSendDialogTarget(null);
          }}
          channelName={sendDialogTarget.channelName}
          connectors={sendDialogTarget.connectors}
          onSend={handleDashboardSendMessage}
        />
      )}
      {showQueueDisabledWarning && (
        <QueueDisabledWarningDialog onClose={() => setShowQueueDisabledWarning(false)} />
      )}
      {clearStatsTarget && (
        <ClearStatisticsDialog
          channelId={clearStatsTarget.channelId}
          channelIds={clearStatsTarget.channelIds}
          channelName={clearStatsTarget.channelName}
          metaDataId={clearStatsTarget.metaDataId}
          onClose={() => setClearStatsTarget(null)}
          onDone={() => {
            setClearStatsTarget(null);
            load();
          }}
        />
      )}
      {removeAllTarget && (
        <RemoveAllMessagesDialog
          channels={removeAllTarget.channels}
          onClose={() => setRemoveAllTarget(null)}
          onDone={() => {
            setRemoveAllTarget(null);
            load();
          }}
        />
      )}
      {depPrompt && (
        <DependencyWarningDialog
          task={depPrompt.task}
          additionalChannels={depPrompt.additionalChannels}
          onResolve={depPrompt.onResolve}
        />
      )}
      {threadsTarget && (
        <ChannelThreadsDialog
          channelId={threadsTarget.channelId}
          channelName={threadsTarget.channelName}
          onClose={() => setThreadsTarget(null)}
        />
      )}
      {haltConfirm && (
        <ConfirmDialog
          title={
            haltConfirm.channelIds.length === 1
              ? "Are you sure you want to halt this channel?"
              : `Are you sure you want to halt these ${haltConfirm.channelIds.length} channels?`
          }
          description={
            <div className="space-y-2 text-sm">
              <p>
                Halt interrupts processing immediately instead of waiting for it to finish. No
                message is lost, but a message that was mid-delivery may be delivered a second time
                after the channel is started again.
              </p>
              {/* Bounded halt and the diagnostics view are 26.9 behaviour. On an older Core the
                  halt is still unbounded, so describing abandonment would be wrong and would point
                  at a view that is not there. The duplicate warning above holds on every version. */}
              {serverSupportsStuckChannelDiagnostics() && (
                <p>
                  A thread that does not respond within the stop grace period is abandoned: the
                  channel is marked Stopped anyway and the thread stays visible in Thread
                  Diagnostics until it finishes on its own.
                </p>
              )}
            </div>
          }
          confirmLabel="Halt"
          cancelLabel="Cancel"
          onConfirm={confirmHalt}
          onCancel={cancelHalt}
        />
      )}
    </>
  );
}
