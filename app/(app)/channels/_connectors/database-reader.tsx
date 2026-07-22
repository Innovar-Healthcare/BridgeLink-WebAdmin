"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Database, Wrench } from "lucide-react";
import { MonacoEditor } from "@/components/monaco-editor";
import { ResizableEditorBox } from "@/components/resizable-editor-box";
import { getRhinoEditorOptions } from "@/lib/monaco-defaults";
import type { editor as MonacoEditorNs } from "monaco-editor";
import { SettingsSection, FieldRow, FullWidthField } from "@/components/settings/settings-section";
import { HoverTooltip } from "@/components/hover-tooltip";
import type { ConnectorDefinition, ConnectorSectionProps } from "./types";
import { PollingSection } from "./shared/polling-section";
import { validatePolling } from "./shared/validate-utils";
import { RadioGroup } from "./shared/radio-group";
import {
  inputCls,
  selectCls,
  inputErrorCls,
  selectErrorCls,
  fieldErrorMsgCls,
} from "./shared/styles";
import { SecretInput } from "@/components/ui/secret-input";
import { VariableOrNumberInput } from "@/components/ui/variable-or-number-input";
import {
  DEFAULT_DB_READER_PROPERTIES_XML,
  parseDatabaseReaderPropsFromXml,
  updateDatabaseReaderPropsInXml,
  type DatabaseReaderProps,
  resolveXmlVersion,
  withVersion,
  parseConnectorResourceIds,
} from "../_lib/channel-xml";
import { parseTransformerFromXml, serializeTransformerToXml } from "../_lib/filter-transformer-xml";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DatabaseDriversDialog } from "@/components/database-drivers-dialog";
import {
  DatabaseMetadataDialog,
  buildSelectConnectionScript,
  buildUpdateConnectionScript,
  prependConnectionScript,
  composeReaderSelectText,
  composeReaderUpdateText,
  buildInboundResultTemplate,
} from "./database-metadata-dialog";
import { useDatabaseDrivers } from "@/lib/hooks/use-database-drivers";
import { matchDriverByClassName } from "@/lib/api/api-database";
import {
  RHINO_LANG_ID,
  registerRhinoLanguage,
  setEditorContext,
  clearEditorContextIfMatches,
} from "@/lib/monaco-rhino";
import { attachRhinoValidation } from "@/lib/monaco-rhino-validation";
import { PluginEditorOverlay } from "@/components/plugin-editor-overlay";
import { useEditorAiSeam } from "@/lib/hooks/use-editor-ai-seam";
import { type EditorContext } from "@/lib/plugin-registry";
import { parseSqlColumns, extractSqlFromScript } from "@/lib/sql-parser-util";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { useCharsetEncodings } from "@/lib/hooks/use-charset-encodings";
import { buildCharsetOptions } from "./shared/charset-options";

// updateMode integer constants (from DatabaseReceiverProperties.java)
const UPDATE_NEVER = 1; // No post-process SQL run
const UPDATE_EACH = 3; // Run after each processed message
const UPDATE_ONCE = 2; // Run once after all messages have been processed

// ─── Shared button styles ─────────────────────────────────────────────────────

const toolbarBtnCls =
  "px-2 py-0.5 text-xs rounded border border-border " +
  "text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 " +
  "hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors whitespace-nowrap";

// ─── Top section: Polling Settings (reuses shared component) ─────────────────

function DatabaseReaderTopSection({ propertiesXml, onChange, isDark }: ConnectorSectionProps) {
  return (
    <PollingSection
      propertiesXml={propertiesXml}
      onChange={onChange}
      isDark={isDark}
      defaultPropertiesXml={DEFAULT_DB_READER_PROPERTIES_XML}
    />
  );
}

// ─── Bottom section: Database Reader Settings ─────────────────────────────────

// Minimal valid <transformer> XML used when transformerXml is absent.
// Matches the XML/XML data types the Database Reader requires (getRequiredInboundDataType = "XML").
const EMPTY_SOURCE_TRANSFORMER_XML =
  `<transformer version="{{VERSION}}"><elements/>` +
  `<inboundDataType>XML</inboundDataType>` +
  `<outboundDataType>XML</outboundDataType>` +
  `</transformer>`;

