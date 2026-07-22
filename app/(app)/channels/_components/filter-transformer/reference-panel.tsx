"use client";

/**
 * ReferencePanel — orchestrates the three tabs of the filter/transformer Reference panel.
 *
 * Tab components live in dedicated files:
 *   - reference-list.tsx      → ReferenceTab
 *   - message-tree-viewer.tsx → MessageTreesTab
 *   - message-template-editor.tsx → MessageTemplatesTab
 *
 * Static data (RefItem, RefCategory, CATEGORIES, splitLabel) lives in reference-data.ts.
 */

import { useState, useEffect } from "react";
import { PanelRightClose } from "lucide-react";
import { ReferenceTab } from "./reference-list";
import { MessageTreesTab } from "./message-tree-viewer";
import type { TreeContextAction } from "./message-tree-viewer";
import { MessageTemplatesTab } from "./message-template-editor";
import { DATA_TYPE_REGISTRY } from "../../_datatypes/index";
import { pluginRegistry, type EditorContext } from "@/lib/plugin-registry";
import { usePluginSurfaceEnabled } from "@/lib/plugin-gating";

// ─── Monaco token marker registration ────────────────────────────────────────
// Stored on globalThis so idempotency survives HMR and component remounts.
const _g = globalThis as Record<string, unknown>;

function maybeRegisterTokenMarker(dataTypeName: string): void {
  const plugin = DATA_TYPE_REGISTRY.get(dataTypeName);
  if (!plugin?.tokenMarker) return;
  const { languageId, tokenizer } = plugin.tokenMarker;
  const guardKey = `__blDtTokenMarker_${languageId}`;
  if (_g[guardKey]) return;
  _g[guardKey] = true;
  // Dynamic import avoids pulling the full monaco-editor bundle into the SSR path.
  void import("monaco-editor").then((monaco) => {
    monaco.languages.register({ id: languageId });
    monaco.languages.setMonarchTokensProvider(languageId, { tokenizer } as Parameters<
      typeof monaco.languages.setMonarchTokensProvider
    >[1]);
  });
}

// ─── Reference panel props ────────────────────────────────────────────────────

interface Props {
  inboundDataType?: string;
  inboundTemplate?: string | null;
  inboundPropertiesXml?: string | null;
  outboundDataType?: string;
  outboundTemplate?: string | null;
  outboundPropertiesXml?: string | null;
  isTransformer?: boolean;
  /** Called when user changes the data type or its properties in the template panel */
  onTypeChange?: (side: "inbound" | "outbound", dt: string, propsXml: string | null) => void;
  /** Called when user edits the template textarea content */
  onTemplateChange?: (side: "inbound" | "outbound", text: string) => void;
  /** Called when the user clicks the collapse button */
  onCollapse?: () => void;
  /** Variable names extracted from the current editor's elements (shown in Reference tab) */
  variables?: string[];
  /** Channel ID — used to filter code templates to only those from enabled libraries */
  channelId?: string;
  /** Whether this is a filter context (affects context menu actions) */
  isFilter?: boolean;
  /** Called when a context menu or DnD action should create a new step/rule */
  onCreateFromTree?: (action: TreeContextAction) => void;
  /** Called when an inbound node is dropped onto an outbound node */
  onCreateMessageBuilder?: (messageSegment: string, mapping: string) => void;
  /** When true, the inbound data type dropdown is read-only (destination transformer) */
  inboundTypeLocked?: boolean;
  /** Tooltip shown on the locked inbound type selector. Defaults to destination-lock message. */
  inboundTypeLockedTitle?: string;
  /** When true, the Reference tab includes the "Response Transformer" category. */
  isResponseTransformer?: boolean;
  /** Current editing mode — forwarded to plugin tab context */
  mode?: "filter" | "transformer" | "responseTransformer";
  /** Whether this is the source connector — forwarded to plugin tab context */
  isSource?: boolean;
  /** Channel name — forwarded to plugin tab context */
  channelName?: string;
}

