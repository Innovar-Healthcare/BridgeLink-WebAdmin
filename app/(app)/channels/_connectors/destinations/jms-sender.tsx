"use client";

import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import { SettingsSection, FieldRow, FullWidthField } from "@/components/settings/settings-section";
import type { DestinationConnectorDefinition, DestinationConnectorSectionProps } from "./types";
import {
  DEFAULT_DEST_PROPERTIES_XML,
  parseJmsSenderPropsFromXml,
  updateJmsSenderPropsInXml,
  type JmsSenderProps,
  type NameValueEntry,
} from "../../_lib/channel-xml";
import { JmsConnectionPropertiesTable } from "../shared/jms-connection-properties-table";
import { RadioGroup } from "../shared/radio-group";
import { inputCls, inputErrorCls, fieldErrorMsgCls } from "../shared/styles";
import { SecretInput } from "@/components/ui/secret-input";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { Textarea } from "@/components/ui/textarea";
import { JmsConnectionTemplatesPanel } from "../shared/jms-connection-templates-panel";

const DEFAULT_XML = DEFAULT_DEST_PROPERTIES_XML["JMS Sender"]!;

// ─── Template helpers ─────────────────────────────────────────────────────────
// Mirrors Java JmsConnectorPanel.loadTemplate (JmsConnectorPanel.java:622-648): Load sets
// ONLY the six connection fields — useJndi, the three JNDI strings, connectionFactoryClass,
// and the connectionProperties table. It never touches destinationName, topic, clientId,
// username, or password (templates store those blank), so those per-instance fields stay at
// their current values when a template is loaded.

export function jmsTemplateToProps(props: Record<string, unknown>): Partial<JmsSenderProps> {
  const rawConn = props.connectionProperties;
  let connectionProperties: NameValueEntry[] = [];
  if (rawConn && typeof rawConn === "object" && !Array.isArray(rawConn)) {
    connectionProperties = Object.entries(rawConn as Record<string, string>).map(
      ([name, value]) => ({ name, value: String(value) })
    );
  }
  return {
    useJndi: Boolean(props.useJndi),
    jndiProviderUrl: String(props.jndiProviderUrl ?? ""),
    jndiInitialContextFactory: String(props.jndiInitialContextFactory ?? ""),
    jndiConnectionFactoryName: String(props.jndiConnectionFactoryName ?? ""),
    connectionFactoryClass: String(props.connectionFactoryClass ?? ""),
    connectionProperties,
  };
}

// ─── Bottom section ───────────────────────────────────────────────────────────

