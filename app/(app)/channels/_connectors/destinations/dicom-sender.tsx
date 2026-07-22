"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import { SettingsSection, FieldRow, FullWidthField } from "@/components/settings/settings-section";
import type { DestinationConnectorDefinition, DestinationConnectorSectionProps } from "./types";
import {
  DEFAULT_DEST_PROPERTIES_XML,
  parseDicomSenderPropsFromXml,
  updateDicomSenderPropsInXml,
  type DicomSenderProps,
} from "../../_lib/channel-xml";
import { RadioGroup } from "../shared/radio-group";
import { inputCls, inputErrorCls, fieldErrorMsgCls } from "../shared/styles";
import { SecretInput } from "@/components/ui/secret-input";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_XML = DEFAULT_DEST_PROPERTIES_XML["DICOM Sender"]!;

// String-typed timing/buffer fields rendered by the shared numeric input.
// Narrowing to these keys lets `numInput` bind `value`/`onChange` without casts.
type DicomNumericKey =
  | "acceptTo"
  | "async"
  | "bufSize"
  | "connectTo"
  | "rcvpdulen"
  | "reaper"
  | "releaseTo"
  | "rspTo"
  | "shutdownDelay"
  | "sndpdulen"
  | "soCloseDelay"
  | "sorcvbuf"
  | "sosndbuf";

// ─── Bottom section ───────────────────────────────────────────────────────────

