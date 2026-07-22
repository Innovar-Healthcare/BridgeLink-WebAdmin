"use client";

/**
 * Web Service Listener source connector panel.
 *
 * Replicates all fields and business logic from the BridgeLink Admin UI
 * (WebServiceReceiverProperties):
 *   - Local address / port
 *   - Service selection: Default vs Custom class name (always shown; disabled when Default)
 *   - Service name (WSDL service name)
 *   - SOAP binding (Default / SOAP 1.1 / SOAP 1.2)
 *   - WSDL URL (read-only computed — mirrors Java's updateWSDL())
 *   - Method signature (read-only computed)
 */

import { useState } from "react";
import { Globe } from "lucide-react";
import { SettingsSection, FieldRow } from "@/components/settings/settings-section";
import { HoverTooltip } from "@/components/hover-tooltip";
import type { ConnectorDefinition, ConnectorSectionProps } from "./types";
import { RadioGroup } from "./shared/radio-group";
import { inputCls, selectCls, inputErrorCls } from "./shared/styles";
import { VariableOrNumberInput } from "@/components/ui/variable-or-number-input";
import {
  DEFAULT_WS_LISTENER_PROPERTIES_XML,
  parseWebServiceListenerPropsFromXml,
  updateWebServiceListenerPropsInXml,
  type WebServiceListenerProps,
  resolveXmlVersion,
  withVersion,
} from "../_lib/channel-xml";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { resolveServerHost } from "./shared/server-host";
import { useMounted } from "@/lib/hooks/use-mounted";

// ─── Constants ────────────────────────────────────────────────────────────────

// The built-in no-op "accept everything" service class shipped with BridgeLink.
const DEFAULT_CLASS = "com.mirth.connect.connectors.ws.DefaultAcceptMessage";

