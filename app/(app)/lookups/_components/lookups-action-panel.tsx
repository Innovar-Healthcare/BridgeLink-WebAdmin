"use client";

import {
  Copy,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { AdaptiveBtn, AdaptiveSeparator } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";

type TabKey = "details" | "values" | "cache" | "history";

export interface ValuesTabActions {
  // Add / import / export
  addValue: () => void;
  importValues: () => void;
  exportValues: () => void;
  // Edit / copy
  editSelected: () => void;
  copySelectedValue: () => void;
  // Remove operations
  removeSelected: () => void;
  removeResults: () => void;
  // State for disabling buttons
  selectedKeys: Set<string>;
  totalCount: number;
}

export interface CacheTabActions {
  resetStats: () => void;
  clearCache: () => void;
  cacheEnabled: boolean;
}

export const EMPTY_VALUES_ACTIONS: ValuesTabActions = {
  addValue: () => {},
  importValues: () => {},
  exportValues: () => {},
  editSelected: () => {},
  copySelectedValue: () => {},
  removeSelected: () => {},
  removeResults: () => {},
  selectedKeys: new Set(),
  totalCount: 0,
};

export const EMPTY_CACHE_ACTIONS: CacheTabActions = {
  resetStats: () => {},
  clearCache: () => {},
  cacheEnabled: false,
};

interface LookupsActionPanelProps {
  position: ToolbarPosition;
  loading: boolean;
  hasSelection: boolean;
  activeTab: TabKey;
  // Global
  onRefresh: () => void;
  onSettings: () => void;
  // Group
  onAddGroup: () => void;
  onImportGroup: () => void;
  onEditGroup: () => void;
  onExportGroup: () => void;
  onDeleteGroup: () => void;
  // Tab-specific
  valuesActions: ValuesTabActions;
  cacheActions: CacheTabActions;
}

export function LookupsActionPanel({
  position,
  loading,
  hasSelection,
  activeTab,
  onRefresh,
  onSettings,
  onAddGroup,
  onImportGroup,
  onEditGroup,
  onExportGroup,
  onDeleteGroup,
  valuesActions,
  cacheActions,
}: LookupsActionPanelProps) {
  const orientation: "vertical" | "horizontal" =
    position === "left" || position === "right" ? "vertical" : "horizontal";

  return (
    <>
      {/* Global actions */}
      <AdaptiveBtn
        orientation={orientation}
        onClick={onRefresh}
        disabled={loading}
        icon={<RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />}
        label="Refresh"
        title="Refresh groups"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onSettings}
        icon={<Settings className="w-4 h-4" />}
        label="Settings"
        title="Lookup settings"
      />
      <AdaptiveSeparator orientation={orientation} />

      {/* Group actions */}
      <AdaptiveBtn
        orientation={orientation}
        onClick={onAddGroup}
        icon={<Plus className="w-4 h-4" />}
        label="Add Group"
        title="Create a new lookup group"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onImportGroup}
        icon={<Upload className="w-4 h-4" />}
        label="Import Group"
        title={
          <div className="space-y-1.5 text-xs max-w-xs">
            <div>
              Import a lookup group from a bundled default (System) or a JSON file matching the
              Export Group output.
            </div>
            <div className="text-gray-300">Expected file shape:</div>
            <pre className="font-mono text-[10px] leading-tight whitespace-pre-wrap">{`{
  "group": {
    "name": "MyGroup",
    "version": "1",
    "cacheSize": 1000,
    "cachePolicy": "LRU",
    "valueType": "JSON",
    "statisticsEnabled": true,
    "extra": { "jsonIndexMode": "NONE" }
  },
  "values": {
    "key1": "{\\"hello\\": \\"world\\"}"
  }
}`}</pre>
          </div>
        }
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onEditGroup}
        disabled={!hasSelection}
        icon={<Pencil className="w-4 h-4" />}
        label="Edit Group"
        title="Edit selected group"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onExportGroup}
        disabled={!hasSelection}
        icon={<Download className="w-4 h-4" />}
        label="Export Group"
        title="Export selected group (metadata + all values) as JSON"
      />
      <AdaptiveBtn
        orientation={orientation}
        variant="destructive"
        onClick={onDeleteGroup}
        disabled={!hasSelection}
        icon={<Trash2 className="w-4 h-4" />}
        label="Delete Group"
        title="Delete selected group and all its values"
      />

      {/* Values tab actions */}
      {activeTab === "values" && hasSelection && (
        <>
          <AdaptiveSeparator orientation={orientation} />
          <AdaptiveBtn
            orientation={orientation}
            onClick={valuesActions.addValue}
            icon={<Plus className="w-4 h-4" />}
            label="Add Value"
            title="Add a new key-value pair"
          />
          <AdaptiveBtn
            orientation={orientation}
            onClick={valuesActions.importValues}
            icon={<Upload className="w-4 h-4" />}
            label="Import Values"
            title={
              <div className="space-y-1.5 text-xs max-w-xs">
                <div>Import values from a CSV file.</div>
                <div className="text-gray-300">
                  Two columns: header row, then key,value pairs. Quote fields containing commas or
                  quotes; double internal quotes.
                </div>
                <pre className="font-mono text-[10px] leading-tight whitespace-pre-wrap">{`key,value
99213,"Office Visit, Established"
mykey,"{""hello"": ""world""}"`}</pre>
              </div>
            }
          />
          <AdaptiveBtn
            orientation={orientation}
            onClick={valuesActions.exportValues}
            icon={<Download className="w-4 h-4" />}
            label="Export Values"
            title="Export all values as CSV (all_values_YYYY_MM_DD_HH_mm.csv)"
          />
          <AdaptiveSeparator orientation={orientation} />
          <AdaptiveBtn
            orientation={orientation}
            onClick={valuesActions.editSelected}
            disabled={valuesActions.selectedKeys.size !== 1}
            icon={<Pencil className="w-4 h-4" />}
            label="Edit"
            title={
              valuesActions.selectedKeys.size === 1
                ? `Edit "${[...valuesActions.selectedKeys][0]}"`
                : "Select a single row to edit"
            }
          />
          <AdaptiveBtn
            orientation={orientation}
            onClick={valuesActions.copySelectedValue}
            disabled={valuesActions.selectedKeys.size !== 1}
            icon={<Copy className="w-4 h-4" />}
            label="Copy Value"
            title={
              valuesActions.selectedKeys.size === 1
                ? "Copy value to clipboard"
                : "Select a single row to copy"
            }
          />
          <AdaptiveSeparator orientation={orientation} />
          <AdaptiveBtn
            orientation={orientation}
            variant="destructive"
            onClick={valuesActions.removeSelected}
            disabled={valuesActions.selectedKeys.size === 0}
            icon={<X className="w-4 h-4" />}
            label={
              valuesActions.selectedKeys.size > 1
                ? `Remove (${valuesActions.selectedKeys.size})`
                : "Remove"
            }
            title={
              valuesActions.selectedKeys.size > 0
                ? valuesActions.selectedKeys.size === 1
                  ? `Remove "${[...valuesActions.selectedKeys][0]}"`
                  : `Remove ${valuesActions.selectedKeys.size} selected values`
                : "Select a row to remove"
            }
          />
          <AdaptiveBtn
            orientation={orientation}
            variant="destructive"
            onClick={valuesActions.removeResults}
            disabled={valuesActions.totalCount === 0}
            icon={<Trash2 className="w-4 h-4" />}
            label="Remove Results"
            title={
              valuesActions.totalCount > 0
                ? `Remove all ${valuesActions.totalCount.toLocaleString()} matching values`
                : "No results to remove"
            }
          />
        </>
      )}

      {/* Cache tab actions */}
      {activeTab === "cache" && hasSelection && (
        <>
          <AdaptiveSeparator orientation={orientation} />
          <AdaptiveBtn
            orientation={orientation}
            onClick={cacheActions.resetStats}
            icon={<RotateCcw className="w-4 h-4" />}
            label="Reset Stats"
            title="Reset database statistics"
          />
          <AdaptiveBtn
            orientation={orientation}
            onClick={cacheActions.clearCache}
            disabled={!cacheActions.cacheEnabled}
            icon={<Trash2 className="w-4 h-4" />}
            label="Clear Cache"
            title={
              cacheActions.cacheEnabled
                ? "Clear in-memory cache"
                : "Caching is disabled for this group"
            }
          />
        </>
      )}
    </>
  );
}
