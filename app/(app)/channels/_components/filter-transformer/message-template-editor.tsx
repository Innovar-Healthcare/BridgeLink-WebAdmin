"use client";

/**
 * Message template editor for the filter/transformer Reference panel.
 *
 * Exports:
 *   MessageTemplatesTab — tab content rendered by ReferencePanel
 *
 * Internal: TemplatePropertiesDialog, TemplateSection.
 */

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { FolderOpen } from "lucide-react";
import { useVerticalSplitResize } from "@/lib/hooks/use-vertical-split-resize";
import { formatContent } from "@/lib/format-content";
import { MONACO_BASE_OPTIONS } from "@/lib/monaco-defaults";
import { registerHl7v2Language, hl7v2Theme } from "@/lib/monaco-hl7v2";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTheme } from "@/lib/hooks/use-theme";
import { pluginSlots } from "@/lib/plugin-slots";
import { useSlotEnabled } from "@/lib/plugin-gating";
import { defaultPropertiesXml, resolveXmlVersion } from "../../_lib/channel-xml";
import { DATA_TYPE_REGISTRY } from "../../_datatypes/index";
import { useVisibleDataTypes } from "../../_datatypes/use-visible-data-types";

const Editor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex-1 bg-white dark:bg-gray-900 p-2 text-xs text-gray-400">
      Loading editor…
    </div>
  ),
});

export function templateLanguage(dataType: string): string {
  switch (dataType) {
    case "HL7V2":
      return "hl7v2";
    case "XML":
    case "RAW":
      return "xml";
    case "JSON":
      return "json";
    default:
      return "plaintext";
  }
}

/**
 * Theme for template editors. Monaco themes are global per instance, so all
 * template editors must use the same one — otherwise a non-HL7 editor's theme
 * clobbers HL7 highlighting in a sibling editor. The hl7v2 theme
 * inherits vs/vs-dark, so XML/JSON/plaintext render identically under it.
 */
export function templateTheme(isDark: boolean): string {
  return hl7v2Theme(isDark);
}

// ─── Template Properties Dialog ───────────────────────────────────────────────
// Shows serialization settings for the selected data type.
// Delegates rendering to the DataTypeDefinition's PropertiesSection component.

