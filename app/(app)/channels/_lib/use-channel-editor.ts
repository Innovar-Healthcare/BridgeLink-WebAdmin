"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useNavigationGuard } from "@/lib/navigation-guard";
import { getSlot } from "@/lib/plugin-slots";
import { slotSurfaceEnabled, surfaceGateEnabledSnapshot } from "@/lib/plugin-gating";
import { loadInstalledPlugins } from "@/lib/installed-plugins";
import { loadPluginLicenses } from "@/lib/plugin-license";
import { loadVersionHistoryEnabled } from "@/lib/version-history";
import {
  createChannelFromXml,
  updateChannelFromXml,
  deployChannels,
  getChannelXml,
  getServerVersion,
  getServerUrl,
  getUsers,
} from "@/lib/api-client";
import { getSession } from "@/lib/auth";
import { downloadFile } from "@/lib/download";
import { pickXmlFileText } from "@/lib/pick-file";
import {
  getChannelTags,
  getChannelIdsAndNames,
  getChannelMetadata,
  bulkUpdateChannelGroups,
} from "@/lib/api/api-channels";
import { getCache } from "@/lib/cache-store";
import { takePendingChannelImport, type PendingChannelImport } from "@/lib/channel-import-store";
import { buildTemplate, applyServerDefaults } from "./channel-template";
import { setChannelTags, getServerSettings } from "@/lib/api/api-settings";
import { parseChannelTagsFromExportXml } from "@/lib/api/parse-channel-tags-xml";
import { mergeImportedChannelTags } from "@/lib/channel-tag-utils";
import type { ChannelTag, ServerSettings } from "@/lib/types";
import {
  parseSummaryFromXml,
  serializeSummaryToXml,
  parseScriptsFromXml,
  serializeScriptsToXml,
  parseDataTypesFromXml,
  serializeDataTypesToXml,
  applyRequiredSourceInboundType,
  parseSourceConnectorFromXml,
  serializeSourceConnectorToXml,
  parseDestinationNamesFromXml,
  parseDestinationConnectorsFromXml,
  serializeDestinationConnectorToXml,
  addDestinationToXml,
  removeDestinationFromXml,
  serializeAllDestinationsToXml,
  duplicateDestinationToXml,
  exportSourceConnectorXml,
  exportDestinationConnectorXml,
  connectorExportFilename,
  parseConnectorFileMode,
  importSourceConnectorIntoXml,
  importDestinationConnectorIntoXml,
  injectSaveMetadata,
  setChannelEnabledInXml,
  parseChannelId,
  parseChannelName,
  setDefaultQueueBufferSize,
  type SummaryState,
  type ScriptsState,
  type DataTypesState,
  type SourceConnectorState,
  type DestinationConnectorState,
} from "./channel-xml";
import { cascadeOutboundDataType } from "./data-type-cascade";
import { validateChannelFiltersAndTransformers } from "./filter-transformer-validation";
import { getQueueStorageError } from "./queue-storage-validation";
import {
  validateMetaDataColumns,
  validatePruning,
  findMetaDataColumnDataLoss,
  channelNameCollides,
} from "./summary-validation";
import { CONNECTOR_REGISTRY } from "../_connectors";
import { validateListenerSettings } from "../_connectors/shared/validate-utils";
import { DESTINATION_CONNECTOR_REGISTRY } from "../_connectors/destinations";
import { PLUGIN_REGISTRY } from "../_connectors/plugins";
import { DESTINATION_PLUGIN_REGISTRY } from "../_connectors/destinations/plugins";
import { findListenerPortConflict, type PortConflict } from "./port-conflict";
import { useResizeHandle } from "@/lib/hooks/use-column-config";
import { toast } from "sonner";
import type {
  ChannelEditorCoreProps,
  EditorTab,
  FtView,
} from "../_components/channel-editor-types";
import type { FlowSelection } from "../_components/channel-flow-panel";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initAllState(text: string) {
  return {
    summary: parseSummaryFromXml(text),
    scripts: parseScriptsFromXml(text),
    dataTypes: parseDataTypesFromXml(text),
    sourceConnector: parseSourceConnectorFromXml(text),
    destinations: parseDestinationConnectorsFromXml(text),
    destNames: parseDestinationNamesFromXml(text),
  };
}

// ─── Return type ──────────────────────────────────────────────────────────────

export interface ChannelEditorState {
  // XML + async state
  xml: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  setError: (e: string | null) => void;

  // Dirty / new flags
  isDirty: boolean;
  isNew: boolean;
  needsSave: boolean;

  // Structured form state
  summary: SummaryState | null;
  scripts: ScriptsState | null;
  dataTypes: DataTypesState | null;
  sourceConnector: SourceConnectorState | null;
  destinations: DestinationConnectorState[];
  destNames: string[];

  // Tags
  allTags: ChannelTag[];
  tagsLoading: boolean;

  // Save-time validation errors
  srcSaveErrors: Set<string>;
  destSaveErrors: Map<number, Set<string>>;
  ftSaveErrored: boolean;
  clearSrcSaveErrors: () => void;
  clearDestSaveErrors: () => void;

  // Tab state
  activeTab: EditorTab;
  activePluginTab: string | null;
  setActivePluginTab: (key: string | null) => void;
  switchTab: (tab: EditorTab) => void;

  // FT overlay
  ftView: FtView | null;
  setFtView: (view: FtView | null) => void;

  // View mode
  viewMode: "flow" | "tabs";
  setViewMode: (mode: "flow" | "tabs") => void;
  flowSelection: FlowSelection;
  setFlowSelection: (sel: FlowSelection) => void;

  // Flow panel resize
  flowPanelWidth: number;
  onFlowPanelResize: (e: React.MouseEvent) => void;

  // Delete dialog
  deleteConfirmIdx: number | null;
  setDeleteConfirmIdx: (idx: number | null) => void;

  // Save & deploy dialog
  saveDeployConfirm: boolean;
  setSaveDeployConfirm: (v: boolean) => void;

  // Export-channel dialog (mirrors the Java editor's "Export Channel" task)
  exportChannelOpen: boolean;
  setExportChannelOpen: (v: boolean) => void;
  exportSaveConfirm: boolean;
  setExportSaveConfirm: (v: boolean) => void;
  handleExportChannel: () => void;
  confirmSaveThenExport: () => Promise<void>;

  // Port-conflict warning dialog
  portConflict: PortConflict | null;
  resolvePortConflict: (proceed: boolean) => void;

  // Concurrent-edit conflict dialog
  saveConflict: { otherUser: string } | null;
  resolveSaveConflict: (proceed: boolean) => void;

