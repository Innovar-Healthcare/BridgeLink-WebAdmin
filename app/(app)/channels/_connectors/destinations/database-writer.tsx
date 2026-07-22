"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Database, Wrench } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import { MonacoEditor } from "@/components/monaco-editor";
import { ResizableEditorBox } from "@/components/resizable-editor-box";
import { getRhinoEditorOptions } from "@/lib/monaco-defaults";
import type * as Monaco from "monaco-editor";
import { SettingsSection, FieldRow, FullWidthField } from "@/components/settings/settings-section";
import type { DestinationConnectorDefinition, DestinationConnectorSectionProps } from "./types";
import {
  DEFAULT_DEST_PROPERTIES_XML,
  parseDatabaseWriterPropsFromXml,
  updateDatabaseWriterPropsInXml,
  type DatabaseWriterProps,
  parseConnectorResourceIds,
} from "../../_lib/channel-xml";
import { RadioGroup } from "../shared/radio-group";
import { inputCls, inputErrorCls, selectErrorCls, fieldErrorMsgCls } from "../shared/styles";
import { SecretInput } from "@/components/ui/secret-input";
import {
  RHINO_LANG_ID,
  registerRhinoLanguage,
  setEditorContext,
  clearEditorContextIfMatches,
} from "@/lib/monaco-rhino";
import { registerMirthDropHandler } from "../shared/monaco-mirth-drop";
import { attachRhinoValidation } from "@/lib/monaco-rhino-validation";
import { PluginEditorOverlay } from "@/components/plugin-editor-overlay";
import { useEditorAiSeam } from "@/lib/hooks/use-editor-ai-seam";
import { type EditorContext } from "@/lib/plugin-registry";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { DatabaseDriversDialog } from "@/components/database-drivers-dialog";
import { useDatabaseDrivers } from "@/lib/hooks/use-database-drivers";
import { matchDriverByClassName } from "@/lib/api/api-database";
import {
  DatabaseMetadataDialog,
  buildWriterConnectionScript,
  composeWriterInsertText,
  prependConnectionScript,
} from "../database-metadata-dialog";

const DEFAULT_XML = DEFAULT_DEST_PROPERTIES_XML["Database Writer"]!;

// ─── Bottom section ───────────────────────────────────────────────────────────