function TemplatePropertiesDialog({
  open,
  onClose,
  onSave,
  dataType,
  propsXml,
  side,
  transformerType,
  isDark,
  channelId,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (newXml: string) => void;
  dataType: string;
  propsXml: string | null;
  side: "inbound" | "outbound";
  transformerType: "source" | "destination" | "response";
  isDark: boolean;
  channelId?: string;
}) {
  const plugin = DATA_TYPE_REGISTRY.get(dataType);
  const [pendingXml, setPendingXml] = useState<string | null>(propsXml);
  // Reset pendingXml whenever dialog opens
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setPendingXml(propsXml);
  }, [open, propsXml]);

  const isReadOnly = !plugin?.PropertiesSection;

  function handleSave() {
    onSave(pendingXml ?? propsXml ?? "");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg flex flex-col max-h-[calc(100vh-6rem)]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-sm">
            {side === "inbound" ? "Inbound" : "Outbound"} Properties — {dataType}
          </DialogTitle>
        </DialogHeader>
        <div className="shrink min-h-0 overflow-y-auto">
          {plugin?.PropertiesSection ? (
            <plugin.PropertiesSection
              key={open ? "open" : "closed"}
              propsXml={pendingXml}
              side={side}
              transformerType={transformerType}
              onChange={setPendingXml}
              isDark={isDark}
              channelId={channelId}
            />
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400 italic p-3">
              No configurable serialization properties for {dataType || "this data type"}.
            </p>
          )}
        </div>
        <DialogFooter className="gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border border-border hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
          >
            Cancel
          </button>
          {!isReadOnly && (
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
            >
              OK
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Template section ─────────────────────────────────────────────────────────

function TemplateSection({
  title,
  dataType,
  text,
  setText,
  propsXml,
  onTypeChange,
  side,
  transformerType,
  dataTypeLocked,
  dataTypeLockedTitle,
  channelId,
}: {
  title: string;
  dataType: string;
  text: string;
  setText: (v: string) => void;
  propsXml: string | null;
  onTypeChange: (dt: string, propsXml: string | null) => void;
  side: "inbound" | "outbound";
  transformerType: "source" | "destination" | "response";
  dataTypeLocked?: boolean;
  dataTypeLockedTitle?: string;
  channelId?: string;
}) {
  const [propsOpen, setPropsOpen] = useState(false);
  const { isDark } = useTheme();
  const visibleTypes = useVisibleDataTypes();
  // Plugin-filled per-pane actions. Member-expression read +
  // separate boolean gate — required by the React Compiler static-components
  // rule (same idiom as javascript-panel.tsx's editor.overlay).
  const TemplateActions = pluginSlots["message-template.actions"];
  const templateActionsEnabled = useSlotEnabled("message-template.actions");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [wrap, setWrap] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("bl-template-wordwrap") === "true";
  });

  const selectCls =
    "h-5 px-1 text-xs rounded border border-border " +
    "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
    "focus:outline-none focus:border-blue-500 cursor-pointer";

  const btnCls =
    "px-1.5 py-0.5 text-xs rounded border border-border " +
    "hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 " +
    "transition-colors cursor-pointer whitespace-nowrap";

  function handleDataTypeChange(dt: string) {
    const newPropsXml = defaultPropertiesXml(
      dt,
      side === "inbound" ? "inboundProperties" : "outboundProperties",
      resolveXmlVersion()
    );
    onTypeChange(dt, newPropsXml);
  }

  /** Open the OS file picker. */
  function handleOpenFile() {
    fileInputRef.current?.click();
  }

  /**
   * Read the selected file and set it as the template text.
   *
   * Detection strategy: if the plugin defines `getTemplateString` it can handle
   * binary input (e.g. DICOM base64 → XML), so we read the file as binary and
   * base64-encode it.  All other types are read as UTF-8 text.
   */
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-picked next time
    e.target.value = "";

    const plugin = DATA_TYPE_REGISTRY.get(dataType);
    const readBinary = !!plugin?.getTemplateString;

    const reader = new FileReader();

    if (readBinary) {
      reader.onload = (ev) => {
        const buf = ev.target?.result as ArrayBuffer;
        // Convert ArrayBuffer to base64 string using chunked btoa to avoid
        // stack overflow on large files.
        const bytes = new Uint8Array(buf);
        let binary = "";
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        setText(btoa(binary));
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = (ev) => {
        setText((ev.target?.result as string) ?? "");
      };
      reader.readAsText(file, "UTF-8");
    }
  }

  const plugin = DATA_TYPE_REGISTRY.get(dataType);
  const placeholderHint = plugin?.getTemplateString
    ? "Paste a sample message or open a file…"
    : "Paste a sample message here…";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header row 1: title */}
      <div className="px-2 py-1 bg-gray-100 dark:bg-gray-800 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">{title}</span>
      </div>
      {/* Header row 2: Data Type dropdown + Properties + Open File + Clear */}
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1 bg-gray-50 dark:bg-gray-900 border-b border-border shrink-0">
        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Data Type:</span>
        {dataTypeLocked ? (
          <span
            className={`${selectCls} inline-flex items-center opacity-60 cursor-not-allowed select-none`}
            title={
              dataTypeLockedTitle ??
              "Destination inbound type is controlled by the source outbound type"
            }
          >
            {dataType}
          </span>
        ) : (
          <select
            value={dataType}
            onChange={(e) => handleDataTypeChange(e.target.value)}
            className={selectCls}
          >
            {visibleTypes.map((dt) => (
              <option key={dt} value={dt}>
                {dt}
              </option>
            ))}
            {/* Pin the current type when it is gated off or unknown so the
                select can't silently switch it to the first option on save. */}
            {!visibleTypes.includes(dataType) && (
              <option value={dataType} disabled>
                {dataType} (unavailable)
              </option>
            )}
          </select>
        )}
        <button
          onClick={() => setPropsOpen(true)}
          className={btnCls + (dataTypeLocked ? " opacity-50 cursor-not-allowed" : "")}
          disabled={dataTypeLocked}
        >
          Properties
        </button>
        {/* Open File — reads binary types as base64, text types as UTF-8 */}
        <button
          onClick={handleOpenFile}
          title="Open a file from disk to use as the sample message template"
          className={btnCls + " flex items-center gap-1"}
        >
          <FolderOpen className="w-3 h-3" />
          Open File
        </button>
        {/* Hidden file input — no accept filter so all file types are reachable */}
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
        {text && (
          <button onClick={() => setText("")} className={btnCls}>
            Clear
          </button>
        )}
        <button
          onClick={() => {
            const next = !wrap;
            setWrap(next);
            localStorage.setItem("bl-template-wordwrap", String(next));
          }}
          className={
            "ml-auto " +
            btnCls +
            (wrap
              ? " bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300"
              : "")
          }
          title={wrap ? "Disable word wrap" : "Enable word wrap"}
        >
          Wrap
        </button>
        <button
          onClick={() => setText(formatContent(text, true))}
          disabled={!text.trim()}
          className={btnCls + (!text.trim() ? " opacity-50 cursor-not-allowed" : "")}
          title="Pretty print JSON/XML content"
        >
          Format
        </button>
        {TemplateActions && templateActionsEnabled && (
          <TemplateActions side={side} dataType={dataType} text={text} setText={setText} />
        )}
      </div>

      {/* Monaco editor — intercepts Ctrl+F for in-app find, provides syntax highlighting */}
      <div className="flex-1 min-h-0 relative">
        {!text && (
          <div className="absolute top-2 left-14 text-xs text-gray-400 dark:text-gray-600 pointer-events-none z-10 font-mono">
            {placeholderHint}
          </div>
        )}
        <Editor
          value={text}
          language={templateLanguage(dataType)}
          theme={templateTheme(isDark)}
          beforeMount={registerHl7v2Language}
          onChange={(v) => setText(v ?? "")}
          options={{
            ...MONACO_BASE_OPTIONS,
            fontSize: 12,
            wordWrap: wrap ? "on" : "off",
            wrappingIndent: "same",
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 3,
            glyphMargin: false,
            padding: { top: 8, bottom: 8 },
            scrollbar: {
              vertical: "auto",
              horizontal: "auto",
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
          }}
          loading={
            <div className="flex-1 bg-white dark:bg-gray-900 p-2 text-xs text-gray-400">
              Loading editor…
            </div>
          }
        />
      </div>

      {/* Properties dialog */}
      <TemplatePropertiesDialog
        open={propsOpen}
        onClose={() => setPropsOpen(false)}
        onSave={(newXml) => onTypeChange(dataType, newXml)}
        dataType={dataType}
        propsXml={propsXml}
        side={side}
        transformerType={transformerType}
        isDark={isDark}
        channelId={channelId}
      />
    </div>
  );
}

