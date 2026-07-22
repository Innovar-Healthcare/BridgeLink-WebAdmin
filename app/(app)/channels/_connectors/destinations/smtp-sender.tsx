"use client";

import { Fragment, useEffect, useState } from "react";
import { Trash2, Mail } from "lucide-react";
import { toast } from "sonner";
import { HoverTooltip } from "@/components/hover-tooltip";
import { useTestConn } from "../shared/use-test-conn";
import { TestConnButton } from "../shared/test-conn-button";
import { SettingsSection, FieldRow, FullWidthField } from "@/components/settings/settings-section";
import type { DestinationConnectorDefinition, DestinationConnectorSectionProps } from "./types";
import {
  DEFAULT_DEST_PROPERTIES_XML,
  parseSmtpSenderPropsFromXml,
  updateSmtpSenderPropsInXml,
  type SmtpSenderProps,
  type SmtpAttachment,
  type NameValueEntry,
} from "../../_lib/channel-xml";
import { NameValueTable } from "../shared/name-value-table";
import { RadioGroup } from "../shared/radio-group";
import { inputCls, selectCls, inputErrorCls, fieldErrorMsgCls } from "../shared/styles";
import { SecretInput } from "@/components/ui/secret-input";
import {
  VariableOrNumberInput,
  isNumberOrVariable,
} from "@/components/ui/variable-or-number-input";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { useCharsetEncodings } from "@/lib/hooks/use-charset-encodings";
import { buildCharsetOptions } from "../shared/charset-options";
import { Textarea } from "@/components/ui/textarea";
import type { ValidationError } from "../shared/validate-utils";

const DEFAULT_XML = DEFAULT_DEST_PROPERTIES_XML["SMTP Sender"]!;

/**
 * Validates SMTP Sender properties, mirroring Java SmtpSender.checkProperties()
 * (SmtpSender.java:238-356). Shared by the connector-level save-time validator and the
 * "Send Test Email" pre-send gate (SmtpSender.java:1057-1061).
 */
function validateSmtpSenderProps(propertiesXml: string | null): ValidationError[] {
  if (!propertiesXml) return [];
  const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
  const root = doc.documentElement;
  const txt = (tag: string) => root.querySelector(`:scope > ${tag}`)?.textContent?.trim() ?? "";
  const errors: ValidationError[] = [];

  if (!txt("smtpHost")) errors.push({ field: "smtpHost", message: "SMTP Host is required." });
  if (!txt("smtpPort")) errors.push({ field: "smtpPort", message: "SMTP Port is required." });
  if (!txt("to")) errors.push({ field: "to", message: "To is required." });
  if (!txt("from")) errors.push({ field: "from", message: "From is required." });

  const timeout = txt("timeout");
  if (!timeout || !isNumberOrVariable(timeout))
    errors.push({ field: "timeout", message: "Timeout is required." });

  if (txt("overrideLocalBinding") === "true") {
    // Mirror Java SmtpSender.java:262-268 — reject local addresses of 3 chars or fewer.
    if (txt("localAddress").length <= 3)
      errors.push({ field: "localAddress", message: "Local Address is required." });
    if (!txt("localPort")) errors.push({ field: "localPort", message: "Local Port is required." });
  }

  if (txt("isUseHeadersVariable") === "true" && !txt("headersVariable"))
    errors.push({ field: "headersVariable", message: "Headers variable name is required." });

  if (txt("isUseAttachmentsVariable") === "true" && !txt("attachmentsVariable"))
    errors.push({
      field: "attachmentsVariable",
      message: "Attachments variable name is required.",
    });

  if (txt("authType") === "OAUTH") {
    if (!txt("username"))
      errors.push({ field: "username", message: "Username is required for OAuth." });
    if (!txt("oAuthClientId"))
      errors.push({ field: "oAuthClientId", message: "OAuth Client ID is required." });
    if (!txt("oAuthClientSecret"))
      errors.push({ field: "oAuthClientSecret", message: "OAuth Client Secret is required." });
    if (!txt("oAuthTokenEndpointUrl"))
      errors.push({
        field: "oAuthTokenEndpointUrl",
        message: "OAuth Token Endpoint URL is required.",
      });
  }

  return errors;
}

// ─── Bottom section ───────────────────────────────────────────────────────────

