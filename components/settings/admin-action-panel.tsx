"use client";

import { RefreshCw, RotateCcw, Save } from "lucide-react";
import { AdaptiveBtn, AdaptiveSeparator } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";

interface AdminActionPanelProps {
  position: ToolbarPosition;
  save: () => void;
  refresh: () => void;
  restoreDefaults: () => void;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  viewOnly?: boolean;
}

export function AdminActionPanel({
  position,
  save,
  refresh,
  restoreDefaults,
  dirty,
  saving,
  loading,
  viewOnly = false,
}: AdminActionPanelProps) {
  const orientation: "vertical" | "horizontal" =
    position === "left" || position === "right" ? "vertical" : "horizontal";
  const ro = viewOnly;

  return (
    <>
      <AdaptiveBtn
        orientation={orientation}
        variant="primary"
        onClick={save}
        disabled={!dirty || saving || ro}
        icon={<Save className="w-4 h-4" />}
        label="Save"
        title="Save admin settings"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={refresh}
        disabled={loading}
        icon={<RefreshCw className="w-4 h-4" />}
        label="Refresh"
        title="Refresh admin settings"
      />
      <AdaptiveSeparator orientation={orientation} />
      <AdaptiveBtn
        orientation={orientation}
        onClick={restoreDefaults}
        disabled={ro}
        icon={<RotateCcw className="w-4 h-4" />}
        label="Restore Defaults"
        title="Restore default settings"
      />
    </>
  );
}
