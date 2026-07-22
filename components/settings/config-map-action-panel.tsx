"use client";

import { Download, RefreshCw, Save, Upload } from "lucide-react";
import { AdaptiveBtn, AdaptiveSeparator } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";

interface ConfigMapActionPanelProps {
  position: ToolbarPosition;
  save: () => void;
  refresh: () => void;
  importMap: () => void;
  exportMap: () => void;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  canExport: boolean;
  viewOnly?: boolean;
}

export function ConfigMapActionPanel({
  position,
  save,
  refresh,
  importMap,
  exportMap,
  dirty,
  saving,
  loading,
  canExport,
  viewOnly = false,
}: ConfigMapActionPanelProps) {
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
        title="Save configuration map"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={refresh}
        disabled={loading}
        icon={<RefreshCw className="w-4 h-4" />}
        label="Refresh"
        title="Refresh configuration map"
      />
      <AdaptiveSeparator orientation={orientation} />
      <AdaptiveBtn
        orientation={orientation}
        onClick={importMap}
        disabled={ro}
        icon={<Upload className="w-4 h-4" />}
        label="Import Map"
        title="Import a properties file into the configuration map. This will remove and replace any existing map values."
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={exportMap}
        disabled={!canExport}
        icon={<Download className="w-4 h-4" />}
        label="Export Map"
        title="Export configuration map to file"
      />
    </>
  );
}
