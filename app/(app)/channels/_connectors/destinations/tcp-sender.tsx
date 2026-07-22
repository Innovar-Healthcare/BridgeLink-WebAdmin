"use client";

import { useEffect, useState } from "react";
import { Network, Settings2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { HoverTooltip } from "@/components/hover-tooltip";
import { SettingsSection, FieldRow, FullWidthField } from "@/components/settings/settings-section";
import { useTestConn } from "../shared/use-test-conn";
import { TestConnButton } from "../shared/test-conn-button";
import type { DestinationConnectorDefinition, DestinationConnectorSectionProps } from "./types";
import {
  DEFAULT_DEST_PROPERTIES_XML,
  parseTcpSenderPropsFromXml,
  updateTcpSenderPropsInXml,
  withVersion,
  resolveXmlVersion,
  type TcpSenderProps,
} from "../../_lib/channel-xml";
import { RadioGroup } from "../shared/radio-group";
import { inputCls, selectCls, inputErrorCls, fieldErrorMsgCls } from "../shared/styles";
import {
  SampleFrameLabel,
  TransmissionModeSettingsDialog,
} from "../shared/transmission-mode-dialog";
import {
  TRANSMISSION_MODE_REGISTRY,
  isTransmissionModeNonDefault,
  defaultSettingsForMode,
  validateTransmissionModeForSave,
} from "../shared/transmission-modes";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { useCharsetEncodings } from "@/lib/hooks/use-charset-encodings";
import { buildCharsetOptions } from "../shared/charset-options";
import { NumberInput, isNonNegativeInteger } from "@/components/ui/number-input";
import { usePluginSurfaceEnabled } from "@/lib/plugin-gating";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_XML = DEFAULT_DEST_PROPERTIES_XML["TCP Sender"]!;

// ─── Bottom section ───────────────────────────────────────────────────────────

function TcpSenderBottomSection({
  propertiesXml,
  onChange,
  channelId,
  channelName,
  invalidFields,
}: DestinationConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const serverCharsets = useCharsetEncodings();
  const surfaceEnabled = usePluginSurfaceEnabled();
  // Transmission modes offered in the dropdown, filtered by server-enablement
  // gating. Built-ins carry no pluginName so they always show.
  const visibleModes = TRANSMISSION_MODE_REGISTRY.filter((m) => surfaceEnabled(m.pluginName));
  const invalid = invalidFields ?? new Set<string>();
  const propsXml = propertiesXml ?? withVersion(DEFAULT_XML, resolveXmlVersion());
  const [local, setLocal] = useState<TcpSenderProps>(() => parseTcpSenderPropsFromXml(propsXml));
  const [tmDialogOpen, setTmDialogOpen] = useState(false);
  const [pendingTransmissionMode, setPendingTransmissionMode] = useState<string | null>(null);
  const {
    testing: tcTesting,
    result: tcResult,
    test: tcTest,
  } = useTestConn("tcp", "_testConnection", propsXml, channelId, channelName);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(
      parseTcpSenderPropsFromXml(propertiesXml ?? withVersion(DEFAULT_XML, resolveXmlVersion()))
    );
  }, [propertiesXml]);

  function commit(updated: TcpSenderProps) {
    setLocal(updated);
    onChange({ propertiesXml: updateTcpSenderPropsInXml(propsXml, updated) });
  }

  function set<K extends keyof TcpSenderProps>(key: K, val: TcpSenderProps[K]) {
    commit({ ...local, [key]: val });
  }

  const isClient = !local.serverMode;
  // A mode that isn't currently selectable is surfaced in the dropdown (pinned,
  // disabled) with the settings dialog disabled. Two cases: an UNREGISTERED
  // mode's <transmissionModeProperties> is preserved verbatim on save (the
  // serializer bails without a definition), so editing would silently no-op; a
  // REGISTERED-but-gated-off mode still round-trips through its
  // compiled-in parse/serialize, but its settings are read-only while the
  // server extension is disabled.
  const isKnownMode = visibleModes.some((m) => m.name === local.transmissionMode);

  return (
    <>
      {pendingTransmissionMode && (
        <ConfirmDialog
          title="Select an Option"
          description="Are you sure you would like to change the transmission mode and lose all of the current transmission properties?"
          confirmLabel="Yes"
          confirmVariant="default"
          onConfirm={() => {
            const newDef = TRANSMISSION_MODE_REGISTRY.find(
              (m) => m.name === pendingTransmissionMode
            );
            // Reset ALL transmission properties (incl. MLLPv2 fields) to the new
            // mode's defaults, mirroring Java's fresh-provider behavior on switch.
            if (newDef) commit({ ...local, ...defaultSettingsForMode(newDef) });
            setPendingTransmissionMode(null);
          }}
          onCancel={() => setPendingTransmissionMode(null)}
        />
      )}

      <SettingsSection
        title="TCP Sender Settings"
        icon={Network}
        defaultExpanded={true}
        storageKey="bl-tcp-sender-main"
      >
        {/* Transmission Mode */}
        <FieldRow label="Transmission Mode:">
          <HoverTooltip content="Select the transmission mode to use for sending and receiving data.">
            <select
              value={local.transmissionMode}
              onChange={(e) => {
                const newMode = e.target.value;
                const currentDef = TRANSMISSION_MODE_REGISTRY.find(
                  (m) => m.name === local.transmissionMode
                );
                // Compare ALL transmission properties (incl. MLLPv2 fields) to the
                // mode defaults, mirroring Java MLLPModeProperties.equals.
                const nonDefault = currentDef
                  ? isTransmissionModeNonDefault(local, currentDef)
                  : false;
                if (nonDefault) {
                  setPendingTransmissionMode(newMode);
                } else {
                  const newDef = TRANSMISSION_MODE_REGISTRY.find((m) => m.name === newMode);
                  if (newDef) commit({ ...local, ...defaultSettingsForMode(newDef) });
                }
              }}
              className={`${selectCls(viewDensity)} w-40`}
            >
              {visibleModes.map(({ name, displayName }) => (
                <option key={name} value={name}>
                  {displayName}
                </option>
              ))}
              {!isKnownMode && (
                <option value={local.transmissionMode} disabled>
                  {local.transmissionMode} (unavailable)
                </option>
              )}
            </select>
          </HoverTooltip>
          <HoverTooltip
            content={
              isKnownMode
                ? "Configure transmission mode settings."
                : "This transmission mode's plugin is not installed. Its settings are read-only."
            }
          >
            <button
              type="button"
              aria-label="Transmission mode settings"
              onClick={() => setTmDialogOpen(true)}
              disabled={!isKnownMode}
              className="ml-1 p-1 rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <Settings2 className="h-4 w-4" />
            </button>
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="">
          <SampleFrameLabel
            transmissionMode={local.transmissionMode}
            startOfMessageBytes={local.startOfMessageBytes}
            endOfMessageBytes={local.endOfMessageBytes}
          />
        </FieldRow>

        {/* Mode */}
        <FieldRow label="Mode:">
          <RadioGroup
            name="tcp-mode"
            value={local.serverMode ? "server" : "client"}
            onChange={(v) => commit({ ...local, serverMode: v === "server" })}
            options={[
              { label: "Client", value: "client" },
              { label: "Server", value: "server" },
            ]}
            title="Select Server to listen for connections from clients, or Client to connect to a TCP Server."
          />
        </FieldRow>

        {/* Client-only: Remote Address/Port */}
        {isClient && (
          <>
            <FieldRow label="Remote Address:">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <HoverTooltip content="The DNS domain name or IP address on which to connect.">
                    <input
                      type="text"
                      value={local.remoteAddress}
                      onChange={(e) => set("remoteAddress", e.target.value)}
                      className={`${inputCls(viewDensity)} w-56 ${invalid.has("remoteAddress") ? inputErrorCls : ""}`}
                    />
                  </HoverTooltip>
                  <TestConnButton
                    label="Test Connection"
                    testing={tcTesting}
                    result={tcResult}
                    onTest={tcTest}
                  />
                </div>
                {invalid.has("remoteAddress") && (
                  <p className={fieldErrorMsgCls}>Remote Address is required.</p>
                )}
              </div>
            </FieldRow>
            <FieldRow label="Remote Port:">
              <HoverTooltip content="The port on which to connect.">
                <input
                  type="text"
                  value={local.remotePort}
                  onChange={(e) => set("remotePort", e.target.value)}
                  className={`${inputCls(viewDensity)} w-28 ${invalid.has("remotePort") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
              {invalid.has("remotePort") && (
                <p className={fieldErrorMsgCls}>Remote Port is required.</p>
              )}
            </FieldRow>

            {/* Override Local Binding */}
            <FieldRow label="Override Local Binding:">
              <RadioGroup
                name="tcp-override-local"
                value={local.overrideLocalBinding ? "yes" : "no"}
                onChange={(v) => set("overrideLocalBinding", v === "yes")}
                options={[
                  { label: "Yes", value: "yes" },
                  { label: "No", value: "no" },
                ]}
                title="Select Yes to override the local address and port that the client socket will be bound to."
              />
            </FieldRow>
            {local.overrideLocalBinding && (
              <>
                <FieldRow label="Local Address:">
                  <HoverTooltip content="The local address that the client socket will be bound to.">
                    <input
                      type="text"
                      value={local.localAddress}
                      onChange={(e) => set("localAddress", e.target.value)}
                      className={`${inputCls(viewDensity)} w-56 ${invalid.has("localAddress") ? inputErrorCls : ""}`}
                    />
                  </HoverTooltip>
                </FieldRow>
                <FieldRow label="Local Port:">
                  <HoverTooltip content="The local port that the client socket will be bound to.">
                    <input
                      type="text"
                      value={local.localPort}
                      onChange={(e) => set("localPort", e.target.value)}
                      className={`${inputCls(viewDensity)} w-28 ${invalid.has("localPort") ? inputErrorCls : ""}`}
                    />
                  </HoverTooltip>
                </FieldRow>
              </>
            )}

            {/* Keep Connection Open */}
            <FieldRow label="Keep Connection Open:">
              <RadioGroup
                name="tcp-keep-open"
                value={local.keepConnectionOpen ? "yes" : "no"}
                onChange={(v) => set("keepConnectionOpen", v === "yes")}
                options={[
                  { label: "Yes", value: "yes" },
                  { label: "No", value: "no" },
                ]}
                title="Select Yes to keep the connection to the host open across multiple messages."
              />
            </FieldRow>
            {local.keepConnectionOpen && (
              <>
                <FieldRow label="Send Timeout (ms):">
                  <HoverTooltip content="The number of milliseconds to keep the connection to the host open. If zero, the connection will be kept open indefinitely.">
                    <NumberInput
                      value={local.sendTimeout}
                      onChange={(sendTimeout) => set("sendTimeout", sendTimeout)}
                      className={`${inputCls(viewDensity)} w-28 ${invalid.has("sendTimeout") ? inputErrorCls : ""}`}
                    />
                  </HoverTooltip>
                </FieldRow>
                <FieldRow label="Check Remote Host:">
                  <RadioGroup
                    name="tcp-check-remote"
                    value={local.checkRemoteHost ? "yes" : "no"}
                    onChange={(v) => set("checkRemoteHost", v === "yes")}
                    options={[
                      { label: "Yes", value: "yes" },
                      { label: "No", value: "no" },
                    ]}
                    title="Select Yes to check if the remote host has closed the connection before each message."
                  />
                </FieldRow>
              </>
            )}
          </>
        )}

        {/* Server-only: Local Address/Port, Max Connections */}
        {!isClient && (
          <>
            <FieldRow label="Local Address:">
              <HoverTooltip content="The local address that the server socket will be bound to.">
                <input
                  type="text"
                  value={local.localAddress}
                  onChange={(e) => set("localAddress", e.target.value)}
                  className={`${inputCls(viewDensity)} w-56 ${invalid.has("localAddress") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
            </FieldRow>
            <FieldRow label="Local Port:">
              <HoverTooltip content="The local port to listen on.">
                <input
                  type="text"
                  value={local.localPort}
                  onChange={(e) => set("localPort", e.target.value)}
                  className={`${inputCls(viewDensity)} w-28 ${invalid.has("localPort") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
            </FieldRow>
            <FieldRow label="Max Connections:">
              <HoverTooltip content="The maximum number of client connections to accept.">
                <NumberInput
                  value={local.maxConnections}
                  onChange={(maxConnections) => set("maxConnections", maxConnections)}
                  className={`${inputCls(viewDensity)} w-28 ${invalid.has("maxConnections") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
            </FieldRow>
          </>
        )}

        {/* Response Timeout */}
        <FieldRow label="Response Timeout (ms):">
          <HoverTooltip content="The number of milliseconds the connector should wait when attempting to read from the remote socket.">
            <NumberInput
              value={local.responseTimeout}
              onChange={(responseTimeout) => set("responseTimeout", responseTimeout)}
              className={`${inputCls(viewDensity)} w-28 ${invalid.has("responseTimeout") ? inputErrorCls : ""}`}
            />
          </HoverTooltip>
        </FieldRow>

        {/* Ignore Response */}
        <FieldRow label="Ignore Response:">
          <RadioGroup
            name="tcp-ignore-response"
            value={local.ignoreResponse ? "yes" : "no"}
            onChange={(v) => set("ignoreResponse", v === "yes")}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="If Yes, the connector will not wait for a response after sending a message."
          />
        </FieldRow>

        {/* Queue on Response Timeout */}
        <FieldRow label="Queue on Response Timeout:">
          <RadioGroup
            name="tcp-queue-timeout"
            value={local.queueOnResponseTimeout ? "yes" : "no"}
            onChange={(v) => set("queueOnResponseTimeout", v === "yes")}
            disabled={local.ignoreResponse}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="If enabled, the message is queued when a timeout occurs while waiting for a response."
          />
        </FieldRow>

        {/* Buffer Size */}
        <FieldRow label="Buffer Size (bytes):">
          <HoverTooltip content="The size, in bytes, of the buffer to be used to hold messages waiting to be sent.">
            <NumberInput
              value={local.bufferSize}
              onChange={(bufferSize) => set("bufferSize", bufferSize)}
              className={`${inputCls(viewDensity)} w-28 ${invalid.has("bufferSize") ? inputErrorCls : ""}`}
            />
          </HoverTooltip>
        </FieldRow>

        {/* Data Type */}
        <FieldRow label="Data Type:">
          <RadioGroup
            name="tcp-data-type"
            value={local.dataTypeBinary ? "binary" : "text"}
            // Selecting Binary resets the charset to Default (mirrors Java, which sets the disabled
            // charset combo back to index 0 / DEFAULT_ENCODING on binary-select).
            onChange={(v) =>
              commit(
                v === "binary"
                  ? { ...local, dataTypeBinary: true, charsetEncoding: "DEFAULT_ENCODING" }
                  : { ...local, dataTypeBinary: false }
              )
            }
            options={[
              { label: "Binary", value: "binary" },
              { label: "Text", value: "text" },
            ]}
            title="Select Binary if the outbound message is a Base64 string. Select Text if the outbound message is text."
          />
        </FieldRow>

        {/* Encoding (Text only) */}
        {!local.dataTypeBinary && (
          <FieldRow label="Encoding:">
            <HoverTooltip content="The character set encoding to use when converting the outbound message to a byte stream.">
              <select
                value={local.charsetEncoding}
                onChange={(e) => set("charsetEncoding", e.target.value)}
                className={selectCls(viewDensity)}
              >
                {buildCharsetOptions(serverCharsets, local.charsetEncoding).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </HoverTooltip>
          </FieldRow>
        )}

        {/* Template */}
        <FullWidthField label="Template:">
          <HoverTooltip content="The message content to be sent.">
            <Textarea
              density={viewDensity}
              enableTabKey
              value={local.template}
              onChange={(e) => set("template", e.target.value)}
              rows={5}
              className={`w-full px-3 py-2 text-sm rounded border border-border
              bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono resize-y
              focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30 ${invalid.has("template") ? inputErrorCls : ""}`}
            />
          </HoverTooltip>
          {invalid.has("template") && <p className={fieldErrorMsgCls}>Template is required.</p>}
        </FullWidthField>
      </SettingsSection>

      <TransmissionModeSettingsDialog
        open={tmDialogOpen}
        onOpenChange={setTmDialogOpen}
        settings={{
          transmissionMode: local.transmissionMode,
          startOfMessageBytes: local.startOfMessageBytes,
          endOfMessageBytes: local.endOfMessageBytes,
          useMLLPv2: local.useMLLPv2,
          ackBytes: local.ackBytes,
          nackBytes: local.nackBytes,
          maxRetries: local.maxRetries,
        }}
        onSave={(updated) => commit({ ...local, ...updated })}
      />
    </>
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────

export const TcpSenderConnector: DestinationConnectorDefinition = {
  BottomSection: TcpSenderBottomSection,
  defaultPropertiesXml: DEFAULT_XML,
  validate(propertiesXml) {
    if (!propertiesXml) return [];
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const txt = (tag: string) => doc.querySelector(tag)?.textContent?.trim() ?? "";
    const errors: import("../shared/validate-utils").ValidationError[] = [];

    const serverMode = txt("serverMode") === "true";
    if (!serverMode) {
      if (txt("remoteAddress").length <= 3)
        errors.push({ field: "remoteAddress", message: "Remote Address is required." });
      if (!txt("remotePort"))
        errors.push({ field: "remotePort", message: "Remote Port is required." });
    }

    if (serverMode || txt("overrideLocalBinding") === "true") {
      if (txt("localAddress").length <= 3)
        errors.push({ field: "localAddress", message: "Local Address is required." });
      if (!txt("localPort"))
        errors.push({ field: "localPort", message: "Local Port is required." });
    }

    if (serverMode) {
      const maxConnections = txt("maxConnections");
      if (!maxConnections || !isNonNegativeInteger(maxConnections) || Number(maxConnections) <= 0)
        errors.push({
          field: "maxConnections",
          message: "Max Connections must be greater than 0.",
        });
    }

    if (!serverMode && txt("keepConnectionOpen") === "true") {
      const sendTimeout = txt("sendTimeout");
      if (!sendTimeout || !isNonNegativeInteger(sendTimeout))
        errors.push({ field: "sendTimeout", message: "Send Timeout is required." });
    }

    const bufferSize = txt("bufferSize");
    if (!bufferSize || !isNonNegativeInteger(bufferSize))
      errors.push({ field: "bufferSize", message: "Buffer Size is required." });

    const responseTimeout = txt("responseTimeout");
    if (!responseTimeout || !isNonNegativeInteger(responseTimeout))
      errors.push({ field: "responseTimeout", message: "Response Timeout is required." });

    if (!txt("template")) errors.push({ field: "template", message: "Template is required." });

    // Transmission-mode byte validation. Save-time is hex-only with blanks allowed for every mode
    // (mirrors the Java connector save path — FrameTransmissionModeClientProvider.checkProperties,
    // which MLLPModeClientProvider inherits without override). The strict non-blank / MLLPv2 rules
    // gate only the transmission-mode dialog, so a channel with blank MLLP frame bytes stays saveable.
    const tmProps = parseTcpSenderPropsFromXml(propertiesXml);
    errors.push(...validateTransmissionModeForSave(tmProps));

    return errors;
  },
};
