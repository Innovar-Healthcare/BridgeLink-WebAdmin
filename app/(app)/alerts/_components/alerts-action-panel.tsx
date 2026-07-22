"use client";

import { Bell, BellOff, BellRing, Download, Pencil, Trash2, Upload } from "lucide-react";
import { AdaptiveBtn, AdaptiveSeparator } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import type { AlertStatus } from "@/lib/types";

interface AlertsActionPanelProps {
  position: ToolbarPosition;
  selectedAlertId: string | null;
  selectedAlert: AlertStatus | null;
  infoLoading: boolean;
  /** When true, all write actions are disabled (View-only RBAC). */
  viewOnly?: boolean;
  onNewAlert: () => void;
  onEditAlert: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onDelete: () => void;
  onExportSelected: () => void;
  onImport: () => void;
  onExportAll: () => void;
}

export function AlertsActionPanel({
  position,
  selectedAlertId,
  selectedAlert,
  infoLoading,
  onNewAlert,
  onEditAlert,
  onEnable,
  onDisable,
  onDelete,
  onExportSelected,
  onImport,
  onExportAll,
  viewOnly = false,
}: AlertsActionPanelProps) {
  const orientation: "vertical" | "horizontal" =
    position === "left" || position === "right" ? "vertical" : "horizontal";
  const ro = viewOnly;

  return (
    <>
      {/* New / Edit */}
      <AdaptiveBtn
        orientation={orientation}
        onClick={onNewAlert}
        disabled={infoLoading || ro}
        icon={<Bell className="w-4 h-4" />}
        label="New Alert"
        title="Create a new alert"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onEditAlert}
        disabled={!selectedAlertId || infoLoading || ro}
        icon={<Pencil className="w-4 h-4" />}
        label="Edit Alert"
        title="Edit selected alert"
      />
      <AdaptiveSeparator orientation={orientation} />
      {/* Enable / Disable */}
      <AdaptiveBtn
        orientation={orientation}
        onClick={onEnable}
        disabled={!selectedAlertId || selectedAlert?.enabled === true || ro}
        icon={<BellRing className="w-4 h-4" />}
        label="Enable"
        title="Enable selected alert"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onDisable}
        disabled={!selectedAlertId || selectedAlert?.enabled === false || ro}
        icon={<BellOff className="w-4 h-4" />}
        label="Disable"
        title="Disable selected alert"
      />
      <AdaptiveSeparator orientation={orientation} />
      {/* Delete / Export */}
      <AdaptiveBtn
        orientation={orientation}
        variant="destructive"
        onClick={onDelete}
        disabled={!selectedAlertId || ro}
        icon={<Trash2 className="w-4 h-4" />}
        label="Delete"
        title="Delete selected alert"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onExportSelected}
        disabled={!selectedAlertId}
        icon={<Download className="w-4 h-4" />}
        label="Export"
        title="Export selected alert"
      />
      <AdaptiveSeparator orientation={orientation} />
      {/* Import / Export All */}
      <AdaptiveBtn
        orientation={orientation}
        onClick={onImport}
        disabled={ro}
        icon={<Upload className="w-4 h-4" />}
        label="Import"
        title="Import alerts from file"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onExportAll}
        icon={<Download className="w-4 h-4" />}
        label="Export All"
        title="Export all alerts"
      />
    </>
  );
}