export function ReferencePanel({
  inboundDataType,
  inboundTemplate,
  inboundPropertiesXml,
  outboundDataType,
  outboundTemplate,
  outboundPropertiesXml,
  isTransformer = false,
  onTypeChange,
  onTemplateChange,
  onCollapse,
  variables,
  channelId,
  isFilter,
  onCreateFromTree,
  onCreateMessageBuilder,
  inboundTypeLocked,
  inboundTypeLockedTitle,
  isResponseTransformer = false,
  mode,
  isSource,
  channelName,
}: Props) {
  const [activeTab, setActiveTab] = useState<string>("reference");

  // Local editable text — initialised from props; re-syncs when the channel/step changes.
  const [inboundText, setInboundText] = useState(inboundTemplate ?? "");
  const [outboundText, setOutboundText] = useState(outboundTemplate ?? "");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInboundText(inboundTemplate ?? "");
  }, [inboundTemplate]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOutboundText(outboundTemplate ?? "");
  }, [outboundTemplate]);

  // Local editable data types + properties — re-sync when channel/step changes.
  const [localInboundDT, setLocalInboundDT] = useState(inboundDataType ?? "RAW");
  const [localOutboundDT, setLocalOutboundDT] = useState(outboundDataType ?? "RAW");

  // Register Monaco token markers for the active data types, if any.
  useEffect(() => {
    maybeRegisterTokenMarker(localInboundDT);
  }, [localInboundDT]);
  useEffect(() => {
    maybeRegisterTokenMarker(localOutboundDT);
  }, [localOutboundDT]);
  const [localInboundPropsXml, setLocalInboundPropsXml] = useState(inboundPropertiesXml ?? null);
  const [localOutboundPropsXml, setLocalOutboundPropsXml] = useState(outboundPropertiesXml ?? null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalInboundDT(inboundDataType ?? "RAW");
  }, [inboundDataType]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalOutboundDT(outboundDataType ?? "RAW");
  }, [outboundDataType]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalInboundPropsXml(inboundPropertiesXml ?? null);
  }, [inboundPropertiesXml]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalOutboundPropsXml(outboundPropertiesXml ?? null);
  }, [outboundPropertiesXml]);

  function handleInboundTypeChange(dt: string, propsXml: string | null) {
    setLocalInboundDT(dt);
    setLocalInboundPropsXml(propsXml);
    onTypeChange?.("inbound", dt, propsXml);
  }

  function handleOutboundTypeChange(dt: string, propsXml: string | null) {
    setLocalOutboundDT(dt);
    setLocalOutboundPropsXml(propsXml);
    onTypeChange?.("outbound", dt, propsXml);
  }

  // Wrappers that update local state AND notify the parent when the user edits
  // the textarea directly. Kept separate from setInboundText/setOutboundText
  // so the useEffect prop-sync above does NOT trigger the parent callback.
  function handleInboundTextChange(v: string) {
    setInboundText(v);
    onTemplateChange?.("inbound", v);
  }

  function handleOutboundTextChange(v: string) {
    setOutboundText(v);
    onTemplateChange?.("outbound", v);
  }

  const tabCls = (t: string) =>
    `px-2 py-1.5 text-xs font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap ` +
    (activeTab === t
      ? "border-blue-500 text-blue-600 dark:text-blue-400"
      : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200");

  // Transformer context for data-type property-group gating (mirrors Java).
  const transformerType: "source" | "destination" | "response" = isSource
    ? "source"
    : isResponseTransformer
      ? "response"
      : "destination";

  const referenceContext: EditorContext = {
    location: "filter-transformer",
    mode,
    isSource,
    inboundDataType: localInboundDT,
    outboundDataType: localOutboundDT,
    inboundTemplate: inboundText,
    outboundTemplate: outboundText,
    channelId,
    channelName,
  };

  // Plugin-contributed tabs, filtered by server-enablement gating.
  // The built-in "reference" tab is the default active tab, so hiding a plugin
  // tab never orphans the active selection.
  const surfaceEnabled = usePluginSurfaceEnabled();
  const pluginTabs = pluginRegistry.referencePanelTabs.filter((t) => surfaceEnabled(t));

  return (
    <div className="flex flex-col h-full border-l border-border bg-gray-50 dark:bg-gray-900">
      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0 overflow-x-auto">
        {pluginTabs.map((tab) => (
          <button key={tab.key} className={tabCls(tab.key)} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
          </button>
        ))}
        <button className={tabCls("reference")} onClick={() => setActiveTab("reference")}>
          Reference
        </button>
        <button className={tabCls("trees")} onClick={() => setActiveTab("trees")}>
          Message Trees
        </button>
        <button className={tabCls("templates")} onClick={() => setActiveTab("templates")}>
          Message Templates
        </button>
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="ml-auto px-2 py-1.5 shrink-0 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Collapse reference panel"
          >
            <PanelRightClose className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {activeTab === "reference" && (
          <ReferenceTab
            variables={variables}
            channelId={channelId}
            inboundDataType={localInboundDT}
            isResponseTransformer={isResponseTransformer}
          />
        )}
        {activeTab === "trees" && (
          <MessageTreesTab
            inboundDataType={localInboundDT}
            inboundText={inboundText}
            inboundPropsXml={localInboundPropsXml}
            outboundDataType={localOutboundDT}
            outboundText={outboundText}
            outboundPropsXml={localOutboundPropsXml}
            isTransformer={isTransformer}
            onInboundNormalize={handleInboundTextChange}
            onOutboundNormalize={handleOutboundTextChange}
            isFilter={isFilter}
            onCreateFromTree={onCreateFromTree}
            onCreateMessageBuilder={onCreateMessageBuilder}
          />
        )}
        {activeTab === "templates" && (
          <MessageTemplatesTab
            inboundDataType={localInboundDT}
            inboundText={inboundText}
            setInboundText={handleInboundTextChange}
            inboundPropsXml={localInboundPropsXml}
            onInboundTypeChange={handleInboundTypeChange}
            outboundDataType={localOutboundDT}
            outboundText={outboundText}
            setOutboundText={handleOutboundTextChange}
            outboundPropsXml={localOutboundPropsXml}
            onOutboundTypeChange={handleOutboundTypeChange}
            isTransformer={isTransformer}
            transformerType={transformerType}
            inboundTypeLocked={inboundTypeLocked}
            inboundTypeLockedTitle={inboundTypeLockedTitle}
            channelId={channelId}
          />
        )}
        {pluginTabs.map((tab) => {
          if (activeTab !== tab.key) return null;
          const TabComp = tab.component;
          return <TabComp key={tab.key} context={referenceContext} />;
        })}
      </div>
    </div>
  );
}