function DicomSenderBottomSection({
  propertiesXml,
  onChange,
  invalidFields,
}: DestinationConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const invalid = invalidFields ?? new Set<string>();
  const propsXml = propertiesXml ?? DEFAULT_XML;
  const [local, setLocal] = useState<DicomSenderProps>(() =>
    parseDicomSenderPropsFromXml(propsXml)
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(parseDicomSenderPropsFromXml(propertiesXml ?? DEFAULT_XML));
  }, [propertiesXml]);

  function commit(updated: DicomSenderProps) {
    setLocal(updated);
    onChange({ propertiesXml: updateDicomSenderPropsInXml(propsXml, updated) });
  }

  function set<K extends keyof DicomSenderProps>(key: K, val: DicomSenderProps[K]) {
    commit({ ...local, [key]: val });
  }

  // Numeric fields are stored as strings and written verbatim (matching the
  // Java text fields and the DICOM Listener) — no parse/coercion, so leading
  // zeros and templated values (e.g. ${timeout}) are preserved and an
  // intentionally blank field is not snapped back to a minimum.
  function numInput(key: DicomNumericKey) {
    return (
      <input
        type="text"
        inputMode="numeric"
        value={local[key]}
        onChange={(e) => set(key, e.target.value)}
        className={`${inputCls(viewDensity)} w-28`}
      />
    );
  }

  const tlsEnabled = local.tls !== "notls";

  return (
    <SettingsSection
      title="DICOM Sender Settings"
      icon={Activity}
      defaultExpanded={true}
      storageKey="bl-dicom-sender-main"
    >
      {/* Network */}
      <FieldRow label="Remote Host:">
        <div className="flex-1 min-w-0">
          <HoverTooltip content="Remote IP to send to.">
            <input
              type="text"
              value={local.host}
              onChange={(e) => set("host", e.target.value)}
              className={`${inputCls(viewDensity)} w-full ${invalid.has("host") ? inputErrorCls : ""}`}
            />
          </HoverTooltip>
          {invalid.has("host") && <p className={fieldErrorMsgCls}>Remote Address is required.</p>}
        </div>
      </FieldRow>
      <FieldRow label="Remote Port:">
        <div>
          <HoverTooltip content="Remote PORT to send to.">
            <input
              type="text"
              value={local.port}
              onChange={(e) => set("port", e.target.value)}
              className={`${inputCls(viewDensity)} w-28 ${invalid.has("port") ? inputErrorCls : ""}`}
            />
          </HoverTooltip>
          {invalid.has("port") && <p className={fieldErrorMsgCls}>Remote Port is required.</p>}
        </div>
      </FieldRow>
      <FieldRow label="Remote Application Entity:">
        <HoverTooltip content="Remote Application Entity">
          <input
            type="text"
            value={local.applicationEntity}
            onChange={(e) => set("applicationEntity", e.target.value)}
            className={`${inputCls(viewDensity)} w-56`}
          />
        </HoverTooltip>
      </FieldRow>
      <FieldRow label="Local Host:">
        <HoverTooltip content="Local address that the client socket will be bound to.">
          <input
            type="text"
            value={local.localHost}
            onChange={(e) => set("localHost", e.target.value)}
            className={`${inputCls(viewDensity)} flex-1`}
          />
        </HoverTooltip>
      </FieldRow>
      <FieldRow label="Local Port:">
        <HoverTooltip content="Local port that the client socket will be bound to.">
          <input
            type="text"
            value={local.localPort}
            onChange={(e) => set("localPort", e.target.value)}
            className={`${inputCls(viewDensity)} w-28`}
          />
        </HoverTooltip>
      </FieldRow>
      <FieldRow label="Local Application Entity:">
        <HoverTooltip content="Local Application Entity">
          <input
            type="text"
            value={local.localApplicationEntity}
            onChange={(e) => set("localApplicationEntity", e.target.value)}
            className={`${inputCls(viewDensity)} w-56`}
          />
        </HoverTooltip>
      </FieldRow>

      {/* DICOM Operation */}
      <FieldRow label="Priority:">
        <RadioGroup
          name="dicom-priority"
          value={local.priority}
          onChange={(v) => set("priority", v)}
          options={[
            { label: "High", value: "high" },
            { label: "Medium", value: "med" },
            { label: "Low", value: "low" },
          ]}
          title="Priority of the C-STORE operation, MEDIUM by default."
        />
      </FieldRow>
      <FieldRow label="Request Storage Commitment:">
        <RadioGroup
          name="dicom-stgcmt"
          value={local.stgcmt ? "yes" : "no"}
          onChange={(v) => set("stgcmt", v === "yes")}
          options={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          title="Request storage commitment of (successfully) sent objects afterwards."
        />
      </FieldRow>
      <FieldRow label="Max Async operations:">
        <HoverTooltip content="Maximum number of outstanding operations it may invoke asynchronously, unlimited by default.">
          {numInput("async")}
        </HoverTooltip>
      </FieldRow>

      {/* Authentication */}
      <FieldRow label="User Name:">
        <HoverTooltip content="Enable User Identity Negotiation with specified username and optional passcode.">
          <input
            type="text"
            autoComplete="off"
            value={local.username}
            onChange={(e) => set("username", e.target.value)}
            className={`${inputCls(viewDensity)} w-56`}
          />
        </HoverTooltip>
      </FieldRow>
      <FieldRow label="Pass Code:">
        <HoverTooltip content="Optional passcode for User Identity Negotiation, only effective with option -username.">
          <SecretInput
            value={local.passcode}
            onChange={(e) => set("passcode", e.target.value)}
            density={viewDensity}
            className={`${inputCls(viewDensity)} w-56`}
          />
        </HoverTooltip>
      </FieldRow>

      <FieldRow label="Request Positive User Identity Response:">
        <RadioGroup
          name="dicom-uidnegrsp"
          value={local.uidnegrsp ? "yes" : "no"}
          onChange={(v) => set("uidnegrsp", v === "yes")}
          options={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          title="Request positive User Identity Negotiation response, only effective with option -username."
        />
      </FieldRow>

      {/* Advanced flags */}
      <FieldRow label="Pack PDV:">
        <RadioGroup
          name="dicom-pdv1"
          value={local.pdv1 ? "yes" : "no"}
          onChange={(v) => set("pdv1", v === "yes")}
          options={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          title="Send only one PDV in one P-Data-TF PDU, pack command and data PDV in one P-DATA-TF PDU by default."
        />
      </FieldRow>
      <FieldRow label="TCP Delay:">
        <RadioGroup
          name="dicom-tcpDelay"
          value={local.tcpDelay ? "yes" : "no"}
          onChange={(v) => set("tcpDelay", v === "yes")}
          options={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          title="Set TCP_NODELAY socket option to false, true by default."
        />
      </FieldRow>
      <FieldRow label="Default Presentation Syntax:">
        <RadioGroup
          name="dicom-ts1"
          value={local.ts1 ? "yes" : "no"}
          onChange={(v) => set("ts1", v === "yes")}
          options={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          title="Offer Default Transfer Syntax in separate Presentation Context. By default offered with Explicit VR Little Endian TS in one PC."
        />
      </FieldRow>

      {/* Timeouts & Buffers */}
      <FieldRow label="TCP Connection Timeout (ms):">
        <HoverTooltip content="Timeout in ms for TCP connect, no timeout by default.">
          {numInput("connectTo")}
        </HoverTooltip>
      </FieldRow>
      <FieldRow label="Timeout A-ASSOCIATE-AC (ms):">
        <HoverTooltip content="Timeout in ms for receiving A-ASSOCIATE-AC, 5000ms by default.">
          {numInput("acceptTo")}
        </HoverTooltip>
      </FieldRow>
      <FieldRow label="A-RELEASE-RP timeout (s):">
        <HoverTooltip content="Timeout in ms for receiving A-RELEASE-RP, 5s by default.">
          {numInput("releaseTo")}
        </HoverTooltip>
      </FieldRow>
      <FieldRow label="DIMSE-RSP timeout (s):">
        <HoverTooltip content="Timeout in ms for receiving DIMSE-RSP, 60s by default.">
          {numInput("rspTo")}
        </HoverTooltip>
      </FieldRow>
      <FieldRow label="DIMSE-RSP interval period (s):">
        <HoverTooltip content="Period in ms to check for outstanding DIMSE-RSP, 10s by default.">
          {numInput("reaper")}
        </HoverTooltip>
      </FieldRow>
      <FieldRow label="Shutdown delay (ms):">
        <HoverTooltip content="Delay in ms for closing the listening socket, 1000ms by default.">
          {numInput("shutdownDelay")}
        </HoverTooltip>
      </FieldRow>
      <FieldRow label="Socket Close Delay After A-ABORT (ms):">
        <HoverTooltip content="Delay in ms for Socket close after sending A-ABORT, 50ms by default.">
          {numInput("soCloseDelay")}
        </HoverTooltip>
      </FieldRow>
      <FieldRow label="P-DATA-TF PDUs max length sent (KB):">
        <HoverTooltip content="Maximal length in KB of sent P-DATA-TF PDUs, 16KB by default.">
          {numInput("sndpdulen")}
        </HoverTooltip>
      </FieldRow>
      <FieldRow label="P-DATA-TF PDUs  max length received (KB):">
        <HoverTooltip content="Maximal length in KB of received P-DATA-TF PDUs, 16KB by default.">
          {numInput("rcvpdulen")}
        </HoverTooltip>
      </FieldRow>
      <FieldRow label="Send Socket Buffer Size (KB):">
        <HoverTooltip content="Set send socket buffer to specified value in KB.">
          {numInput("sosndbuf")}
        </HoverTooltip>
      </FieldRow>
      <FieldRow label="Receive Socket Buffer Size (KB):">
        <HoverTooltip content="Set receive socket buffer to specified value in KB.">
          {numInput("sorcvbuf")}
        </HoverTooltip>
      </FieldRow>
      <FieldRow label="Transcoder Buffer Size (KB):">
        <HoverTooltip content="Transcoder buffer size in KB, 1KB by default.">
          {numInput("bufSize")}
        </HoverTooltip>
      </FieldRow>

      {/* TLS */}
      <FieldRow label="TLS:">
        <RadioGroup
          name="dicom-tls"
          value={local.tls}
          onChange={(v) => set("tls", v)}
          options={[
            { label: "3DES", value: "3des" },
            { label: "AES", value: "aes" },
            { label: "Without", value: "without" },
            { label: "No TLS", value: "notls" },
          ]}
          title="Enable TLS connection without, 3DES or AES encryption."
        />
      </FieldRow>
      {tlsEnabled && (
        <>
          <FieldRow label="Client Authentication TLS:">
            <RadioGroup
              name="dicom-noClientAuth"
              value={local.noClientAuth ? "yes" : "no"}
              onChange={(v) => set("noClientAuth", v === "yes")}
              options={[
                { label: "Yes", value: "yes" },
                { label: "No", value: "no" },
              ]}
              title="Enable client authentication for TLS."
            />
          </FieldRow>
          <FieldRow label="Accept ssl v2 TLS handshake:">
            <RadioGroup
              name="dicom-nossl2"
              value={local.nossl2 ? "yes" : "no"}
              onChange={(v) => set("nossl2", v === "yes")}
              options={[
                { label: "Yes", value: "yes" },
                { label: "No", value: "no" },
              ]}
              title="Enable acceptance of SSLv2Hello TLS handshake."
            />
          </FieldRow>
          <FieldRow label="Keystore:">
            <HoverTooltip content="File path or URL of P12 or JKS keystore, resource:tls/test_sys_2.p12 by default.">
              <input
                type="text"
                autoComplete="off"
                value={local.keyStore}
                onChange={(e) => set("keyStore", e.target.value)}
                className={`${inputCls(viewDensity)} flex-1`}
              />
            </HoverTooltip>
          </FieldRow>
          <FieldRow label="Keystore Password:">
            <HoverTooltip content="Password for keystore file.">
              <SecretInput
                value={local.keyStorePW}
                onChange={(e) => set("keyStorePW", e.target.value)}
                className={`${inputCls(viewDensity)} w-56`}
              />
            </HoverTooltip>
          </FieldRow>
          <FieldRow label="Key Password:">
            <HoverTooltip content="Password for accessing the key in the keystore, keystore password by default.">
              <SecretInput
                value={local.keyPW}
                onChange={(e) => set("keyPW", e.target.value)}
                className={`${inputCls(viewDensity)} w-56`}
              />
            </HoverTooltip>
          </FieldRow>
          <FieldRow label="Trust Store:">
            <HoverTooltip content="File path or URL of JKS truststore, resource:tls/mesa_certs.jks by default.">
              <input
                type="text"
                autoComplete="off"
                value={local.trustStore}
                onChange={(e) => set("trustStore", e.target.value)}
                className={`${inputCls(viewDensity)} flex-1`}
              />
            </HoverTooltip>
          </FieldRow>
          <FieldRow label="Trust Store Password:">
            <HoverTooltip content="Password for truststore file.">
              <SecretInput
                value={local.trustStorePW}
                onChange={(e) => set("trustStorePW", e.target.value)}
                className={`${inputCls(viewDensity)} w-56`}
              />
            </HoverTooltip>
          </FieldRow>
        </>
      )}

      {/* Template */}
      <FullWidthField label="Template:">
        <HoverTooltip content="The DICOM message content to be sent.">
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
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────

export const DICOMSenderConnector: DestinationConnectorDefinition = {
  canValidateResponse: false,
  BottomSection: DicomSenderBottomSection,
  defaultPropertiesXml: DEFAULT_XML,
  validate(propertiesXml) {
    if (!propertiesXml) return [];
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const root = doc.documentElement;
    const txt = (tag: string) => root.querySelector(`:scope > ${tag}`)?.textContent?.trim() ?? "";
    const errors: import("../shared/validate-utils").ValidationError[] = [];
    if (txt("host").length <= 3)
      errors.push({ field: "host", message: "Remote Address is required." });
    if (!txt("port")) errors.push({ field: "port", message: "Remote Port is required." });
    if (!txt("template")) errors.push({ field: "template", message: "Template is required." });
    return errors;
  },
};
