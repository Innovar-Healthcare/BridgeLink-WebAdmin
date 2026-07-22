"use client";

import { useState, useCallback } from "react";
import type { DashboardStatus, DeployedState } from "@/lib/types";
import type { ConnectorInfo } from "@/components/messages/advanced-filter-panel";
import type { ChannelAction } from "@/app/(app)/dashboard/_components/dashboard-row";
import { getCache } from "@/lib/cache-store";
import { expandWithDependencies, type DependencyTask } from "@/lib/dependency-graph";
import type {
  DependencyWarningChannel,
  DependencyWarningDecision,
} from "@/app/(app)/dashboard/_components/dependency-warning-dialog";
import { useNavigatingRouter } from "@/lib/hooks/use-navigating-router";
import {
  startChannels,
  stopChannels,
  pauseChannels,
  resumeChannels,
  haltChannels,
  undeployChannels,
  stopConnector,
  startConnector,
  sendMessagesInBackground,
} from "@/lib/api-client";
import { toast } from "sonner";

// ─── Action-outcome verification ──────────────────────────────────────────────

/**
 * Accepted channel states after an action, used to detect silent server-side
 * failures (some errors are handled asynchronously and never surface as HTTP
 * errors). Includes the transitional in-progress state (STARTING/STOPPING/
 * PAUSING) alongside the terminal target: state transitions are async and the
 * request returns before the channel settles, so an immediate read often catches
 * the in-progress state — which is success-in-progress, not a failure. A genuine
 * failure leaves the channel in its original state (e.g. a failed pause stays
 * STARTED), which is not accepted here and so is correctly flagged.
 */
const ACTION_ACCEPTED_STATES: Partial<Record<ChannelAction, DeployedState[]>> = {
  start: ["STARTED", "STARTING"],
  stop: ["STOPPED", "STOPPING"],
  pause: ["PAUSED", "PAUSING"],
  resume: ["STARTED", "STARTING"],
};

/**
 * Whether `state` indicates `action` succeeded or is still legitimately in
 * progress. Returns true for actions with no tracked outcome (halt/undeploy).
 */
export function isActionOutcomeAcceptable(action: ChannelAction, state: DeployedState): boolean {
  const accepted = ACTION_ACCEPTED_STATES[action];
  return !accepted || accepted.includes(state);
}

// ─── Dependency-aware actions ─────────────────────────────────────────────────

/**
 * Maps each dashboard action to the dependency-expansion task. Actions absent
 * here (only `halt`) do NOT expand along the dependency chain, matching the Java
 * client where Frame.doHalt skips getStatusesWithDependencies.
 */
const ACTION_DEP_TASK: Partial<Record<ChannelAction, DependencyTask>> = {
  start: "start",
  resume: "resume",
  stop: "stop",
  pause: "pause",
  undeploy: "undeploy",
};

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Manages dashboard channel/connector operations and dialog state:
 * - Channel start/stop/pause/resume/halt/undeploy with silent-failure detection
 * - Connector start/stop with silent-failure detection
 * - Send message, clear stats, remove all messages dialogs
 * - Bottom panel channel/connector selection
 */
