"use client";

import { MessageSquare, Plug } from "lucide-react";
import { SettingsSection, FieldRow, SummaryChip } from "@/components/settings/settings-section";
import { HoverTooltip } from "@/components/hover-tooltip";
import type { ConnectorDefinition, ConnectorSectionProps } from "./types";
import { RadioGroup } from "./shared/radio-group";
import { inputCls, inputErrorCls, fieldErrorMsgCls } from "./shared/styles";
import { SecretInput } from "@/components/ui/secret-input";
import {
  DEFAULT_JMS_LISTENER_PROPERTIES_XML,
  parseJmsListenerPropsFromXml,
  updateJmsListenerPropsInXml,
  type JmsListenerProps,
  type JmsConnectionProperty,
  resolveXmlVersion,
  withVersion,
} from "../_lib/channel-xml";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { JmsConnectionTemplatesPanel } from "./shared/jms-connection-templates-panel";
import { JmsConnectionPropertiesTable } from "./shared/jms-connection-properties-table";

// ─── Template adapter ─────────────────────────────────────────────────────────
// Converts a raw JmsConnectorProperties record (base class, from the templates API)
// into a partial JmsListenerProps. Mirrors Java JmsConnectorPanel.loadTemplate
// (JmsConnectorPanel.java:622-648): Load sets ONLY the six connection fields — useJndi,
// the three JNDI strings, connectionFactoryClass, and the connectionProperties table. It
// never touches destinationName, topic, clientId, username, or password (templates store
// those blank), so those per-instance fields stay at their current values on Load. The
// listener-specific fields (selector, reconnectIntervalMillis, durableTopic) are likewise
// excluded.

