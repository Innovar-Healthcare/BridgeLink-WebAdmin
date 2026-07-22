"use client";

import { Play, RefreshCw, Save, ScrollText, Square, Undo2 } from "lucide-react";
import { AdaptiveBtn, AdaptiveSeparator } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";

interface DataPrunerActionPanelProps {
  position: ToolbarPosition;
  save: () => void;
  refresh: () => void;
  discard: () => void;
  viewEvents: () => void;
  pruneNow: () => void;
  stop: () => void;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  isRunning: boolean;
  actionLoading: boolean;
  /** False when the pruner status is unknown — Prune Now / Stop are hidden (Java parity). */
  statusKnown?: boolean;
  viewOnly?: boolean;
}

export function DataPrunerActionPanel({
  position,
  save,
  refresh,
  discard,
  viewEvents,
  pruneNow,
  stop,
  dirty,
  saving,
  loading,
  isRunning,
  actionLoading,
  statusKnown = true,
  viewOnly = false,
}: DataPrunerActionPanelProps) {
  const orientation: "vertical" | "horizontal" =
    position === "left" || position === "right" ? "vertical" : "horizontal";
  const ro = viewOnly;

  return (
    <>
      <AdaptiveBtn
        orientation={orientation}
        onClick={save}
        disabled={!dirty || saving || ro}
        variant="primary"
        icon={<Save className="w-4 h-4" />}
        label={saving ? "Saving..." : "Save"}
        title="Save settings"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={refresh}
        disabled={loading}
        icon={<RefreshCw className="w-4 h-4" />}
        label="Refresh"
        title="Refresh settings"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={viewEvents}
        icon={<ScrollText className="w-4 h-4" />}
        label="View Events"
        title="View the Data Pruner events"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={discard}
        disabled={!dirty || loading}
        icon={<Undo2 className="w-4 h-4" />}
        label="Discard"
        title="Discard unsaved changes"
      />
      {statusKnown && (
        <>
          <AdaptiveSeparator orientation={orientation} />
          {isRunning ? (
            <AdaptiveBtn
              orientation={orientation}
              variant="destructive"
              onClick={stop}
              disabled={actionLoading || ro}
              icon={<Square className="w-4 h-4" />}
              label="Stop Pruner"
              title="Stop the running pruner"
            />
          ) : (
            <AdaptiveBtn
              orientation={orientation}
              onClick={pruneNow}
              disabled={actionLoading || ro}
              icon={<Play className="w-4 h-4" />}
              label="Prune Now"
              title="Start pruning now"
            />
          )}
        </>
      )}
    </>
  );
}
