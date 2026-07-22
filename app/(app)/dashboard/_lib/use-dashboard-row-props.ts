"use client";

import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import type { RowProps } from "../_components/dashboard-row";

/** The subset of DashboardRow props shared by every row (everything except the
 *  per-row `status`/`depth`/`inGroup`). */
export type SharedRowProps = Omit<RowProps, "status" | "depth" | "inGroup">;

type Inputs = Omit<SharedRowProps, "onStopConnectorQueueDisabled"> & {
  setShowQueueDisabledWarning: Dispatch<SetStateAction<boolean>>;
};

/**
 * Builds the memoized props object spread onto every DashboardRow. Memoizing it
 * (and stabilizing the one inline handler) is what lets React.memo'd rows skip
 * re-rendering when the page re-renders on a no-op poll tick.
 */
export function useDashboardRowProps(inputs: Inputs): SharedRowProps {
  const {
    expanded,
    onToggle,
    tagMap,
    tagDisplayMode,
    visibleCols,
    mounted,
    selectedIds,
    selectedConnector,
    onRowClick,
    statsMode,
    portMap,
    connectorStates,
    trendSummary,
    trendLoading,
    onChannelAction,
    onGroupAction,
    onViewMessages,
    onSendMessage,
    onClearStats,
    onRemoveAllMessages,
    onGroupClearStats,
    onGroupRemoveAllMessages,
    onStopConnector,
    onStartConnector,
    globalDensity,
    setShowQueueDisabledWarning,
  } = inputs;

  const onStopConnectorQueueDisabled = useCallback(
    () => setShowQueueDisabledWarning(true),
    [setShowQueueDisabledWarning]
  );

  return useMemo(
    () => ({
      expanded,
      onToggle,
      tagMap,
      tagDisplayMode,
      visibleCols,
      mounted,
      selectedIds,
      selectedConnector,
      onRowClick,
      statsMode,
      portMap,
      connectorStates,
      trendSummary,
      trendLoading,
      onChannelAction,
      onGroupAction,
      onViewMessages,
      onSendMessage,
      onClearStats,
      onRemoveAllMessages,
      onGroupClearStats,
      onGroupRemoveAllMessages,
      onStopConnector,
      onStopConnectorQueueDisabled,
      onStartConnector,
      globalDensity,
    }),
    [
      expanded,
      onToggle,
      tagMap,
      tagDisplayMode,
      visibleCols,
      mounted,
      selectedIds,
      selectedConnector,
      onRowClick,
      statsMode,
      portMap,
      connectorStates,
      trendSummary,
      trendLoading,
      onChannelAction,
      onGroupAction,
      onViewMessages,
      onSendMessage,
      onClearStats,
      onRemoveAllMessages,
      onGroupClearStats,
      onGroupRemoveAllMessages,
      onStopConnector,
      onStopConnectorQueueDisabled,
      onStartConnector,
      globalDensity,
    ]
  );
}
