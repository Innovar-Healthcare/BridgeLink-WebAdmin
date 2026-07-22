"use client";

import { Fragment, useMemo, useState, useRef, useCallback } from "react";
import { Trash2, Globe, GripVertical, ShieldAlert } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import { useTestConn, type TestConnResult } from "../shared/use-test-conn";
import { TestConnButton } from "../shared/test-conn-button";
import { TestConnResultDialog } from "../shared/test-conn-result-dialog";
import { EditableCombobox } from "../shared/editable-combobox";
import { SettingsSection, FieldRow, FullWidthField } from "@/components/settings/settings-section";
import type { DestinationConnectorDefinition, DestinationConnectorSectionProps } from "./types";
import { isUsingHttps } from "./url-scheme";
import {
  DEFAULT_DEST_PROPERTIES_XML,
  parseWebServiceSenderPropsFromXml,
  updateWebServiceSenderPropsInXml,
  withVersion,
  resolveXmlVersion,
  type WebServiceSenderProps,
  type WebServiceAttachment,
  type NameValueEntry,
} from "../../_lib/channel-xml";
import { NameValueTable } from "../shared/name-value-table";
import { RadioGroup } from "../shared/radio-group";
import { inputCls, inputErrorCls, fieldErrorMsgCls } from "../shared/styles";
import { SecretInput } from "@/components/ui/secret-input";
import {
  VariableOrNumberInput,
  isNumberOrVariable,
} from "@/components/ui/variable-or-number-input";
import { PROXY_BASE, getServerUrl, normalizeXStream } from "@/lib/api/api-core";
import { assertNoUnresolvedVersion } from "@/lib/connector-props-guard";
import {
  cacheWsdlFromUrl,
  getWsdlDefinition,
  isWsdlCached,
  generateWsEnvelope,
  getWsSoapAction,
} from "@/lib/api/api-ws";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { MonacoEditor } from "@/components/monaco-editor";
import { ResizableEditorBox } from "@/components/resizable-editor-box";
import type * as Monaco from "monaco-editor";
import { MONACO_BASE_OPTIONS } from "@/lib/monaco-defaults";
import { registerMirthDropHandler } from "../shared/monaco-mirth-drop";

const DEFAULT_XML = DEFAULT_DEST_PROPERTIES_XML["Web Service Sender"]!;

const PLACEHOLDER_OP = "Press Get Operations";

// XStream serializes a single-element Java List as a bare value (not an array).
// This normalizes portInfo.operations / portInfo.actions to string[] in all cases.
function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val as string[];
  if (typeof val === "string" && val) return [val];
  return [];
}

/**
 * Generate the next unique attachment ID, mirroring Java
 * WebServiceSender.getNewAttachmentId(): the first "Attachment{n}" (n ≥ 1) that
 * is not already present (case-insensitive). Deriving from the count alone would
 * collide after a middle row is removed.
 */