// ─── Message Templates tab ────────────────────────────────────────────────────

export function MessageTemplatesTab({
  inboundDataType,
  inboundText,
  setInboundText,
  inboundPropsXml,
  onInboundTypeChange,
  outboundDataType,
  outboundText,
  setOutboundText,
  outboundPropsXml,
  onOutboundTypeChange,
  isTransformer,
  transformerType,
  inboundTypeLocked,
  inboundTypeLockedTitle,
  channelId,
}: {
  inboundDataType: string;
  inboundText: string;
  setInboundText: (v: string) => void;
  inboundPropsXml: string | null;
  onInboundTypeChange: (dt: string, propsXml: string | null) => void;
  outboundDataType: string;
  outboundText: string;
  setOutboundText: (v: string) => void;
  outboundPropsXml: string | null;
  onOutboundTypeChange: (dt: string, propsXml: string | null) => void;
  isTransformer: boolean;
  transformerType: "source" | "destination" | "response";
  inboundTypeLocked?: boolean;
  inboundTypeLockedTitle?: string;
  channelId?: string;
}) {
  const { topRatio, containerRef, onDragMouseDown } = useVerticalSplitResize({
    storageKey: "bl-ft-templates-split",
    defaultRatio: 0.5,
    minPx: 80,
  });

  return (
    <div className="flex flex-col h-full" ref={containerRef}>
      {/* Inbound section */}
      <div
        className={"flex flex-col min-h-0 overflow-hidden " + (isTransformer ? "" : "flex-1")}
        style={isTransformer ? { height: `${topRatio * 100}%` } : undefined}
      >
        <TemplateSection
          title="Inbound Message Template"
          dataType={inboundDataType}
          text={inboundText}
          setText={setInboundText}
          propsXml={inboundPropsXml}
          onTypeChange={onInboundTypeChange}
          side="inbound"
          transformerType={transformerType}
          dataTypeLocked={inboundTypeLocked}
          dataTypeLockedTitle={inboundTypeLockedTitle}
          channelId={channelId}
        />
      </div>
      {/* Outbound section — transformers only */}
      {isTransformer && (
        <>
          <div
            onMouseDown={onDragMouseDown}
            className="h-1 shrink-0 cursor-row-resize select-none bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors"
            title="Drag to resize"
          />
          <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
            <TemplateSection
              title="Outbound Message Template"
              dataType={outboundDataType}
              text={outboundText}
              setText={setOutboundText}
              propsXml={outboundPropsXml}
              onTypeChange={onOutboundTypeChange}
              side="outbound"
              transformerType={transformerType}
              channelId={channelId}
            />
          </div>
        </>
      )}
    </div>
  );
}
