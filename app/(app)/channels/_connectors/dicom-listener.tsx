"use client";

import { Activity, Settings, Lock } from "lucide-react";
import { SettingsSection, FieldRow, SummaryChip } from "@/components/settings/settings-section";
import type { ConnectorDefinition, ConnectorSectionProps } from "./types";
import { HoverTooltip } from "@/components/hover-tooltip";
import { RadioGroup } from "./shared/radio-group";
import { inputCls, inputErrorCls } from "./shared/styles";
import { SecretInput } from "@/components/ui/secret-input";
import {
  DEFAULT_DICOM_LISTENER_PROPERTIES_XML,
  parseDICOMListenerPropsFromXml,
  updateDICOMListenerPropsInXml,
  type DICOMListenerProps,
  resolveXmlVersion,
  withVersion,
} from "../_lib/channel-xml";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";

// ─── TLS options ──────────────────────────────────────────────────────────────
//
// These match the tls field values accepted by the dcm4che DICOM library.

// Radio options mirror the DICOM Sender panel exactly (which matches the Java
// DICOMListener/DICOMSender radios). Stored values are unchanged from the server model.
const TLS_OPTIONS = [
  { label: "3DES", value: "3des" },
  { label: "AES", value: "aes" },
  { label: "Without", value: "without" },
  { label: "No TLS", value: "notls" },
];

// ─── Bottom section: DICOM Listener Settings ──────────────────────────────────

