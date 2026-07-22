"use client";

import { RefreshCw, Save } from "lucide-react";
import { AdaptiveBtn } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";

interface TagsActionPanelProps {
  position: ToolbarPosition;
  save: () => void;
  refresh: () => void;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  viewOnly?: boolean;
}

export function TagsActionPanel({
  position,
  save,
  refresh,
  dirty,
  saving,
  loading,
  viewOnly = false,
}: TagsActionPanelProps) {
  const orientation: "vertical" | "horizontal" =
    position === "left" || position === "right" ? "vertical" : "horizontal";
  const ro = viewOnly;

  return (
    <>
      <AdaptiveBtn
        orientation={orientation}
        variant="primary"
        onClick={save}
        disabled={!dirty || saving || loading || ro}
        icon={<Save className="w-4 h-4" />}
        label="Save"
        title="Save tags"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={refresh}
        disabled={loading}
        icon={<RefreshCw className="w-4 h-4" />}
        label="Refresh"
        title="Refresh tags"
      />
    </>
  );
}
