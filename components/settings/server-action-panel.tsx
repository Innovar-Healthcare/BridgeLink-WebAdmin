"use client";

import { Download, RefreshCw, Save, Trash2, Upload } from "lucide-react";
import { AdaptiveBtn, AdaptiveSeparator } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";

interface ServerActionPanelProps {
  position: ToolbarPosition;
  save: () => void;
  refresh: () => void;
  backup: () => void;
  restore: () => void;
  clearStats: () => void;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  backingUp: boolean;
  restoring: boolean;
  clearingStats: boolean;
  viewOnly?: boolean;
}

export function ServerActionPanel({
  position,
  save,
  refresh,
  backup,
  restore,
  clearStats,
  dirty,
  saving,
  loading,
  backingUp,
  restoring,
  clearingStats,
  viewOnly = false,
}: ServerActionPanelProps) {
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
        title="Save server settings"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={refresh}
        disabled={loading}
        icon={<RefreshCw className="w-4 h-4" />}
        label="Refresh"
        title="Refresh server settings"
      />
      <AdaptiveSeparator orientation={orientation} />
      <AdaptiveBtn
        orientation={orientation}
        onClick={backup}
        disabled={backingUp}
        icon={<Download className="w-4 h-4" />}
        label="Backup"
        title="Backup server configuration"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={restore}
        disabled={restoring || ro}
        icon={<Upload className="w-4 h-4" />}
        label="Restore"
        title="Restore server configuration"
      />
      <AdaptiveSeparator orientation={orientation} />
      <AdaptiveBtn
        orientation={orientation}
        variant="destructive"
        onClick={clearStats}
        disabled={clearingStats || ro}
        icon={<Trash2 className="w-4 h-4" />}
        label="Clear All Statistics"
        title="Reset the current and lifetime statistics for all channels"
      />
    </>
  );
}
