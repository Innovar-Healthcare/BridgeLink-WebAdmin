"use client";

import { useMemo } from "react";
import { pluginRegistry } from "@/lib/plugin-registry";
import { usePluginSurfaceEnabled } from "@/lib/plugin-gating";
import type { ChannelTag } from "@/lib/types";
import type {
  SummaryState,
  ScriptsState,
  DataTypesState,
  SourceConnectorState,
  DestinationConnectorState,
  MessageStorageMode,
} from "../_lib/channel-xml";
import { SummaryTab } from "./summary-tab";
import { ScriptsTab } from "./scripts-tab";
import { SourceTab } from "./source-tab";
import { DestinationTab } from "./destination-tab";
import type { EditorTab } from "./channel-editor-types";
import { harvestSourceResponseVariables } from "../_lib/source-response-harvest";

// Unified selection type (covers both tab mode and flow mode)
// index is optional: omitted in tabs mode (uncontrolled), present in flow mode (controlled)
export type TabSelection =
  | Exclude<EditorTab, "destination">
  | { type: "destination"; index?: number };

export interface ChannelEditorTabContentProps {
  selection: TabSelection;

  // Data
  summary: SummaryState | null;
  scripts: ScriptsState | null;
  dataTypes: DataTypesState | null;
  sourceConnector: SourceConnectorState | null;
  destinations: DestinationConnectorState[];
  channelId: string;
  isDark: boolean;

  // Tags
  allTags: ChannelTag[];
  tagsLoading: boolean;

  // Destination selection — flow mode passes these; tabs mode omits them
  onSelectedDestIndexChange?: (i: number) => void;

  // Change handlers
  onSummaryChange: (updates: Partial<SummaryState>) => void;
  onScriptsChange: (updates: Partial<ScriptsState>) => void;
  onTagsChange: (updated: ChannelTag[]) => void;
  onDataTypesChange: (updated: DataTypesState) => void;
  onSourceConnectorChange: (updates: Partial<SourceConnectorState>) => void;
  onDestinationChange: (index: number, updates: Partial<DestinationConnectorState>) => void;
  onDestinationAdd: (transportName: string) => void;
  onDestinationRemove: (index: number) => void;
  onDestinationDuplicate: (index: number) => void;
  onDestinationReorder: (from: number, to: number) => void;
  onSourceConnectorExport: () => void;
  onSourceConnectorImport: () => void;
  onDestinationExport: (index: number) => void;
  onDestinationImport: () => void;
  onOpenSourceFilter: () => void;
  onOpenSourceTransformer: () => void;
  onOpenDestFilter: (destIndex: number) => void;
  onOpenDestTransformer: (destIndex: number) => void;
  onOpenDestResponseTransformer: (destIndex: number) => void;
  messageStorageMode?: MessageStorageMode;
  sourceTransformerXml?: string | null;

  // Channel XML + callback for library-resource edits in the Dependencies dialog
  currentXml?: string | null;
  onLibraryResourcesChanged?: (newXml: string) => void;

  // Save-time errors
  srcSaveErrors: Set<string>;
  destSaveErrors: Map<number, Set<string>>;
  onClearSrcErrors: () => void;
  onClearDestErrors: () => void;

  // Scripts initial tab (edit mode only)
  initialScript?: "preprocessing" | "postprocessing" | "deploy" | "undeploy";

  // Plugin tabs
  activePluginTab: string | null;
  mode: "edit" | "new";
  editChannelId?: string;
  channelName?: string;
}

