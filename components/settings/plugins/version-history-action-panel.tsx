"use client";

import { RefreshCw, Save } from "lucide-react";
import { AdaptiveBtn } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";

interface VersionHistoryActionPanelProps {
  position: ToolbarPosition;
  save: () => void;
  refresh: () => void;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  viewOnly?: boolean;
}

export function VersionHistoryActionPanel({
  position,
  save,
  refresh,
  dirty,
  saving,
  loading,
  viewOnly = false,
}: VersionHistoryActionPanelProps) {
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
    </>
  );
}