export function jmsTemplateToListenerProps(
  props: Record<string, unknown>
): Partial<JmsListenerProps> {
  const rawConn = props.connectionProperties;
  let connectionProperties: JmsConnectionProperty[] = [];
  if (rawConn && typeof rawConn === "object" && !Array.isArray(rawConn)) {
    connectionProperties = Object.entries(rawConn as Record<string, string>).map(
      ([key, value]) => ({ key, value: String(value) })
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

// ─── Bottom section: JMS Listener Settings ────────────────────────────────────

function JmsListenerBottomSection({
  propertiesXml,
  onChange,
  invalidFields,
}: ConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const invalid = invalidFields ?? new Set<string>();
  const propsXml =
    propertiesXml ?? withVersion(DEFAULT_JMS_LISTENER_PROPERTIES_XML, resolveXmlVersion());
  const props = parseJmsListenerPropsFromXml(propsXml);

  function update(patch: Partial<JmsListenerProps>) {
    onChange({ propertiesXml: updateJmsListenerPropsInXml(propsXml, { ...props, ...patch }) });
  }

  // Derived flag
  const showDurable = props.topic;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Main settings ────────────────────────────────────────────────────── */}

      <SettingsSection
        title="JMS Listener Settings"
        icon={MessageSquare}
        defaultExpanded={true}
        storageKey="bl-jms-listener-main"
      >
        {/* ── Connection Templates ─────────────────────────────────────────── */}
        <JmsConnectionTemplatesPanel
          currentXml={propsXml}
          onLoadTemplate={(raw) => update(jmsTemplateToListenerProps(raw))}
        />

        {/* ── Connection mode ─────────────────────────────────────────────────── */}

        <FieldRow label="Use JNDI:">
          <RadioGroup
            name="useJndi"
            value={props.useJndi ? "yes" : "no"}
            onChange={(v) => update({ useJndi: v === "yes" })}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Select Yes to use JNDI to look up a connection factory to connect to the queue or topic. Select No to specify a connection factory class without using JNDI."
          />
        </FieldRow>

        {/* ── JNDI fields (visible when useJndi = true) ────────────────────────── */}

        {props.useJndi && (
          <>
            <FieldRow label="JNDI Provider URL:">
              <div>
                <HoverTooltip content="If using JNDI, enter the URL of the JNDI provider here.">
                  <input
                    type="text"
                    value={props.jndiProviderUrl}
                    onChange={(e) => update({ jndiProviderUrl: e.target.value })}
                    className={`${inputCls(viewDensity)} w-96 ${invalid.has("jndiProviderUrl") ? inputErrorCls : ""}`}
                    placeholder="jnp://localhost:1099"
                  />
                </HoverTooltip>
                {invalid.has("jndiProviderUrl") && (
                  <p className={fieldErrorMsgCls}>Provider URL is required.</p>
                )}
              </div>
            </FieldRow>

            <FieldRow label="Initial Context Factory:">
              <div>
                <HoverTooltip content="If using JNDI, enter the full Java classname of the JNDI Initial Context Factory class here.">
                  <input
                    type="text"
                    value={props.jndiInitialContextFactory}
                    onChange={(e) => update({ jndiInitialContextFactory: e.target.value })}
                    className={`${inputCls(viewDensity)} w-96 ${invalid.has("jndiInitialContextFactory") ? inputErrorCls : ""}`}
                    placeholder="org.jnp.interfaces.NamingContextFactory"
                  />
                </HoverTooltip>
                {invalid.has("jndiInitialContextFactory") && (
                  <p className={fieldErrorMsgCls}>Initial Context Factory is required.</p>
                )}
              </div>
            </FieldRow>

            <FieldRow label="Connection Factory Name:">
              <div>
                <HoverTooltip content="If using JNDI, enter the JNDI name of the connection factory here.">
                  <input
                    type="text"
                    value={props.jndiConnectionFactoryName}
                    onChange={(e) => update({ jndiConnectionFactoryName: e.target.value })}
                    className={`${inputCls(viewDensity)} w-96 ${invalid.has("jndiConnectionFactoryName") ? inputErrorCls : ""}`}
                    placeholder="java:/ConnectionFactory"
                  />
                </HoverTooltip>
                {invalid.has("jndiConnectionFactoryName") && (
                  <p className={fieldErrorMsgCls}>Connection Factory Name is required.</p>
                )}
              </div>
            </FieldRow>
          </>
        )}

        {/* ── Direct connection factory fields (visible when useJndi = false) ─── */}

        {!props.useJndi && (
          <FieldRow label="Connection Factory Class:">
            <div>
              <HoverTooltip content="If using the generic JMS provider and not using JNDI, enter the full Java classname of the JMS connection factory here.">
                <input
                  type="text"
                  value={props.connectionFactoryClass}
                  onChange={(e) => update({ connectionFactoryClass: e.target.value })}
                  className={`${inputCls(viewDensity)} w-96 ${invalid.has("connectionFactoryClass") ? inputErrorCls : ""}`}
                  placeholder="org.apache.activemq.ActiveMQConnectionFactory"
                />
              </HoverTooltip>
              {invalid.has("connectionFactoryClass") && (
                <p className={fieldErrorMsgCls}>Connection Factory Class is required.</p>
              )}
            </div>
          </FieldRow>
        )}

        {/* ── Credentials ──────────────────────────────────────────────────────── */}

        <FieldRow label="Username:">
          <HoverTooltip content="The username for accessing the queue or topic.">
            <input
              type="text"
              value={props.username}
              onChange={(e) => update({ username: e.target.value })}
              className={`${inputCls(viewDensity)} w-52`}
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Password:">
          <HoverTooltip content="The password for accessing the queue or topic.">
            <SecretInput
              value={props.password}
              onChange={(e) => update({ password: e.target.value })}
              density={viewDensity}
              className={`${inputCls(viewDensity)} w-52`}
            />
          </HoverTooltip>
        </FieldRow>

        {/* ── Destination ──────────────────────────────────────────────────────── */}

        <FieldRow label="Destination Name:">
          <HoverTooltip content="The name of the queue or topic.">
            <input
              type="text"
              value={props.destinationName}
              onChange={(e) => update({ destinationName: e.target.value })}
              className={`${inputCls(viewDensity)} w-72`}
              placeholder="myQueue"
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Is Topic:">
          <RadioGroup
            name="topic"
            value={props.topic ? "yes" : "no"}
            onChange={(v) => update({ topic: v === "yes" })}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Specify whether the destination is a queue or a topic."
          />
        </FieldRow>

        {/* ── Durable subscription (topics only) ──────────────────────────────── */}

        {showDurable && (
          <FieldRow label="Durable Subscription:">
            <RadioGroup
              name="durableTopic"
              value={props.durableTopic ? "yes" : "no"}
              onChange={(v) => update({ durableTopic: v === "yes" })}
              options={[
                { label: "Yes", value: "yes" },
                { label: "No", value: "no" },
              ]}
              title="When connecting to a topic, if this is Yes, all messages published to the topic will be read, regardless of whether or not a connection to the broker is active. If No, only messages published while a connection is active will be read."
            />
          </FieldRow>
        )}

        <FieldRow label="Client ID:">
          <HoverTooltip content="The JMS client ID to use when connecting to the JMS broker.">
            <input
              type="text"
              value={props.clientId}
              onChange={(e) => update({ clientId: e.target.value })}
              className={`${inputCls(viewDensity)} w-52`}
              placeholder="clientId"
            />
          </HoverTooltip>
        </FieldRow>

        {/* ── Message filter / reconnect ───────────────────────────────────────── */}

        <FieldRow label="Message Selector:">
          <HoverTooltip content="Enter a selector expression to select specific messages from the queue/topic. Leave blank to read all messages.">
            <input
              type="text"
              value={props.selector}
              onChange={(e) => update({ selector: e.target.value })}
              className={`${inputCls(viewDensity)} w-96`}
              placeholder="(optional JMS selector, e.g. JMSPriority > 1)"
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Reconnect Interval (ms):">
          <HoverTooltip content="The number of milliseconds between reconnect attempts when a connection error occurs.">
            {/* Java JmsListener constrains this to non-negative integers (no decimals,
                sign, or variables) via MirthFieldConstraints — strip everything but digits. */}
            <input
              type="text"
              inputMode="numeric"
              value={props.reconnectIntervalMillis}
              onChange={(e) =>
                update({ reconnectIntervalMillis: e.target.value.replace(/[^0-9]/g, "") })
              }
              className={`${inputCls(viewDensity)} w-32`}
            />
          </HoverTooltip>
        </FieldRow>
      </SettingsSection>

      {/* ── Connection Properties table (always visible — Java shows it regardless
           of JNDI mode; properties are simply ignored at runtime in JNDI mode) ── */}

      <SettingsSection
        title="Connection Properties"
        icon={Plug}
        defaultExpanded={false}
        storageKey="bl-jms-listener-conn"
        summary={
          props.connectionProperties.length > 0 ? (
            <SummaryChip
              value={`${props.connectionProperties.length} propert${props.connectionProperties.length === 1 ? "y" : "ies"}`}
            />
          ) : undefined
        }
      >
        <FieldRow label="Properties:">
          <JmsConnectionPropertiesTable
            entries={props.connectionProperties.map((p) => ({ name: p.key, value: p.value }))}
            onChange={(entries) =>
              update({
                connectionProperties: entries.map((e) => ({ key: e.name, value: e.value })),
              })
            }
          />
        </FieldRow>
      </SettingsSection>
    </>
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────
//
// JMS Listener is a persistent server-push listener (not polling), so there is
// no TopSection.

export const JmsListenerConnector: ConnectorDefinition = {
  BottomSection: JmsListenerBottomSection,
  defaultPropertiesXml: DEFAULT_JMS_LISTENER_PROPERTIES_XML,
  validate(propertiesXml) {
    if (!propertiesXml) return [];
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const txt = (tag: string) => doc.querySelector(tag)?.textContent?.trim() ?? "";
    const errors: import("./shared/validate-utils").ValidationError[] = [];

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
      // clientId required when destination is a Topic with durable subscription enabled
      if (txt("topic") === "true" && txt("durableTopic") === "true" && !txt("clientId"))
        errors.push({
          field: "clientId",
          message: "Client ID is required for durable topic subscriptions.",
        });
    }

    return errors;
  },
};