function DatabaseReaderBottomSection({
  propertiesXml,
  onChange,
  isDark,
  channelId = "",
  channelName = "",
  transportName,
  invalidFields,
  transformerXml,
}: ConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const serverCharsets = useCharsetEncodings();
  const invalid = invalidFields ?? new Set<string>();
  const propsXml =
    propertiesXml ?? withVersion(DEFAULT_DB_READER_PROPERTIES_XML, resolveXmlVersion());
  const [local, setLocal] = useState<DatabaseReaderProps>(() =>
    parseDatabaseReaderPropsFromXml(propsXml)
  );
  // Guards against the state feedback loop: when commit() propagates XML up to
  // the parent and the parent passes it back as a new prop, the useEffect would
  // re-parse and overwrite local state (resetting Monaco's value mid-keystroke).
  const isLocalCommitRef = useRef(false);

  const { drivers } = useDatabaseDrivers();

  // Confirm dialog before enabling Aggregate Results
  const [pendingAggregateEnable, setPendingAggregateEnable] = useState(false);

  // Manage Drivers dialog
  const [driversDialogOpen, setDriversDialogOpen] = useState(false);

  // Custom-driver mode: sticky after the user picks "Custom…" so the free-text
  // class-name input stays visible even while the driver value is empty. Mirrors
  // Java, where the driver text field is always present and "Custom" only stops
  // auto-syncing it from the dropdown (DatabaseReader.updateDriverFieldFromComboBox).
  const [customMode, setCustomMode] = useState(false);

  // Dialog state: which dialog is open and for which editor target
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"select" | "update">("select");
  const [dialogTarget, setDialogTarget] = useState<"select" | "update">("select");

  // Parsed column names from the SELECT query (debounced, matches Java 1s timer)
  const [parsedColumns, setParsedColumns] = useState<string[]>([]);
  const parseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Post-process Monaco editor ref for inserting variables at cursor
  const updateEditorRef = useRef<MonacoEditorNs.IStandaloneCodeEditor | null>(null);

  // AI seam — orb + Explain/Generate/Fix actions, JavaScript mode only. Both the SELECT and
  // post-process editors register with one seam; the single orb targets the last-focused one.
  const seam = useEditorAiSeam(local.useScript);
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

  useEffect(() => {
    if (isLocalCommitRef.current) {
      isLocalCommitRef.current = false;
      return;
    }

    // Genuine external reload (channel switch, XML-tab edit): drop the sticky
    // custom-mode flag. storedIsCustom still keeps the input visible when the
    // reloaded driver is genuinely unknown to the server list.
    setCustomMode(false);
    setLocal(
      parseDatabaseReaderPropsFromXml(
        propertiesXml ?? withVersion(DEFAULT_DB_READER_PROPERTIES_XML, resolveXmlVersion())
      )
    );
  }, [propertiesXml]);

  // Ref-based blur handler so it always reads current prop values without
  // needing to re-register the Monaco event listener on every render.
  // Mirrors Java updateIncomingData() — fires when the SELECT editor loses focus.
  //
  // Two intentional deviations from Java updateIncomingData() M-9,
  // accepted as parity gaps):
  //   1. Java recomputes the template on a 1s keystroke debounce; we fire on blur.
  //   2. Java also copies the generated template to every destination connector's
  //      inbound template when the source outbound type is XML and empty. The
  //      connector panel's onChange only mutates the source connector
  //      (SourceConnectorState) and has no handle to destination transformers, so
  //      we update the source transformer only.
  const applyTemplate = useCallback(
    (selectOverride?: string) => {
      // selectOverride lets the metadata-dialog confirm rewrite the template from
      // the just-generated SELECT synchronously, without waiting for an editor blur
      // (the dialog closes without focusing the editor, so blur may never fire).
      const selectText = selectOverride ?? local.select;
      const sql = local.useScript ? extractSqlFromScript(selectText) : selectText;
      const columns = parseSqlColumns(sql);
      // Java DatabaseReader.updateIncomingData always rewrites the inbound template;
      // an empty/unparseable query produces a bare <result/> that clears any stale
      // template (do NOT early-return on zero columns).
      const template = buildInboundResultTemplate(columns);
      const base = transformerXml || withVersion(EMPTY_SOURCE_TRANSFORMER_XML, resolveXmlVersion());
      const state = parseTransformerFromXml(base);
      const updatedXml = serializeTransformerToXml(base, { ...state, inboundTemplate: template });
      onChange({ transformerXml: updatedXml });
    },
    [local.useScript, local.select, transformerXml, onChange]
  );

  const applyTemplateRef = useRef(applyTemplate);
  useEffect(() => {
    applyTemplateRef.current = applyTemplate;
  }, [applyTemplate]);

  useEffect(() => {
    if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
    parseTimerRef.current = setTimeout(() => {
      const sql = local.useScript ? extractSqlFromScript(local.select) : local.select;
      setParsedColumns(parseSqlColumns(sql));
    }, 1000);
    return () => {
      if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
    };
  }, [local.select, local.useScript]);

  const handleVarClick = useCallback(
    (colName: string) => {
      const varText = local.useScript ? `$('${colName}')` : `\${${colName}}`;
      const editor = updateEditorRef.current;
      if (editor) {
        const pos = editor.getPosition();
        if (pos) {
          editor.executeEdits("db-var-insert", [
            {
              range: {
                startLineNumber: pos.lineNumber,
                startColumn: pos.column,
                endLineNumber: pos.lineNumber,
                endColumn: pos.column,
              },
              text: varText,
            },
          ]);
          editor.focus();
        }
      }
    },
    [local.useScript]
  );

  function commit(patch: Partial<DatabaseReaderProps>) {
    const updated = { ...local, ...patch };
    isLocalCommitRef.current = true;
    setLocal(updated);
    onChange({ propertiesXml: updateDatabaseReaderPropsInXml(propsXml, updated) });
  }

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

  // Driver dropdown options: placeholder → server drivers → Custom
  const driverOptions = [
    { label: "Please Select One", value: "Please Select One" },
    ...drivers.map((d) => ({ label: `${d.name}  (${d.className})`, value: d.className })),
    { label: "Custom…", value: "__custom__" },
  ];

  // Java: updateOnceActionPerformed() disables dbVarList in "Once" mode — the
  // post-process runs once for the whole result set, so per-row column variables
  // don't apply. updateEachActionPerformed() leaves it enabled.
  const varListDisabled = local.updateMode === UPDATE_ONCE;

  // Monaco language/theme switches when the user toggles "Use JavaScript".
  const editorLanguage = local.useScript ? RHINO_LANG_ID : "sql";
  const editorTheme = local.useScript
    ? isDark
      ? "mirth-js-dark"
      : "mirth-js"
    : isDark
      ? "vs-dark"
      : "vs";

  // ── Button handlers ──────────────────────────────────────────────────────────

  function handleInsertUrlTemplate() {
    const tmpl = liveDriver?.template;
    if (tmpl) commit({ url: tmpl });
  }

  function handleSelectConnection() {
    // Java DatabaseReader.generateConnectionActionPerformed prepends the
    // boilerplate above the existing script; it does not replace it.
    commit({
      select: prependConnectionScript(
        buildSelectConnectionScript(local.driver, local.url, local.username, local.password),
        local.select
      ),
    });
  }

  function handleUpdateConnection() {
    const perRow = local.updateMode === UPDATE_EACH;
    // Java DatabaseReader.generateUpdateConnectionActionPerformed also prepends.
    commit({
      update: prependConnectionScript(
        buildUpdateConnectionScript(
          local.driver,
          local.url,
          local.username,
          local.password,
          perRow,
          local.aggregateResults
        ),
        local.update
      ),
    });
  }

  function openMetadataDialog(mode: "select" | "update") {
    setDialogMode(mode);
    setDialogTarget(mode);
    setDialogOpen(true);
  }

  function handleMetadataConfirm(sql: string) {
    // Java DatabaseReader.setSelectText / setUpdateText: SQL mode prepends the
    // generated statement (update strips `?`), JS mode appends an
    // executeCachedQuery / executeUpdate wrapper. Never a wholesale replace.
    if (dialogTarget === "select") {
      const nextSelect = composeReaderSelectText(sql, local.select, local.useScript);
      commit({ select: nextSelect });
      // Mirror Java's DocumentListener: regenerate the inbound template from the
      // freshly generated SELECT now (the dialog closes without blurring the editor).
      applyTemplate(nextSelect);
    } else {
      commit({ update: composeReaderUpdateText(sql, local.update, local.useScript) });
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <DatabaseDriversDialog open={driversDialogOpen} onOpenChange={setDriversDialogOpen} />
      {/* Metadata dialog (portal-style, rendered outside the settings section) */}
      {dialogOpen && (
        <DatabaseMetadataDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          mode={dialogMode}
          driver={local.driver}
          url={local.url}
          username={local.username}
          password={local.password}
          channelId={channelId}
          channelName={channelName}
          selectLimit={liveDriver?.selectLimit || undefined}
          resourceIds={parseConnectorResourceIds(propsXml, "source")}
          onConfirm={handleMetadataConfirm}
        />
      )}

      <SettingsSection
        title="Database Reader Settings"
        icon={Database}
        defaultExpanded={true}
        storageKey="bl-db-reader-main"
      >
        {/* ── Connection ──────────────────────────────────────────────────────── */}

        <FieldRow label="Driver:">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <HoverTooltip content="Specifies the type of database driver to use to connect to the database.">
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
                        commit({ driver: "" });
                      }
                    } else {
                      setCustomMode(false);
                      commit({ driver: e.target.value });
                    }
                  }}
                  className={`${selectCls(viewDensity)} ${invalid.has("driver") ? selectErrorCls : ""}`}
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
                  className={toolbarBtnCls}
                  aria-label="Manage Drivers"
                >
                  <Wrench className="h-3.5 w-3.5" />
                </button>
              </HoverTooltip>
            </div>
            {invalid.has("driver") && <p className={fieldErrorMsgCls}>Driver must be selected.</p>}
            {/* Free-text input shown when the driver is custom or after selecting Custom… */}
            {showCustomInput && (
              <HoverTooltip content="The fully-qualified class name of the JDBC driver to use to connect to the database.">
                <input
                  type="text"
                  value={local.driver}
                  onChange={(e) => commit({ driver: e.target.value })}
                  placeholder="JDBC driver class name"
                  className={inputCls(viewDensity)}
                />
              </HoverTooltip>
            )}
          </div>
        </FieldRow>

        <FieldRow label="URL:">
          <div className="w-full">
            <div className="flex items-center gap-2">
              <HoverTooltip content="The JDBC URL to connect to the database. This is not used when 'Use JavaScript' is checked. However, it is used when the Insert Connection feature is used to generate code.">
                <input
                  type="text"
                  value={local.url}
                  onChange={(e) => commit({ url: e.target.value })}
                  className={`${inputCls(viewDensity)} w-96 ${invalid.has("url") ? inputErrorCls : ""}`}
                  placeholder="jdbc:…"
                />
              </HoverTooltip>
              <HoverTooltip
                content={
                  liveDriver?.template ? `Insert: ${liveDriver.template}` : "Select a driver first"
                }
              >
                <button
                  onClick={handleInsertUrlTemplate}
                  disabled={!liveDriver?.template}
                  className={toolbarBtnCls + " disabled:opacity-40 disabled:cursor-not-allowed"}
                >
                  Insert URL Template
                </button>
              </HoverTooltip>
            </div>
            {invalid.has("url") && <p className={fieldErrorMsgCls}>URL is required.</p>}
          </div>
        </FieldRow>

        <FieldRow label="Username:">
          <HoverTooltip content="The user name to connect to the database. This is not used when 'Use JavaScript' is checked. However, it is used when the Insert Connection feature is used to generate code.">
            <input
              type="text"
              value={local.username}
              onChange={(e) => commit({ username: e.target.value })}
              className={`${inputCls(viewDensity)} w-52`}
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Password:">
          <HoverTooltip content="The password to connect to the database. This is not used when 'Use JavaScript' is checked. However, it is used when the Insert Connection feature is used to generate code.">
            <SecretInput
              value={local.password}
              onChange={(e) => commit({ password: e.target.value })}
              density={viewDensity}
              className={`${inputCls(viewDensity)} w-52`}
            />
          </HoverTooltip>
        </FieldRow>

        {/* ── Behaviour ───────────────────────────────────────────────────────── */}

        <FieldRow label="Use JavaScript:">
          <RadioGroup
            name="useScript"
            value={local.useScript ? "yes" : "no"}
            onChange={(v) => {
              const useScript = v === "yes";
              if (useScript) {
                // Java: useScriptYesActionPerformed() — auto-populate the editor
                // boilerplate and only *disable* keepConnectionOpen + cacheResults
                // (the disabled props on those RadioGroups below). Java never mutates
                // the stored radio values, and getProperties() re-reads them, so a
                // detour through JS mode must not downgrade the stored booleans.
                const perRow = local.updateMode === UPDATE_EACH;
                commit({
                  useScript: true,
                  select: buildSelectConnectionScript(
                    local.driver,
                    local.url,
                    local.username,
                    local.password
                  ),
                  update: buildUpdateConnectionScript(
                    local.driver,
                    local.url,
                    local.username,
                    local.password,
                    perRow,
                    local.aggregateResults
                  ),
                });
              } else {
                // Java: useScriptNoActionPerformed() — clear editors, re-enable controls
                commit({
                  useScript: false,
                  select: "",
                  update: "",
                });
              }
            }}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Yes: Implement JavaScript code using JDBC to get the messages to be processed and mark messages in the database as processed. No: Specify the SQL statements to get messages to be processed and mark messages in the database as processed."
          />
        </FieldRow>

        <FieldRow label="Keep Connection Open:">
          <RadioGroup
            name="keepConnectionOpen"
            value={local.keepConnectionOpen ? "yes" : "no"}
            onChange={(v) => commit({ keepConnectionOpen: v === "yes" })}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            disabled={local.useScript}
            title="Yes: Re-use the same database connection each time the select query is executed. No: Close the database connection after selected messages have finished processing."
          />
        </FieldRow>

        {pendingAggregateEnable && (
          <ConfirmDialog
            title="Enable Aggregate Results"
            description="All rows returned by the query below will be aggregated into a single message. This could cause memory issues if the result set is large. Are you sure?"
            confirmLabel="Enable"
            confirmVariant="default"
            onConfirm={() => {
              commit({ aggregateResults: true, cacheResults: true });
              setPendingAggregateEnable(false);
            }}
            onCancel={() => setPendingAggregateEnable(false)}
          />
        )}

        <FieldRow label="Aggregate Results:">
          <RadioGroup
            name="aggregateResults"
            value={local.aggregateResults ? "yes" : "no"}
            onChange={(v) => {
              if (v === "yes") {
                setPendingAggregateEnable(true);
              } else {
                commit({ aggregateResults: false });
              }
            }}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="If enabled, all rows returned in the query will be aggregated into a single XML message. Note that all rows will be read into memory at once, so use this with caution."
          />
        </FieldRow>

        <FieldRow label="Cache Results:">
          <RadioGroup
            name="cacheResults"
            value={local.cacheResults ? "yes" : "no"}
            onChange={(v) => commit({ cacheResults: v === "yes" })}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            disabled={local.useScript || local.aggregateResults}
            title="Yes: Cache the entire result set in memory prior to processing messages. No: Do not cache the entire result set in memory prior to processing messages."
          />
        </FieldRow>

        {/* ── Tuning ──────────────────────────────────────────────────────────── */}

        <FieldRow label="Fetch Size:">
          <HoverTooltip content="The JDBC ResultSet fetch size to be used when fetching results from the current cursor position.">
            <VariableOrNumberInput
              min={1}
              value={local.fetchSize}
              onChange={(fetchSize) => commit({ fetchSize })}
              className={`${inputCls(viewDensity)} w-28`}
              // Java: cacheResults{Yes,No}ButtonActionPerformed() — Fetch Size is
              // also disabled when Cache Results is on (the cached result set is
              // already fully read into memory), not just in JavaScript mode.
              disabled={local.useScript || local.cacheResults}
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="# of Retries on Error:">
          <HoverTooltip content="The number of times to retry executing the statement or script if an error occurs.">
            <VariableOrNumberInput
              min={0}
              value={local.retryCount}
              onChange={(retryCount) => commit({ retryCount })}
              className={`${inputCls(viewDensity)} w-24`}
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Retry Interval (ms):">
          <HoverTooltip content="The amount of time that should elapse between retry attempts.">
            <VariableOrNumberInput
              min={0}
              value={local.retryInterval}
              onChange={(retryInterval) => commit({ retryInterval })}
              className={`${inputCls(viewDensity)} w-28`}
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Encoding:">
          <HoverTooltip content="Select the character set encoding used by the source database, or select Default to use the default character set encoding for the JVM running BridgeLink.">
            <select
              value={local.encoding}
              onChange={(e) => commit({ encoding: e.target.value })}
              className={selectCls(viewDensity)}
            >
              {buildCharsetOptions(serverCharsets, local.encoding).map((enc) => (
                <option key={enc.value} value={enc.value}>
                  {enc.label}
                </option>
              ))}
            </select>
          </HoverTooltip>
        </FieldRow>

        {/* ── SELECT query / script ────────────────────────────────────────────── */}

        {/*
          Toolbar above the SELECT editor.
          When "Use JavaScript" is on, show Connection (inserts JS boilerplate)
          and Select (opens metadata dialog to generate SQL wrapped in JS).
          When "Use JavaScript" is off, show only Select (generates plain SQL).
        */}
        <FullWidthField label={local.useScript ? "JavaScript:" : "SQL:"}>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              {local.useScript && (
                <HoverTooltip content="Inserts boilerplate Connection construction code into the JavaScript editor at the current caret location.">
                  <button onClick={handleSelectConnection} className={toolbarBtnCls}>
                    Connection
                  </button>
                </HoverTooltip>
              )}
              <HoverTooltip content="Opens a window to assist in building a select query to select records from the database specified in the URL above.">
                <button onClick={() => openMetadataDialog("select")} className={toolbarBtnCls}>
                  Select
                </button>
              </HoverTooltip>
            </div>
            <ResizableEditorBox
              className={`overflow-hidden border rounded ${invalid.has("select") ? "border-red-500 dark:border-red-400" : "border-border"}`}
              height={300}
            >
              <MonacoEditor
                language={editorLanguage}
                value={local.select}
                onChange={(v) => commit({ select: v ?? "" })}
                beforeMount={(m) => registerRhinoLanguage(m)}
                onMount={(editor, monaco) => {
                  editor.onDidBlurEditorText(() => {
                    applyTemplateRef.current();
                  });
                  // Real-time JS syntax validation. Language-aware: no-op in SQL mode,
                  // re-validates on the switch to JavaScript.
                  attachRhinoValidation(editor, monaco);
                  const uri = editor.getModel()?.uri.toString();
                  if (uri) {
                    const ctx = { contextType: "SOURCE_RECEIVER" as const, channelId };
                    setEditorContext(uri, ctx);
                    editor.getModel()!.onWillDispose(() => clearEditorContextIfMatches(uri, ctx));
                  }
                  seam.registerEditor(editor, monaco);
                }}
                theme={editorTheme}
                height="100%"
                width="100%"
                options={getRhinoEditorOptions({
                  suggestOnTriggerCharacters: true,
                })}
              />
            </ResizableEditorBox>
            {invalid.has("select") && <p className={fieldErrorMsgCls}>SELECT SQL is required.</p>}
          </div>
        </FullWidthField>

        {/* ── Post-process SQL / script ────────────────────────────────────────── */}

        <FieldRow label={local.useScript ? "Run Post-Process Script:" : "Run Post-Process SQL:"}>
          {/*
            updateMode values:
              UPDATE_NEVER (1) — no post-process query is run
              UPDATE_EACH  (3) — runs after every message (use for marking rows processed)
              UPDATE_ONCE  (2) — runs once after the full result set is consumed
          */}
          <RadioGroup
            name="updateMode"
            value={String(local.updateMode)}
            onChange={(v) => commit({ updateMode: Number(v) })}
            options={[
              { label: "Never", value: String(UPDATE_NEVER) },
              {
                label: local.aggregateResults ? "For each row" : "After each message",
                value: String(UPDATE_EACH),
              },
              {
                label: local.aggregateResults ? "Once for all rows" : "Once after all messages",
                value: String(UPDATE_ONCE),
              },
            ]}
            title="When using a database reader, it is usually necessary to execute a separate SQL statement to mark the message that was just fetched as processed, so it will not be fetched again the next time a poll occurs. Never: Do not run the post-process statement. After each message: Run after each message finishes processing. Once after all messages: Run only once after all messages have finished processing."
          />
        </FieldRow>

        {local.updateMode !== UPDATE_NEVER && (
          <FullWidthField label={local.useScript ? "JavaScript:" : "SQL:"}>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                {local.useScript && (
                  <HoverTooltip content="Inserts boilerplate Connection construction code into the post-process JavaScript editor at the current caret location.">
                    <button onClick={handleUpdateConnection} className={toolbarBtnCls}>
                      Connection
                    </button>
                  </HoverTooltip>
                )}
                <HoverTooltip content="Opens a window to assist in building an update query to update records in the database specified in the URL above.">
                  <button onClick={() => openMetadataDialog("update")} className={toolbarBtnCls}>
                    Update
                  </button>
                </HoverTooltip>
              </div>
              <div className="flex gap-2 min-w-0">
                <ResizableEditorBox
                  className={`min-w-0 flex-1 overflow-hidden border rounded ${invalid.has("update") ? "border-red-500 dark:border-red-400" : "border-border"}`}
                  height={220}
                >
                  <MonacoEditor
                    language={editorLanguage}
                    value={local.update}
                    onChange={(v) => commit({ update: v ?? "" })}
                    beforeMount={(m) => registerRhinoLanguage(m)}
                    onMount={(editor, monaco) => {
                      updateEditorRef.current = editor;
                      // Real-time JS syntax validation. Language-aware: no-op in SQL mode,
                      // re-validates on the switch to JavaScript.
                      attachRhinoValidation(editor, monaco);
                      const uri = editor.getModel()?.uri.toString();
                      if (uri) {
                        const ctx = { contextType: "SOURCE_RECEIVER" as const, channelId };
                        setEditorContext(uri, ctx);
                        editor
                          .getModel()!
                          .onWillDispose(() => clearEditorContextIfMatches(uri, ctx));
                      }
                      seam.registerEditor(editor, monaco);
                    }}
                    theme={editorTheme}
                    height="100%"
                    width="100%"
                    options={getRhinoEditorOptions({
                      suggestOnTriggerCharacters: true,
                    })}
                  />
                </ResizableEditorBox>
                {/* Column variable list — parsed from the SELECT statement */}
                {parsedColumns.length > 0 && (
                  <div
                    className="flex-shrink-0 border border-border rounded overflow-y-auto bg-white dark:bg-gray-900"
                    style={{ height: 160, width: 120 }}
                  >
                    {parsedColumns.map((col) => (
                      <HoverTooltip
                        key={col}
                        content={
                          varListDisabled
                            ? ""
                            : `Click to insert ${local.useScript ? `$('${col}')` : `\${${col}}`} into the post-process editor`
                        }
                      >
                        <button
                          type="button"
                          disabled={varListDisabled}
                          onClick={() => {
                            if (varListDisabled) return;
                            handleVarClick(col);
                          }}
                          className={`block w-full text-left px-2 py-0.5 text-xs font-mono truncate ${
                            varListDisabled
                              ? "text-gray-400 dark:text-gray-600 opacity-40 cursor-not-allowed"
                              : "text-gray-700 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900"
                          }`}
                        >
                          {col}
                        </button>
                      </HoverTooltip>
                    ))}
                  </div>
                )}
              </div>
              {invalid.has("update") && (
                <p className={fieldErrorMsgCls}>Post-process SQL/script is required.</p>
              )}
            </div>
          </FullWidthField>
        )}
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

export const DatabaseReaderConnector: ConnectorDefinition = {
  TopSection: DatabaseReaderTopSection,
  BottomSection: DatabaseReaderBottomSection,
  defaultPropertiesXml: DEFAULT_DB_READER_PROPERTIES_XML,
  getRequiredInboundDataType: () => "XML",
  validate(propertiesXml) {
    if (!propertiesXml) return [];
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const txt = (tag: string) => doc.querySelector(tag)?.textContent?.trim() ?? "";
    const errors: import("./shared/validate-utils").ValidationError[] = [];
    const useScript = txt("useScript") === "true";
    if (!useScript && !txt("url")) errors.push({ field: "url", message: "URL is required." });
    if (!txt("select")) errors.push({ field: "select", message: "SELECT SQL is required." });
    const driver = txt("driver");
    if (!driver || driver === "Please Select One")
      errors.push({ field: "driver", message: "Driver must be selected." });
    // updateMode 1 = Never; default to "1" when absent so missing tag doesn't trigger this
    if ((txt("updateMode") || "1") !== "1" && !txt("update"))
      errors.push({ field: "update", message: "Post-process SQL/script is required." });
    errors.push(...validatePolling(propertiesXml));
    return errors;
  },
};
