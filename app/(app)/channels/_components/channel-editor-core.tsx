"use client";

import { useRouter } from "next/navigation";
import { pluginRegistry } from "@/lib/plugin-registry";
import { pluginSlots } from "@/lib/plugin-slots";
import { usePluginSurfaceEnabled, useSlotEnabled } from "@/lib/plugin-gating";
import { AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useTheme } from "@/lib/hooks/use-theme";
import {
  DEFAULT_DEST_RESPONSE_TRANSFORMER_XML,
  resolveXmlVersion,
  withVersion,
} from "../_lib/channel-xml";
import { CONNECTOR_REGISTRY } from "../_connectors";
import { FilterTransformerEditor } from "./filter-transformer/filter-transformer-editor";
import { ChannelFlowPanel } from "./channel-flow-panel";
import { emptyFilterXml } from "../_lib/filter-transformer-xml";
import { DeleteDestinationDialog } from "./delete-destination-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ChannelEditorActions } from "./channel-editor-actions";
import { ExportChannelDialog } from "../_dialogs/export-channel-dialog";
import { ChannelEditorTabContent } from "./channel-editor-tab-content";
import { useChannelEditor } from "../_lib/use-channel-editor";
import { countNonDefaultScripts } from "../_lib/channel-xml";
import { TAB_LABELS, type EditorTab, type ChannelEditorCoreProps } from "./channel-editor-types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TabSelection } from "./channel-editor-tab-content";

export type { ChannelEditorCoreProps };

// ─── Core component ───────────────────────────────────────────────────────────