function SmtpSenderBottomSection({
  propertiesXml,
  onChange,
  channelId,
  channelName,
  invalidFields,
}: DestinationConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const serverCharsets = useCharsetEncodings();
  const invalid = invalidFields ?? new Set<string>();
  const propsXml = propertiesXml ?? DEFAULT_XML;
  const [local, setLocal] = useState<SmtpSenderProps>(() => parseSmtpSenderPropsFromXml(propsXml));
  const {
    testing: tcTesting,
    result: tcResult,
    test: tcTest,
  } = useTestConn("smtp", "_sendTestEmail", propsXml, channelId, channelName);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(parseSmtpSenderPropsFromXml(propertiesXml ?? DEFAULT_XML));
  }, [propertiesXml]);

  function commit(updated: SmtpSenderProps) {
    setLocal(updated);
    onChange({ propertiesXml: updateSmtpSenderPropsInXml(propsXml, updated) });
  }

  // Mirror Java SmtpSender.sendTestEmailButtonActionPerformed (SmtpSender.java:1057-1061):
  // refuse to send a test email until the connector validates, listing the errors.
  function handleSendTest() {
    const errors = validateSmtpSenderProps(propsXml);
    if (errors.length > 0) {
      toast.error(
        `Please fix the following errors before sending a test email:\n${errors
          .map((e) => `• ${e.message}`)
          .join("\n")}`
      );
      return;
    }
    tcTest();
  }

  function set<K extends keyof SmtpSenderProps>(key: K, val: SmtpSenderProps[K]) {
    commit({ ...local, [key]: val });
  }

  function handleHeaders(entries: NameValueEntry[]) {
    commit({ ...local, headers: entries });
  }

  function addAttachment() {
    const idx = local.attachments.length + 1;
    commit({
      ...local,
      attachments: [...local.attachments, { name: `Attachment ${idx}`, content: "", mimeType: "" }],
    });
  }
  function removeAttachment(i: number) {
    commit({ ...local, attachments: local.attachments.filter((_, j) => j !== i) });
  }

  function updateAttachment(i: number, field: keyof SmtpAttachment, val: string) {
    const updated = local.attachments.map((a, j) => (j === i ? { ...a, [field]: val } : a));
    commit({ ...local, attachments: updated });
  }

  return (
    <SettingsSection
      title="SMTP Sender Settings"
      icon={Mail}
      defaultExpanded={true}
      storageKey="bl-smtp-sender-main"
    >
      {/* SMTP Host + inline Send Test Email */}
      <FieldRow label="SMTP Host:">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <HoverTooltip content='Enter the DNS domain name or IP address of the SMTP server to use to send the email messages. Note that sending email to an SMTP server that is not expecting it may result in the IP of the box running BridgeLink being added to the server&apos;s "blacklist".'>
              <input
                type="text"
                value={local.smtpHost}
                onChange={(e) => set("smtpHost", e.target.value)}
                className={`${inputCls(viewDensity)} flex-1 min-w-0 ${invalid.has("smtpHost") ? inputErrorCls : ""}`}
              />
            </HoverTooltip>
            <TestConnButton
              label="Send Test Email"
              testing={tcTesting}
              result={tcResult}
              onTest={handleSendTest}
            />
          </div>
          {invalid.has("smtpHost") && <p className={fieldErrorMsgCls}>SMTP Host is required.</p>}
        </div>
      </FieldRow>

      {/* SMTP Port */}
      <FieldRow label="SMTP Port:">
        <div>
          <HoverTooltip content="The port number of the SMTP server. Generally the default port of 25 is used.">
            <input
              type="text"
              value={local.smtpPort}
              onChange={(e) => set("smtpPort", e.target.value)}
              className={`${inputCls(viewDensity)} w-28 ${invalid.has("smtpPort") ? inputErrorCls : ""}`}
            />
          </HoverTooltip>
          {invalid.has("smtpPort") && <p className={fieldErrorMsgCls}>SMTP Port is required.</p>}
        </div>
      </FieldRow>

      {/* Override Local Binding */}
      <FieldRow label="Override Local Binding:">
        <RadioGroup
          name="smtp-override-local"
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
                className={`${inputCls(viewDensity)} w-56`}
              />
            </HoverTooltip>
          </FieldRow>
          <FieldRow label="Local Port:">
            <HoverTooltip content="The local port that the client socket will be bound to, if Override Local Binding is set to Yes. Note that if a specific (non-zero) local port is chosen, then after a socket is closed it's up to the underlying OS to release the port before the next socket creation, otherwise the bind attempt will fail.">
              <input
                type="text"
                value={local.localPort}
                onChange={(e) => set("localPort", e.target.value)}
                className={`${inputCls(viewDensity)} w-28`}
              />
            </HoverTooltip>
          </FieldRow>
        </>
      )}

      {/* Send Timeout */}
      <FieldRow label="Send Timeout (ms):">
        <HoverTooltip content="The number of milliseconds for the SMTP socket connection timeout.">
          <VariableOrNumberInput
            min={0}
            value={local.timeout}
            onChange={(timeout) => set("timeout", timeout)}
            className={`${inputCls(viewDensity)} w-28`}
          />
        </HoverTooltip>
      </FieldRow>

      {/* Encryption */}
      <FieldRow label="Encryption:">
        <RadioGroup
          name="smtp-encryption"
          value={local.encryption}
          onChange={(v) => set("encryption", v)}
          options={[
            { label: "None", value: "none" },
            { label: "STARTTLS", value: "TLS" },
            { label: "SSL", value: "SSL" },
          ]}
          title="Selects whether STARTTLS or SSL should be used for optional connection security."
        />
      </FieldRow>

      {/* Authentication Type */}
      <FieldRow label="Auth Type:">
        <RadioGroup
          name="smtp-auth-type"
          value={local.authType}
          onChange={(v) => set("authType", v as SmtpSenderProps["authType"])}
          options={[
            { label: "None", value: "NONE" },
            { label: "Basic", value: "BASIC" },
            { label: "OAuth 2.0", value: "OAUTH" },
          ]}
          title="Selects the authentication method used when connecting to the SMTP server."
        />
      </FieldRow>
      {local.authType === "BASIC" && (
        <>
          <FieldRow label="Username:">
            <HoverTooltip content="The username for SMTP authentication.">
              <input
                type="text"
                value={local.username}
                onChange={(e) => set("username", e.target.value)}
                className={`${inputCls(viewDensity)} w-56`}
              />
            </HoverTooltip>
          </FieldRow>
          <FieldRow label="Password:">
            <HoverTooltip content="The password for SMTP authentication.">
              <SecretInput
                value={local.password}
                onChange={(e) => set("password", e.target.value)}
                className={`${inputCls(viewDensity)} w-56`}
              />
            </HoverTooltip>
          </FieldRow>
        </>
      )}
      {local.authType === "OAUTH" && (
        <>
          <FieldRow label="Username:">
            <div>
              <HoverTooltip content="If the SMTP server requires authentication to send a message, enter the username here.">
                <input
                  type="text"
                  value={local.username}
                  onChange={(e) => set("username", e.target.value)}
                  className={`${inputCls(viewDensity)} w-56 ${invalid.has("username") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
              {invalid.has("username") && (
                <p className={fieldErrorMsgCls}>Username is required for OAuth.</p>
              )}
            </div>
          </FieldRow>
          <FieldRow label="Client ID:">
            <HoverTooltip content="The OAuth 2.0 client ID used to obtain an access token.">
              <input
                type="text"
                value={local.oAuthClientId}
                onChange={(e) => set("oAuthClientId", e.target.value)}
                className={`${inputCls(viewDensity)} w-72`}
              />
            </HoverTooltip>
          </FieldRow>
          <FieldRow label="Client Secret:">
            <HoverTooltip content="The OAuth 2.0 client secret used to obtain an access token.">
              <SecretInput
                value={local.oAuthClientSecret}
                onChange={(e) => set("oAuthClientSecret", e.target.value)}
                className={`${inputCls(viewDensity)} w-72`}
              />
            </HoverTooltip>
          </FieldRow>
          <FieldRow label="Token URL:">
            <HoverTooltip content="The OAuth 2.0 token endpoint URL used to request an access token.">
              <input
                type="text"
                value={local.oAuthTokenEndpointUrl}
                onChange={(e) => set("oAuthTokenEndpointUrl", e.target.value)}
                className={`${inputCls(viewDensity)} w-full max-w-md`}
              />
            </HoverTooltip>
          </FieldRow>
          <FieldRow label="Scope:">
            <HoverTooltip content="The OAuth 2.0 scope requested when obtaining an access token.">
              <input
                type="text"
                value={local.oAuthScope}
                onChange={(e) => set("oAuthScope", e.target.value)}
                className={`${inputCls(viewDensity)} w-full max-w-md`}
              />
            </HoverTooltip>
          </FieldRow>
        </>
      )}

      {/* To */}
      <FieldRow label="To:">
        <div className="flex-1 min-w-0">
          <HoverTooltip content="The email address to which the message should be sent.">
            <input
              type="text"
              value={local.to}
              onChange={(e) => set("to", e.target.value)}
              className={`${inputCls(viewDensity)} w-full ${invalid.has("to") ? inputErrorCls : ""}`}
            />
          </HoverTooltip>
          {invalid.has("to") && <p className={fieldErrorMsgCls}>To is required.</p>}
        </div>
      </FieldRow>

      {/* From */}
      <FieldRow label="From:">
        <HoverTooltip content="The name that should appear as the From address in the email.">
          <input
            type="text"
            value={local.from}
            onChange={(e) => set("from", e.target.value)}
            className={`${inputCls(viewDensity)} flex-1`}
          />
        </HoverTooltip>
      </FieldRow>

      {/* Subject */}
      <FieldRow label="Subject:">
        <input
          type="text"
          value={local.subject}
          onChange={(e) => set("subject", e.target.value)}
          className={`${inputCls(viewDensity)} flex-1`}
        />
      </FieldRow>

      {/* Charset Encoding */}
      <FieldRow label="Charset Encoding:">
        <HoverTooltip content="The character set encoding used by the sender.">
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

      {/* HTML Body */}
      <FieldRow label="HTML Body:">
        <RadioGroup
          name="smtp-html"
          value={local.html ? "yes" : "no"}
          onChange={(v) => set("html", v === "yes")}
          options={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          title="Select Yes to allow HTML tags in the email message body."
        />
      </FieldRow>

      {/* Body */}
      <FullWidthField label="Body:">
        <HoverTooltip content="The email message body content.">
          <Textarea
            density={viewDensity}
            enableTabKey
            value={local.body}
            onChange={(e) => set("body", e.target.value)}
            rows={5}
            className="w-full px-3 py-2 text-sm rounded border border-border
              bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono resize-y
              focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30"
          />
        </HoverTooltip>
      </FullWidthField>

      {/* Headers */}
      <FieldRow label="Headers:" className="!items-start pt-1">
        <div className="flex-1 space-y-1.5">
          <RadioGroup
            name="smtp-headers-mode"
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

      {/* Attachments */}
      <FieldRow label="Attachments:" className="!items-start pt-1">
        <div className="flex-1 space-y-1.5">
          <RadioGroup
            name="smtp-attach-mode"
            value={local.useAttachmentsVariable ? "list" : "table"}
            onChange={(v) => set("useAttachmentsVariable", v === "list")}
            options={[
              { label: "Use Table", value: "table" },
              { label: "Use List", value: "list" },
            ]}
          />
          {local.useAttachmentsVariable ? (
            <HoverTooltip content="The variable of a Java list to use to populate attachments. The list must contain AttachmentEntry values.">
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
                <div className="grid gap-1" style={{ gridTemplateColumns: "1fr 1fr 1fr 1.5rem" }}>
                  {["Name", "Content", "MIME Type", ""].map((h) => (
                    <span
                      key={h}
                      className="text-xs text-gray-500 dark:text-gray-400 font-medium px-1"
                    >
                      {h}
                    </span>
                  ))}
                  {local.attachments.map((att, i) => (
                    <Fragment key={i}>
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
                        value={att.mimeType}
                        onChange={(e) => updateAttachment(i, "mimeType", e.target.value)}
                        className={`${inputCls(viewDensity)} text-xs`}
                        placeholder="text/plain"
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
    </SettingsSection>
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────

export const SmtpSenderConnector: DestinationConnectorDefinition = {
  canValidateResponse: false,
  BottomSection: SmtpSenderBottomSection,
  defaultPropertiesXml: DEFAULT_XML,
  validate(propertiesXml) {
    return validateSmtpSenderProps(propertiesXml);
  },
};
