"use client";

import { ArrowLeft, Download, LayoutList, Rocket, Save, Workflow } from "lucide-react";

interface ChannelEditorActionsProps {
  saving: boolean;
  needsSave: boolean;
  xmlReady: boolean;
  viewMode: "flow" | "tabs";
  onSave: () => void;
  onSaveDeployClick: () => void;
  onExport: () => void;
  onBack: () => void;
  onToggleViewMode: () => void;
}

export function ChannelEditorActions({
  saving,
  needsSave,
  xmlReady,
  viewMode,
  onSave,
  onSaveDeployClick,
  onExport,
  onBack,
  onToggleViewMode,
}: ChannelEditorActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onSave}
        disabled={saving || !xmlReady || !needsSave}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
      >
        <Save className="w-3.5 h-3.5" />
        {saving ? "Saving…" : "Save"}
      </button>
      <button
        onClick={onSaveDeployClick}
        disabled={saving || !xmlReady}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
      >
        <Rocket className="w-3.5 h-3.5" />
        {saving ? "Saving…" : needsSave ? "Save & Deploy" : "Deploy"}
      </button>
      <button
        onClick={onExport}
        disabled={!xmlReady || saving}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-border text-gray-700 hover:bg-gray-50 dark:bg-gray-700 dark:border-border dark:text-gray-200 dark:hover:bg-gray-600 rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Download className="w-3.5 h-3.5" />
        Export
      </button>
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-border text-gray-700 hover:bg-gray-50 dark:bg-gray-700 dark:border-border dark:text-gray-200 dark:hover:bg-gray-600 rounded font-medium"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back
      </button>
      <button
        onClick={onToggleViewMode}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-border text-gray-700 hover:bg-gray-50 dark:bg-gray-700 dark:border-border dark:text-gray-200 dark:hover:bg-gray-600 rounded font-medium"
      >
        {viewMode === "flow" ? (
          <LayoutList className="w-3.5 h-3.5" />
        ) : (
          <Workflow className="w-3.5 h-3.5" />
        )}
        {viewMode === "flow" ? "Tab view" : "Flow view"}
      </button>
    </div>
  );
}