// SOAP binding options (maps to the Binding enum in WebServiceReceiverProperties).
const SOAP_BINDINGS = [
  { label: "Default", value: "DEFAULT" },
  { label: "SOAP 1.1", value: "SOAP11HTTP" },
  { label: "SOAP 1.2", value: "SOAP12HTTP" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute the WSDL URL preview, mirroring the Java UI's updateWSDL() method:
 *   "http" + (usingHttps ? "s" : "") + "://" + <connected server host> + ":" +
 *   <listener port> + "/services/" + <service name> + "?wsdl"
 * The host is the connected server's host (not the listener's local address),
 * and the scheme is https when the SSL plugin secures the transport.
 */
function computeWsdlUrl(host: string, port: string, serviceName: string, secure: boolean): string {
  const scheme = secure ? "https" : "http";
  return `${scheme}://${host}:${port}/services/${serviceName}?wsdl`;
}

// ─── Bottom section ───────────────────────────────────────────────────────────

function WebServiceListenerBottomSection({
  propertiesXml,
  onChange,
  securesTransport,
  invalidFields,
}: ConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const invalid = invalidFields ?? new Set<string>();
  const mounted = useMounted();
  const propsXml =
    propertiesXml ?? withVersion(DEFAULT_WS_LISTENER_PROPERTIES_XML, resolveXmlVersion());
  const props = parseWebServiceListenerPropsFromXml(propertiesXml);

  function update(patch: Partial<WebServiceListenerProps>) {
    onChange({
      propertiesXml: updateWebServiceListenerPropsInXml(propsXml, { ...props, ...patch }),
    });
  }

  // Business logic: the Default/Custom radio is an explicit mode, not a pure function of the
  // class name. Java keeps DefaultAcceptMessage in the (now editable) field when switching to
  // Custom (WebServiceListener.classNameCustomRadioActionPerformed), so we can't derive the
  // radio from className alone. Seed from className, re-derive only when a new connector loads.
  const [mode, setMode] = useState<"default" | "custom">(
    props.className === DEFAULT_CLASS ? "default" : "custom"
  );
  // Re-derive the mode only when the class name itself changes (a new connector loading, or
  // the class name edited externally) — NOT on every propertiesXml round-trip. Keying on the
  // whole XML would reset Custom→Default the moment any other field is edited while the class
  // name still equals the default, which is exactly the state fix 3f creates.
  const [prevClassName, setPrevClassName] = useState(props.className);
  if (props.className !== prevClassName) {
    setPrevClassName(props.className);
    setMode(props.className === DEFAULT_CLASS ? "default" : "custom");
  }
  const isDefaultService = mode === "default";

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <SettingsSection
      title="Web Service Listener Settings"
      icon={Globe}
      defaultExpanded={true}
      storageKey="bl-ws-listener-main"
    >
      {/* Local listener address */}
      <FieldRow label="Local Address:">
        <HoverTooltip content="The DNS domain name or IP address on which the web service should listen for connections.">
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
        <HoverTooltip content="The port on which the web service should listen for connections.">
          <VariableOrNumberInput
            min={1}
            max={65535}
            value={props.port}
            onChange={(port) => update({ port })}
            className={`${inputCls(viewDensity)} w-24 ${invalid.has("port") ? inputErrorCls : ""}`}
          />
        </HoverTooltip>
      </FieldRow>

      {/* Service selection.
          "Default service" uses DefaultAcceptMessage.
          "Custom service" lets the user specify a fully-qualified class name. */}
      <FieldRow label="Web Service:">
        <RadioGroup
          name="serviceType"
          value={isDefaultService ? "default" : "custom"}
          onChange={(v) => {
            if (v === "default") {
              setMode("default");
              update({ className: DEFAULT_CLASS });
            } else {
              // Java keeps the existing DefaultAcceptMessage as an editable starting value —
              // switch the mode but leave the class name in place for the user to edit.
              setMode("custom");
            }
          }}
          options={[
            { label: "Default service", value: "default" },
            { label: "Custom service", value: "custom" },
          ]}
          title="Select Default service to use the DefaultAcceptMessage web service. Select Custom service to specify a custom web service class defined below."
        />
      </FieldRow>

      {/* Service class name — always visible (matches Java UI).
          Disabled when Default service is active, editable when Custom. */}
      <FieldRow label="Service Class Name:">
        <HoverTooltip content="The fully qualified class name of the web service that should be hosted. If this is a custom class, it should be added in a custom jar so it is loaded with BridgeLink.">
          <input
            type="text"
            value={props.className}
            onChange={(e) => update({ className: e.target.value })}
            disabled={isDefaultService}
            className={`${inputCls(viewDensity)} w-96`}
            placeholder="com.example.MyWebService"
          />
        </HoverTooltip>
      </FieldRow>

      {/* WSDL service name */}
      <FieldRow label="Service Name:">
        <HoverTooltip content="The name to give to the web service.">
          <input
            type="text"
            value={props.serviceName}
            onChange={(e) => update({ serviceName: e.target.value })}
            className={`${inputCls(viewDensity)} w-52`}
            placeholder="Service name"
          />
        </HoverTooltip>
      </FieldRow>

      {/* SOAP binding */}
      <FieldRow label="Binding:">
        <HoverTooltip content="The selected binding version defines the structure of the generated envelope. Selecting default will publish this endpoint with the specified binding annotation. If no annotation is provided, a SOAP 1.1 binding will be used.">
          <select
            value={props.soapBinding}
            onChange={(e) => update({ soapBinding: e.target.value })}
            className={`${selectCls(viewDensity)} w-40`}
          >
            {SOAP_BINDINGS.map(({ label, value }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </HoverTooltip>
      </FieldRow>

      {/* WSDL URL — read-only, computed from the connected server host, listener
          port, and service name. Scheme is https when the SSL plugin secures the
          transport. Mirrors the Java UI's updateWSDL(). */}
      <FieldRow label="WSDL URL:">
        <HoverTooltip content="Displays the generated WSDL URL for the web service. The client that sends messages to the service can download this file to determine how to call the web service.">
          <input
            type="text"
            readOnly
            value={computeWsdlUrl(
              mounted ? resolveServerHost() : "<server ip>",
              props.port,
              props.serviceName,
              securesTransport === true
            )}
            className={`${inputCls(viewDensity)} w-[30rem] bg-gray-50 dark:bg-gray-900 cursor-default select-all`}
          />
        </HoverTooltip>
      </FieldRow>

      {/* Method — read-only operation signature.
          Default service always exposes acceptMessage; Custom depends on implementation. */}
      <FieldRow label="Method:">
        <HoverTooltip content="Displays the generated web service operation signature the client will call.">
          <input
            type="text"
            readOnly
            value={
              isDefaultService
                ? "String acceptMessage(String message)"
                : "<Custom Web Service Methods>"
            }
            className={`${inputCls(viewDensity)} w-[30rem] bg-gray-50 dark:bg-gray-900 cursor-default`}
          />
        </HoverTooltip>
      </FieldRow>
    </SettingsSection>
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────
//
// Web Service Listener is a persistent listener (no polling), so there is no
// TopSection. The SSL Settings plugin section is rendered automatically by
// SslSettingsPlugin in PLUGIN_REGISTRY when the SSL plugin XML is detected.

export const WebServiceListenerConnector: ConnectorDefinition = {
  BottomSection: WebServiceListenerBottomSection,
  defaultPropertiesXml: DEFAULT_WS_LISTENER_PROPERTIES_XML,
  validate(propertiesXml) {
    if (!propertiesXml) return [];
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const txt = (tag: string) => doc.querySelector(tag)?.textContent?.trim() ?? "";
    const errors: import("./shared/validate-utils").ValidationError[] = [];
    if (!txt("className"))
      errors.push({ field: "className", message: "Service Class is required." });
    if (!txt("serviceName"))
      errors.push({ field: "serviceName", message: "Service Name is required." });
    return errors;
  },
};
