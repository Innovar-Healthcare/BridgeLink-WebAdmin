"use client";

import { useCallback, useMemo, useRef } from "react";
import { MonacoEditor } from "@/components/monaco-editor";
import type * as Monaco from "monaco-editor";
import { ResizableEditorBox } from "@/components/resizable-editor-box";
import { getRhinoEditorOptions } from "@/lib/monaco-defaults";
import { Code2 } from "lucide-react";
import { SettingsSection } from "@/components/settings/settings-section";
import type { ConnectorDefinition, ConnectorSectionProps } from "./types";
import { PollingSection } from "./shared/polling-section";
import { validatePolling } from "./shared/validate-utils";
import {
  DEFAULT_JS_READER_PROPERTIES_XML,
  parseScriptFromPropertiesXml,
  updateScriptInPropertiesXml,
  resolveXmlVersion,
  withVersion,
} from "../_lib/channel-xml";
import {
  RHINO_LANG_ID,
  registerRhinoLanguage,
  setEditorContext,
  clearEditorContextIfMatches,
} from "@/lib/monaco-rhino";
import { registerMirthDropHandler } from "./shared/monaco-mirth-drop";
import { attachRhinoValidation } from "@/lib/monaco-rhino-validation";
import { inputErrorCls, fieldErrorMsgCls } from "./shared/styles";
import { PluginEditorOverlay } from "@/components/plugin-editor-overlay";
import { useEditorAiSeam } from "@/lib/hooks/use-editor-ai-seam";
import { type EditorContext } from "@/lib/plugin-registry";

// ─── Top section: Polling Settings ────────────────────────────────────────────

function JavaScriptReaderTopSection({ propertiesXml, onChange, isDark }: ConnectorSectionProps) {
  return (
    <PollingSection
      propertiesXml={propertiesXml}
      onChange={onChange}
      isDark={isDark}
      defaultPropertiesXml={DEFAULT_JS_READER_PROPERTIES_XML}
    />
  );
}

// ─── Bottom section: Script editor ────────────────────────────────────────────

function JavaScriptReaderBottomSection({
  propertiesXml,
  onChange,
  isDark,
  invalidFields,
  channelId = "",
  channelName,
  transportName,
}: ConnectorSectionProps) {
  const invalid = invalidFields ?? new Set<string>();
  const propsXml =
    propertiesXml ?? withVersion(DEFAULT_JS_READER_PROPERTIES_XML, resolveXmlVersion());
  const script = parseScriptFromPropertiesXml(propertiesXml);

  // JavaScript Reader script is always in JS mode — always prefer jsInsert expressions.
  const preferJsRef = useRef(true);

  // Cleanup function returned by registerMirthDropHandler
  const dropCleanupRef = useRef<(() => void) | null>(null);

  // AI seam — mounts the orb + Explain/Generate/Fix actions on this JS editor.
  const seam = useEditorAiSeam();
  const aiContext = useMemo<EditorContext>(
    () => ({
      location: "connector-script",
      isSource: true,
      channelId,
      channelName,
      connectorType: transportName,
    }),
    [channelId, channelName, transportName]
  );

  function handleScriptChange(newScript: string | undefined) {
    onChange({ propertiesXml: updateScriptInPropertiesXml(propsXml, newScript ?? "") });
  }

  const handleMount = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
      dropCleanupRef.current?.();
      dropCleanupRef.current = registerMirthDropHandler(editor, monaco, preferJsRef);
      // Real-time JS syntax validation (squiggles + hover tooltips) — same markers as the
      // Code Templates editor via the shared acorn parser. Self-cleans on dispose.
      attachRhinoValidation(editor, monaco);
      const uri = editor.getModel()?.uri.toString();
      if (uri) {
        const ctx = { contextType: "SOURCE_RECEIVER" as const, channelId };
        setEditorContext(uri, ctx);
        editor.getModel()!.onWillDispose(() => clearEditorContextIfMatches(uri, ctx));
      }
      seam.registerEditor(editor, monaco);
    },
    [channelId, seam]
  );

  return (
    <SettingsSection
      title="JavaScript Reader Settings"
      icon={Code2}
      defaultExpanded={true}
      storageKey="bl-js-reader-main"
    >
      <ResizableEditorBox
        className={`overflow-hidden border rounded ${invalid.has("script") ? inputErrorCls : "border-border"}`}
        height={400}
      >
        <MonacoEditor
          language={RHINO_LANG_ID}
          value={script}
          onChange={handleScriptChange}
          beforeMount={(m) => registerRhinoLanguage(m)}
          onMount={handleMount}
          theme={isDark ? "mirth-js-dark" : "mirth-js"}
          height="100%"
          width="100%"
          options={getRhinoEditorOptions({
            suggestOnTriggerCharacters: true,
          })}
        />
      </ResizableEditorBox>
      {invalid.has("script") && <p className={fieldErrorMsgCls}>Script is required.</p>}
      <PluginEditorOverlay
        editorRef={seam.editorRef}
        monacoRef={seam.monacoRef}
        context={aiContext}
      />
    </SettingsSection>
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────

export const JavaScriptReaderConnector: ConnectorDefinition = {
  TopSection: JavaScriptReaderTopSection,
  BottomSection: JavaScriptReaderBottomSection,
  defaultPropertiesXml: DEFAULT_JS_READER_PROPERTIES_XML,
  validate(propertiesXml) {
    if (!propertiesXml) return [];
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const errors: import("./shared/validate-utils").ValidationError[] = [];
    if (!doc.querySelector("script")?.textContent?.trim())
      errors.push({ field: "script", message: "Script is required." });
    errors.push(...validatePolling(propertiesXml));
    return errors;
  },
};