  // Custom-metadata schema-change confirm #18)
  metadataColumnConfirm: boolean;
  resolveMetadataColumnConfirm: (proceed: boolean) => void;

  // Connector-validation failure confirm #17) — save the channel disabled.
  // Carries the formatted validation-error text to show in the dialog, or null when closed.
  connectorValidationConfirm: string | null;
  resolveConnectorValidationConfirm: (proceed: boolean) => void;

  // Change handlers
  handleSummaryChange: (updates: Partial<SummaryState>) => void;
  handleScriptsChange: (updates: Partial<ScriptsState>) => void;
  handleTagsChange: (updated: ChannelTag[]) => void;
  handleDataTypesChange: (updated: DataTypesState) => void;
  handleLibraryResourcesChanged: (newXml: string) => void;
  handleSourceFtChange: (field: "filterXml" | "transformerXml", newXml: string) => void;
  handleDestFtChange: (
    destIndex: number,
    field: "filterXml" | "transformerXml" | "responseTransformerXml",
    newXml: string
  ) => void;
  handleSourceConnectorChange: (updates: Partial<SourceConnectorState>) => void;
  handleDestinationChange: (index: number, updates: Partial<DestinationConnectorState>) => void;
  handleDestinationAdd: (transportName: string) => void;
  handleDestinationRemove: (index: number) => void;
  handleDestinationReorder: (from: number, to: number) => void;
  handleDestinationToggleEnabled: (index: number) => void;
  handleDestinationDuplicate: (index: number) => void;
  handleSourceConnectorExport: () => void;
  handleSourceConnectorImport: () => void;
  handleDestinationExport: (index: number) => void;
  handleDestinationImport: () => void;

  // Save / deploy actions
  handleSave: () => Promise<boolean>;
  handleSaveAndDeploy: () => Promise<void>;
  handleDeploy: () => Promise<void>;

  // Navigation
  guardedNavigate: (path: string) => void;

  // Computed display values
  pageTitle: string;
  pageSubtitle: string | undefined;
  channelId: string;
}

/**
 * Resolve a BridgeLink user id to a display name for the concurrent-edit conflict prompt
 *. Mirrors the Java client, which names the other editor. Falls back to a generic
 * label when the id is unknown or the user list can't be fetched.
 */
