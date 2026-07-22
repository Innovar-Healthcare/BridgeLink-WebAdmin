"use client";

import { useState } from "react";
import { Network, Reply, Settings2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SettingsSection, FieldRow, SummaryChip } from "@/components/settings/settings-section";
import { HoverTooltip } from "@/components/hover-tooltip";
import type { ConnectorDefinition, ConnectorSectionProps } from "./types";
import { RadioGroup } from "./shared/radio-group";
import { selectCls, inputCls, inputErrorCls } from "./shared/styles";
import {
  SampleFrameLabel,
  TransmissionModeSettingsDialog,
} from "./shared/transmission-mode-dialog";
import {
  TRANSMISSION_MODE_REGISTRY,
  isTransmissionModeNonDefault,
  defaultSettingsForMode,
  validateTransmissionModeForSave,
} from "./shared/transmission-modes";
import {
  DEFAULT_TCP_LISTENER_PROPERTIES_XML,
  parseTcpListenerPropsFromXml,
  updateTcpListenerPropsInXml,
  type TcpListenerProps,
  TCP_RESPOND_SAME_CONNECTION,
  TCP_RESPOND_NEW_CONNECTION,
  TCP_RESPOND_ON_RECOVERY,
  resolveXmlVersion,
  withVersion,
} from "../_lib/channel-xml";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { useCharsetEncodings } from "@/lib/hooks/use-charset-encodings";
import { buildCharsetOptions } from "./shared/charset-options";
import { VariableOrNumberInput } from "@/components/ui/variable-or-number-input";
import { NumberInput, isNonNegativeInteger } from "@/components/ui/number-input";
import { usePluginSurfaceEnabled } from "@/lib/plugin-gating";

// ─── Bottom section ───────────────────────────────────────────────────────────