function DICOMListenerBottomSection({
  propertiesXml,
  onChange,
  invalidFields,
}: ConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const invalid = invalidFields ?? new Set<string>();
  const propsXml =
    propertiesXml ?? withVersion(DEFAULT_DICOM_LISTENER_PROPERTIES_XML, resolveXmlVersion());
  const props = parseDICOMListenerPropsFromXml(propertiesXml);

  function update(patch: Partial<DICOMListenerProps>) {
    onChange({ propertiesXml: updateDICOMListenerPropsInXml(propsXml, { ...props, ...patch }) });
  }

  const tlsEnabled = props.tls !== "notls";

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Main connection settings ─────────────────────────────────────────── */}

      <SettingsSection
        labelWidth="w-[320px]"
        title="DICOM Listener Settings"
        icon={Activity}
        defaultExpanded={true}
        storageKey="bl-dicom-listener-main"
      >
        <FieldRow label="Local Address:">
          <input
            type="text"
            value={props.host}
            onChange={(e) => update({ host: e.target.value })}
            className={`${inputCls(viewDensity)} w-52 ${invalid.has("host") ? inputErrorCls : ""}`}
            placeholder="0.0.0.0"
          />
        </FieldRow>

        <FieldRow label="Local Port:">
          <input
            type="text"
            inputMode="numeric"
            min={1}
            max={65535}
            value={props.port}
            onChange={(e) => update({ port: e.target.value })}
            className={`${inputCls(viewDensity)} w-28 ${invalid.has("port") ? inputErrorCls : ""}`}
          />
        </FieldRow>

        <FieldRow label="Application Entity:">
          <HoverTooltip content="If specified, only requests with a matching called AE title will be accepted">
            <input
              type="text"
              value={props.applicationEntity}
              onChange={(e) => update({ applicationEntity: e.target.value })}
              className={`${inputCls(viewDensity)} w-52`}
              placeholder="AE title"
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Store Recieved Objects in Directory:">
          <HoverTooltip content="Store received objects into files in specified directory <dir>. Do not store received objects by default.">
            <input
              type="text"
              value={props.dest}
              onChange={(e) => update({ dest: e.target.value })}
              className={`${inputCls(viewDensity)} w-80`}
              placeholder="(keep in memory)"
            />
          </HoverTooltip>
        </FieldRow>
      </SettingsSection>

      {/* ── Advanced: timing, PDU, data format, network ──────────────────────── */}

      <SettingsSection
        title="Advanced Settings"
        icon={Settings}
        defaultExpanded={false}
        storageKey="bl-dicom-listener-advanced"
      >
        {/* Timing */}

        <FieldRow label="Socket Close Delay After A-ABORT (ms):">
          <HoverTooltip content="Delay in ms for Socket close after sending A-ABORT, 50ms by default.">
            <input
              type="text"
              inputMode="numeric"
              min={0}
              value={props.soCloseDelay}
              onChange={(e) => update({ soCloseDelay: e.target.value })}
              className={`${inputCls(viewDensity)} w-28`}
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="A-RELEASE-RP timeout (s):">
          <HoverTooltip content="Timeout in ms for receiving A-RELEASE-RP, 5s by default.">
            <input
              type="text"
              inputMode="numeric"
              min={0}
              value={props.releaseTo}
              onChange={(e) => update({ releaseTo: e.target.value })}
              className={`${inputCls(viewDensity)} w-28`}
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="ASSOCIATE-RQ timeout (ms):">
          <HoverTooltip content="Timeout in ms for receiving -ASSOCIATE-RQ, 5s by default.">
            <input
              type="text"
              inputMode="numeric"
              min={0}
              value={props.requestTo}
              onChange={(e) => update({ requestTo: e.target.value })}
              className={`${inputCls(viewDensity)} w-28`}
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="DIMSE-RQ timeout (ms):">
          <HoverTooltip content="Timeout in ms for receiving DIMSE-RQ, 60s by default.">
            <input
              type="text"
              inputMode="numeric"
              min={0}
              value={props.idleTo}
              onChange={(e) => update({ idleTo: e.target.value })}
              className={`${inputCls(viewDensity)} w-28`}
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="DIMSE-RSP interval period (s):">
          <HoverTooltip content="Period in ms to check for outstanding DIMSE-RSP, 10s by default">
            <input
              type="text"
              inputMode="numeric"
              min={0}
              value={props.reaper}
              onChange={(e) => update({ reaper: e.target.value })}
              className={`${inputCls(viewDensity)} w-28`}
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="DIMSE-RSP delay (ms):">
          <HoverTooltip content="Delay in ms for DIMSE-RSP; useful for testing asynchronous mode.">
            <input
              type="text"
              inputMode="numeric"
              min={0}
              value={props.rspDelay}
              onChange={(e) => update({ rspDelay: e.target.value })}
              className={`${inputCls(viewDensity)} w-28`}
            />
          </HoverTooltip>
        </FieldRow>

        {/* PDU / Transfer */}

        <FieldRow label="Pack PDV:">
          <RadioGroup
            name="pdv1"
            value={props.pdv1 ? "yes" : "no"}
            onChange={(v) => update({ pdv1: v === "yes" })}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Send only one PDV in one P-Data-TF PDU, pack command and data PDV in one P-DATA-TF PDU by default."
          />
        </FieldRow>

        <FieldRow label="P-DATA-TF PDUs max length sent (KB):">
          <HoverTooltip content="Maximal length in KB of sent P-DATA-TF PDUs, 16KB by default.">
            <input
              type="text"
              inputMode="numeric"
              min={1}
              value={props.sndpdulen}
              onChange={(e) => update({ sndpdulen: e.target.value })}
              className={`${inputCls(viewDensity)} w-28`}
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="P-DATA-TF PDUs max length received (KB):">
          <HoverTooltip content="Maximal length in KB of received P-DATA-TF PDUs, 16KB by default.">
            <input
              type="text"
              inputMode="numeric"
              min={1}
              value={props.rcvpdulen}
              onChange={(e) => update({ rcvpdulen: e.target.value })}
              className={`${inputCls(viewDensity)} w-28`}
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Max Async operations:">
          <HoverTooltip content="Maximum number of outstanding operations performed asynchronously, unlimited by default.">
            <input
              type="text"
              inputMode="numeric"
              min={0}
              max={100}
              value={props.async}
              onChange={(e) => update({ async: e.target.value })}
              className={`${inputCls(viewDensity)} w-24`}
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Transcoder Buffer Size (KB):">
          <HoverTooltip content="Minimal buffer size to write received object to file, 1KB by default.">
            <input
              type="text"
              inputMode="numeric"
              min={1}
              value={props.bufSize}
              onChange={(e) => update({ bufSize: e.target.value })}
              className={`${inputCls(viewDensity)} w-24`}
            />
          </HoverTooltip>
        </FieldRow>

        {/* Data format
            Mutual-exclusion rules (mirrors Java DICOMListener cascading disable):
            - bigEndian=Yes  → force defts=false, disable defts row
            - defts=Yes      → force bigEndian=false + nativeData=false, disable both rows
            - nativeData=Yes → force defts=false, disable defts row
        */}

        <FieldRow label="Accept Explict VR Big Endian:">
          <RadioGroup
            name="bigEndian"
            value={props.bigEndian ? "yes" : "no"}
            disabled={props.defts}
            onChange={(v) => {
              const bigEndian = v === "yes";
              update({ bigEndian, ...(bigEndian ? { defts: false } : {}) });
            }}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Accept also Explict VR Big Endian transfer syntax."
          />
        </FieldRow>

        <FieldRow label="Only Accept Default Transfer Syntax:">
          <RadioGroup
            name="defts"
            value={props.defts ? "yes" : "no"}
            disabled={props.bigEndian || props.nativeData}
            onChange={(v) => {
              const defts = v === "yes";
              update({ defts, ...(defts ? { bigEndian: false, nativeData: false } : {}) });
            }}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Accept only default transfer syntax."
          />
        </FieldRow>

        <FieldRow label="Only Uncompressed Pixel Data:">
          <RadioGroup
            name="nativeData"
            value={props.nativeData ? "yes" : "no"}
            disabled={props.defts}
            onChange={(v) => {
              const nativeData = v === "yes";
              update({ nativeData, ...(nativeData ? { defts: false } : {}) });
            }}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Accept only transfer syntax with uncompressed pixel data."
          />
        </FieldRow>

        {/* Network */}

        <FieldRow label="TCP Delay:">
          <RadioGroup
            name="tcpDelay"
            value={props.tcpDelay ? "yes" : "no"}
            onChange={(v) => update({ tcpDelay: v === "yes" })}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Set TCP_NODELAY socket option to false, true by default."
          />
        </FieldRow>

        <FieldRow label="Receive Socket Buffer Size (KB):">
          <HoverTooltip content="Set receive socket buffer to specified value in KB">
            <input
              type="text"
              inputMode="numeric"
              min={0}
              value={props.sorcvbuf}
              onChange={(e) => update({ sorcvbuf: e.target.value })}
              className={`${inputCls(viewDensity)} w-28`}
              placeholder="0 = OS default"
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Send Socket Buffer Size (KB):">
          <HoverTooltip content="Set send socket buffer to specified value in KB">
            <input
              type="text"
              inputMode="numeric"
              min={0}
              value={props.sosndbuf}
              onChange={(e) => update({ sosndbuf: e.target.value })}
              className={`${inputCls(viewDensity)} w-28`}
              placeholder="0 = OS default"
            />
          </HoverTooltip>
        </FieldRow>
      </SettingsSection>

      {/* ── TLS settings ─────────────────────────────────────────────────────── */}

      <SettingsSection
        title="TLS Settings"
        icon={Lock}
        defaultExpanded={false}
        storageKey="bl-dicom-listener-tls"
        summary={
          tlsEnabled ? (
            <SummaryChip
              value={TLS_OPTIONS.find((o) => o.value === props.tls)?.label ?? props.tls}
            />
          ) : undefined
        }
      >
        <FieldRow label="TLS:">
          <RadioGroup
            name="dicom-listener-tls"
            value={props.tls}
            onChange={(v) => update({ tls: v })}
            options={TLS_OPTIONS}
            title="Enable TLS connection without, 3DES or AES encryption."
          />
        </FieldRow>

        {/*
          Keystore, truststore and cipher-specific fields are only relevant
          when TLS is enabled. They remain in the XML even when disabled, so
          we simply hide them in the UI rather than clearing their values.
        */}
        {tlsEnabled && (
          <>
            <FieldRow label="Keystore:">
              <HoverTooltip content="File path or URL of P12 or JKS keystore, resource:tls/test_sys_2.p12 by default.">
                <input
                  type="text"
                  autoComplete="off"
                  value={props.keyStore}
                  onChange={(e) => update({ keyStore: e.target.value })}
                  className={`${inputCls(viewDensity)} w-80`}
                  placeholder="/path/to/keystore.jks"
                />
              </HoverTooltip>
            </FieldRow>

            <FieldRow label="Keystore Password:">
              <HoverTooltip content="Password for keystore file.">
                <SecretInput
                  value={props.keyStorePW}
                  onChange={(e) => update({ keyStorePW: e.target.value })}
                  density={viewDensity}
                  className={`${inputCls(viewDensity)} w-52`}
                />
              </HoverTooltip>
            </FieldRow>

            <FieldRow label="Key Password:">
              <HoverTooltip content="Password for accessing the key in the keystore.">
                <SecretInput
                  value={props.keyPW}
                  onChange={(e) => update({ keyPW: e.target.value })}
                  density={viewDensity}
                  className={`${inputCls(viewDensity)} w-52`}
                />
              </HoverTooltip>
            </FieldRow>

            <FieldRow label="Trust Store:">
              <HoverTooltip content="File path or URL of JKS truststore, resource:tls/mesa_certs.jks by default.">
                <input
                  type="text"
                  autoComplete="off"
                  value={props.trustStore}
                  onChange={(e) => update({ trustStore: e.target.value })}
                  className={`${inputCls(viewDensity)} w-80`}
                  placeholder="/path/to/truststore.jks"
                />
              </HoverTooltip>
            </FieldRow>

            <FieldRow label="Trust Store Password:">
              <HoverTooltip content="Password for truststore file.">
                <SecretInput
                  value={props.trustStorePW}
                  onChange={(e) => update({ trustStorePW: e.target.value })}
                  density={viewDensity}
                  className={`${inputCls(viewDensity)} w-52`}
                />
              </HoverTooltip>
            </FieldRow>

            <FieldRow label="Client Authentication TLS:">
              <RadioGroup
                name="noClientAuth"
                value={props.noClientAuth ? "yes" : "no"}
                onChange={(v) => update({ noClientAuth: v === "yes" })}
                options={[
                  { label: "Yes", value: "yes" },
                  { label: "No", value: "no" },
                ]}
                title="Enable client authentication for TLS."
              />
            </FieldRow>

            <FieldRow label="Accept ssl v2 TLS handshake:">
              <RadioGroup
                name="nossl2"
                value={props.nossl2 ? "yes" : "no"}
                onChange={(v) => update({ nossl2: v === "yes" })}
                options={[
                  { label: "Yes", value: "yes" },
                  { label: "No", value: "no" },
                ]}
                title="Enable acceptance of SSLv2Hello TLS handshake."
              />
            </FieldRow>
          </>
        )}
      </SettingsSection>
    </>
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────
//
// DICOM Listener has no polling (it is a persistent server-push listener),
// so there is no TopSection.

export const DICOMListenerConnector: ConnectorDefinition = {
  BottomSection: DICOMListenerBottomSection,
  defaultPropertiesXml: DEFAULT_DICOM_LISTENER_PROPERTIES_XML,
  // DICOMReceiverProperties.canBatch() returns false — DICOM Listener forbids batch processing.
  canBatch: false,
};