function DatabaseWriterBottomSection({
  propertiesXml,
  onChange,
  isDark,
  channelId = "",
  channelName = "",
  transportName,
  invalidFields,
}: DestinationConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const invalid = invalidFields ?? new Set<string>();
  const propsXml = propertiesXml ?? DEFAULT_XML;
  const [local, setLocal] = useState<DatabaseWriterProps>(() =>
    parseDatabaseWriterPropsFromXml(propsXml)
  );
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false);
  const [driversDialogOpen, setDriversDialogOpen] = useState(false);
  // Custom-driver mode: sticky after the user picks "Custom…" so the free-text
  // class-name input stays visible even while the driver value is empty. Mirrors
  // Java, where the driver text field is always present and "Custom" only stops
  // auto-syncing it from the dropdown (DatabaseWriter.updateDriverFieldFromComboBox).
  const [customMode, setCustomMode] = useState(false);

  const { drivers } = useDatabaseDrivers();

  // Match the stored driver against server-registered drivers, including each
  // driver's alternativeClassNames (e.g. legacy com.mysql.jdbc.Driver → MySQL),
  // mirroring Java's updateDriverComboBoxFromField().
  const liveDriver = matchDriverByClassName(drivers, local.driver);
  // A driver stored in XML that matches nothing is treated as custom, including an
  // empty string (a channel saved from Swing with an empty <driver> — the ticket's
  // explicit legacy-data case). "Please Select One" is the Java DRIVER_DEFAULT
  // placeholder — not a real driver class, so it alone is excluded.
  const storedIsCustom = local.driver !== "Please Select One" && !liveDriver;
  // Show the free-text input either for a genuinely-unknown stored driver or once
  // the user explicitly picks "Custom…" (customMode) — even while the value is empty.
  const showCustomInput = customMode || storedIsCustom;
  // The dropdown options are keyed by primary className, so when a stored driver
  // matched via an alternativeClassName we select the matched driver's primary
  // className (mirrors Java selecting the MySQL entry while the field keeps the
  // legacy class string).
  const selectValue = showCustomInput ? "__custom__" : (liveDriver?.className ?? local.driver);

  // Driver dropdown options: placeholder → server drivers (name + class) → Custom
  const driverOptions = [
    { label: "Please Select One", value: "Please Select One" },
    ...drivers.map((d) => ({ label: `${d.name}  (${d.className})`, value: d.className })),
    { label: "Custom…", value: "__custom__" },
  ];

  const monacoRef = useRef<
    Parameters<NonNullable<React.ComponentProps<typeof MonacoEditor>["beforeMount"]>>[0] | null
  >(null);
  // preferJsRef.current tracks local.useScript so the drop handler sees the
  // current mode without being re-registered every time the mode changes.
  const preferJsRef = useRef(local.useScript);
  useLayoutEffect(() => {
    preferJsRef.current = local.useScript;
  });
  const dropCleanupRef = useRef<(() => void) | null>(null);
  // Guards against the state feedback loop: when commit() propagates XML up to
  // the parent and the parent passes it back as a new prop, the useEffect would
  // re-parse and overwrite local state (resetting Monaco's value mid-keystroke).
  // This ref lets the effect skip the re-parse for locally-originated changes.
  const isLocalCommitRef = useRef(false);

  // AI seam — orb + Explain/Generate/Fix actions, JavaScript mode only.
  const seam = useEditorAiSeam(local.useScript);
  const aiContext = useMemo<EditorContext>(
    () => ({
      location: "connector-script",
      isSource: false,
      channelId,
      channelName,
      connectorType: transportName,
    }),
    [channelId, channelName, transportName]
  );

  const handleMount = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
      monacoRef.current = monaco;
      dropCleanupRef.current?.();
      dropCleanupRef.current = registerMirthDropHandler(editor, monaco, preferJsRef);
      // Real-time JS syntax validation (squiggles + hover tooltips). Language-aware: no-op while
      // this editor is toggled to SQL mode, re-validates on the switch back to JS.
      attachRhinoValidation(editor, monaco);
      const uri = editor.getModel()?.uri.toString();
      if (uri) {
        const ctx = { contextType: "DESTINATION_DISPATCHER" as const, channelId };
        setEditorContext(uri, ctx);
        editor.getModel()!.onWillDispose(() => clearEditorContextIfMatches(uri, ctx));
      }
      seam.registerEditor(editor, monaco);
    },
    [channelId, seam]
  );

  useEffect(() => {
    if (isLocalCommitRef.current) {
      isLocalCommitRef.current = false;
      return;
    }

    // Genuine external reload (channel switch, XML-tab edit): drop the sticky
    // custom-mode flag. storedIsCustom still keeps the input visible when the
    // reloaded driver is genuinely unknown to the server list.
    setCustomMode(false);
    setLocal(parseDatabaseWriterPropsFromXml(propertiesXml ?? DEFAULT_XML));
  }, [propertiesXml]);

  function commit(updated: DatabaseWriterProps) {
    isLocalCommitRef.current = true;
    setLocal(updated);
    onChange({ propertiesXml: updateDatabaseWriterPropsInXml(propsXml, updated) });
  }

  function set<K extends keyof DatabaseWriterProps>(key: K, val: DatabaseWriterProps[K]) {
    commit({ ...local, [key]: val });
  }

  function handleModeChange(v: string) {
    const useScript = v === "yes";
    const updated: DatabaseWriterProps = { ...local, useScript };
    if (useScript && !local.useScript) {
      // Java DatabaseWriter.useJavaScriptYesActionPerformed unconditionally replaces
      // the editor with the connection boilerplate on switch to JS mode, regardless
      // of existing content (matches the Database Reader's behaviour).
      updated.query = buildWriterConnectionScript(
        local.driver,
        local.url,
        local.username,
        local.password
      );
    } else if (!useScript && local.useScript) {
      // Clear when switching back to SQL mode
      updated.query = "";
    }
    commit(updated);
  }

  function handleConnection() {
    // Java DatabaseWriter.generateConnectionActionPerformed prepends the connection
    // boilerplate above the existing script; it does not replace it.
    commit({
      ...local,
      query: prependConnectionScript(
        buildWriterConnectionScript(local.driver, local.url, local.username, local.password),
        local.query
      ),
    });
  }

  function handleInsertConfirm(sql: string) {
    commit({ ...local, query: composeWriterInsertText(sql, local.query, local.useScript) });
  }

  // Monaco language/theme switch mirrors the Database Reader: the JS (rhino)
  // theme only applies in script mode; SQL mode uses Monaco's stock SQL theme.
  const editorLanguage = local.useScript ? RHINO_LANG_ID : "sql";
  const editorTheme = local.useScript
    ? isDark
      ? "mirth-js-dark"
      : "mirth-js"
    : isDark
      ? "vs-dark"
      : "vs";

  return (
    <>
      <DatabaseDriversDialog open={driversDialogOpen} onOpenChange={setDriversDialogOpen} />
      {metadataDialogOpen && (
        <DatabaseMetadataDialog
          open={metadataDialogOpen}
          onClose={() => setMetadataDialogOpen(false)}
          mode="insert"
          driver={local.driver}
          url={local.url}
          username={local.username}
          password={local.password}
          channelId={channelId}
          channelName={channelName}
          selectLimit={liveDriver?.selectLimit || undefined}
          resourceIds={parseConnectorResourceIds(propsXml, "destination")}
          onConfirm={handleInsertConfirm}
        />
      )}
      <SettingsSection
        title="Database Writer Settings"
        icon={Database}
        defaultExpanded={true}
        storageKey="bl-db-writer-main"
      >
        {/* Driver */}
        <FieldRow label="Driver:">
          <div className="flex flex-col gap-1 flex-1">
            <div className="flex items-center gap-1.5">
              <HoverTooltip content="Specifies the type of database driver to use.">
                <select
                  value={selectValue}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      setCustomMode(true);
                      // Java's driver field is blank when the combo is on the
                      // placeholder (setProperties blanks it); only clear our merged
                      // driver value in that case. A driver value already holding a
                      // real class name (or existing custom text) is preserved, same
                      // as Java leaving the field untouched when Custom is selected.
                      if (local.driver === "Please Select One") {
                        set("driver", "");
                      }
                    } else {
                      setCustomMode(false);
                      set("driver", e.target.value);
                    }
                  }}
                  className={`px-2 py-1 text-sm rounded border border-border
                  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                  focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 ${invalid.has("driver") ? selectErrorCls : ""}`}
                >
                  {driverOptions.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </HoverTooltip>
              <HoverTooltip content="Manage JDBC drivers registered on the server">
                <button
                  type="button"
                  onClick={() => setDriversDialogOpen(true)}
                  aria-label="Manage Drivers"
                  className="p-1 rounded border border-border text-gray-600 dark:text-gray-300
                  bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <Wrench className="h-3.5 w-3.5" />
                </button>
              </HoverTooltip>
            </div>
            {invalid.has("driver") && <p className={fieldErrorMsgCls}>Driver must be selected.</p>}
            {showCustomInput && (
              <HoverTooltip content="The fully-qualified class name of the JDBC driver to use to connect to the database.">
                <input
                  type="text"
                  value={local.driver}
                  onChange={(e) => set("driver", e.target.value)}
                  placeholder="Fully-qualified driver class name"
                  className={`${inputCls(viewDensity)} flex-1 ${invalid.has("driver") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
            )}
          </div>
        </FieldRow>

        {/* URL */}
        <FieldRow label="URL:">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <HoverTooltip content="The JDBC URL to connect to the database.">
                <input
                  type="text"
                  value={local.url}
                  onChange={(e) => set("url", e.target.value)}
                  placeholder="jdbc:..."
                  className={`${inputCls(viewDensity)} flex-1 min-w-0 ${invalid.has("url") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
              <HoverTooltip
                content={
                  liveDriver?.template
                    ? `Insert URL template: ${liveDriver.template}`
                    : "No URL template available for this driver"
                }
              >
                <button
                  onClick={() => {
                    if (liveDriver?.template) set("url", liveDriver.template);
                  }}
                  disabled={!liveDriver?.template}
                  className="shrink-0 px-2 py-1 text-xs rounded border border-border
                  text-gray-700 dark:text-gray-300
                  hover:bg-gray-50 dark:hover:bg-gray-700
                  hover:border-border
                  disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Insert URL Template
                </button>
              </HoverTooltip>
            </div>
            {invalid.has("url") && <p className={fieldErrorMsgCls}>URL is required.</p>}
          </div>
        </FieldRow>

        {/* Username */}
        <FieldRow label="Username:">
          <HoverTooltip content="The username to connect to the database.">
            <input
              type="text"
              value={local.username}
              onChange={(e) => set("username", e.target.value)}
              className={`${inputCls(viewDensity)} w-56`}
            />
          </HoverTooltip>
        </FieldRow>

        {/* Password */}
        <FieldRow label="Password:">
          <HoverTooltip content="The password to connect to the database.">
            <SecretInput
              value={local.password}
              onChange={(e) => set("password", e.target.value)}
              density={viewDensity}
              className={`${inputCls(viewDensity)} w-56`}
            />
          </HoverTooltip>
        </FieldRow>

        {/* Use JavaScript */}
        <FieldRow label="Use JavaScript:">
          <RadioGroup
            name="db-use-script"
            value={local.useScript ? "yes" : "no"}
            onChange={handleModeChange}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Yes: Implement JavaScript code using JDBC to insert a message. No: Specify the SQL statements to insert a message."
          />
        </FieldRow>

        {/* SQL / JavaScript editor */}
        <FullWidthField label={local.useScript ? "JavaScript:" : "SQL:"}>
          <div className="flex items-center gap-2 mb-1.5">
            {local.useScript && (
              <HoverTooltip content="Inserts boilerplate Connection construction code into the JavaScript editor.">
                <button
                  onClick={handleConnection}
                  className="px-2 py-0.5 text-xs rounded border border-border text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
                >
                  Connection
                </button>
              </HoverTooltip>
            )}
            <HoverTooltip content="Opens a window to assist in building an insert statement to insert records into the database specified in the URL above.">
              <button
                onClick={() => setMetadataDialogOpen(true)}
                className="px-2 py-0.5 text-xs rounded border border-border text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
              >
                Insert
              </button>
            </HoverTooltip>
          </div>
          <ResizableEditorBox
            className={`overflow-hidden border border-border rounded ${invalid.has("query") ? "!border-red-500 dark:!border-red-400" : ""}`}
            height={360}
          >
            <MonacoEditor
              language={editorLanguage}
              value={local.query}
              onChange={(v) => set("query", v ?? "")}
              beforeMount={(m) => {
                registerRhinoLanguage(m);
              }}
              onMount={handleMount}
              theme={editorTheme}
              height="100%"
              width="100%"
              options={getRhinoEditorOptions({
                suggestOnTriggerCharacters: true,
              })}
            />
          </ResizableEditorBox>
          {invalid.has("query") && <p className={fieldErrorMsgCls}>SQL is required.</p>}
        </FullWidthField>
        {local.useScript && (
          <PluginEditorOverlay
            editorRef={seam.editorRef}
            monacoRef={seam.monacoRef}
            context={aiContext}
          />
        )}
      </SettingsSection>
    </>
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────

export const DatabaseWriterConnector: DestinationConnectorDefinition = {
  BottomSection: DatabaseWriterBottomSection,
  defaultPropertiesXml: DEFAULT_XML,
  validate(propertiesXml) {
    if (!propertiesXml) return [];
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const txt = (tag: string) => doc.querySelector(tag)?.textContent?.trim() ?? "";
    const errors: import("../shared/validate-utils").ValidationError[] = [];
    const useScript = txt("useScript") === "true";
    if (!useScript && !txt("url")) errors.push({ field: "url", message: "URL is required." });
    if (!txt("query")) errors.push({ field: "query", message: "SQL is required." });
    const driver = txt("driver");
    if (!driver || driver === "Please Select One")
      errors.push({ field: "driver", message: "Driver must be selected." });
    return errors;
  },
};