export function ChannelEditorCore(props: ChannelEditorCoreProps) {
  const router = useRouter();
  const { isDark } = useTheme();

  const ed = useChannelEditor(props, router);

  // Plugin-contributed editor tabs, gated on the backing plugin being active
  // (e.g. the Version History tab is hidden when Version History is disabled —
  // either the extension or its "Enable" setting). Tabs without a pluginName
  // always show.
  const surfaceEnabled = usePluginSurfaceEnabled();
  const channelEditorTabs = pluginRegistry.channelEditorTabs.filter((t) => surfaceEnabled(t));

  // Plugin overlay slot (e.g. version history auto-commit dialog), gated on the
  // filling plugin being enabled.
  const ChannelEditorOverlay = pluginSlots["channel-editor.overlay"];
  const overlayEnabled = useSlotEnabled("channel-editor.overlay");

  // Derive unified selection for ChannelEditorTabContent
  const tabContentSelection: TabSelection =
    ed.viewMode === "tabs"
      ? ed.activeTab === "destination"
        ? { type: "destination" as const }
        : (ed.activeTab as Exclude<EditorTab, "destination">)
      : typeof ed.flowSelection === "object"
        ? ed.flowSelection
        : (ed.flowSelection as Exclude<EditorTab, "destination">);

  const initialScript =
    props.mode === "edit" && props.initialTab === "scripts"
      ? (props.initialScript as
          | "preprocessing"
          | "postprocessing"
          | "deploy"
          | "undeploy"
          | undefined)
      : undefined;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <PageHeader
        title={ed.pageTitle}
        subtitle={ed.pageSubtitle}
        actions={
          <ChannelEditorActions
            saving={ed.saving}
            needsSave={ed.needsSave}
            xmlReady={!!ed.xml}
            viewMode={ed.viewMode}
            onSave={ed.handleSave}
            onSaveDeployClick={() => ed.setSaveDeployConfirm(true)}
            onExport={ed.handleExportChannel}
            onBack={() => ed.guardedNavigate("/channels")}
            onToggleViewMode={() => ed.setViewMode(ed.viewMode === "flow" ? "tabs" : "flow")}
          />
        }
      />

      {ed.error && (
        <div className="mx-4 mt-2 flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{ed.error}</span>
          <button
            onClick={() => ed.setError(null)}
            className="ml-auto text-red-400 hover:text-red-600 dark:hover:text-red-300"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Save & Deploy confirmation dialog ───────────────────────────── */}
      {ed.saveDeployConfirm && (
        <ConfirmDialog
          title="Select an Option"
          description={
            ed.needsSave
              ? "This channel will be saved before it is deployed. Are you sure you want to save and deploy this channel?"
              : "Are you sure you want to deploy this channel?"
          }
          confirmLabel={ed.needsSave ? "Save & Deploy" : "Deploy"}
          confirmVariant="default"
          onConfirm={ed.needsSave ? ed.handleSaveAndDeploy : ed.handleDeploy}
          onCancel={() => ed.setSaveDeployConfirm(false)}
        />
      )}

      {/* ── Export: save-first prompt when the channel has unsaved edits ─────
          Mirrors Java ChannelPanel.doExportChannel (editor path). */}
      {ed.exportSaveConfirm && (
        <ConfirmDialog
          title="Export Channel"
          description="This channel has been modified. You must save the channel changes before you can export. Would you like to save them now?"
          confirmLabel="Save"
          confirmVariant="default"
          onConfirm={ed.confirmSaveThenExport}
          onCancel={() => ed.setExportSaveConfirm(false)}
        />
      )}

      {/* ── Export channel dialog (fetches the saved server channel + libraries) ──
          Mounted only once the channel has a server id. The dialog fetches by
          channelId and blocks dismissal while loading, so opening it with an
          empty id (e.g. an unsaved new channel) would strand it on a spinner. */}
      {ed.channelId && (
        <ExportChannelDialog
          open={ed.exportChannelOpen}
          onClose={() => ed.setExportChannelOpen(false)}
          channelId={ed.channelId}
          channelName={ed.summary?.name ?? ""}
        />
      )}

      {/* ── Listening port conflict warning dialog ──────────────────────── */}
      {ed.portConflict && (
        <ConfirmDialog
          title="Listening port already in use"
          description={
            <>
              Port <strong>{ed.portConflict.port}</strong> is already configured on{" "}
              {ed.portConflict.channels.length === 1 ? "channel " : "channels "}
              {ed.portConflict.channels.map((n) => `"${n}"`).join(", ")}. Two channels listening on
              the same port may fail to start. Save anyway?
            </>
          }
          confirmLabel="Save Anyway"
          confirmVariant="default"
          onConfirm={() => ed.resolvePortConflict(true)}
          onCancel={() => ed.resolvePortConflict(false)}
        />
      )}

      {/* Concurrent-edit conflict — another user changed this channel since it was
          opened. Mirrors Java Frame.updateChannel's overwrite prompt. */}
      {ed.saveConflict && (
        <ConfirmDialog
          title="Overwrite Changes?"
          description={
            <>
              Another user ({ed.saveConflict.otherUser}) has made changes to this channel since you
              started editing and your changes will overwrite theirs. Are you sure you want to save
              your changes?
            </>
          }
          confirmLabel="Overwrite"
          confirmVariant="default"
          onConfirm={() => ed.resolveSaveConflict(true)}
          onCancel={() => ed.resolveSaveConflict(false)}
        />
      )}

      {/* Custom-metadata schema change #18) — renaming, deleting, or changing the
          type of an existing column deletes its stored data on deploy. Mirrors Java
          ChannelSetup.java:1219-1222's confirm-before-save. */}
      {ed.metadataColumnConfirm && (
        <ConfirmDialog
          title="Delete Column Data?"
          description={
            <>
              Renaming, deleting, or changing the type of existing custom metadata columns will
              delete all existing data for that column. Are you sure you want to do this?
            </>
          }
          confirmLabel="Save Anyway"
          confirmVariant="destructive"
          onConfirm={() => ed.resolveMetadataColumnConfirm(true)}
          onCancel={() => ed.resolveMetadataColumnConfirm(false)}
        />
      )}

      {/* Connector-validation failure #17) — a required connector field is invalid.
          Mirrors Java ChannelSetup.saveChanges, which alerts and saves the channel disabled
          instead of blocking. Confirm saves it disabled; Cancel aborts the save. */}
      {ed.connectorValidationConfirm !== null && (
        <ConfirmDialog
          title="Save Channel Disabled?"
          description={
            <>
              This channel has connector validation errors and cannot be enabled. It can still be
              saved as <strong>disabled</strong> so you can finish it later:
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted p-2 text-xs">
                {ed.connectorValidationConfirm}
              </pre>
            </>
          }
          confirmLabel="Save Disabled"
          confirmVariant="default"
          onConfirm={() => ed.resolveConnectorValidationConfirm(true)}
          onCancel={() => ed.resolveConnectorValidationConfirm(false)}
        />
      )}

      {/* ── Plugin overlay slot (e.g. version history auto-commit dialog) ─── */}
      {ChannelEditorOverlay && overlayEnabled && <ChannelEditorOverlay />}

      <div className="flex flex-col flex-1 overflow-hidden">
        {/* ── Tab bar — shown only in classic tab mode ─────────────────── */}
        {!ed.ftView && ed.viewMode === "tabs" && (
          <Tabs
            value={ed.activePluginTab ?? ed.activeTab}
            onValueChange={(v) => {
              if (channelEditorTabs.some((t) => t.key === v)) {
                ed.setActivePluginTab(v);
                ed.setFtView(null);
              } else {
                ed.switchTab(v as EditorTab);
              }
            }}
          >
            <TabsList>
              {(Object.keys(TAB_LABELS) as EditorTab[]).map((tab) => (
                <TabsTrigger key={tab} value={tab}>
                  {tab === "scripts" && ed.scripts
                    ? (() => {
                        const n = countNonDefaultScripts(ed.scripts);
                        return n > 0 ? `Scripts (${n})` : "Scripts";
                      })()
                    : tab === "destination"
                      ? `Destinations (${ed.destinations.length})`
                      : TAB_LABELS[tab]}
                </TabsTrigger>
              ))}
              {props.mode === "edit" &&
                channelEditorTabs.map((pluginTab) => (
                  <TabsTrigger key={pluginTab.key} value={pluginTab.key}>
                    {pluginTab.label}
                  </TabsTrigger>
                ))}
            </TabsList>
          </Tabs>
        )}

        {/* ── Main content area ─────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">
          {/* Flow mode: left pipeline panel (hidden while FT editor is open) */}
          {!ed.ftView && ed.viewMode === "flow" && (
            <>
              <div
                className="shrink-0 border-r border-border overflow-y-auto p-3 bg-gray-50 dark:bg-gray-800/50"
                style={{ width: ed.flowPanelWidth }}
              >
                <ChannelFlowPanel
                  sourceConnector={ed.sourceConnector}
                  destinations={ed.destinations}
                  scriptCount={ed.scripts ? countNonDefaultScripts(ed.scripts) : 0}
                  selection={ed.flowSelection}
                  onSelect={(sel) => {
                    ed.setFlowSelection(sel);
                    ed.setActivePluginTab(null);
                  }}
                  pluginTabs={props.mode === "edit" ? channelEditorTabs : undefined}
                  activePluginTab={ed.activePluginTab}
                  onSelectPluginTab={(key) => {
                    ed.setActivePluginTab(ed.activePluginTab === key ? null : key);
                    ed.setFtView(null);
                  }}
                  onAddDestination={() => {
                    ed.handleDestinationAdd("Channel Writer");
                    ed.setFlowSelection({
                      type: "destination",
                      index: ed.destinations.length,
                    });
                  }}
                  onReorder={ed.handleDestinationReorder}
                  onToggleEnabled={ed.handleDestinationToggleEnabled}
                  onRemove={(i) => {
                    ed.handleDestinationRemove(i);
                    if (
                      typeof ed.flowSelection === "object" &&
                      ed.flowSelection.type === "destination"
                    ) {
                      const newIdx =
                        ed.flowSelection.index >= i
                          ? Math.max(0, ed.flowSelection.index - 1)
                          : ed.flowSelection.index;
                      ed.setFlowSelection({ type: "destination", index: newIdx });
                    }
                  }}
                  onDuplicate={(i) => {
                    ed.handleDestinationDuplicate(i);
                    ed.setFlowSelection({ type: "destination", index: i + 1 });
                  }}
                  onRequestDelete={ed.setDeleteConfirmIdx}
                  onExportSource={ed.handleSourceConnectorExport}
                  onImportSource={ed.handleSourceConnectorImport}
                  onExportDest={ed.handleDestinationExport}
                  onImportDest={ed.handleDestinationImport}
                />
              </div>
              {/* Resize handle */}
              <div
                onMouseDown={ed.onFlowPanelResize}
                className="w-1 shrink-0 cursor-col-resize select-none
                           bg-gray-200 dark:bg-gray-700
                           hover:bg-blue-400 dark:hover:bg-blue-500
                           transition-colors"
              />
            </>
          )}

          {/* Right panel — inspector */}
          <div className="flex-1 overflow-hidden">
            {/* Filter / Transformer overlay */}
            {ed.ftView && !ed.loading && (
              <FilterTransformerEditor
                mode={ed.ftView.mode}
                isSource={ed.ftView.target === "source"}
                xml={(() => {
                  if (ed.ftView!.target === "source") {
                    return ed.ftView!.mode === "filter"
                      ? (ed.sourceConnector?.filterXml ?? emptyFilterXml(resolveXmlVersion()))
                      : (ed.sourceConnector?.transformerXml ?? "");
                  } else {
                    const d = ed.destinations[ed.ftView!.destIndex];
                    if (ed.ftView!.mode === "filter")
                      return d?.filterXml ?? emptyFilterXml(resolveXmlVersion());
                    if (ed.ftView!.mode === "responseTransformer")
                      return (
                        d?.responseTransformerXml ??
                        withVersion(DEFAULT_DEST_RESPONSE_TRANSFORMER_XML, resolveXmlVersion())
                      );
                    return d?.transformerXml ?? "";
                  }
                })()}
                onChange={(newXml) => {
                  if (ed.ftView!.target === "source") {
                    const field = ed.ftView!.mode === "filter" ? "filterXml" : "transformerXml";
                    ed.handleSourceFtChange(field, newXml);
                  } else {
                    const field =
                      ed.ftView!.mode === "filter"
                        ? "filterXml"
                        : ed.ftView!.mode === "responseTransformer"
                          ? "responseTransformerXml"
                          : "transformerXml";
                    ed.handleDestFtChange(ed.ftView!.destIndex, field, newXml);
                  }
                }}
                onBack={() => ed.setFtView(null)}
                destinationConnectors={ed.destinations.map((d) => ({
                  metaDataId: d.metaDataId,
                  name: d.name,
                }))}
                isDark={isDark}
                autoValidate={ed.ftSaveErrored}
                title={(() => {
                  if (ed.ftView!.target === "source") {
                    return ed.ftView!.mode === "filter" ? "Source Filter" : "Source Transformer";
                  }
                  const d = ed.destinations[ed.ftView!.destIndex];
                  const name = d?.name ?? "Destination";
                  if (ed.ftView!.mode === "filter") return `${name} Filter`;
                  if (ed.ftView!.mode === "responseTransformer")
                    return `${name} Response Transformer`;
                  return `${name} Transformer`;
                })()}
                transformerXml={
                  ed.ftView!.mode === "filter"
                    ? ed.ftView!.target === "source"
                      ? (ed.sourceConnector?.transformerXml ?? "")
                      : (ed.destinations[ed.ftView!.destIndex]?.transformerXml ?? "")
                    : undefined
                }
                onTransformerChange={
                  ed.ftView!.mode === "filter"
                    ? (newTXml) => {
                        if (ed.ftView!.target === "source")
                          ed.handleSourceFtChange("transformerXml", newTXml);
                        else ed.handleDestFtChange(ed.ftView!.destIndex, "transformerXml", newTXml);
                      }
                    : undefined
                }
                channelId={ed.channelId}
                channelName={ed.summary?.name}
                sourceInboundLocked={(() => {
                  if (ed.ftView!.target !== "source") return false;
                  const def = CONNECTOR_REGISTRY[ed.sourceConnector?.transportName ?? ""];
                  return (
                    def?.getRequiredInboundDataType?.(ed.sourceConnector?.propertiesXml ?? null) !=
                    null
                  );
                })()}
              />
            )}

            {!ed.ftView && ed.loading ? (
              <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500">
                Loading channel XML…
              </div>
            ) : !ed.ftView && !ed.xml ? (
              <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500">
                Preparing channel template…
              </div>
            ) : (
              !ed.ftView && (
                <ChannelEditorTabContent
                  selection={tabContentSelection}
                  summary={ed.summary}
                  scripts={ed.scripts}
                  dataTypes={ed.dataTypes}
                  sourceConnector={ed.sourceConnector}
                  destinations={ed.destinations}
                  channelId={ed.channelId}
                  isDark={isDark}
                  allTags={ed.allTags}
                  tagsLoading={ed.tagsLoading}
                  onSelectedDestIndexChange={
                    ed.viewMode === "flow" && typeof ed.flowSelection === "object"
                      ? (i) => ed.setFlowSelection({ type: "destination", index: i })
                      : undefined
                  }
                  onSummaryChange={ed.handleSummaryChange}
                  onScriptsChange={ed.handleScriptsChange}
                  onTagsChange={ed.handleTagsChange}
                  onDataTypesChange={ed.handleDataTypesChange}
                  onSourceConnectorChange={ed.handleSourceConnectorChange}
                  onDestinationChange={ed.handleDestinationChange}
                  onDestinationAdd={ed.handleDestinationAdd}
                  onDestinationRemove={ed.handleDestinationRemove}
                  onDestinationDuplicate={ed.handleDestinationDuplicate}
                  onDestinationReorder={ed.handleDestinationReorder}
                  onSourceConnectorExport={ed.handleSourceConnectorExport}
                  onSourceConnectorImport={ed.handleSourceConnectorImport}
                  onDestinationExport={ed.handleDestinationExport}
                  onDestinationImport={ed.handleDestinationImport}
                  onOpenSourceFilter={() => ed.setFtView({ mode: "filter", target: "source" })}
                  onOpenSourceTransformer={() =>
                    ed.setFtView({ mode: "transformer", target: "source" })
                  }
                  onOpenDestFilter={(destIndex) =>
                    ed.setFtView({ mode: "filter", target: "dest", destIndex })
                  }
                  onOpenDestTransformer={(destIndex) =>
                    ed.setFtView({ mode: "transformer", target: "dest", destIndex })
                  }
                  onOpenDestResponseTransformer={(destIndex) =>
                    ed.setFtView({ mode: "responseTransformer", target: "dest", destIndex })
                  }
                  messageStorageMode={ed.summary?.messageStorageMode}
                  sourceTransformerXml={ed.sourceConnector?.transformerXml}
                  currentXml={ed.xml}
                  onLibraryResourcesChanged={ed.handleLibraryResourcesChanged}
                  srcSaveErrors={ed.srcSaveErrors}
                  destSaveErrors={ed.destSaveErrors}
                  onClearSrcErrors={ed.clearSrcSaveErrors}
                  onClearDestErrors={ed.clearDestSaveErrors}
                  initialScript={initialScript}
                  activePluginTab={ed.activePluginTab}
                  mode={props.mode}
                  editChannelId={props.mode === "edit" ? props.channelId : undefined}
                  channelName={ed.summary?.name}
                />
              )
            )}
          </div>
        </div>
      </div>

      {/* ── Delete destination confirmation dialog ─────────────────────── */}
      <DeleteDestinationDialog
        open={ed.deleteConfirmIdx !== null}
        destinationName={
          ed.deleteConfirmIdx !== null ? (ed.destinations[ed.deleteConfirmIdx]?.name ?? "") : ""
        }
        onClose={() => ed.setDeleteConfirmIdx(null)}
        onConfirm={() => {
          if (ed.deleteConfirmIdx !== null) {
            ed.handleDestinationRemove(ed.deleteConfirmIdx);
            if (typeof ed.flowSelection === "object" && ed.flowSelection.type === "destination") {
              const newIdx =
                ed.flowSelection.index >= ed.deleteConfirmIdx
                  ? Math.max(0, ed.flowSelection.index - 1)
                  : ed.flowSelection.index;
              ed.setFlowSelection({ type: "destination", index: newIdx });
            }
            ed.setDeleteConfirmIdx(null);
          }
        }}
      />
    </div>
  );
}