export function useDashboardActions(statuses: DashboardStatus[], load: () => Promise<void>) {
  const { push } = useNavigatingRouter();

  // ── Bottom panel selection ──────────────────────────────────────────────
  const [selectedChannelId, setSelectedChannelId] = useState<string | undefined>(undefined);
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | undefined>(undefined);

  const onSelectChannel = useCallback((chId: string, connId?: string) => {
    setSelectedChannelId(chId);
    setSelectedConnectorId(connId);
  }, []);

  // ── Dialog state ────────────────────────────────────────────────────────
  const [sendDialogTarget, setSendDialogTarget] = useState<{
    channelId: string;
    channelName: string;
    connectors: ConnectorInfo[];
  } | null>(null);
  const [showQueueDisabledWarning, setShowQueueDisabledWarning] = useState(false);
  const [clearStatsTarget, setClearStatsTarget] = useState<{
    channelId: string;
    /** When set, clears stats for all listed channels (group-level) */
    channelIds?: string[];
    metaDataId: number | null;
    channelName: string;
  } | null>(null);
  const [removeAllTarget, setRemoveAllTarget] = useState<{
    channels: { channelId: string; channelName: string; channelState: string }[];
  } | null>(null);
  // Open dependency-chain warning prompt (null when not shown). onResolve is the
  // promise resolver wired up by resolveTargetsWithDeps below.
  const [depPrompt, setDepPrompt] = useState<{
    task: DependencyTask;
    additionalChannels: DependencyWarningChannel[];
    onResolve: (decision: DependencyWarningDecision) => void;
  } | null>(null);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleViewMessages = useCallback(
    (channelId: string, metaDataId?: number) => {
      const params = new URLSearchParams({ channelId });
      if (metaDataId !== undefined) params.set("metaDataId", String(metaDataId));
      push(`/messages?${params.toString()}`);
    },
    [push]
  );

  const handleOpenSendMessage = useCallback(
    (channelId: string, channelName: string) => {
      // Build connector list from the channel's child statuses (destination connectors only)
      const channelStatus = statuses.find((s) => s.channelId === channelId);
      const connectors: ConnectorInfo[] = (channelStatus?.childStatuses ?? [])
        .filter((c) => c.statusType === "DESTINATION_CONNECTOR" && (c.metaDataId ?? 0) > 0)
        .map((c) => ({ metaDataId: c.metaDataId ?? 0, name: c.name }));
      setSendDialogTarget({ channelId, channelName, connectors });
    },
    [statuses]
  );

  const handleDashboardSendMessage = useCallback(
    (
      contents: string[],
      destinationMetaDataIds: number[] | null,
      sourceMap: Record<string, string>
    ) => {
      const target = sendDialogTarget;
      if (!target) return;
      // Fire-and-forget, mirroring the Java client's SwingWorker: the dialog closes
      // immediately and processing continues in the background. Awaiting the blocking
      // processMessage request inline would freeze the dialog — and back-pressure
      // other tabs sharing the session — for the whole server-side processing time.
      void sendMessagesInBackground(target.channelId, contents, {
        destinationMetaDataIds: destinationMetaDataIds ?? undefined,
        sourceMap,
        onSuccess: (n) =>
          toast.success(
            n > 1
              ? `${n} messages sent to "${target.channelName}".`
              : `Message sent to "${target.channelName}".`
          ),
        onError: (m) => toast.error(`Failed to send message to "${target.channelName}": ${m}`),
      });
    },
    [sendDialogTarget]
  );

  const handleClearStats = useCallback(
    (channelId: string, metaDataId: number | null, channelName: string) => {
      setClearStatsTarget({ channelId, metaDataId, channelName });
    },
    []
  );

  const handleRemoveAllMessages = useCallback(
    (channels: { channelId: string; channelName: string; channelState: string }[]) => {
      setRemoveAllTarget({ channels });
    },
    []
  );

  // ── Connector start/stop ────────────────────────────────────────────────

  const handleStopConnector = useCallback(
    async (channelId: string, metaDataId: number) => {
      try {
        await stopConnector(channelId, metaDataId);
        await load();
        // Check if the connector actually stopped (server may swallow errors)
        const fresh = getCache().dashboardStatuses;
        const ch = fresh.find((s) => s.channelId === channelId);
        const conn = ch?.childStatuses?.find((c) => c.metaDataId === metaDataId);
        if (conn && conn.state === "STARTED") {
          toast.warning(
            `Connector "${conn.name}" did not stop successfully. Check the server log for details.`
          );
        }
      } catch (e) {
        toast.error(`Operation failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [load]
  );

  const handleStartConnector = useCallback(
    async (channelId: string, metaDataId: number) => {
      try {
        await startConnector(channelId, metaDataId);
        await load();
        // Check if the connector actually started (server may swallow errors)
        const fresh = getCache().dashboardStatuses;
        const ch = fresh.find((s) => s.channelId === channelId);
        const conn = ch?.childStatuses?.find((c) => c.metaDataId === metaDataId);
        if (conn && conn.state === "STOPPED") {
          toast.warning(
            `Connector "${conn.name}" did not start successfully. Check the server log for details.`
          );
        }
      } catch (e) {
        toast.error(`Operation failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [load]
  );

  // ── Dependency expansion + prompt ───────────────────────────────────────

  /**
   * Resolves the final set of channel IDs an action should target, expanding
   * along the dependency chain and prompting the user when extra channels are
   * pulled in (mirrors Frame.getStatusesWithDependencies). Returns the original
   * selection unchanged when nothing extra is pulled in, the expanded/selected
   * set after the prompt, or `null` when the user cancels (abort the action).
   */
  const resolveTargetsWithDeps = useCallback(
    (selectedIds: string[], task: DependencyTask): Promise<string[] | null> => {
      const stateByChannelId = new Map<string, DeployedState>();
      const nameByChannelId = new Map<string, string>();
      for (const s of statuses) {
        if (s.statusType && s.statusType !== "CHANNEL") continue; // channel-level rows only
        stateByChannelId.set(s.channelId, s.state);
        nameByChannelId.set(s.channelId, s.name);
      }

      const { added } = expandWithDependencies(
        selectedIds,
        stateByChannelId,
        getCache().channelDependencies,
        task
      );
      if (added.size === 0) return Promise.resolve(selectedIds);

      const additionalChannels: DependencyWarningChannel[] = [...added]
        .map((id) => ({ id, name: nameByChannelId.get(id) ?? id }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return new Promise<string[] | null>((resolve) => {
        setDepPrompt({
          task,
          additionalChannels,
          onResolve: ({ proceed, include }) => {
            setDepPrompt(null);
            if (!proceed) resolve(null);
            else resolve(include ? [...selectedIds, ...added] : selectedIds);
          },
        });
      });
    },
    [statuses]
  );

  /**
   * Start or resume a set of channels, routing each to the correct endpoint by
   * current state (STOPPED → _start, PAUSED → _resume). Mirrors Java's single
   * START_RESUME task that handles both.
   */
  const startResume = useCallback(
    async (ids: string[]) => {
      const stopped = ids.filter(
        (id) => statuses.find((st) => st.channelId === id)?.state === "STOPPED"
      );
      const paused = ids.filter(
        (id) => statuses.find((st) => st.channelId === id)?.state === "PAUSED"
      );
      if (stopped.length > 0) await startChannels(stopped);
      if (paused.length > 0) await resumeChannels(paused);
    },
    [statuses]
  );

  // ── Group-level actions ────────────────────────────────────────────────

  const handleGroupAction = useCallback(
    async (channelIds: string[], action: ChannelAction) => {
      if (channelIds.length === 0) return;

      let targets = channelIds;
      const depTask = ACTION_DEP_TASK[action];
      if (depTask) {
        const resolved = await resolveTargetsWithDeps(channelIds, depTask);
        if (resolved === null) return; // user cancelled
        targets = resolved;
      }

      try {
        switch (action) {
          case "start":
          case "resume":
            await startResume(targets);
            break;
          case "stop":
            await stopChannels(targets);
            break;
          case "pause":
            await pauseChannels(targets);
            break;
          case "halt":
            await haltChannels(targets);
            break;
          case "undeploy":
            await undeployChannels(targets);
            break;
        }
        await load();
        toast.success(
          `${action.charAt(0).toUpperCase() + action.slice(1)} completed for ${targets.length} channel(s)`
        );
      } catch (e) {
        toast.error(`Operation failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [load, resolveTargetsWithDeps, startResume]
  );

  const handleGroupClearStats = useCallback((channelIds: string[], groupName: string) => {
    if (channelIds.length === 0) return;
    setClearStatsTarget({
      channelId: channelIds[0],
      channelIds,
      metaDataId: null,
      channelName: groupName,
    });
  }, []);

  // ── Channel actions ─────────────────────────────────────────────────────

  const handleChannelAction = useCallback(
    async (channelId: string, action: ChannelAction) => {
      let targets = [channelId];
      const depTask = ACTION_DEP_TASK[action];
      if (depTask) {
        const resolved = await resolveTargetsWithDeps([channelId], depTask);
        if (resolved === null) return; // user cancelled
        targets = resolved;
      }

      try {
        switch (action) {
          case "start":
          case "resume":
            // PAUSED → _resume, STOPPED → _start (per channel state).
            await startResume(targets);
            break;
          case "stop":
            await stopChannels(targets);
            break;
          case "pause":
            await pauseChannels(targets);
            break;
          case "halt":
            await haltChannels(targets);
            break;
          case "undeploy":
            await undeployChannels(targets);
            break;
        }
        await load();

        // Verify the action took effect by reading the freshly-cached state for
        // the channel the user clicked (see ACTION_ACCEPTED_STATES /
        // isActionOutcomeAcceptable above for why transitional in-progress states
        // are treated as success-in-progress).
        if (action in ACTION_ACCEPTED_STATES) {
          const fresh = getCache().dashboardStatuses;
          const ch = fresh.find((s) => s.channelId === channelId);
          if (ch && !isActionOutcomeAcceptable(action, ch.state)) {
            toast.warning(
              `Channel "${ch.name}" did not ${action} successfully. Check the server log for details.`
            );
          }
        }
      } catch (e) {
        toast.error(`Operation failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [load, resolveTargetsWithDeps, startResume]
  );

  // Context-menu Clear Statistics / Remove All Messages, selection-aware: when the
  // right-clicked row is part of a multi-selection, act on EVERY selected channel
  // (mirrors the toolbar + the Java client). Resolves the channel set from
  // `statuses` since the row only knows its own status.
  const handleGroupClearStatsForSelection = useCallback(
    (channelIds: string[]) => {
      handleGroupClearStats(
        channelIds,
        `${channelIds.length} channel${channelIds.length !== 1 ? "s" : ""}`
      );
    },
    [handleGroupClearStats]
  );

  const handleGroupRemoveAllMessagesForSelection = useCallback(
    (channelIds: string[]) => {
      const chans = statuses
        .filter(
          (s) => (s.statusType === "CHANNEL" || !s.statusType) && channelIds.includes(s.channelId)
        )
        .map((s) => ({ channelId: s.channelId, channelName: s.name, channelState: s.state ?? "" }));
      if (chans.length) handleRemoveAllMessages(chans);
    },
    [statuses, handleRemoveAllMessages]
  );

  return {
    // Selection
    selectedChannelId,
    selectedConnectorId,
    onSelectChannel,
    // Dialog state
    sendDialogTarget,
    setSendDialogTarget,
    showQueueDisabledWarning,
    setShowQueueDisabledWarning,
    clearStatsTarget,
    setClearStatsTarget,
    removeAllTarget,
    setRemoveAllTarget,
    depPrompt,
    // Handlers
    handleViewMessages,
    handleOpenSendMessage,
    handleDashboardSendMessage,
    handleClearStats,
    handleRemoveAllMessages,
    handleStopConnector,
    handleStartConnector,
    handleChannelAction,
    handleGroupAction,
    handleGroupClearStats,
    handleGroupClearStatsForSelection,
    handleGroupRemoveAllMessagesForSelection,
  };
}