export function nextAttachmentId(existing: string[]): string {
  const taken = new Set(existing.map((s) => s.trim().toLowerCase()));
  for (let i = 1; i <= existing.length + 1; i++) {
    const candidate = `Attachment${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return "";
}

/**
 * Build the XOP include element dragged from an attachment row into the SOAP
 * envelope, mirroring Java WebServiceSender's attachment TransferHandler exactly:
 *   <inc:Include href="cid:{ID}" xmlns:inc="http://www.w3.org/2004/08/xop/include"/>
 */
export function buildXopInclude(id: string): string {
  return `<inc:Include href="cid:${id}" xmlns:inc="http://www.w3.org/2004/08/xop/include"/>`;
}

// Java WebServiceSender SSL_TOOL_TIP, reworded for BridgeLink.
const SSL_NOT_CONFIGURED_TOOLTIP =
  "The default system certificate store will be used for this connection. As a result, certain security options are not available and mutual authentication (two-way authentication) is not supported.";

// ─── Bottom section ───────────────────────────────────────────────────────────

function WebServiceSenderBottomSection({
  propertiesXml,
  onChange,
  isDark,
  channelId,
  channelName,
  invalidFields,
  securesTransport,
}: DestinationConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const invalid = invalidFields ?? new Set<string>();
  const preferJsRef = useRef(false);
  const dropCleanupRef = useRef<(() => void) | null>(null);
  const handleEnvelopeMount = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
      dropCleanupRef.current?.();
      dropCleanupRef.current = registerMirthDropHandler(editor, monaco, preferJsRef);
    },
    []
  );
  const propsXml = propertiesXml ?? withVersion(DEFAULT_XML, resolveXmlVersion());
  const [local, setLocal] = useState<WebServiceSenderProps>(() =>
    parseWebServiceSenderPropsFromXml(propsXml)
  );
  // Mirror Java WebServiceSender.testConnectionButtonActionPerformed(true): the WSDL-URL
  // "Test Connection" button blanks the Location URI before posting so the server tests the
  // WSDL endpoint (WebServiceConnectorServlet tests the Location URI FIRST when it is non-blank).
  const wsdlTestXml = useMemo(
    () => updateWebServiceSenderPropsInXml(propsXml, { ...local, locationURI: "" }),
    [propsXml, local]
  );
  const {
    testing: tcTesting,
    result: tcResult,
    test: tcTest,
    clearResult: tcClear,
  } = useTestConn("ws", "_testConnection", wsdlTestXml, channelId, channelName);

  // ── Location URI test connection state ─────────────────────────────────────
  const [locUriTesting, setLocUriTesting] = useState(false);
  const [locUriResult, setLocUriResult] = useState<TestConnResult | null>(null);
  const [locUriDialogOpen, setLocUriDialogOpen] = useState(false);

  // ── Get Operations state ────────────────────────────────────────────────────
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);

  // ── Generate Envelope state ─────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // ── Confirm dialogs ────────────────────────────────────────────────────────
  const [confirmOps, setConfirmOps] = useState(false);
  const [confirmGenEnv, setConfirmGenEnv] = useState(false);

  // Re-parse local props when the incoming XML changes (adjust state during render).
  const [prevPropertiesXml, setPrevPropertiesXml] = useState(propertiesXml);
  if (propertiesXml !== prevPropertiesXml) {
    setPrevPropertiesXml(propertiesXml);
    setLocal(
      parseWebServiceSenderPropsFromXml(
        propertiesXml ?? withVersion(DEFAULT_XML, resolveXmlVersion())
      )
    );
  }

  // Open the location-URI result dialog when a new result arrives.
  const [prevLocUriResult, setPrevLocUriResult] = useState(locUriResult);
  if (locUriResult !== prevLocUriResult) {
    setPrevLocUriResult(locUriResult);
    if (locUriResult) setLocUriDialogOpen(true);
  }

  function commit(updated: WebServiceSenderProps) {
    setLocal(updated);
    onChange({ propertiesXml: updateWebServiceSenderPropsInXml(propsXml, updated) });
  }

  function set<K extends keyof WebServiceSenderProps>(key: K, val: WebServiceSenderProps[K]) {
    commit({ ...local, [key]: val });
  }

  function handleHeaders(entries: NameValueEntry[]) {
    commit({ ...local, headers: entries });
  }

  function addAttachment() {
    // Mirror Java newButtonActionPerformed: unique "Attachment{n}" ID and a blank MIME type.
    commit({
      ...local,
      attachments: [
        ...local.attachments,
        { name: nextAttachmentId(local.attachments.map((a) => a.name)), content: "", type: "" },
      ],
    });
  }
  function removeAttachment(i: number) {
    commit({ ...local, attachments: local.attachments.filter((_, j) => j !== i) });
  }
  function updateAttachment(i: number, field: keyof WebServiceAttachment, val: string) {
    // Mirror Java AttachmentsTableCellEditor(checkUnique=true) on the ID column: reject an
    // edit that would duplicate another row's ID (case-insensitive). Blank IDs are allowed
    // while editing and dropped on save (writeWsAttachments skips blank-name rows).
    if (field === "name" && val.trim() !== "") {
      const dup = local.attachments.some(
        (a, j) => j !== i && a.name.trim().toLowerCase() === val.trim().toLowerCase()
      );
      if (dup) return;
    }
    const updated = local.attachments.map((a, j) => (j === i ? { ...a, [field]: val } : a));
    commit({ ...local, attachments: updated });
  }

  // ── Derived cascade values ─────────────────────────────────────────────────

  const serviceOptions = useMemo(
    () => Object.keys(local.wsdlDefinitionMap),
    [local.wsdlDefinitionMap]
  );
  const portOptions = useMemo(
    () => Object.keys(local.wsdlDefinitionMap[local.service] ?? {}),
    [local.wsdlDefinitionMap, local.service]
  );
  const portInfo = local.wsdlDefinitionMap[local.service]?.[local.port];
  const operationOptions = toStringArray(portInfo?.operations);
  const canGenerate =
    !!local.operation && local.operation !== PLACEHOLDER_OP && portInfo !== undefined;

  // Mirror Java WebServiceSender.getConnectorTypeDecoration / doLocalDecoration: when either the
  // WSDL URL or the Location URI is https, the connection uses the default system cert store
  // (no configured SSL), so both fields get a warning icon + highlight (#FFF099 in Java).
  // The SSL Settings plugin suppresses this: its Mode.DESTINATION ConnectorTypeDecoration replaces
  // the base warning whenever its section is present, surfaced here as `securesTransport`.
  const sslNotConfigured =
    !securesTransport && (isUsingHttps(local.wsdlUrl) || isUsingHttps(local.locationURI));
  const sslHighlightStyle = sslNotConfigured
    ? { backgroundColor: "#fff099", color: "#000" }
    : undefined;

  // ── Cascade handlers ───────────────────────────────────────────────────────

  // Location URI on a manual service/port selection: mirror Java portComboBoxActionPerformed,
  // which restores a non-blank previously-selected Location URI over the port's own value, and
  // otherwise falls back to the port's Location URI (blank when it has none). WsPortInformation
  // always carries a string locationURI ("" when absent), so a plain ?? cannot express this.
  function cascadeLocationURI(info: { locationURI: string } | undefined): string {
    return local.locationURI.trim() ? local.locationURI : (info?.locationURI ?? "");
  }
  // SOAP Action on a cascade: mirror the Java operation action listener, which resets it to ""
  // whenever the resulting operation has no matching action (rather than keeping a stale value).
  function cascadeSoapAction(actions: string[], idx: number): string {
    return idx >= 0 && idx < actions.length ? (actions[idx] ?? "") : "";
  }

  function onServiceChange(svc: string) {
    const ports = Object.keys(local.wsdlDefinitionMap[svc] ?? {});
    const keepPort = ports.includes(local.port) ? local.port : (ports[0] ?? "");
    const info = local.wsdlDefinitionMap[svc]?.[keepPort];
    const ops = toStringArray(info?.operations);
    const keepOp = ops.includes(local.operation) ? local.operation : (ops[0] ?? PLACEHOLDER_OP);
    commit({
      ...local,
      service: svc,
      port: keepPort,
      locationURI: cascadeLocationURI(info),
      operation: keepOp,
      soapAction: cascadeSoapAction(info?.actions ?? [], ops.indexOf(keepOp)),
    });
  }

  function onPortChange(port: string) {
    const info = local.wsdlDefinitionMap[local.service]?.[port];
    const ops = toStringArray(info?.operations);
    const keepOp = ops.includes(local.operation) ? local.operation : (ops[0] ?? PLACEHOLDER_OP);
    commit({
      ...local,
      port,
      locationURI: cascadeLocationURI(info),
      operation: keepOp,
      soapAction: cascadeSoapAction(info?.actions ?? [], ops.indexOf(keepOp)),
    });
  }

  function onOperationChange(op: string) {
    // Mirror Java operationComboBox action listener: SOAP Action resets to "" on every
    // selection and is only repopulated for a real operation with a matching action.
    if (!portInfo || op === PLACEHOLDER_OP) {
      commit({ ...local, operation: op, soapAction: "" });
      return;
    }
    const idx = operationOptions.indexOf(op);
    const soapAction =
      idx >= 0 && idx < portInfo.actions.length ? (portInfo.actions[idx] ?? "") : "";
    commit({ ...local, operation: op, soapAction });
  }

  // ── Get Operations ──────────────────────────────────────────────────────────

  function needsOpsOverwrite() {
    return (
      local.service.trim() ||
      local.port.trim() ||
      local.locationURI.trim() ||
      (local.operation && local.operation !== PLACEHOLDER_OP)
    );
  }

  async function doGetOperations() {
    setOpsLoading(true);
    setOpsError(null);
    try {
      await cacheWsdlFromUrl(propsXml, channelId, channelName);
      const defMap = await getWsdlDefinition({
        channelId,
        channelName,
        wsdlUrl: local.wsdlUrl,
        username: local.username,
        password: local.password,
      });
      if (Object.keys(defMap).length === 0) throw new Error("No operations found in WSDL.");

      // Auto-populate first service → first port → first operation
      const firstSvc = Object.keys(defMap)[0] ?? "";
      const firstPort = Object.keys(defMap[firstSvc] ?? {})[0] ?? "";
      const info = defMap[firstSvc]?.[firstPort];
      const ops = toStringArray(info?.operations);
      const firstOp = ops[0] ?? PLACEHOLDER_OP;
      // Mirror Java loadServiceMap → cascade: Get Operations resets the Location URI, so a
      // fetched port with no location leaves it blank (not the prior/WSDL value). Unlike the
      // manual service/port cascade handlers, there is no previously-typed value to restore.
      const locUri = info?.locationURI ?? "";
      const idx = ops.indexOf(firstOp);
      const soapAction =
        info && idx >= 0 && idx < info.actions.length ? (info.actions[idx] ?? "") : "";

      commit({
        ...local,
        wsdlDefinitionMap: defMap,
        service: firstSvc,
        port: firstPort,
        locationURI: locUri,
        operation: firstOp,
        soapAction,
      });
    } catch (e) {
      setOpsError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpsLoading(false);
    }
  }

  function handleGetOperations() {
    if (needsOpsOverwrite()) {
      setConfirmOps(true);
    } else {
      void doGetOperations();
    }
  }

  // ── Generate Envelope ───────────────────────────────────────────────────────

  async function doGenerateEnvelope() {
    setGenerating(true);
    setGenError(null);
    try {
      const cached = await isWsdlCached({
        channelId,
        channelName,
        wsdlUrl: local.wsdlUrl,
        username: local.username,
        password: local.password,
      });
      if (!cached) {
        setGenError("WSDL is no longer cached. Click “Get Operations” to reload it.");
        return;
      }
      const [envelope, soapAction] = await Promise.all([
        generateWsEnvelope({
          channelId,
          channelName,
          wsdlUrl: local.wsdlUrl,
          username: local.username,
          password: local.password,
          service: local.service,
          port: local.port,
          operation: local.operation,
          buildOptional: true,
        }),
        getWsSoapAction({
          channelId,
          channelName,
          wsdlUrl: local.wsdlUrl,
          username: local.username,
          password: local.password,
          service: local.service,
          port: local.port,
          operation: local.operation,
        }),
      ]);
      commit({ ...local, envelope: envelope ?? "", soapAction: soapAction ?? local.soapAction });
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  function handleGenerateEnvelope() {
    if (local.envelope || local.soapAction) {
      setConfirmGenEnv(true);
    } else {
      void doGenerateEnvelope();
    }
  }

  // ── Location URI test connection ────────────────────────────────────────────

  async function handleTestLocationUri() {
    if (!local.locationURI.trim()) return;
    setLocUriTesting(true);
    setLocUriResult(null);
    setLocUriDialogOpen(false);

    const modifiedXml = updateWebServiceSenderPropsInXml(propsXml, { ...local, wsdlUrl: "" });
    // Send-boundary guard: this direct fetch bypasses serialize().
    assertNoUnresolvedVersion(modifiedXml, "connectors/ws/_testConnection");
    const serverUrl = getServerUrl();
    const params = new URLSearchParams();
    if (channelId) params.set("channelId", channelId);
    if (channelName) params.set("channelName", channelName);
    const qs = params.toString() ? `?${params.toString()}` : "";

    try {
      const res = await fetch(`${PROXY_BASE}/connectors/ws/_testConnection${qs}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/xml",
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          ...(serverUrl ? { "x-bl-server": serverUrl } : {}),
        },
        body: modifiedXml,
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setLocUriResult({
          type: "FAILURE",
          message: `HTTP ${res.status}: ${txt || res.statusText}`,
        });
        return;
      }

      const txt = await res.text();
      try {
        const raw = JSON.parse(txt);
        const normalized = normalizeXStream(raw) as Record<string, unknown>;
        const keys = Object.keys(normalized ?? {});
        const data =
          keys.length === 1 &&
          typeof normalized[keys[0]] === "object" &&
          normalized[keys[0]] !== null
            ? (normalized[keys[0]] as { type?: string; message?: string })
            : (normalized as { type?: string; message?: string });
        setLocUriResult({
          type: (data.type === "SUCCESS" || data.type === "TIME_OUT"
            ? data.type
            : "FAILURE") as TestConnResult["type"],
          message: data.message ?? "",
        });
      } catch {
        const upper = txt.trim().toUpperCase();
        setLocUriResult({
          type: (upper === "SUCCESS"
            ? "SUCCESS"
            : upper === "TIME_OUT"
              ? "TIME_OUT"
              : "FAILURE") as TestConnResult["type"],
          message: txt.trim(),
        });
      }
    } catch (e) {
      setLocUriResult({
        type: "FAILURE",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLocUriTesting(false);
    }
  }

  return (
    <>
      {/* Location URI test result */}
      <TestConnResultDialog
        open={locUriDialogOpen}
        result={locUriResult}
        onClose={() => {
          setLocUriDialogOpen(false);
          setLocUriResult(null);
        }}
      />

      {/* Get Operations overwrite confirm */}
      {confirmOps && (
        <ConfirmDialog
          title="Replace current settings?"
          description="This will replace your current service, port, location URI, and operation. Press OK to continue."
          confirmLabel="OK"
          confirmVariant="default"
          onConfirm={() => {
            setConfirmOps(false);
            void doGetOperations();
          }}
          onCancel={() => setConfirmOps(false)}
        />
      )}

      {/* Generate Envelope overwrite confirm */}
      {confirmGenEnv && (
        <ConfirmDialog
          title="Replace envelope and SOAP action?"
          description="This will replace your current SOAP envelope and SOAP action. Press OK to continue."
          confirmLabel="OK"
          confirmVariant="default"
          onConfirm={() => {
            setConfirmGenEnv(false);
            void doGenerateEnvelope();
          }}
          onCancel={() => setConfirmGenEnv(false)}
        />
      )}

      <SettingsSection
        title="Web Service Sender Settings"
        icon={Globe}
        defaultExpanded={true}
        storageKey="bl-ws-sender-main"
      >
        {/* WSDL URL */}
        <FieldRow label="WSDL URL:">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <HoverTooltip content="Enter the full URL to the WSDL describing the web service method to be called.">
                <input
                  type="text"
                  value={local.wsdlUrl}
                  onChange={(e) => set("wsdlUrl", e.target.value)}
                  style={sslHighlightStyle}
                  className={`${inputCls(viewDensity)} flex-1 min-w-0 ${invalid.has("wsdlUrl") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
              {sslNotConfigured && (
                <HoverTooltip content={SSL_NOT_CONFIGURED_TOOLTIP}>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                    <ShieldAlert className="w-4 h-4" />
                    (SSL Not Configured)
                  </span>
                </HoverTooltip>
              )}
            </div>
            {invalid.has("wsdlUrl") && <p className={fieldErrorMsgCls}>WSDL URL is required.</p>}
          </div>
        </FieldRow>

        {/* Test Connection + Get Operations buttons */}
        <FieldRow label="">
          <div className="flex flex-col gap-2 flex-1">
            <div className="flex items-start gap-2 flex-wrap">
              <TestConnButton
                label="Test Connection"
                testing={tcTesting}
                result={tcResult}
                onTest={tcTest}
                onResultClose={tcClear}
                disabled={!local.wsdlUrl.trim()}
              />
              <HoverTooltip content="Clicking this button fetches the WSDL from the specified URL and parses it to obtain a description of the data types and methods used by the web service to be called. It replaces the values of all of the controls below by values taken from the WSDL.">
                <button
                  onClick={handleGetOperations}
                  disabled={opsLoading || !local.wsdlUrl.trim()}
                  className="px-3 py-1 text-sm rounded border border-border
                    text-gray-700 dark:text-gray-300
                    hover:bg-gray-50 dark:hover:bg-gray-700
                    hover:border-border
                    disabled:opacity-40 disabled:cursor-not-allowed
                    transition-colors"
                >
                  {opsLoading ? "Loading…" : "Get Operations"}
                </button>
              </HoverTooltip>
            </div>
            {opsError && <p className="text-xs text-red-600 dark:text-red-400">{opsError}</p>}
          </div>
        </FieldRow>

        {/* Service — editable combo backed by wsdlDefinitionMap */}
        <FieldRow label="Service:">
          <div className="flex-1 min-w-0">
            <HoverTooltip content="The service name for the WSDL defined above. This field is filled in automatically when the Get Operations button is clicked and does not usually need to be changed, unless multiple services are defined in the WSDL.">
              <span className="block w-full">
                <EditableCombobox
                  value={local.service}
                  onChange={(v) => set("service", v)}
                  onSelect={onServiceChange}
                  options={serviceOptions}
                  ariaLabel="Service"
                  invalid={invalid.has("service")}
                  className={`${inputCls(viewDensity)} w-full`}
                />
              </span>
            </HoverTooltip>
            {invalid.has("service") && <p className={fieldErrorMsgCls}>Service is required.</p>}
          </div>
        </FieldRow>

        {/* Port / Endpoint — editable combo backed by selected service */}
        <FieldRow label="Port / Endpoint:">
          <div className="flex-1 min-w-0">
            <HoverTooltip content="The port / endpoint name for the service defined above. This field is filled in automatically when the Get Operations button is clicked and does not usually need to be changed, unless multiple endpoints are defined for the currently selected service in the WSDL.">
              <span className="block w-full">
                <EditableCombobox
                  value={local.port}
                  onChange={(v) => set("port", v)}
                  onSelect={onPortChange}
                  options={portOptions}
                  ariaLabel="Port / Endpoint"
                  invalid={invalid.has("port")}
                  className={`${inputCls(viewDensity)} w-full`}
                />
              </span>
            </HoverTooltip>
            {invalid.has("port") && (
              <p className={fieldErrorMsgCls}>Port / Endpoint is required.</p>
            )}
          </div>
        </FieldRow>

        {/* Location URI */}
        <FieldRow label="Location URI:">
          <div className="flex items-center gap-2 flex-1">
            <HoverTooltip content="The dispatch location for the port / endpoint defined above. This field is filled in automatically when the Get Operations button is clicked and does not usually need to be changed. If left blank, the default URI defined in the WSDL will be used.">
              <input
                type="text"
                value={local.locationURI}
                onChange={(e) => set("locationURI", e.target.value)}
                style={sslHighlightStyle}
                className={`${inputCls(viewDensity)} flex-1`}
              />
            </HoverTooltip>
            <button
              onClick={handleTestLocationUri}
              disabled={locUriTesting || !local.locationURI.trim()}
              className="shrink-0 px-2.5 py-1 text-xs rounded border border-border
                text-gray-700 dark:text-gray-300
                hover:bg-gray-50 dark:hover:bg-gray-700
                hover:border-border
                disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {locUriTesting ? "Testing…" : "Test Connection"}
            </button>
          </div>
        </FieldRow>

        {/* Socket Timeout */}
        <FieldRow label="Socket Timeout (ms):">
          <HoverTooltip content="The connection and socket timeout in milliseconds. Zero = infinite timeout.">
            <VariableOrNumberInput
              min={0}
              value={local.socketTimeout}
              onChange={(socketTimeout) => set("socketTimeout", socketTimeout)}
              className={`${inputCls(viewDensity)} w-28`}
            />
          </HoverTooltip>
        </FieldRow>

        {/* Authentication */}
        <FieldRow label="Authentication:">
          <RadioGroup
            name="ws-auth"
            value={local.useAuthentication ? "yes" : "no"}
            onChange={(v) => {
              // Mirror Java authenticationNoRadioActionPerformed: switching to No clears the
              // username/password so stale credentials aren't serialized or sent to the WSDL
              // cache calls (the server WSDL cache key embeds credentials).
              if (v === "yes") {
                set("useAuthentication", true);
              } else {
                commit({ ...local, useAuthentication: false, username: "", password: "" });
              }
            }}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Use a username and password when fetching the WSDL and calling the web service."
          />
        </FieldRow>
        {local.useAuthentication && (
          <>
            <FieldRow label="Username:">
              <HoverTooltip content="The username used to get the WSDL and call the web service.">
                <input
                  type="text"
                  value={local.username}
                  onChange={(e) => set("username", e.target.value)}
                  className={`${inputCls(viewDensity)} w-56`}
                />
              </HoverTooltip>
            </FieldRow>
            <FieldRow label="Password:">
              <HoverTooltip content="The password used to get the WSDL and call the web service.">
                <SecretInput
                  value={local.password}
                  onChange={(e) => set("password", e.target.value)}
                  className={`${inputCls(viewDensity)} w-56`}
                />
              </HoverTooltip>
            </FieldRow>
          </>
        )}

        {/* Invocation Type */}
        <FieldRow label="Invocation Type:">
          <RadioGroup
            name="ws-invocation"
            value={local.oneWay ? "one-way" : "two-way"}
            onChange={(v) => set("oneWay", v === "one-way")}
            options={[
              { label: "Two-Way", value: "two-way" },
              { label: "One-Way", value: "one-way" },
            ]}
            title="Two-Way: wait for a response. One-Way: do not wait for a response."
          />
        </FieldRow>

        {/* Operation + Generate Envelope — editable combo backed by selected port */}
        <FieldRow label="Operation:">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex-1 min-w-0">
              <HoverTooltip content="Select the web service operation to be called from this list. This is only used for generating the envelope.">
                <span className="block w-full">
                  <EditableCombobox
                    value={local.operation}
                    onChange={(v) => set("operation", v)}
                    onSelect={onOperationChange}
                    options={operationOptions}
                    ariaLabel="Operation"
                    className={`${inputCls(viewDensity)} w-full`}
                  />
                </span>
              </HoverTooltip>
            </div>
            <HoverTooltip
              content={
                canGenerate
                  ? "Generate a SOAP envelope template for the selected operation."
                  : "Select an operation to enable this button."
              }
            >
              <button
                onClick={handleGenerateEnvelope}
                disabled={generating || !canGenerate}
                className="shrink-0 px-2.5 py-1 text-xs rounded border border-border
                  text-gray-700 dark:text-gray-300
                  hover:bg-gray-50 dark:hover:bg-gray-700
                  hover:border-border
                  disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {generating ? "Generating…" : "Generate Envelope"}
              </button>
            </HoverTooltip>
          </div>
          {genError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{genError}</p>}
        </FieldRow>

        {/* SOAP Action */}
        <FieldRow label="SOAP Action:">
          <HoverTooltip content="The SOAPAction HTTP request header field. Optional for most web services.">
            <input
              type="text"
              value={local.soapAction}
              onChange={(e) => set("soapAction", e.target.value)}
              className={`${inputCls(viewDensity)} flex-1`}
            />
          </HoverTooltip>
        </FieldRow>

        {/* SOAP Envelope */}
        <FullWidthField label="SOAP Envelope:">
          <HoverTooltip content="The SOAP envelope XML to send to the web service.">
            <ResizableEditorBox className="border border-border rounded" height={160}>
              <MonacoEditor
                height="100%"
                language="xml"
                theme={isDark ? "vs-dark" : "vs"}
                value={local.envelope}
                onMount={handleEnvelopeMount}
                onChange={(v) => set("envelope", v ?? "")}
                options={{ ...MONACO_BASE_OPTIONS, fontSize: 12 }}
              />
            </ResizableEditorBox>
          </HoverTooltip>
        </FullWidthField>

        {/* Headers */}
        <FieldRow label="Headers:" className="!items-start pt-1">
          <div className="flex-1 space-y-1.5">
            <RadioGroup
              name="ws-headers-mode"
              value={local.useHeadersVariable ? "map" : "table"}
              onChange={(v) => set("useHeadersVariable", v === "map")}
              options={[
                { label: "Use Table", value: "table" },
                { label: "Use Map", value: "map" },
              ]}
            />
            {local.useHeadersVariable ? (
              <HoverTooltip content="The variable of a Java map to use to populate headers.">
                <input
                  type="text"
                  value={local.headersVariable}
                  onChange={(e) => set("headersVariable", e.target.value)}
                  placeholder="Map variable name"
                  className={`${inputCls(viewDensity)} w-56`}
                />
              </HoverTooltip>
            ) : (
              <NameValueTable
                entries={local.headers}
                onChange={handleHeaders}
                nameLabel="Header"
                valueLabel="Value"
                addLabel="Add Header"
              />
            )}
          </div>
        </FieldRow>

        {/* Use MTOM */}
        <FieldRow label="Use MTOM:">
          <RadioGroup
            name="ws-mtom"
            value={local.useMtom ? "yes" : "no"}
            onChange={(v) => set("useMtom", v === "yes")}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Enable MTOM on the SOAP Binding to allow attachments."
          />
        </FieldRow>

        {/* Attachments (MTOM only) */}
        {local.useMtom && (
          <FieldRow label="Attachments:" className="!items-start pt-1">
            <div className="flex-1 space-y-1.5">
              <RadioGroup
                name="ws-attach-mode"
                value={local.useAttachmentsVariable ? "list" : "table"}
                onChange={(v) => set("useAttachmentsVariable", v === "list")}
                options={[
                  { label: "Use Table", value: "table" },
                  { label: "Use List", value: "list" },
                ]}
              />
              {local.useAttachmentsVariable ? (
                <HoverTooltip content="The variable of a Java list to use to populate attachments (AttachmentEntry values).">
                  <input
                    type="text"
                    value={local.attachmentsVariable}
                    onChange={(e) => set("attachmentsVariable", e.target.value)}
                    placeholder="List variable name"
                    className={`${inputCls(viewDensity)} w-56`}
                  />
                </HoverTooltip>
              ) : (
                <div className="space-y-1">
                  {local.attachments.length > 0 && (
                    <div
                      className="grid gap-1 items-center"
                      style={{ gridTemplateColumns: "1.25rem 1fr 1fr 1fr 1.5rem" }}
                    >
                      {["", "ID", "Content", "MIME Type", ""].map((h, hi) => (
                        <span
                          key={h || `h${hi}`}
                          className="text-xs text-gray-500 dark:text-gray-400 font-medium px-1"
                        >
                          {h}
                        </span>
                      ))}
                      {local.attachments.map((att, i) => (
                        <Fragment key={i}>
                          {/* Drag handle — mirrors Java's draggable attachment row: drops an
                              XOP <inc:Include> referencing this attachment's cid into the envelope. */}
                          <HoverTooltip content="Drag into the SOAP Envelope to insert an XOP include for this attachment.">
                            <span
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData("text/plain", buildXopInclude(att.name));
                                e.dataTransfer.effectAllowed = "copy";
                              }}
                              className="flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-grab active:cursor-grabbing"
                              aria-label="Drag attachment into envelope"
                            >
                              <GripVertical className="w-3.5 h-3.5" />
                            </span>
                          </HoverTooltip>
                          <input
                            type="text"
                            value={att.name}
                            onChange={(e) => updateAttachment(i, "name", e.target.value)}
                            className={`${inputCls(viewDensity)} text-xs`}
                          />
                          <input
                            type="text"
                            value={att.content}
                            onChange={(e) => updateAttachment(i, "content", e.target.value)}
                            className={`${inputCls(viewDensity)} text-xs`}
                          />
                          <input
                            type="text"
                            value={att.type}
                            onChange={(e) => updateAttachment(i, "type", e.target.value)}
                            className={`${inputCls(viewDensity)} text-xs`}
                          />
                          <HoverTooltip content="Remove attachment">
                            <button
                              onClick={() => removeAttachment(i)}
                              className="flex items-center justify-center text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </HoverTooltip>
                        </Fragment>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={addAttachment}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    + Add Attachment
                  </button>
                </div>
              )}
            </div>
          </FieldRow>
        )}
      </SettingsSection>
    </>
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────

export const WebServiceSenderConnector: DestinationConnectorDefinition = {
  BottomSection: WebServiceSenderBottomSection,
  defaultPropertiesXml: DEFAULT_XML,
  validate(propertiesXml) {
    if (!propertiesXml) return [];
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const txt = (tag: string) => doc.querySelector(tag)?.textContent?.trim() ?? "";
    const errors: import("../shared/validate-utils").ValidationError[] = [];

    if (!txt("wsdlUrl")) errors.push({ field: "wsdlUrl", message: "WSDL URL is required." });
    if (!txt("service")) errors.push({ field: "service", message: "Service is required." });
    if (!txt("port")) errors.push({ field: "port", message: "Port / Endpoint is required." });

    const socketTimeout = txt("socketTimeout");
    if (!socketTimeout || !isNumberOrVariable(socketTimeout))
      errors.push({ field: "socketTimeout", message: "Socket Timeout is required." });

    if (!txt("envelope")) errors.push({ field: "envelope", message: "Envelope is required." });

    if (txt("isUseHeadersVariable") === "true" && !txt("headersVariable"))
      errors.push({ field: "headersVariable", message: "Headers variable name is required." });

    if (
      txt("useMtom") === "true" &&
      txt("isUseAttachmentsVariable") === "true" &&
      !txt("attachmentsVariable")
    )
      errors.push({
        field: "attachmentsVariable",
        message: "Attachments variable name is required.",
      });

    return errors;
  },
};
