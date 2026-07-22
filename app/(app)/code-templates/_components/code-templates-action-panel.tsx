"use client";

import {
  RefreshCw,
  FilePlus,
  FolderPlus,
  Search,
  FileCheck,
  Trash2,
  Save,
  Download,
  Upload,
  ChevronDown,
  History,
  GitBranch,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { AdaptiveBtn, AdaptiveSeparator } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import { cn } from "@/lib/utils";

/** Dropdown menu side based on toolbar position */
const DROPDOWN_SIDE: Record<ToolbarPosition, "top" | "bottom" | "left" | "right"> = {
  left: "right",
  right: "left",
  top: "bottom",
  bottom: "top",
};

interface CodeTemplatesActionPanelProps {
  position: ToolbarPosition;
  loading: boolean;
  dirty: boolean;
  saving: boolean;
  canDelete: boolean;
  selectedTemplateId: string | null;
  selectedLibraryId: string | null;
  hasLibraries: boolean;
  /** When true, all write actions are disabled (View-only RBAC). */
  viewOnly?: boolean;
  onRefresh: () => void;
  onAddTemplate: () => void;
  onAddLibrary: () => void;
  onDelete: () => void;
  onValidate: () => void;
  onSave: () => void;
  onFindUsage: () => void;
  onExportTemplate: () => void;
  onExportLibrary: () => void;
  onExportAllLibraries: () => void;
  onImportTemplate: () => void;
  onImportLibrary: () => void;
  onImportFromRepo?: () => void;
  /** Opens version history for the selected template or library. Only provided when plugin is installed and an item is selected. */
  onViewHistory?: () => void;
  /** Saves all current libraries to the version history repo. Only provided when plugin is installed. */
  onSaveLibraries?: () => void;
}

export function CodeTemplatesActionPanel({
  position,
  loading,
  dirty,
  saving,
  canDelete,
  selectedTemplateId,
  selectedLibraryId,
  hasLibraries,
  onRefresh,
  onAddTemplate,
  onAddLibrary,
  onDelete,
  onValidate,
  onSave,
  onFindUsage,
  onExportTemplate,
  onExportLibrary,
  onExportAllLibraries,
  onImportTemplate,
  onImportLibrary,
  onImportFromRepo,
  onViewHistory,
  onSaveLibraries,
  viewOnly = false,
}: CodeTemplatesActionPanelProps) {
  const orientation: "vertical" | "horizontal" =
    position === "left" || position === "right" ? "vertical" : "horizontal";
  const dropdownSide = DROPDOWN_SIDE[position];
  const ro = viewOnly;

  return (
    <>
      {/* Refresh */}
      <AdaptiveBtn
        orientation={orientation}
        onClick={onRefresh}
        disabled={loading}
        icon={<RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />}
        label="Refresh"
        title="Refresh code templates"
      />
      <AdaptiveSeparator orientation={orientation} />
      {/* Create */}
      <AdaptiveBtn
        orientation={orientation}
        onClick={onAddTemplate}
        disabled={ro}
        icon={<FilePlus className="w-4 h-4" />}
        label="New Tmpl"
        title="New code template"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onAddLibrary}
        disabled={ro}
        icon={<FolderPlus className="w-4 h-4" />}
        label="New Library"
        title="New code template library"
      />
      <AdaptiveSeparator orientation={orientation} />
      {/* Actions */}
      <AdaptiveBtn
        orientation={orientation}
        variant="accent"
        onClick={onFindUsage}
        disabled={!selectedTemplateId}
        icon={<Search className="w-4 h-4" />}
        label="Find Usage"
        title="Find channels using this template"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onValidate}
        disabled={!selectedTemplateId}
        icon={<FileCheck className="w-4 h-4" />}
        label="Validate"
        title="Validate script syntax"
      />
      {onViewHistory && (
        <AdaptiveBtn
          orientation={orientation}
          onClick={onViewHistory}
          icon={<History className="w-4 h-4" />}
          label="History"
          title="View version history for selected item"
        />
      )}
      {/* Import dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            disabled={ro}
            className={
              orientation === "vertical"
                ? "flex flex-col items-center gap-0.5 w-full px-1 py-1.5 text-[10px] leading-tight rounded disabled:opacity-40 disabled:cursor-not-allowed bg-gray-50 dark:bg-gray-700 border border-border hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
                : "flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-gray-50 dark:bg-gray-700 border border-border hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
            }
          >
            <Upload className="w-4 h-4" />
            <span>Import</span>
            <ChevronDown className="w-3 h-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={dropdownSide} align="start">
          <DropdownMenuItem onClick={onImportTemplate} disabled={!hasLibraries}>
            <Upload className="w-3.5 h-3.5 mr-2" />
            Import Code Templates
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onImportLibrary}>
            <Upload className="w-3.5 h-3.5 mr-2" />
            Import Libraries
          </DropdownMenuItem>
          {onImportFromRepo && (
            <DropdownMenuItem onClick={onImportFromRepo}>
              <Upload className="w-3.5 h-3.5 mr-2" />
              Import from Repo
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Export dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            disabled={!hasLibraries}
            className={
              orientation === "vertical"
                ? "flex flex-col items-center gap-0.5 w-full px-1 py-1.5 text-[10px] leading-tight rounded disabled:opacity-40 disabled:cursor-not-allowed bg-gray-50 dark:bg-gray-700 border border-border hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
                : "flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-gray-50 dark:bg-gray-700 border border-border hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
            }
          >
            <Download className="w-4 h-4" />
            <span>Export</span>
            <ChevronDown className="w-3 h-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={dropdownSide} align="start">
          <DropdownMenuItem onClick={onExportTemplate} disabled={!selectedTemplateId}>
            <Download className="w-3.5 h-3.5 mr-2" />
            Export Code Template
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onExportLibrary}
            disabled={!selectedLibraryId && !selectedTemplateId}
          >
            <Download className="w-3.5 h-3.5 mr-2" />
            Export Library
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExportAllLibraries}>
            <Download className="w-3.5 h-3.5 mr-2" />
            Export All Libraries
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AdaptiveBtn
        orientation={orientation}
        variant="destructive"
        onClick={onDelete}
        disabled={!canDelete || ro}
        icon={<Trash2 className="w-4 h-4" />}
        label="Delete"
        title="Delete selected library or template"
      />
      <AdaptiveSeparator orientation={orientation} />
      {/* Save Libraries (version history) */}
      {onSaveLibraries && (
        <AdaptiveBtn
          orientation={orientation}
          onClick={onSaveLibraries}
          icon={<GitBranch className="w-4 h-4" />}
          label="Save Libs"
          title="Save libraries to version history repo"
        />
      )}
      {/* Save */}
      <AdaptiveBtn
        orientation={orientation}
        variant="primary"
        onClick={onSave}
        disabled={!dirty || saving || ro}
        icon={<Save className="w-4 h-4" />}
        label={saving ? "Saving…" : "Save"}
        title="Save all changes"
      />
    </>
  );
}
