"use client";

import { Minus, Plus, RefreshCw, RotateCw, Save } from "lucide-react";
import { AdaptiveBtn, AdaptiveSeparator } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";

interface ResourcesActionPanelProps {
  position: ToolbarPosition;
  save: () => void;
  refresh: () => void;
  addResource: () => void;
  removeResource: () => void;
  reloadResource: () => void;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  canRemove: boolean;
  canReload: boolean;
  reloading: boolean;
  viewOnly?: boolean;
}

export function ResourcesActionPanel({
  position,
  save,
  refresh,
  addResource,
  removeResource,
  reloadResource,
  dirty,
  saving,
  loading,
  canRemove,
  canReload,
  reloading,
  viewOnly = false,
}: ResourcesActionPanelProps) {
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
        title="Save resources"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={refresh}
        disabled={loading}
        icon={<RefreshCw className="w-4 h-4" />}
        label="Refresh"
        title="Refresh resources"
      />
      <AdaptiveSeparator orientation={orientation} />
      <AdaptiveBtn
        orientation={orientation}
        onClick={addResource}
        disabled={ro}
        icon={<Plus className="w-4 h-4" />}
        label="Add Resource"
        title="Add a new resource"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={removeResource}
        disabled={!canRemove || ro}
        icon={<Minus className="w-4 h-4" />}
        label="Remove Resource"
        title="Remove selected resource"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={reloadResource}
        disabled={!canReload || reloading || ro}
        icon={<RotateCw className="w-4 h-4" />}
        label="Reload Resource"
        title="Reload selected resource"
      />
    </>
  );
}