function TcpListenerBottomSection({
  propertiesXml,
  onChange,
  invalidFields,
}: ConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const invalid = invalidFields ?? new Set<string>();
  const serverCharsets = useCharsetEncodings();
  const surfaceEnabled = usePluginSurfaceEnabled();
  // Transmission modes offered in the dropdown, filtered by server-enablement
  // gating. Built-ins carry no pluginName so they always show.
  const visibleModes = TRANSMISSION_MODE_REGISTRY.filter((m) => surfaceEnabled(m.pluginName));
  const propsXml =
    propertiesXml ?? withVersion(DEFAULT_TCP_LISTENER_PROPERTIES_XML, resolveXmlVersion());
  const props = parseTcpListenerPropsFromXml(propertiesXml);
  const [tmDialogOpen, setTmDialogOpen] = useState(false);
  const [pendingTransmissionMode, setPendingTransmissionMode] = useState<string | null>(null);

  function update(patch: Partial<TcpListenerProps>) {
    onChange({ propertiesXml: updateTcpListenerPropsInXml(propsXml, { ...props, ...patch }) });
  }

  // Derived booleans
  const isClientMode = !props.serverMode;
  const showResponseAddr = props.respondOnNewConnection !== TCP_RESPOND_SAME_CONNECTION;
  // A mode that isn't currently selectable is surfaced in the dropdown (pinned,
  // disabled) with the settings dialog disabled. Two cases: an UNREGISTERED
  // mode's <transmissionModeProperties> is preserved verbatim on save (the
  // serializer bails without a definition), so editing would silently no-op; a
  // REGISTERED-but-gated-off mode still round-trips through its
  // compiled-in parse/serialize, but its settings are read-only while the
  // server extension is disabled.
  const isKnownMode = visibleModes.some((m) => m.name === props.transmissionMode);

  // ── Render ─────────────────────────────────────────────────────────────────

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
            if (newDef) update(defaultSettingsForMode(newDef));
            setPendingTransmissionMode(null);
          }}
          onCancel={() => setPendingTransmissionMode(null)}
        />
      )}

      {/* ── Main TCP settings ──────────────────────────────────────────────── */}

      <SettingsSection
        title="TCP Listener Settings"
        icon={Network}
        defaultExpanded={true}
        storageKey="bl-tcp-listener-main"
      >
        {/* Transmission mode */}
        <FieldRow label="Transmission Mode:">
          <HoverTooltip content="Select the transmission mode to use for sending and receiving data.">
            <select
              value={props.transmissionMode}
              onChange={(e) => {
                const newMode = e.target.value;
                const currentDef = TRANSMISSION_MODE_REGISTRY.find(
                  (m) => m.name === props.transmissionMode
                );
                // Compare ALL transmission properties (incl. MLLPv2 fields) to the
                // mode defaults, mirroring Java MLLPModeProperties.equals.
                const nonDefault = currentDef
                  ? isTransmissionModeNonDefault(props, currentDef)
                  : false;
                if (nonDefault) {
                  setPendingTransmissionMode(newMode);
                } else {
                  const newDef = TRANSMISSION_MODE_REGISTRY.find((m) => m.name === newMode);
                  if (newDef) update(defaultSettingsForMode(newDef));
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
                <option value={props.transmissionMode} disabled>
                  {props.transmissionMode} (unavailable)
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
            transmissionMode={props.transmissionMode}
            startOfMessageBytes={props.startOfMessageBytes}
            endOfMessageBytes={props.endOfMessageBytes}
          />
        </FieldRow>

        {/* Local listener address */}
        <FieldRow label="Local Address:">
          <HoverTooltip content="The DNS domain name or IP address on which the listener should bind.">
            <input
              type="text"
              value={props.host}
              onChange={(e) => update({ host: e.target.value })}
              className={`${inputCls(viewDensity)} w-48 ${invalid.has("host") ? inputErrorCls : ""}`}
              placeholder="0.0.0.0"
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Local Port:">
          <HoverTooltip content="The port on which the listener should accept connections.">
            <VariableOrNumberInput
              min={1}
              max={65535}
              value={props.port}
              onChange={(port) => update({ port })}
              className={`${inputCls(viewDensity)} w-24 ${invalid.has("port") ? inputErrorCls : ""}`}
            />
          </HoverTooltip>
        </FieldRow>

        {/* Mode selection */}
        <FieldRow label="Mode:">
          <RadioGroup
            name="serverMode"
            value={props.serverMode ? "server" : "client"}
            onChange={(v) => update({ serverMode: v === "server" })}
            options={[
              { label: "Server (Listen)", value: "server" },
              { label: "Client (Connect)", value: "client" },
            ]}
            title="Select Server to listen for connections from clients, or Client to connect to a TCP Server. In Client mode, the listener settings will only be used if Override Local Binding is enabled."
          />
        </FieldRow>

        {/* Server-mode-only: max connections */}
        {!isClientMode && (
          <FieldRow label="Max Connections:">
            <HoverTooltip content="The maximum number of client connections to accept. After this number has been reached, subsequent socket requests will result in a rejection.">
              <NumberInput
                value={props.maxConnections}
                onChange={(maxConnections) => update({ maxConnections })}
                className={`${inputCls(viewDensity)} w-24 ${invalid.has("maxConnections") ? inputErrorCls : ""}`}
              />
            </HoverTooltip>
          </FieldRow>
        )}

        {/* Client-mode-only fields */}
        {isClientMode && (
          <>
            <FieldRow label="Remote Address:">
              <HoverTooltip content="The DNS domain name or IP address on which to connect.">
                <input
                  type="text"
                  value={props.remoteAddress}
                  onChange={(e) => update({ remoteAddress: e.target.value })}
                  className={`${inputCls(viewDensity)} w-48 ${invalid.has("remoteAddress") ? inputErrorCls : ""}`}
                  placeholder="hostname or IP"
                />
              </HoverTooltip>
            </FieldRow>

            <FieldRow label="Remote Port:">
              <HoverTooltip content="The port on which to connect.">
                <VariableOrNumberInput
                  min={1}
                  max={65535}
                  value={props.remotePort}
                  onChange={(remotePort) => update({ remotePort })}
                  className={`${inputCls(viewDensity)} w-24 ${invalid.has("remotePort") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
            </FieldRow>

            <FieldRow label="Reconnect Interval (ms):">
              <HoverTooltip content="If Client mode is selected, enter the time (in milliseconds) to wait between disconnecting from the TCP server and connecting to it again.">
                <NumberInput
                  value={props.reconnectInterval}
                  onChange={(reconnectInterval) => update({ reconnectInterval })}
                  className={`${inputCls(viewDensity)} w-32 ${invalid.has("reconnectInterval") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
            </FieldRow>

            <FieldRow label="Override Local Binding:">
              <RadioGroup
                name="overrideLocalBinding"
                value={props.overrideLocalBinding ? "yes" : "no"}
                onChange={(v) => update({ overrideLocalBinding: v === "yes" })}
                options={[
                  { label: "Yes", value: "yes" },
                  { label: "No", value: "no" },
                ]}
                title="Select Yes to override the local address and port that the client socket will be bound to. Select No to use the default values of 0.0.0.0:0. A local port of zero (0) indicates that the OS should assign an ephemeral port automatically. Note that if a specific (non-zero) local port is chosen, then after a socket is closed it's up to the underlying OS to release the port before the next socket creation, otherwise the bind attempt will fail."
              />
            </FieldRow>
          </>
        )}
      </SettingsSection>

      {/* ── Connection settings ────────────────────────────────────────────── */}

      <SettingsSection
        title="Connection Settings"
        icon={Network}
        defaultExpanded={true}
        storageKey="bl-tcp-listener-conn"
      >
        <FieldRow label="Receive Timeout (ms):">
          <HoverTooltip content="The amount of time, in milliseconds, to wait without receiving a message before closing a connection.">
            <NumberInput
              value={props.receiveTimeout}
              onChange={(receiveTimeout) => update({ receiveTimeout })}
              className={`${inputCls(viewDensity)} w-32 ${invalid.has("receiveTimeout") ? inputErrorCls : ""}`}
            />
          </HoverTooltip>
          <span className="text-xs text-gray-500 dark:text-gray-400">(0 = no timeout)</span>
        </FieldRow>

        <FieldRow label="Buffer Size (bytes):">
          <HoverTooltip content="Use larger values for larger messages, and smaller values for smaller messages. Generally, the default value is fine.">
            <NumberInput
              value={props.bufferSize}
              onChange={(bufferSize) => update({ bufferSize })}
              className={`${inputCls(viewDensity)} w-32 ${invalid.has("bufferSize") ? inputErrorCls : ""}`}
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Keep Connection Open:">
          <RadioGroup
            name="keepConnectionOpen"
            value={props.keepConnectionOpen ? "yes" : "no"}
            onChange={(v) => update({ keepConnectionOpen: v === "yes" })}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Select No to close the listening socket after a received message has finished processing. Otherwise the socket will remain open until the sending system closes it. In that case, messages will only be processed if data is received and either the receive timeout is reached, the client closes the socket, or an end of message byte sequence has been detected."
          />
        </FieldRow>

        <FieldRow label="Data Type:">
          <RadioGroup
            name="dataType"
            value={props.dataTypeBinary ? "binary" : "text"}
            // Selecting Binary resets the charset to Default (mirrors Java, which sets the disabled
            // charset combo back to index 0 / DEFAULT_ENCODING on binary-select).
            onChange={(v) =>
              update(
                v === "binary"
                  ? { dataTypeBinary: true, charsetEncoding: "DEFAULT_ENCODING" }
                  : { dataTypeBinary: false }
              )
            }
            options={[
              { label: "Text", value: "text" },
              { label: "Binary", value: "binary" },
            ]}
            title="Select Binary if the inbound messages are raw byte streams; the payload will be Base64 encoded. Select Text if the inbound messages are text streams; the payload will be encoded with the specified character set encoding."
          />
        </FieldRow>

        {!props.dataTypeBinary && (
          <FieldRow label="Encoding:">
            <HoverTooltip content="Select the character set encoding used by the message sender, or Select Default to use the default character set encoding for the JVM running BridgeLink.">
              <select
                value={props.charsetEncoding}
                onChange={(e) => update({ charsetEncoding: e.target.value })}
                className={`${selectCls(viewDensity)} w-44`}
              >
                {buildCharsetOptions(serverCharsets, props.charsetEncoding).map(
                  ({ label, value }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  )
                )}
              </select>
            </HoverTooltip>
          </FieldRow>
        )}
      </SettingsSection>

      {/* ── Response settings ──────────────────────────────────────────────── */}

      <SettingsSection
        title="Response Settings"
        icon={Reply}
        defaultExpanded={true}
        storageKey="bl-tcp-listener-response"
        summary={
          <SummaryChip
            label="respond on new conn"
            value={
              props.respondOnNewConnection === TCP_RESPOND_NEW_CONNECTION
                ? "Yes"
                : props.respondOnNewConnection === TCP_RESPOND_ON_RECOVERY
                  ? "Message Recovery"
                  : "No"
            }
          />
        }
      >
        <FieldRow label="Respond on New Connection:">
          <RadioGroup
            name="respondOnNewConnection"
            value={String(props.respondOnNewConnection)}
            onChange={(v) => update({ respondOnNewConnection: parseInt(v, 10) })}
            options={[
              { label: "No", value: String(TCP_RESPOND_SAME_CONNECTION) },
              { label: "Yes", value: String(TCP_RESPOND_NEW_CONNECTION) },
              { label: "Message Recovery", value: String(TCP_RESPOND_ON_RECOVERY) },
            ]}
            title="Select No to send responses only via the same connection the inbound message was received on. Select Yes to always send responses on a new connection (during normal processing as well as recovery). Select Message Recovery to only send responses on a new connection during message recovery. Connections will be bound locally on the same interface chosen in the Listener Settings with an ephemeral port."
          />
        </FieldRow>

        {showResponseAddr && (
          <>
            <FieldRow label="Response Address:">
              <HoverTooltip content="Enter the DNS domain name or IP address to send message responses to.">
                <input
                  type="text"
                  value={props.responseAddress}
                  onChange={(e) => update({ responseAddress: e.target.value })}
                  className={`${inputCls(viewDensity)} w-48 ${invalid.has("responseAddress") ? inputErrorCls : ""}`}
                  placeholder="hostname or IP"
                />
              </HoverTooltip>
            </FieldRow>

            <FieldRow label="Response Port:">
              <HoverTooltip content="Enter the port to send message responses to.">
                <VariableOrNumberInput
                  min={1}
                  max={65535}
                  value={props.responsePort}
                  onChange={(responsePort) => update({ responsePort })}
                  className={`${inputCls(viewDensity)} w-24 ${invalid.has("responsePort") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
            </FieldRow>
          </>
        )}
      </SettingsSection>

      <TransmissionModeSettingsDialog
        open={tmDialogOpen}
        onOpenChange={setTmDialogOpen}
        settings={{
          transmissionMode: props.transmissionMode,
          startOfMessageBytes: props.startOfMessageBytes,
          endOfMessageBytes: props.endOfMessageBytes,
          useMLLPv2: props.useMLLPv2,
          ackBytes: props.ackBytes,
          nackBytes: props.nackBytes,
          maxRetries: props.maxRetries,
        }}
        onSave={(updated) => update(updated)}
      />
    </>
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────
//
// TCP Listener is a persistent server listener (no polling), so there is no
// TopSection. The SSL Settings sections are rendered automatically by the
// SslSettingsPlugin in PLUGIN_REGISTRY when the SSL plugin XML is detected.

export const TcpListenerConnector: ConnectorDefinition = {
  BottomSection: TcpListenerBottomSection,
  defaultPropertiesXml: DEFAULT_TCP_LISTENER_PROPERTIES_XML,
  validate(propertiesXml) {
    if (!propertiesXml) return [];
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const txt = (tag: string) => doc.querySelector(tag)?.textContent?.trim() ?? "";
    const errors: import("./shared/validate-utils").ValidationError[] = [];

    const isClientMode = txt("serverMode") !== "true";
    if (isClientMode) {
      if (!txt("remoteAddress"))
        errors.push({ field: "remoteAddress", message: "Remote Address is required." });
      if (!txt("remotePort"))
        errors.push({ field: "remotePort", message: "Remote Port is required." });
      const reconnectInterval = txt("reconnectInterval");
      if (!reconnectInterval || !isNonNegativeInteger(reconnectInterval))
        errors.push({
          field: "reconnectInterval",
          message: "Reconnect Interval is required.",
        });
    }

    const receiveTimeout = txt("receiveTimeout");
    if (!receiveTimeout || !isNonNegativeInteger(receiveTimeout))
      errors.push({ field: "receiveTimeout", message: "Receive Timeout is required." });

    const bufferSize = txt("bufferSize");
    if (!bufferSize || !isNonNegativeInteger(bufferSize))
      errors.push({ field: "bufferSize", message: "Buffer Size is required." });

    // Max Connections is a server-mode concept (the listening thread pool). In client mode the field
    // is hidden and unused, so only validate it in server mode — mirrors the Java TcpSender gate and
    // avoids a save error that points at an invisible field.
    if (!isClientMode) {
      const maxConnectionsRaw = txt("maxConnections");
      if (
        !maxConnectionsRaw ||
        !isNonNegativeInteger(maxConnectionsRaw) ||
        Number(maxConnectionsRaw) <= 0
      )
        errors.push({
          field: "maxConnections",
          message: "Max Connections must be greater than 0.",
        });
    }

    // respondOnNewConnection: 0 = same connection, 1 = new connection, 2 = on recovery
    const respondOnNewConnection = Number(txt("respondOnNewConnection"));
    if (respondOnNewConnection !== 0) {
      if (txt("responseAddress").length <= 3)
        errors.push({ field: "responseAddress", message: "Response Address is required." });
      if (!txt("responsePort"))
        errors.push({ field: "responsePort", message: "Response Port is required." });
    }

    // Transmission-mode byte validation. Save-time is hex-only with blanks allowed for every mode
    // (mirrors the Java connector save path — FrameTransmissionModeClientProvider.checkProperties,
    // which MLLPModeClientProvider inherits without override). The strict non-blank / MLLPv2 rules
    // gate only the transmission-mode dialog, so a channel with blank MLLP frame bytes stays saveable.
    const tmProps = parseTcpListenerPropsFromXml(propertiesXml);
    errors.push(...validateTransmissionModeForSave(tmProps));

    return errors;
  },
};
