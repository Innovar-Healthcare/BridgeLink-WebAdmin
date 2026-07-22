"use client";

import { CheckCircle, Download, GitBranch, History, RefreshCw, Save, Upload } from "lucide-react";
import { AdaptiveBtn, AdaptiveSeparator } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";

interface GlobalScriptsActionPanelProps {
  position: ToolbarPosition;
  loading: boolean;
  saving: boolean;
  anyDirty: boolean;
  hasScripts: boolean;
  onRefresh: () => void;
  onImport: () => void;
  onExport: () => void;
  onValidate: () => void;
  onSave: () => void;
  onViewHistory?: () => void;
  onCommit?: () => void;
}

export function GlobalScriptsActionPanel({
  position,
  loading,
  saving,
  anyDirty,
  hasScripts,
  onRefresh,
  onImport,
  onExport,
  onValidate,
  onSave,
  onViewHistory,
  onCommit,
}: GlobalScriptsActionPanelProps) {
  const orientation: "vertical" | "horizontal" =
    position === "left" || position === "right" ? "vertical" : "horizontal";

  return (
    <>
      <AdaptiveBtn
        orientation={orientation}
        onClick={onRefresh}
        disabled={loading}
        icon={<RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />}
        label="Refresh"
        title="Reload scripts from server"
      />
      <AdaptiveSeparator orientation={orientation} />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onImport}
        disabled={loading || !hasScripts}
        icon={<Upload className="w-4 h-4" />}
        label="Import"
        title="Import all global scripts from an XML file"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onExport}
        disabled={loading || !hasScripts}
        icon={<Download className="w-4 h-4" />}
        label="Export"
        title="Export all global scripts to an XML file"
      />
      {onViewHistory && (
        <>
          <AdaptiveSeparator orientation={orientation} />
          <AdaptiveBtn
            orientation={orientation}
            onClick={onViewHistory}
            icon={<History className="w-4 h-4" />}
            label="History"
            title="View version history for global scripts"
          />
        </>
      )}
      {onCommit && (
        <>
          <AdaptiveSeparator orientation={orientation} />
          <AdaptiveBtn
            orientation={orientation}
            onClick={onCommit}
            disabled={loading || !hasScripts}
            icon={<GitBranch className="w-4 h-4" />}
            label="Commit & Push"
            title="Commit current global scripts and push to the repository"
          />
        </>
      )}
      <AdaptiveSeparator orientation={orientation} />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onValidate}
        disabled={loading || !hasScripts}
        icon={<CheckCircle className="w-4 h-4" />}
        label="Validate"
        title="Validate active script for syntax errors"
      />
      <AdaptiveSeparator orientation={orientation} />
      <AdaptiveBtn
        orientation={orientation}
        variant="primary"
        onClick={onSave}
        disabled={saving || loading || !anyDirty}
        icon={<Save className="w-4 h-4" />}
        label={saving ? "Saving…" : "Save"}
        title="Save all scripts"
      />
    </>
  );
}