async function resolveOtherUsername(userId: number | undefined): Promise<string> {
  if (userId == null) return "another user";
  try {
    const users = await getUsers();
    return users.find((u) => u.id === userId)?.username ?? `user ${userId}`;
  } catch {
    return "another user";
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useChannelEditor(
  props: ChannelEditorCoreProps,
  router: ReturnType<typeof useRouter>
): ChannelEditorState {
  // ── Canonical XML state ──────────────────────────────────────────────────
  const [xml, setXml] = useState<string | null>(null);
  const [savedXml, setSavedXml] = useState<string | null>(null);
  const [loading, setLoading] = useState(props.mode === "edit");
  const [saving, setSaving] = useState(false);
  const [saveDeployConfirm, setSaveDeployConfirm] = useState(false);
  const [exportChannelOpen, setExportChannelOpen] = useState(false);
  const [exportSaveConfirm, setExportSaveConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portConflict, setPortConflict] = useState<PortConflict | null>(null);
  const portConflictResolveRef = useRef<((proceed: boolean) => void) | null>(null);

  // Concurrent-edit conflict dialog. `otherUser` is the already-resolved display name
  // of whoever modified the channel since editing began. Mirrors Java Frame.updateChannel: another
  // user's edit prompts before overwriting; a same-user edit overwrites silently (handled inline).
  const [saveConflict, setSaveConflict] = useState<{ otherUser: string } | null>(null);
  const saveConflictResolveRef = useRef<((proceed: boolean) => void) | null>(null);

  // Custom-metadata schema-change confirm #18). Shown when a save would rename,
  // delete, or change the type of an already-saved column — which deletes that column's
  // stored data on deploy. Mirrors Java ChannelSetup.java:1219-1222's alertOption gate.
  const [metadataColumnConfirm, setMetadataColumnConfirm] = useState(false);
  const metadataColumnConfirmResolveRef = useRef<((proceed: boolean) => void) | null>(null);

  // Connector-validation failure confirm #17). Mirrors Java ChannelSetup.saveChanges:
  // on validation failure it alerts, sets metadata.enabled=false, and still saves. We offer the
  // same save-disabled path via a confirm dialog; the state holds the error text to display.
  const [connectorValidationConfirm, setConnectorValidationConfirm] = useState<string | null>(null);
  const connectorValidationConfirmResolveRef = useRef<((proceed: boolean) => void) | null>(null);
  // Wall-clock instant editing began for this channel — sent as `startEdit` so the server can
  // detect a concurrent modification (it compares this against the stored lastModified). Set in the
  // edit-load effect (before any save is possible) and reset after every successful save so
  // same-session re-saves don't self-conflict. Initialized to 0 to keep the ref initializer pure
  // (Date.now() during render is disallowed); the effect overwrites it before it's ever read.
  const startEditRef = useRef<number>(0);

  // ── Tag state ────────────────────────────────────────────────────────────
  const [allTags, setAllTags] = useState<ChannelTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(true);
  const [tagsDirty, setTagsDirty] = useState(false);

  // ── Structured form state ────────────────────────────────────────────────
  const [summary, setSummary] = useState<SummaryState | null>(null);
  const [scripts, setScripts] = useState<ScriptsState | null>(null);
  const [dataTypes, setDataTypes] = useState<DataTypesState | null>(null);
  const [sourceConnector, setSourceConnector] = useState<SourceConnectorState | null>(null);
  const [destinations, setDestinations] = useState<DestinationConnectorState[]>([]);
  const [destNames, setDestNames] = useState<string[]>([]);

  // ── Connector save-time validation errors ────────────────────────────────
  const [srcSaveErrors, setSrcSaveErrors] = useState<Set<string>>(new Set());
  const [destSaveErrors, setDestSaveErrors] = useState<Map<number, Set<string>>>(new Map());
  const [ftSaveErrored, setFtSaveErrored] = useState(false);

  // ── Always-current refs ──────────────────────────────────────────────────
  const xmlRef = useRef<string | null>(null);
  const savedXmlRef = useRef<string | null>(null);
  const destinationsRef = useRef<DestinationConnectorState[]>([]);
  // Synced in a deps-less effect (not during render) to satisfy react-hooks/refs.
  // All are only read from event handlers / guard callbacks, never during render.
  // savedXmlRef mirrors the last-persisted XML so doSave can diff outgoing metadata
  // columns against the saved schema #18) without adding a callback dep.
  useEffect(() => {
    xmlRef.current = xml;
    savedXmlRef.current = savedXml;
    destinationsRef.current = destinations;
  });

  // ── Tab state ────────────────────────────────────────────────────────────
  const initTab = props.mode === "edit" ? (props.initialTab ?? "summary") : "summary";
  const [activeTab, setActiveTab] = useState<EditorTab>(initTab);
  const [activePluginTab, setActivePluginTab] = useState<string | null>(null);

  // ── Filter / Transformer overlay ─────────────────────────────────────────
  const [ftView, setFtView] = useState<FtView | null>(() => {
    if (props.mode !== "edit" || !props.initialSub) return null;
    const sub = props.initialSub;
    if (sub !== "filter" && sub !== "transformer" && sub !== "responseTransformer") return null;
    if (props.initialTab === "source") {
      return { mode: sub as "filter" | "transformer", target: "source" };
    }
    if (props.initialTab === "destination") {
      return { mode: sub, target: "dest", destIndex: props.initialDestIndex ?? 0 };
    }
    return null;
  });

  // ── View mode (persisted globally to localStorage) ───────────────────────
  const VIEW_MODE_KEY = "bl-edit-channel-view-mode-v1";
  const [viewMode, setViewModeState] = useState<"flow" | "tabs">(() => {
    if (typeof window === "undefined") return "flow";
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    return saved === "tabs" ? "tabs" : "flow";
  });
  const setViewMode = useCallback((mode: "flow" | "tabs") => {
    setViewModeState(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }, []);
  const [flowSelection, setFlowSelection] = useState<FlowSelection>(() => {
    if (props.mode !== "edit" || !props.initialTab) return "summary";
    switch (props.initialTab) {
      case "source":
        return "source";
      case "destination":
        return { type: "destination", index: props.initialDestIndex ?? 0 };
      case "scripts":
        return "scripts";
      default:
        return "summary";
    }
  });

  // ── Resizable flow panel width ───────────────────────────────────────────
  const [flowPanelWidth, setFlowPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 256;
    const stored = localStorage.getItem("bl-channels-flow-panel-width");
    return stored ? Math.max(200, Math.min(400, Number(stored))) : 256;
  });
  const { onMouseDown: onFlowPanelResize } = useResizeHandle(flowPanelWidth, 200, (w) => {
    const clamped = Math.min(400, w);
    setFlowPanelWidth(clamped);
    localStorage.setItem("bl-channels-flow-panel-width", String(clamped));
  });

  // ── Delete confirmation dialog ───────────────────────────────────────────
  const [deleteConfirmIdx, setDeleteConfirmIdx] = useState<number | null>(null);

  const isDirty = (xml !== null && xml !== savedXml) || tagsDirty;
  const isNew = props.mode === "new";
  const needsSave = isNew ? xml !== null : isDirty;

  // ── Navigation guard ─────────────────────────────────────────────────────
  const { registerGuard, unregisterGuard, guardedNavigate } = useNavigationGuard();

  const isDirtyRef = useRef(isDirty);
  const doSaveRef = useRef<() => Promise<void>>(async () => {});
  // Synced in a deps-less effect (read only from the navigation-guard callback).
  useEffect(() => {
    isDirtyRef.current = isDirty;
  });

  // ── Mode-specific initialization ─────────────────────────────────────────
  const initKey = props.mode === "edit" ? props.channelId : "__new__";

  //: an imported channel may have been queued for review by an import
  // dialog before navigating here. Consume it exactly once. The take-and-clear
  // and the ref read happen inside the init effect (never during render); the
  // ref guard keeps the value stable across StrictMode's double effect run and
  // across initKey changes (navigating between channels).
  const pendingImportRef = useRef<{ taken: boolean; value: PendingChannelImport | null }>({
    taken: false,
    value: null,
  });

  //: tags carried in an imported channel's <exportData>, queued here by the
  // seed branch and folded into `allTags` once the global tag set has loaded (the two
  // run as independent async effects). `{ tags, channelId }` or null when nothing is
  // pending. Intentionally not cleared once applied — the consuming effect is mount-only
  // and its merge is idempotent (see the tag-load effect below).
  const importedTagsRef = useRef<{ tags: ChannelTag[]; channelId: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!pendingImportRef.current.taken) {
      pendingImportRef.current = { taken: true, value: takePendingChannelImport() };
    }
    const pendingImport = pendingImportRef.current.value;
    const seedXml =
      pendingImport &&
      ((props.mode === "new" && pendingImport.mode === "new") ||
        (props.mode === "edit" &&
          pendingImport.mode === "overwrite" &&
          pendingImport.channelId === props.channelId))
        ? pendingImport.xml
        : null;

    if (seedXml) {
      // Seed the editor from the imported channel for review instead of building
      // a template (new) or fetching from the server (overwrite). Mark dirty
      // (savedXml = null) so the navigation guard protects the imported content
      // and Save is the explicit commit. The existing mode-based save path then
      // routes to POST (new) or PUT override (edit/overwrite). State is set in a
      // microtask (like the fetch branches below) to avoid synchronous setState
      // in the effect body.
      Promise.resolve().then(() => {
        if (cancelled) return;
        const derived = initAllState(seedXml);
        setXml(seedXml);
        setSavedXml(null);
        setSummary(derived.summary);
        setScripts(derived.scripts);
        setDataTypes(derived.dataTypes);
        setSourceConnector(derived.sourceConnector);
        setDestinations(derived.destinations);
        setDestNames(derived.destNames);
        setLoading(false);
      });
      //: recover the tags the export file carried so the imported channel
      // arrives tagged (matching the Java client). Stash them keyed to the channel's
      // final id; the tag-load effect merges them into `allTags` and marks dirty so
      // Save persists them. mode "new" → id from the seeded XML; "overwrite" → route id.
      const importedTags = parseChannelTagsFromExportXml(seedXml);
      if (importedTags.length > 0) {
        const targetId = props.mode === "edit" ? props.channelId : (parseChannelId(seedXml) ?? "");
        if (targetId) importedTagsRef.current = { tags: importedTags, channelId: targetId };
      }
    } else if (props.mode === "edit") {
      // Record when editing began (mirrors Java ChannelSetup's dateStartEdit) so the save PUT can
      // send `startEdit` and the server can detect a concurrent modification.
      startEditRef.current = Date.now();
      startTransition(() => {
        setLoading(true);
        setError(null);
      });
      getChannelXml(props.channelId)
        .then((text) => {
          if (cancelled) return;
          const derived = initAllState(text);
          // Auto-fix: if the source connector requires a specific inbound type,
          // enforce it now so channels saved before this check are corrected on load.
          const srcDef = CONNECTOR_REGISTRY[derived.sourceConnector.transportName];
          const requiredOnLoad =
            srcDef?.getRequiredInboundDataType?.(derived.sourceConnector.propertiesXml) ?? null;
          let workingText = text;
          let loadedDataTypes = derived.dataTypes;
          let loadedSourceConnector = derived.sourceConnector;
          if (
            requiredOnLoad &&
            derived.dataTypes.connectors[0]?.inboundDataType !== requiredOnLoad
          ) {
            loadedDataTypes = applyRequiredSourceInboundType(derived.dataTypes, requiredOnLoad);
            workingText = serializeDataTypesToXml(text, loadedDataTypes);
            loadedSourceConnector = parseSourceConnectorFromXml(workingText);
          }
          setXml(workingText);
          setSavedXml(text);
          setSummary(derived.summary);
          setScripts(derived.scripts);
          setDataTypes(loadedDataTypes);
          setSourceConnector(loadedSourceConnector);
          setDestinations(derived.destinations);
          setDestNames(derived.destNames);
        })
        .catch((e) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      Promise.all([
        getServerVersion(getServerUrl()).catch(() => "4.0.0"),
        getServerSettings().catch(() => null as ServerSettings | null),
      ]).then(([version, settings]) => {
        if (cancelled) return;
        const { xml: seeded } = buildTemplate(version);
        const withSettings = settings ? applyServerDefaults(seeded, settings) : seeded;
        const withDefaults = addDestinationToXml(withSettings, "Channel Writer");
        const derived = initAllState(withDefaults);
        setXml(withDefaults);
        setSavedXml(withDefaults);
        setSummary(derived.summary);
        setScripts(derived.scripts);
        setDataTypes(derived.dataTypes);
        setSourceConnector(derived.sourceConnector);
        setDestinations(derived.destinations);
        setDestNames(derived.destNames);
      });
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initKey]);

  // ── Auto-sync dataTypes from xml ─────────────────────────────────────────
  // Re-derive dataTypes whenever the channel XML changes (adjust state during render).
  const [prevXmlForDataTypes, setPrevXmlForDataTypes] = useState(xml);
  if (xml !== prevXmlForDataTypes) {
    setPrevXmlForDataTypes(xml);
    if (xml) setDataTypes(parseDataTypesFromXml(xml));
  }

  // ── Cache the server-configured default queue buffer size ────────────────
  // Mirrors Java ChannelSetup reading serverSettings.getQueueBufferSize() into defaultQueueBufferSize;
  // parse fallbacks and newly-added destinations substitute it wherever a stored value is <= 0.
  // Runs for every mode (edit/import/new) so adding a destination to any channel honors the setting.
  useEffect(() => {
    let cancelled = false;
    getServerSettings()
      .then((settings) => {
        if (!cancelled) setDefaultQueueBufferSize(settings.queueBufferSize);
      })
      .catch(() => {
        /* leave the 1000 fallback in place */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load all channel tags on mount ───────────────────────────────────────
  useEffect(() => {
    getChannelTags()
      .then((tags) => {
        //: if this editor was seeded from an import that carried tags, fold
        // them into the freshly-loaded global set (remapped to the channel's final id)
        // and mark dirty so Save persists them. The ref is intentionally not cleared:
        // this effect is mount-only ([] deps) but runs twice under StrictMode, and the
        // merge is idempotent on a fresh base set, so applying it on both runs yields
        // the same result regardless of which fetch resolves last.
        const pending = importedTagsRef.current;
        if (pending) {
          setAllTags(mergeImportedChannelTags(tags, pending.tags, pending.channelId));
          setTagsDirty(true);
        } else {
          setAllTags(tags);
        }
      })
      .catch(() => {
        /* silently fail */
      })
      .finally(() => setTagsLoading(false));
  }, []);

  // ── Warn on close with unsaved changes ───────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // ── Register navigation guard ────────────────────────────────────────────
  useEffect(() => {
    registerGuard(
      () => isDirtyRef.current,
      () => doSaveRef.current(),
      "channel changes"
    );
    return () => unregisterGuard();
  }, [registerGuard, unregisterGuard]);

  // ── Tab switching ────────────────────────────────────────────────────────
  function switchTab(newTab: EditorTab) {
    if (newTab === activeTab && activePluginTab === null) return;
    setActiveTab(newTab);
    setActivePluginTab(null);
  }

  // ── Form change handlers ─────────────────────────────────────────────────

  const handleSummaryChange = useCallback(
    (updates: Partial<SummaryState>) => {
      if (!summary || !xml) return;
      const next = { ...summary, ...updates };
      setSummary(next);
      setXml(serializeSummaryToXml(xml, next));
    },
    [summary, xml]
  );

  const handleScriptsChange = useCallback(
    (updates: Partial<ScriptsState>) => {
      if (!scripts || !xml) return;
      const next = { ...scripts, ...updates };
      setScripts(next);
      setXml(serializeScriptsToXml(xml, next));
    },
    [scripts, xml]
  );

  const handleTagsChange = useCallback((updated: ChannelTag[]) => {
    setAllTags(updated);
    setTagsDirty(true);
  }, []);

  const handleDataTypesChange = useCallback((updated: DataTypesState) => {
    const x = xmlRef.current;
    if (!x) return;
    const newXml = serializeDataTypesToXml(x, updated);
    setXml(newXml);
    setSourceConnector(parseSourceConnectorFromXml(newXml));
    setDestinations(parseDestinationConnectorsFromXml(newXml));
  }, []);

  // Called from the Channel Dependencies dialog when the Library Resources selection
  // changes. Pushes the dependency-dialog-generated XML into our local state so the
  // channel becomes dirty and the Resources chip on the Summary tab re-counts.
  // Only touch summary.resourceIdCount — other summary fields may hold unsaved user
  // edits that should not be overwritten by re-parsing the XML.
  const handleLibraryResourcesChanged = useCallback((newXml: string) => {
    setXml(newXml);
    const fresh = parseSummaryFromXml(newXml);
    setSummary((s) => (s ? { ...s, resourceIdCount: fresh.resourceIdCount } : fresh));
  }, []);

  const handleSourceFtChange = useCallback(
    (field: "filterXml" | "transformerXml", newXml: string) => {
      if (!sourceConnector) return;
      const next = { ...sourceConnector, [field]: newXml };
      const x = xmlRef.current;
      if (!x) {
        setSourceConnector(next);
        return;
      }
      const base = serializeSourceConnectorToXml(x, next);

      //: when the source OUTBOUND data type changes via the transformer
      // Message Templates tab, cascade it to every destination inbound type — the
      // same cascade the Summary "Set Data Types" dialog performs, mirroring Java
      // DataTypesDialog.updateSingleDataType (SOURCE branch). No-op (returns `base`)
      // for ordinary transformer edits (steps/scripts/templates).
      const out = field === "transformerXml" ? cascadeOutboundDataType(x, base, "source") : base;

      if (out !== base) {
        // Cascade fired — re-derive both connectors from the resulting XML so React
        // state matches the serialized channel (mirrors handleDataTypesChange). This
        // also picks up the source row's normalized outbound-properties, keeping the
        // (locked) destination inbound selectors and the source connector in sync.
        setSourceConnector(parseSourceConnectorFromXml(out));
        setDestinations(parseDestinationConnectorsFromXml(out));
      } else {
        setSourceConnector(next);
      }

      setXml(out);
    },
    [sourceConnector]
  );

  const handleDestFtChange = useCallback(
    (
      destIndex: number,
      field: "filterXml" | "transformerXml" | "responseTransformerXml",
      newXml: string
    ) => {
      setDestinations((prev) => {
        const next = prev.map((d, i) => (i === destIndex ? { ...d, [field]: newXml } : d));
        const x = xmlRef.current;
        if (!x) return next;
        const base = serializeDestinationConnectorToXml(x, destIndex, next[destIndex]);

        //: a destination's OUTBOUND type change (its transformer) cascades to
        // that destination's response transformer inbound + outbound, mirroring Java
        // DataTypesDialog. No-op for ordinary transformer edits.
        const out =
          field === "transformerXml" ? cascadeOutboundDataType(x, base, `dest-${destIndex}`) : base;

        setXml(out);
        // Re-derive so the response transformer's inbound/outbound selectors re-render.
        return out !== base ? parseDestinationConnectorsFromXml(out) : next;
      });
    },
    []
  );

  const handleSourceConnectorChange = useCallback(
    (updates: Partial<SourceConnectorState>) => {
      if (!sourceConnector) return;
      const next = { ...sourceConnector, ...updates };

      const x = xmlRef.current;
      if (!x) {
        setSourceConnector(next);
        return;
      }

      let newXml = serializeSourceConnectorToXml(x, next);

      // If the connector requires a specific inbound data type, enforce it now.
      // This mirrors Java ChannelSetup.checkAndSetSourceDataType().
      const def = CONNECTOR_REGISTRY[next.transportName];
      const required = def?.getRequiredInboundDataType?.(next.propertiesXml) ?? null;
      if (required) {
        const dt = parseDataTypesFromXml(newXml);
        if (dt.connectors[0]?.inboundDataType !== required) {
          newXml = serializeDataTypesToXml(newXml, applyRequiredSourceInboundType(dt, required));
          // Re-parse so sourceConnector.transformerXml contains the forced inbound type
          setSourceConnector(parseSourceConnectorFromXml(newXml));
        } else {
          setSourceConnector(next);
        }
      } else {
        setSourceConnector(next);
      }

      setXml(newXml);
    },
    [sourceConnector]
  );

  const handleDestinationChange = useCallback(
    (index: number, updates: Partial<DestinationConnectorState>) => {
      setDestinations((prev) => {
        const next = prev.map((d, i) => (i === index ? { ...d, ...updates } : d));
        setXml((x) => (x ? serializeDestinationConnectorToXml(x, index, next[index]) : x));
        return next;
      });
    },
    []
  );

  const handleDestinationAdd = useCallback((transportName: string) => {
    const x = xmlRef.current;
    if (!x) return;
    const next = addDestinationToXml(x, transportName);
    setXml(next);
    setDestinations(parseDestinationConnectorsFromXml(next));
  }, []);

  const handleDestinationRemove = useCallback((index: number) => {
    const x = xmlRef.current;
    if (!x) return;
    const next = removeDestinationFromXml(x, index);
    setXml(next);
    setDestinations(parseDestinationConnectorsFromXml(next));
  }, []);

  const handleDestinationReorder = useCallback((from: number, to: number) => {
    const prev = destinationsRef.current;
    const next = [...prev];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDestinations(next);
    const x = xmlRef.current;
    if (x) setXml(serializeAllDestinationsToXml(x, next));
  }, []);

  const handleDestinationToggleEnabled = useCallback((index: number) => {
    const prev = destinationsRef.current;
    const target = prev[index];
    if (target?.enabled) {
      const enabledCount = prev.filter((d) => d.enabled).length;
      if (enabledCount <= 1) {
        toast.warning("At least one destination must be enabled.");
        return;
      }
    }
    const next = prev.map((d, i) => (i === index ? { ...d, enabled: !d.enabled } : d));
    setDestinations(next);
    const x = xmlRef.current;
    if (x) setXml(serializeAllDestinationsToXml(x, next));
  }, []);

  const handleDestinationDuplicate = useCallback((index: number) => {
    const x = xmlRef.current;
    if (!x) return;
    const next = duplicateDestinationToXml(x, destinationsRef.current, index);
    setXml(next);
    setDestinations(parseDestinationConnectorsFromXml(next));
  }, []);

  // ── Export / Import a single connector ─────────────────────────────────────
  // Mirrors Java Frame.doExportConnector() / doImportConnector(). Export works
  // off the live in-memory XML (reflects unsaved edits — no forced save).

  const handleSourceConnectorExport = useCallback(() => {
    const x = xmlRef.current;
    if (!x) return;
    const out = exportSourceConnectorXml(x);
    if (!out) return;
    downloadFile(out, `${connectorExportFilename(x, "source")}.xml`, {
      mimeType: "application/xml",
    });
  }, []);

  const handleDestinationExport = useCallback((index: number) => {
    const x = xmlRef.current;
    if (!x) return;
    const out = exportDestinationConnectorXml(x, index);
    if (!out) return;
    downloadFile(out, `${connectorExportFilename(x, { destIndex: index })}.xml`, {
      mimeType: "application/xml",
    });
  }, []);

  const handleSourceConnectorImport = useCallback(async () => {
    const x = xmlRef.current;
    if (!x) return;
    const fileXml = await pickXmlFileText();
    if (fileXml == null) return;
    const mode = parseConnectorFileMode(fileXml);
    if (mode !== "SOURCE") {
      setError(
        mode === "DESTINATION"
          ? "This file contains a Destination connector. Use a destination's Import Connector action instead."
          : "The selected file is not a valid connector export."
      );
      return;
    }
    try {
      const next = importSourceConnectorIntoXml(x, fileXml);
      setXml(next);
      setSourceConnector(parseSourceConnectorFromXml(next));
      setDestinations(parseDestinationConnectorsFromXml(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const handleDestinationImport = useCallback(async () => {
    const x = xmlRef.current;
    if (!x) return;
    const fileXml = await pickXmlFileText();
    if (fileXml == null) return;
    const mode = parseConnectorFileMode(fileXml);
    if (mode !== "DESTINATION") {
      setError(
        mode === "SOURCE"
          ? "This file contains a Source connector. Use the source's Import Connector action instead."
          : "The selected file is not a valid connector export."
      );
      return;
    }
    try {
      const next = importDestinationConnectorIntoXml(x, fileXml);
      setXml(next);
      setDestinations(parseDestinationConnectorsFromXml(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // ── doSave ───────────────────────────────────────────────────────────────
  const doSave = useCallback(async () => {
    // `let` because a connector-validation failure may rewrite it to save disabled (#17).
    let x = xmlRef.current;
    if (!x) return;

    // Set when the user opts to save a connector-invalid channel as disabled (#17). Callers
    // (Save & Deploy) use this to skip deploying a channel that was just saved non-runnable.
    let savedDisabled = false;

    const channelName = parseChannelName(x);

    if (!channelName.trim()) {
      throw new Error("Channel name cannot be empty.");
    }
    if (channelName.length > 40) {
      throw new Error("Channel name cannot be longer than 40 characters.");
    }
    if (/[^a-zA-Z0-9\-_ ]/.test(channelName)) {
      throw new Error(
        "Channel name cannot contain special characters besides hyphens, underscores, and spaces."
      );
    }

    const namesMap = await getChannelIdsAndNames();

    // Duplicate channel-name check is case-insensitive (mirrors Java
    // Frame.checkChannelName:4941-4946 equalsIgnoreCase; self excluded by id).
    if (
      channelNameCollides(
        channelName,
        props.mode === "edit" ? props.channelId : undefined,
        namesMap.entries()
      )
    ) {
      throw new Error(`A channel named "${channelName}" already exists.`);
    }

    const summary = parseSummaryFromXml(x);

    // Custom metadata column names: reject empty/reserved/invalid/duplicate on the RAW
    // list (mirrors Java ChannelSetup.java:1189-1209 — a blank column name blocks the
    // save; it is NOT silently filtered out).
    const colError = validateMetaDataColumns(summary.metaDataColumns);
    if (colError) throw new Error(colError);

    // Pruning: content age cannot exceed metadata age (mirrors Java ChannelSetup.java:1167-1175).
    const pruneError = validatePruning(
      summary.pruningSettings.pruneMetaDataDays,
      summary.pruningSettings.pruneContentDays
    );
    if (pruneError) throw new Error(pruneError);

    {
      const dests = parseDestinationConnectorsFromXml(x);
      const destNameCounts = new Map<string, number>();
      for (const d of dests) {
        const n = d.name.trim();
        if (n) destNameCounts.set(n, (destNameCounts.get(n) ?? 0) + 1);
      }
      const dupDestNames = [...destNameCounts.entries()].filter(([, c]) => c > 1).map(([n]) => n);
      if (dupDestNames.length > 0) {
        throw new Error(
          `Duplicate destination name${dupDestNames.length > 1 ? "s" : ""}: ${dupDestNames.map((n) => `"${n}"`).join(", ")}. All destination names must be unique.`
        );
      }
    }

    {
      // Warm every snapshot surfaceGateEnabledSnapshot can read — enablement,
      // license, and the Version History feature flag (its pluginName is
      // special-cased in the gate) — so the per-plugin gate below reads accurate
      // values item 2). The editor tabs already warm these on open;
      // this only matters in a fast-save race, and all loaders are no-ops once
      // resolved.
      await Promise.all([
        loadInstalledPlugins(),
        loadPluginLicenses(),
        loadVersionHistoryEnabled(),
      ]);

      const validationErrors: string[] = [];
      const newSrcErrors = new Set<string>();
      const newDestErrors = new Map<number, Set<string>>();

      const srcState = parseSourceConnectorFromXml(x);
      const srcValidate = CONNECTOR_REGISTRY[srcState.transportName]?.validate;
      if (srcValidate) {
        const srcErrors = srcValidate(srcState.propertiesXml);
        if (srcErrors.length > 0) {
          srcErrors.forEach((e) => newSrcErrors.add(e.field));
          validationErrors.push(
            `Source (${srcState.transportName}):\n${srcErrors.map((e) => `  - ${e.message}`).join("\n")}`
          );
        }
      }
      // Shared listener host/port check — runs for any socket-listener connector
      // (no-op otherwise). Mirrors Java ConnectorPanel → ListenerSettingsPanel.checkProperties.
      {
        const listenerErrors = validateListenerSettings(srcState.propertiesXml);
        if (listenerErrors.length > 0) {
          listenerErrors.forEach((e) => newSrcErrors.add(e.field));
          validationErrors.push(
            `Source (${srcState.transportName}):\n${listenerErrors.map((e) => `  - ${e.message}`).join("\n")}`
          );
        }
      }
      for (const plugin of PLUGIN_REGISTRY) {
        // Skip plugins whose config section the UI gate hides (disabled/
        // unlicensed): validating them would block the save with errors pointing
        // at hidden UI. Same enablement+license gate the render sites use
        // item 2).
        if (!surfaceGateEnabledSnapshot(plugin)) continue;
        if (!plugin.validate) continue;
        if (!plugin.isApplicable(srcState.transportName, srcState.propertiesXml)) continue;
        const pluginErrors = plugin.validate(srcState.propertiesXml);
        if (pluginErrors.length > 0) {
          pluginErrors.forEach((e) => newSrcErrors.add(e.field));
          validationErrors.push(
            `Source (${srcState.transportName}):\n${pluginErrors.map((e) => `  - ${e.message}`).join("\n")}`
          );
        }
      }
      const dests = parseDestinationConnectorsFromXml(x);
      for (let i = 0; i < dests.length; i++) {
        const d = dests[i];
        if (!d.enabled) continue;
        const destValidate = DESTINATION_CONNECTOR_REGISTRY[d.transportName]?.validate;
        if (destValidate) {
          const destErrors = destValidate(d.propertiesXml);
          if (destErrors.length > 0) {
            newDestErrors.set(i, new Set(destErrors.map((e) => e.field)));
            validationErrors.push(
              `Destination ${i + 1} "${d.name}" (${d.transportName}):\n${destErrors.map((e) => `  - ${e.message}`).join("\n")}`
            );
          }
        }
        for (const plugin of DESTINATION_PLUGIN_REGISTRY) {
          if (!surfaceGateEnabledSnapshot(plugin)) continue;
          if (!plugin.validate) continue;
          if (!plugin.isApplicable(d.transportName, d.propertiesXml)) continue;
          const pluginErrors = plugin.validate(d.propertiesXml);
          if (pluginErrors.length > 0) {
            const existing = newDestErrors.get(i) ?? new Set<string>();
            pluginErrors.forEach((e) => existing.add(e.field));
            newDestErrors.set(i, existing);
            validationErrors.push(
              `Destination ${i + 1} "${d.name}" (${d.transportName}):\n${pluginErrors.map((e) => `  - ${e.message}`).join("\n")}`
            );
          }
        }
      }
      if (validationErrors.length > 0) {
        // Highlight the offending fields, then — mirroring Java ChannelSetup.saveChanges,
        // which alerts, sets metadata.enabled=false, and still saves — offer to save the
        // channel disabled rather than hard-blocking #17). Cancel aborts the save.
        setSrcSaveErrors(newSrcErrors);
        setDestSaveErrors(newDestErrors);
        const proceed = await new Promise<boolean>((resolve) => {
          connectorValidationConfirmResolveRef.current = resolve;
          setConnectorValidationConfirm(validationErrors.join("\n\n"));
        });
        if (!proceed) return false;
        x = setChannelEnabledInXml(x, false);
        savedDisabled = true;
      }
    }

    {
      const ftErrors = validateChannelFiltersAndTransformers(x);
      if (ftErrors.length > 0) {
        setFtSaveErrored(true);
        const formatted = ftErrors
          .map((e) => `${e.location} — ${e.elementType} "${e.elementName}": ${e.message}`)
          .join("\n");
        throw new Error(`Filter/Transformer validation failed:\n\n${formatted}`);
      }
    }

    {
      // Block saving when queueing is incompatible with the message storage mode
      // (mirrors Java ChannelSetup.saveChanges() → getQueueErrorString).
      const messageStorageMode = parseSummaryFromXml(x).messageStorageMode;
      const sourceQueueEnabled = !parseSourceConnectorFromXml(x).respondAfterProcessing;
      const destinationQueueEnabled = parseDestinationConnectorsFromXml(x).some(
        (d) => d.queue.queueEnabled
      );
      const queueError = getQueueStorageError(
        messageStorageMode,
        sourceQueueEnabled,
        destinationQueueEnabled
      );
      if (queueError) {
        throw new Error(queueError);
      }
    }

    {
      const selfId = props.mode === "edit" ? props.channelId : (parseChannelId(x) ?? "");
      const srcProps = parseSourceConnectorFromXml(x).propertiesXml;
      const cache = getCache();
      const conflict = findListenerPortConflict(srcProps, selfId, cache.channels, cache.configMap);
      if (conflict) {
        const proceed = await new Promise<boolean>((resolve) => {
          portConflictResolveRef.current = resolve;
          setPortConflict(conflict);
        });
        if (!proceed) return false;
      }
    }

    // Custom-metadata schema-change confirm (mirrors Java ChannelSetup.java:1179-1222): if a
    // saved column has been renamed, deleted, or had its type changed, its stored data is
    // deleted on deploy — prompt before proceeding. New columns / reordering don't lose data.
    if (props.mode === "edit" && savedXmlRef.current) {
      const savedCols = parseSummaryFromXml(savedXmlRef.current).metaDataColumns;
      if (findMetaDataColumnDataLoss(savedCols, summary.metaDataColumns)) {
        const proceed = await new Promise<boolean>((resolve) => {
          metadataColumnConfirmResolveRef.current = resolve;
          setMetadataColumnConfirm(true);
        });
        if (!proceed) return false;
      }
    }

    const userId = getSession()?.userId ?? 1;
    const xToSave = injectSaveMetadata(x, userId);

    if (props.mode === "edit") {
      // Concurrent-edit protection (mirrors Java Frame.updateChannel,. Attempt the save
      // with override=false + the edit-start timestamp so the server can reject it if the channel
      // was modified since we opened it. On conflict: silently overwrite if we were the last
      // modifier (same-user re-save), otherwise prompt naming the other user before overwriting.
      const applied = await updateChannelFromXml(
        props.channelId,
        xToSave,
        false,
        startEditRef.current
      );
      if (!applied) {
        const currentUserId = getSession()?.userId;
        // Identify the last modifier so we can distinguish a same-user re-save (silent overwrite)
        // from another user's edit (prompt). Prefer the warm cache; fall back to a fresh fetch
        // because the editor doesn't populate channelMetadata (a deep-link to the edit page can
        // have a cold cache). Mirrors Java fetching the original-state channel's userId.
        let lastModifierId = getCache().channelMetadata[props.channelId]?.userId;
        if (lastModifierId == null) {
          lastModifierId = await getChannelMetadata()
            .then((m) => m[props.channelId]?.userId)
            .catch(() => undefined);
        }
        // Only overwrite silently on a positive same-user match; when the modifier is unknown,
        // prompt rather than risk clobbering another user's work without asking.
        const sameUser =
          lastModifierId != null && currentUserId != null && lastModifierId === currentUserId;
        if (sameUser) {
          await updateChannelFromXml(props.channelId, xToSave, true);
        } else {
          const otherUser = await resolveOtherUsername(lastModifierId);
          const proceed = await new Promise<boolean>((resolve) => {
            saveConflictResolveRef.current = resolve;
            setSaveConflict({ otherUser });
          });
          if (!proceed) return false;
          await updateChannelFromXml(props.channelId, xToSave, true);
        }
      }
      // Reset the edit-start clock so an immediate re-save in this session isn't flagged as a
      // conflict against the lastModified we just wrote.
      startEditRef.current = Date.now();
      setXml(xToSave);
      setSavedXml(xToSave);
      setSummary(parseSummaryFromXml(xToSave));
      setScripts(parseScriptsFromXml(xToSave));
      setSourceConnector(parseSourceConnectorFromXml(xToSave));
      setDestinations(parseDestinationConnectorsFromXml(xToSave));
      setDestNames(parseDestinationNamesFromXml(xToSave));
      if (tagsDirty) {
        await setChannelTags(allTags);
        setTagsDirty(false);
      }
    } else {
      await createChannelFromXml(xToSave);
      const channelId = parseChannelId(xToSave);
      if (tagsDirty && channelId) {
        await setChannelTags(allTags);
      }
      setFtSaveErrored(false);
      setXml(xToSave);
      setSavedXml(xToSave);
    }
    // Call any registered post-save plugin handler (e.g. version history git
    // write + auto-commit) only when its owning plugin is enabled.
    // The async gate is load-accurate so a genuinely-enabled plugin's handler
    // is never skipped due to a cold enablement cache. Errors are silently
    // swallowed — they must not surface as channel save failures.
    if (await slotSurfaceEnabled("channels.post-save")) {
      await getSlot("channels.post-save")?.(xToSave, props.mode).catch(() => {});
    }
    return savedDisabled ? "saved-disabled" : true;
  }, [props, tagsDirty, allTags]);

  // Synced in a deps-less effect (read only from the navigation-guard callback).
  useEffect(() => {
    doSaveRef.current = async () => {
      await doSave();
    };
  });

  // ── Save handlers ────────────────────────────────────────────────────────
  const handleSave = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const saved = await doSave();
      if (!saved) {
        setSaving(false);
        return false;
      }
      if (props.mode === "new") {
        const channelId = parseChannelId(xmlRef.current ?? "");
        if (channelId && props.defaultGroupId) {
          const group = getCache().channelGroups.find((g) => g.id === props.defaultGroupId);
          if (group) {
            const updated = {
              ...group,
              channels: [...(group.channels ?? []), { id: channelId }],
            };
            // Force the overwrite (override=true): auto-adding a freshly-created channel to
            // its group is a follow-up to the channel save, not a group-management action, so
            // the concurrency prompt intentionally does not apply here.
            await bulkUpdateChannelGroups([updated], [], true).catch(() => {
              toast.error("Channel created, but failed to add to group.");
            });
          }
        }
        router.push(channelId ? `/channels/${channelId}/edit` : "/channels");
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
      return false;
    } finally {
      if (props.mode === "edit") setSaving(false);
    }
  }, [doSave, props, router]);

  // "Export Channel" from within the editor. Mirrors Java ChannelPanel.doExportChannel:
  // exporting the saved channel requires flushing unsaved edits first. When the channel
  // is dirty we prompt to save (Java: "This channel has been modified..."); otherwise we
  // open the export dialog directly. The dialog itself fetches the saved server channel
  // (with code-template libraries) and handles the include-libraries prompt + download.
  const handleExportChannel = useCallback(() => {
    if (needsSave) {
      setExportSaveConfirm(true);
    } else {
      setExportChannelOpen(true);
    }
  }, [needsSave]);

  const confirmSaveThenExport = useCallback(async () => {
    setExportSaveConfirm(false);
    const ok = await handleSave();
    // In new mode handleSave navigates to the edit route (component remount), so we can't
    // chain-open the dialog here; the user re-clicks Export from the now-saved edit view.
    if (ok && props.mode === "edit") setExportChannelOpen(true);
  }, [handleSave, props.mode]);

  const handleSaveAndDeploy = useCallback(async () => {
    setSaveDeployConfirm(false);
    setSaving(true);
    setError(null);
    try {
      const saved = await doSave();
      if (!saved) {
        setSaving(false);
        return;
      }
      // A connector-invalid channel was saved disabled (#17) — do not deploy a non-runnable
      // channel (Java never deploys on validation failure). Stay in the editor so the user can
      // fix the connector errors and deploy from the dashboard afterward.
      if (saved === "saved-disabled") {
        toast.info("Channel saved as disabled. Fix the connector errors, then deploy.");
        setSaving(false);
        return;
      }
      const channelId = parseChannelId(xmlRef.current ?? "");
      if (channelId) await deployChannels([channelId]);
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }, [doSave, router]);

  const handleDeploy = useCallback(async () => {
    setSaveDeployConfirm(false);
    setSaving(true);
    setError(null);
    try {
      const channelId = parseChannelId(xmlRef.current ?? "");
      if (channelId) await deployChannels([channelId]);
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }, [router]);

  // ── Computed display values ──────────────────────────────────────────────
  const pageTitle = props.mode === "new" ? "New Channel" : "Edit Channel";
  const pageSubtitle = summary?.name?.trim() ? summary.name : undefined;
  const channelId =
    props.mode === "edit" ? props.channelId : xml ? (parseChannelId(xml) ?? "") : "";

  return {
    xml,
    loading,
    saving,
    error,
    setError,
    isDirty,
    isNew,
    needsSave,
    summary,
    scripts,
    dataTypes,
    sourceConnector,
    destinations,
    destNames,
    allTags,
    tagsLoading,
    srcSaveErrors,
    destSaveErrors,
    ftSaveErrored,
    clearSrcSaveErrors: () => setSrcSaveErrors(new Set()),
    clearDestSaveErrors: () => setDestSaveErrors(new Map()),
    activeTab,
    activePluginTab,
    setActivePluginTab,
    switchTab,
    ftView,
    setFtView,
    viewMode,
    setViewMode,
    flowSelection,
    setFlowSelection,
    flowPanelWidth,
    onFlowPanelResize,
    deleteConfirmIdx,
    setDeleteConfirmIdx,
    saveDeployConfirm,
    setSaveDeployConfirm,
    exportChannelOpen,
    setExportChannelOpen,
    exportSaveConfirm,
    setExportSaveConfirm,
    handleExportChannel,
    confirmSaveThenExport,
    portConflict,
    resolvePortConflict: useCallback((proceed: boolean) => {
      portConflictResolveRef.current?.(proceed);
      portConflictResolveRef.current = null;
      setPortConflict(null);
    }, []),
    saveConflict,
    resolveSaveConflict: useCallback((proceed: boolean) => {
      saveConflictResolveRef.current?.(proceed);
      saveConflictResolveRef.current = null;
      setSaveConflict(null);
    }, []),
    metadataColumnConfirm,
    resolveMetadataColumnConfirm: useCallback((proceed: boolean) => {
      metadataColumnConfirmResolveRef.current?.(proceed);
      metadataColumnConfirmResolveRef.current = null;
      setMetadataColumnConfirm(false);
    }, []),
    connectorValidationConfirm,
    resolveConnectorValidationConfirm: useCallback((proceed: boolean) => {
      connectorValidationConfirmResolveRef.current?.(proceed);
      connectorValidationConfirmResolveRef.current = null;
      setConnectorValidationConfirm(null);
    }, []),
    handleSummaryChange,
    handleScriptsChange,
    handleTagsChange,
    handleDataTypesChange,
    handleLibraryResourcesChanged,
    handleSourceFtChange,
    handleDestFtChange,
    handleSourceConnectorChange,
    handleDestinationChange,
    handleDestinationAdd,
    handleDestinationRemove,
    handleDestinationReorder,
    handleDestinationToggleEnabled,
    handleDestinationDuplicate,
    handleSourceConnectorExport,
    handleSourceConnectorImport,
    handleDestinationExport,
    handleDestinationImport,
    handleSave,
    handleSaveAndDeploy,
    handleDeploy,
    guardedNavigate,
    pageTitle,
    pageSubtitle,
    channelId,
  };
}