function JmsSenderBottomSection({
  propertiesXml,
  onChange,
  invalidFields,
}: DestinationConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const invalid = invalidFields ?? new Set<string>();
  const propsXml = propertiesXml ?? DEFAULT_XML;
  const [local, setLocal] = useState<JmsSenderProps>(() => parseJmsSenderPropsFromXml(propsXml));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(parseJmsSenderPropsFromXml(propertiesXml ?? DEFAULT_XML));
  }, [propertiesXml]);

  function commit(updated: JmsSenderProps) {
    setLocal(updated);
    onChange({ propertiesXml: updateJmsSenderPropsInXml(propsXml, updated) });
  }

  function set<K extends keyof JmsSenderProps>(key: K, val: JmsSenderProps[K]) {
    commit({ ...local, [key]: val });
  }

  function handleConnProps(entries: NameValueEntry[]) {
    commit({ ...local, connectionProperties: entries });
  }

  return (
    <SettingsSection
      title="JMS Sender Settings"
      icon={MessageSquare}
      defaultExpanded={true}
      storageKey="bl-jms-sender-main"
    >
      {/* ── Connection Templates ───────────────────────────────────────────── */}
      <JmsConnectionTemplatesPanel
        currentXml={propsXml}
        onLoadTemplate={(raw) => commit({ ...local, ...jmsTemplateToProps(raw) })}
      />

      {/* Use JNDI */}
      <FieldRow label="Use JNDI:">
        <RadioGroup
          name="jms-jndi"
          value={local.useJndi ? "yes" : "no"}
          onChange={(v) => set("useJndi", v === "yes")}
          options={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          title="Select Yes to use JNDI to look up a connection factory. Select No to specify a connection factory class directly."
        />
      </FieldRow>

      {/* JNDI fields */}
      {local.useJndi ? (
        <>
          <FieldRow label="Provider URL:">
            <div className="flex-1 min-w-0">
              <HoverTooltip content="If using JNDI, enter the URL of the JNDI provider here.">
                <input
                  type="text"
                  value={local.jndiProviderUrl}
                  onChange={(e) => set("jndiProviderUrl", e.target.value)}
                  className={`${inputCls(viewDensity)} w-full ${invalid.has("jndiProviderUrl") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
              {invalid.has("jndiProviderUrl") && (
                <p className={fieldErrorMsgCls}>Provider URL is required.</p>
              )}
            </div>
          </FieldRow>
          <FieldRow label="Initial Context Factory:">
            <div className="flex-1 min-w-0">
              <HoverTooltip content="The full Java classname of the JNDI Initial Context Factory class.">
                <input
                  type="text"
                  value={local.jndiInitialContextFactory}
                  onChange={(e) => set("jndiInitialContextFactory", e.target.value)}
                  className={`${inputCls(viewDensity)} w-full ${invalid.has("jndiInitialContextFactory") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
              {invalid.has("jndiInitialContextFactory") && (
                <p className={fieldErrorMsgCls}>Initial Context Factory is required.</p>
              )}
            </div>
          </FieldRow>
          <FieldRow label="Connection Factory Name:">
            <div className="flex-1 min-w-0">
              <HoverTooltip content="If using JNDI, the JNDI name of the connection factory.">
                <input
                  type="text"
                  value={local.jndiConnectionFactoryName}
                  onChange={(e) => set("jndiConnectionFactoryName", e.target.value)}
                  className={`${inputCls(viewDensity)} w-full ${invalid.has("jndiConnectionFactoryName") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
              {invalid.has("jndiConnectionFactoryName") && (
                <p className={fieldErrorMsgCls}>Connection Factory Name is required.</p>
              )}
            </div>
          </FieldRow>
        </>
      ) : (
        <FieldRow label="Connection Factory Class:">
          <div className="flex-1 min-w-0">
            <HoverTooltip content="The full Java classname of the JMS connection factory.">
              <input
                type="text"
                value={local.connectionFactoryClass}
                onChange={(e) => set("connectionFactoryClass", e.target.value)}
                className={`${inputCls(viewDensity)} w-full ${invalid.has("connectionFactoryClass") ? inputErrorCls : ""}`}
              />
            </HoverTooltip>
            {invalid.has("connectionFactoryClass") && (
              <p className={fieldErrorMsgCls}>Connection Factory Class is required.</p>
            )}
          </div>
        </FieldRow>
      )}

      {/* Connection Properties */}
      <FieldRow label="Connection Properties:" className="!items-start pt-1">
        <div className="flex-1">
          <JmsConnectionPropertiesTable
            entries={local.connectionProperties}
            onChange={handleConnProps}
          />
        </div>
      </FieldRow>

      {/* Destination Type — Java keeps this visible but disabled in JNDI mode (the
          value is preserved either way) rather than hiding it. */}
      <FieldRow label="Destination Type:">
        <RadioGroup
          name="jms-dest-type"
          disabled={local.useJndi}
          value={local.topic ? "topic" : "queue"}
          onChange={(v) => set("topic", v === "topic")}
          options={[
            { label: "Queue", value: "queue" },
            { label: "Topic", value: "topic" },
          ]}
          title="Specify whether the destination is a queue or a topic."
        />
      </FieldRow>

      {/* Destination Name */}
      <FieldRow label="Destination Name:">
        <HoverTooltip content="The name of the queue or topic.">
          <input
            type="text"
            value={local.destinationName}
            onChange={(e) => set("destinationName", e.target.value)}
            className={`${inputCls(viewDensity)} flex-1`}
          />
        </HoverTooltip>
      </FieldRow>

      {/* Client ID */}
      <FieldRow label="Client ID:">
        <HoverTooltip content="The JMS client ID to use when connecting to the JMS broker.">
          <input
            type="text"
            value={local.clientId}
            onChange={(e) => set("clientId", e.target.value)}
            className={`${inputCls(viewDensity)} w-56`}
          />
        </HoverTooltip>
      </FieldRow>

      {/* Username */}
      <FieldRow label="Username:">
        <HoverTooltip content="The username for accessing the queue or topic.">
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
        <HoverTooltip content="The password for accessing the queue or topic.">
          <SecretInput
            value={local.password}
            onChange={(e) => set("password", e.target.value)}
            className={`${inputCls(viewDensity)} w-56`}
          />
        </HoverTooltip>
      </FieldRow>

      {/* Template */}
      <FullWidthField label="Template:">
        <HoverTooltip content="The JMS message content to be sent.">
          <Textarea
            density={viewDensity}
            enableTabKey
            value={local.template}
            onChange={(e) => set("template", e.target.value)}
            rows={5}
            className="w-full px-3 py-2 text-sm rounded border border-border
              bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono resize-y
              focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30"
          />
        </HoverTooltip>
      </FullWidthField>
    </SettingsSection>
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────

export const JmsSenderConnector: DestinationConnectorDefinition = {
  canValidateResponse: false,
  BottomSection: JmsSenderBottomSection,
  defaultPropertiesXml: DEFAULT_XML,
  validate(propertiesXml) {
    if (!propertiesXml) return [];
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const txt = (tag: string) => doc.querySelector(tag)?.textContent?.trim() ?? "";
    const errors: import("../shared/validate-utils").ValidationError[] = [];

    if (!txt("destinationName"))
      errors.push({ field: "destinationName", message: "Destination Name is required." });

    if (txt("useJndi") === "true") {
      if (!txt("jndiProviderUrl"))
        errors.push({ field: "jndiProviderUrl", message: "Provider URL is required." });
      if (!txt("jndiInitialContextFactory"))
        errors.push({
          field: "jndiInitialContextFactory",
          message: "Initial Context Factory is required.",
        });
      if (!txt("jndiConnectionFactoryName"))
        errors.push({
          field: "jndiConnectionFactoryName",
          message: "Connection Factory Name is required.",
        });
    } else {
      if (!txt("connectionFactoryClass"))
        errors.push({
          field: "connectionFactoryClass",
          message: "Connection Factory Class is required.",
        });
    }

    if (!txt("template")) errors.push({ field: "template", message: "Template is required." });

    return errors;
  },
};