export function ChannelEditorTabContent({
  selection,
  summary,
  scripts,
  dataTypes,
  sourceConnector,
  destinations,
  channelId,
  isDark,
  allTags,
  tagsLoading,
  onSelectedDestIndexChange,
  onSummaryChange,
  onScriptsChange,
  onTagsChange,
  onDataTypesChange,
  onSourceConnectorChange,
  onDestinationChange,
  onDestinationAdd,
  onDestinationRemove,
  onDestinationDuplicate,
  onDestinationReorder,
  onSourceConnectorExport,
  onSourceConnectorImport,
  onDestinationExport,
  onDestinationImport,
  onOpenSourceFilter,
  onOpenSourceTransformer,
  onOpenDestFilter,
  onOpenDestTransformer,
  onOpenDestResponseTransformer,
  messageStorageMode,
  sourceTransformerXml,
  currentXml,
  onLibraryResourcesChanged,
  srcSaveErrors,
  destSaveErrors,
  onClearSrcErrors,
  onClearDestErrors,
  initialScript,
  activePluginTab,
  mode,
  editChannelId,
  channelName,
}: ChannelEditorTabContentProps) {
  // Gate plugin tabs on the backing plugin being active, mirroring the
  // trigger-level gate in channel-editor-core.tsx so a disabled plugin's tab
  // content never renders even if activePluginTab still holds it.
  const surfaceEnabled = usePluginSurfaceEnabled();

  // Destination references (metaDataId + name) for the Source Response dropdown,
  // which persists `d<metaDataId>` keys (mirrors Java updateResponseDropDown).
  const destinationRefs = useMemo(
    () => destinations.map((d) => ({ metaDataId: d.metaDataId, name: d.name })),
    [destinations]
  );

  // Response-map variables harvested from filters/transformers/response
  // transformers + pre/post-processor scripts, for the Source Response dropdown.
  // Only the Source tab consumes this, and the harvest parses every connector's
  // filter/transformer XML — so skip the work entirely on other tabs (e.g. while
  // editing a destination, where `destinations` changes on every keystroke).
  const sourceResponseVars = useMemo(
    () =>
      selection === "source"
        ? harvestSourceResponseVariables({
            sourceFilterXml: sourceConnector?.filterXml,
            sourceTransformerXml: sourceConnector?.transformerXml,
            destinations,
            scripts: scripts ? [scripts.preprocessing, scripts.postprocessing] : [],
          })
        : [],
    [selection, sourceConnector?.filterXml, sourceConnector?.transformerXml, destinations, scripts]
  );

  if (activePluginTab !== null && mode === "edit" && editChannelId) {
    const pluginTab = pluginRegistry.channelEditorTabs.find(
      (t) => t.key === activePluginTab && surfaceEnabled(t)
    );
    if (pluginTab) {
      const PluginComponent = pluginTab.component;
      const name = channelName ?? editChannelId;
      return (
        <div className="h-full min-h-0 flex flex-col overflow-hidden p-4">
          <PluginComponent channelId={editChannelId} channelName={name} />
        </div>
      );
    }
  }

  if (selection === "summary" && summary) {
    return (
      <SummaryTab
        summary={summary}
        channelId={channelId}
        onChange={onSummaryChange}
        allTags={allTags}
        onTagsChange={onTagsChange}
        tagsLoading={tagsLoading}
        dataTypes={dataTypes}
        onDataTypesChange={onDataTypesChange}
        currentXml={currentXml}
        onLibraryResourcesChanged={onLibraryResourcesChanged}
        sourceTransportName={sourceConnector?.transportName}
        sourcePropertiesXml={sourceConnector?.propertiesXml}
        sourceQueueEnabled={sourceConnector ? !sourceConnector.respondAfterProcessing : false}
        destinationQueueEnabled={destinations.some((d) => d.queue.queueEnabled)}
      />
    );
  }

  if (selection === "source" && sourceConnector) {
    return (
      <SourceTab
        sourceConnector={sourceConnector}
        destinations={destinationRefs}
        responseVars={sourceResponseVars}
        messageStorageMode={messageStorageMode}
        onChange={onSourceConnectorChange}
        isDark={isDark}
        channelId={channelId}
        channelName={channelName ?? ""}
        onOpenFilter={onOpenSourceFilter}
        onOpenTransformer={onOpenSourceTransformer}
        onExport={onSourceConnectorExport}
        onImport={onSourceConnectorImport}
        externalInvalidFields={srcSaveErrors}
        onClearExternalErrors={onClearSrcErrors}
      />
    );
  }

  if (typeof selection === "object" && selection.type === "destination") {
    return (
      <DestinationTab
        destinations={destinations}
        messageStorageMode={messageStorageMode}
        onChange={onDestinationChange}
        onAdd={onDestinationAdd}
        onRemove={onDestinationRemove}
        onDuplicate={onDestinationDuplicate}
        onReorder={onDestinationReorder}
        onExport={onDestinationExport}
        onImport={onDestinationImport}
        isDark={isDark}
        channelId={channelId}
        channelName={channelName ?? ""}
        onOpenFilter={onOpenDestFilter}
        onOpenTransformer={onOpenDestTransformer}
        onOpenResponseTransformer={onOpenDestResponseTransformer}
        selectedIndex={selection.index}
        onSelectedIndexChange={
          selection.index !== undefined ? onSelectedDestIndexChange : undefined
        }
        sourceTransformerXml={sourceTransformerXml}
        externalInvalidFieldsByDestIndex={destSaveErrors}
        onClearExternalErrors={onClearDestErrors}
      />
    );
  }

  if (selection === "scripts" && scripts) {
    return (
      <ScriptsTab
        scripts={scripts}
        isDark={isDark}
        onChange={onScriptsChange}
        channelId={channelId}
        initialScript={initialScript}
      />
    );
  }

  return null;
}
