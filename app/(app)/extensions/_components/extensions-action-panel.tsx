"use client";

import { Info, RefreshCw, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { AdaptiveBtn, AdaptiveSeparator } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import type { ExtensionRow } from "../_lib/extension-types";

interface ExtensionsActionPanelProps {
  position: ToolbarPosition;
  selectedRow: ExtensionRow | null;
  loading: boolean;
  actionLoading: boolean;
  /** When true, all write actions are disabled (View-only RBAC). */
  viewOnly?: boolean;
  onRefresh: () => void;
  onToggleEnabled: () => void;
  onInfo: () => void;
  onUninstall: () => void;
}

export function ExtensionsActionPanel({
  position,
  selectedRow,
  loading,
  actionLoading,
  onRefresh,
  onToggleEnabled,
  onInfo,
  onUninstall,
  viewOnly = false,
}: ExtensionsActionPanelProps) {
  const orientation: "vertical" | "horizontal" =
    position === "left" || position === "right" ? "vertical" : "horizontal";

  const hasSelection = selectedRow !== null;
  const ro = viewOnly;

  return (
    <>
      <AdaptiveBtn
        orientation={orientation}
        onClick={onRefresh}
        disabled={loading}
        icon={<RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />}
        label="Refresh"
        title="Refresh extension data"
      />
      <AdaptiveSeparator orientation={orientation} />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onToggleEnabled}
        disabled={!hasSelection || actionLoading || ro}
        variant={hasSelection && !selectedRow.enabled ? "primary" : "default"}
        icon={
          hasSelection && selectedRow.enabled ? (
            <ToggleRight className="w-4 h-4" />
          ) : (
            <ToggleLeft className="w-4 h-4" />
          )
        }
        label={hasSelection && selectedRow.enabled ? "Disable" : "Enable"}
        title={
          hasSelection && selectedRow.enabled
            ? "Disable selected extension"
            : "Enable selected extension"
        }
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onInfo}
        disabled={!hasSelection}
        icon={<Info className="w-4 h-4" />}
        label="Info"
        title="View extension details"
      />
      <AdaptiveSeparator orientation={orientation} />
      <AdaptiveBtn
        orientation={orientation}
        variant="destructive"
        onClick={onUninstall}
        disabled={!hasSelection || ro}
        icon={<Trash2 className="w-4 h-4" />}
        label="Uninstall"
        title="Uninstall selected extension"
      />
    </>
  );
}
