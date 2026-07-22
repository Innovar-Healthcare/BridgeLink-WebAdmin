"use client";

import { useEffect, useState } from "react";
import { Lock, Globe } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import { useTestConn } from "../shared/use-test-conn";
import { TestConnButton } from "../shared/test-conn-button";
import { SettingsSection, FieldRow, FullWidthField } from "@/components/settings/settings-section";
import type { DestinationConnectorDefinition, DestinationConnectorSectionProps } from "./types";
import { isUsingHttps } from "./url-scheme";
import {
  DEFAULT_DEST_PROPERTIES_XML,
  parseHttpSenderPropsFromXml,
  updateHttpSenderPropsInXml,
  withVersion,
  resolveXmlVersion,
  type HttpSenderProps,
  type NameValueEntry,
} from "../../_lib/channel-xml";
import { NameValueTable } from "../shared/name-value-table";
import { RadioGroup } from "../shared/radio-group";
import { inputCls, selectCls, inputErrorCls, fieldErrorMsgCls } from "../shared/styles";
import { SecretInput } from "@/components/ui/secret-input";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { useCharsetEncodings } from "@/lib/hooks/use-charset-encodings";
import { buildCharsetOptions } from "../shared/charset-options";
import {
  VariableOrNumberInput,
  isNumberOrVariable,
} from "@/components/ui/variable-or-number-input";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_XML = DEFAULT_DEST_PROPERTIES_XML["HTTP Sender"]!;

// ─── Bottom section ───────────────────────────────────────────────────────────

function HttpSenderBottomSection({
  propertiesXml,
  onChange,
  channelId,
  channelName,
  invalidFields,
  securesTransport,
}: DestinationConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const serverCharsets = useCharsetEncodings();
  const invalid = invalidFields ?? new Set<string>();
  const propsXml = propertiesXml ?? withVersion(DEFAULT_XML, resolveXmlVersion());
  const [local, setLocal] = useState<HttpSenderProps>(() => parseHttpSenderPropsFromXml(propsXml));
  const {
    testing: tcTesting,
    result: tcResult,
    test: tcTest,
  } = useTestConn("http", "_testConnection", propsXml, channelId, channelName);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(
      parseHttpSenderPropsFromXml(propertiesXml ?? withVersion(DEFAULT_XML, resolveXmlVersion()))
    );
  }, [propertiesXml]);

  function commit(updated: HttpSenderProps) {
    setLocal(updated);
    onChange({ propertiesXml: updateHttpSenderPropsInXml(propsXml, updated) });
  }

  function set<K extends keyof HttpSenderProps>(key: K, val: HttpSenderProps[K]) {
    commit({ ...local, [key]: val });
  }

  // Derived booleans for conditional rendering. Mirror Java HttpSender.isUsingHttps() (URI-scheme
  // semantics). The SSL Settings plugin suppresses the warning when its section is present, surfaced
  // as `securesTransport`.
  const isHttps = isUsingHttps(local.host);
  const sslNotConfigured = isHttps && !securesTransport;
  const hasBody = local.method === "post" || local.method === "put" || local.method === "patch";
  const isFormUrlEncoded = local.contentType
    .toLowerCase()
    .startsWith("application/x-www-form-urlencoded");
  const bodyEnabled = hasBody && !isFormUrlEncoded;

  function handleHeaders(entries: NameValueEntry[]) {
    commit({ ...local, headers: entries });
  }
  function handleParams(entries: NameValueEntry[]) {
    commit({ ...local, parameters: entries });
  }

  function handleContentTypeChange(val: string) {
    const updated: Partial<HttpSenderProps> = { contentType: val };
    if (val.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
      updated.multipart = false;
      updated.dataTypeBinary = false;
    }
    commit({ ...local, ...updated });
  }

  return (
    <SettingsSection
      title="HTTP Sender Settings"
      icon={Globe}
      defaultExpanded={true}
      storageKey="bl-http-sender-main"
    >
      {/* URL + inline Test Connection */}
      <FieldRow label="URL:">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <HoverTooltip content="Enter the URL of the HTTP server to send each message to.">
              <input
                type="text"
                value={local.host}
                onChange={(e) => set("host", e.target.value)}
                placeholder="http://..."
                className={`${inputCls(viewDensity)} flex-1 min-w-0 ${invalid.has("host") ? inputErrorCls : ""}`}
              />
            </HoverTooltip>
            {sslNotConfigured && (
              <HoverTooltip content="The default system certificate store will be used for this connection. Mutual authentication (two-way) is not supported without the SSL Manager plugin.">
                <span className="shrink-0 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <Lock className="w-3.5 h-3.5" />
                  SSL
                </span>
              </HoverTooltip>
            )}
            <TestConnButton
              label="Test Connection"
              testing={tcTesting}
              result={tcResult}
              onTest={tcTest}
            />
          </div>
          {invalid.has("host") && <p className={fieldErrorMsgCls}>URL is required.</p>}
        </div>
      </FieldRow>

      {/* Use Proxy Server */}
      <FieldRow label="Use Proxy Server:">
        <RadioGroup
          name="http-proxy"
          value={local.useProxyServer ? "yes" : "no"}
          onChange={(v) => set("useProxyServer", v === "yes")}
          options={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          title="If enabled, requests will be forwarded to the proxy server specified in the address/port fields below."
        />
      </FieldRow>

      {local.useProxyServer && (
        <>
          <FieldRow label="Proxy Address:">
            <HoverTooltip content="The domain name or IP address of the proxy server to connect to.">
              <input
                type="text"
                value={local.proxyAddress}
                onChange={(e) => set("proxyAddress", e.target.value)}
                className={`${inputCls(viewDensity)} w-56`}
              />
            </HoverTooltip>
          </FieldRow>
          <FieldRow label="Proxy Port:">
            <HoverTooltip content="The port on which to connect to the proxy server.">
              <input
                type="text"
                value={local.proxyPort}
                onChange={(e) => set("proxyPort", e.target.value)}
                className={`${inputCls(viewDensity)} w-28`}
              />
            </HoverTooltip>
          </FieldRow>
        </>
      )}

      {/* Method */}
      <FieldRow label="Method:">
        <RadioGroup
          name="http-method"
          value={local.method}
          onChange={(v) =>
            commit({ ...local, method: v, ...(v !== "post" ? { multipart: false } : {}) })
          }
          options={[
            { label: "POST", value: "post" },
            { label: "GET", value: "get" },
            { label: "PUT", value: "put" },
            { label: "DELETE", value: "delete" },
            { label: "PATCH", value: "patch" },
          ]}
          title="Selects the HTTP operation used to send each message."
        />
      </FieldRow>

      {/* Multipart (POST only) */}
      {local.method === "post" && (
        <FieldRow label="Multipart:">
          <RadioGroup
            name="http-multipart"
            value={local.multipart ? "yes" : "no"}
            onChange={(v) => set("multipart", v === "yes")}
            disabled={isFormUrlEncoded}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            title="Yes = use multipart in Content-Type header (POST only). No = do not use multipart."
          />
        </FieldRow>
      )}

      {/* Send Timeout */}
      <FieldRow label="Send Timeout (ms):">
        <HoverTooltip content="Sets the socket timeout (SO_TIMEOUT) in milliseconds. A timeout value of zero is interpreted as an infinite timeout.">
          <VariableOrNumberInput
            min={0}
            value={local.socketTimeout}
            onChange={(socketTimeout) => set("socketTimeout", socketTimeout)}
            className={`${inputCls(viewDensity)} w-28`}
          />
        </HoverTooltip>
      </FieldRow>

      {/* Response Content */}
      <FieldRow label="Response Content:">
        <RadioGroup
          name="http-response-content"
          value={local.responseXmlBody ? "xml" : "plain"}
          onChange={(v) => set("responseXmlBody", v === "xml")}
          options={[
            { label: "Plain Body", value: "plain" },
            { label: "XML Body", value: "xml" },
          ]}
          title="Plain Body: the response content will only include the response body as a raw string. XML Body: the response content will include the response body as serialized XML."
        />
      </FieldRow>

      {local.responseXmlBody && (
        <>
          <FieldRow label="Parse Multipart:">
            <RadioGroup
              name="http-parse-multipart"
              value={local.responseParseMultipart ? "yes" : "no"}
              onChange={(v) => set("responseParseMultipart", v === "yes")}
              options={[
                { label: "Yes", value: "yes" },
                { label: "No", value: "no" },
              ]}
              title="Select Yes to automatically parse multipart responses into separate XML nodes."
            />
          </FieldRow>
          <FieldRow label="Include Metadata:">
            <RadioGroup
              name="http-include-metadata"
              value={local.responseIncludeMetadata ? "yes" : "no"}
              onChange={(v) => set("responseIncludeMetadata", v === "yes")}
              options={[
                { label: "Yes", value: "yes" },
                { label: "No", value: "no" },
              ]}
              title="Select Yes to include response metadata (status line and headers) in the XML content."
            />
          </FieldRow>
        </>
      )}

      {/* Binary MIME Types */}
      <FieldRow label="Binary MIME Types:">
        <div className="flex items-center gap-3 flex-wrap">
          <HoverTooltip content="When a response comes in with a Content-Type header that matches one of these entries, the content will be encoded into a Base64 string. If Regular Expression is unchecked, specify multiple entries with commas. Otherwise, enter a valid regular expression to match MIME types against.">
            <input
              type="text"
              value={local.responseBinaryMimeTypes}
              onChange={(e) => set("responseBinaryMimeTypes", e.target.value)}
              className={`${inputCls(viewDensity)} w-80 font-mono text-xs`}
            />
          </HoverTooltip>
          <HoverTooltip content="When a response comes in with a Content-Type header that matches one of these entries, the content will be encoded into a Base64 string. If Regular Expression is unchecked, specify multiple entries with commas. Otherwise, enter a valid regular expression to match MIME types against.">
            <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={local.responseBinaryMimeTypesRegex}
                onChange={(e) => set("responseBinaryMimeTypesRegex", e.target.checked)}
                className="accent-blue-600"
              />
              Regular Expression
            </label>
          </HoverTooltip>
        </div>
      </FieldRow>

      {/* Query Parameters */}
      <FieldRow label="Query Parameters:" className="!items-start pt-1">
        <div className="flex-1 space-y-1.5">
          <RadioGroup
            name="http-params-mode"
            value={local.useParametersVariable ? "map" : "table"}
            onChange={(v) => set("useParametersVariable", v === "map")}
            options={[
              { label: "Use Table", value: "table" },
              { label: "Use Map", value: "map" },
            ]}
            title="Use Table: the table below will be used to populate query parameters. Use Map: the Java map specified by the following variable will be used to populate query parameters. The map must have String keys and either String or List<String> values."
          />
          {local.useParametersVariable ? (
            <HoverTooltip content="The variable of a Java map to use to populate query parameters. The map must have String keys and either String or List<String> values.">
              <input
                type="text"
                value={local.parametersVariable}
                onChange={(e) => set("parametersVariable", e.target.value)}
                placeholder="Map variable name"
                className={`${inputCls(viewDensity)} w-56`}
              />
            </HoverTooltip>
          ) : (
            <HoverTooltip content="Query parameters are encoded as x=y pairs as part of the request URL, separated from it by a '?' and from each other by an '&'.">
              <div>
                <NameValueTable
                  entries={local.parameters}
                  onChange={handleParams}
                  nameLabel="Parameter"
                  valueLabel="Value"
                  addLabel="Add Parameter"
                />
              </div>
            </HoverTooltip>
          )}
        </div>
      </FieldRow>

      {/* Headers */}
      <FieldRow label="Headers:" className="!items-start pt-1">
        <div className="flex-1 space-y-1.5">
          <RadioGroup
            name="http-headers-mode"
            value={local.useHeadersVariable ? "map" : "table"}
            onChange={(v) => set("useHeadersVariable", v === "map")}
            options={[
              { label: "Use Table", value: "table" },
              { label: "Use Map", value: "map" },
            ]}
            title="Use Table: the table below will be used to populate headers. Use Map: the Java map specified by the following variable will be used to populate headers. The map must have String keys and either String or List<String> values."
          />
          {local.useHeadersVariable ? (
            <HoverTooltip content="The variable of a Java map to use to populate headers. The map must have String keys and either String or List<String> values.">
              <input
                type="text"
                value={local.headersVariable}
                onChange={(e) => set("headersVariable", e.target.value)}
                placeholder="Map variable name"
                className={`${inputCls(viewDensity)} w-56`}
              />
            </HoverTooltip>
          ) : (
            <HoverTooltip content="Header parameters are encoded as HTTP headers in the HTTP request sent to the server.">
              <div>
                <NameValueTable
                  entries={local.headers}
                  onChange={handleHeaders}
                  nameLabel="Header"
                  valueLabel="Value"
                  addLabel="Add Header"
                />
              </div>
            </HoverTooltip>
          )}
        </div>
      </FieldRow>

      {/* Authentication */}
      <FieldRow label="Authentication:">
        <RadioGroup
          name="http-auth"
          value={local.useAuthentication ? "yes" : "no"}
          onChange={(v) => {
            const enabled = v === "yes";
            commit({
              ...local,
              useAuthentication: enabled,
              ...(!enabled ? { username: "", password: "" } : {}),
            });
          }}
          options={[
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ]}
          title="Turning on authentication uses a username and password to communicate with the HTTP server."
        />
      </FieldRow>

      {local.useAuthentication && (
        <>
          <FieldRow label="Authentication Type:">
            <RadioGroup
              name="http-auth-type"
              value={local.authenticationType}
              onChange={(v) => set("authenticationType", v)}
              options={[
                { label: "Basic", value: "Basic" },
                { label: "Digest", value: "Digest" },
              ]}
              title="Basic: use the basic authentication scheme. Digest: use the digest authentication scheme."
            />
          </FieldRow>
          <FieldRow label="Preemptive:">
            <HoverTooltip content="If checked, the authorization header will be sent to the server with the initial request. Otherwise, the header will only be sent when the server requests it. When using digest authentication, an Authorization header containing the realm/nonce/algorithm/qop values must be included in the Headers table.">
              <input
                type="checkbox"
                checked={local.usePreemptiveAuthentication}
                onChange={(e) => set("usePreemptiveAuthentication", e.target.checked)}
                className="accent-blue-600"
              />
            </HoverTooltip>
          </FieldRow>
          <FieldRow label="Username:">
            <HoverTooltip content="The username used to connect to the HTTP server.">
              <input
                type="text"
                value={local.username}
                onChange={(e) => set("username", e.target.value)}
                className={`${inputCls(viewDensity)} w-56`}
              />
            </HoverTooltip>
          </FieldRow>
          <FieldRow label="Password:">
            <HoverTooltip content="The password used to connect to the HTTP server.">
              <SecretInput
                value={local.password}
                onChange={(e) => set("password", e.target.value)}
                className={`${inputCls(viewDensity)} w-56`}
              />
            </HoverTooltip>
          </FieldRow>
        </>
      )}

      {/* Content (body) — only for POST/PUT/PATCH */}
      {hasBody && (
        <>
          <FieldRow label="Content Type:">
            <HoverTooltip content="The HTTP message body MIME type to use. If application/x-www-form-urlencoded is used, the query parameters specified above will be automatically encoded into the request body.">
              <input
                type="text"
                value={local.contentType}
                onChange={(e) => handleContentTypeChange(e.target.value)}
                className={`${inputCls(viewDensity)} w-56`}
              />
            </HoverTooltip>
          </FieldRow>

          <FieldRow label="Data Type:">
            <RadioGroup
              name="http-data-type"
              value={local.dataTypeBinary ? "binary" : "text"}
              onChange={(v) => {
                const binary = v === "binary";
                commit({
                  ...local,
                  dataTypeBinary: binary,
                  ...(binary ? { charset: "DEFAULT_ENCODING" } : {}),
                });
              }}
              disabled={isFormUrlEncoded}
              options={[
                { label: "Binary", value: "binary" },
                { label: "Text", value: "text" },
              ]}
              title="Select Binary if the outbound message is a Base64 string. Select Text if the outbound message is text."
            />
          </FieldRow>

          {!local.dataTypeBinary && (
            <FieldRow label="Charset Encoding:">
              <HoverTooltip content="Select the character set encoding used by the sender of the message, or Default to assume the default character set encoding for the JVM running BridgeLink.">
                <select
                  value={local.charset}
                  onChange={(e) => set("charset", e.target.value)}
                  className={selectCls(viewDensity)}
                >
                  {buildCharsetOptions(serverCharsets, local.charset).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </HoverTooltip>
            </FieldRow>
          )}

          <FullWidthField label="Content:">
            <HoverTooltip content="The HTTP message body.">
              <Textarea
                density={viewDensity}
                enableTabKey
                value={local.content}
                onChange={(e) => set("content", e.target.value)}
                disabled={!bodyEnabled}
                rows={5}
                className={`w-full px-3 py-2 text-sm rounded border border-border
                  bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono resize-y
                  focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500/30
                  disabled:opacity-40 disabled:cursor-not-allowed`}
              />
            </HoverTooltip>
          </FullWidthField>
        </>
      )}
    </SettingsSection>
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────

export const HttpSenderConnector: DestinationConnectorDefinition = {
  BottomSection: HttpSenderBottomSection,
  defaultPropertiesXml: DEFAULT_XML,
  validate(propertiesXml) {
    if (!propertiesXml) return [];
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const txt = (tag: string) => doc.querySelector(tag)?.textContent?.trim() ?? "";
    const errors: import("../shared/validate-utils").ValidationError[] = [];

    if (!txt("host")) errors.push({ field: "host", message: "URL is required." });

    if (txt("useProxyServer") === "true") {
      if (!txt("proxyAddress"))
        errors.push({ field: "proxyAddress", message: "Proxy Address is required." });
      if (!txt("proxyPort"))
        errors.push({ field: "proxyPort", message: "Proxy Port is required." });
    }

    const socketTimeout = txt("socketTimeout");
    if (!socketTimeout || !isNumberOrVariable(socketTimeout))
      errors.push({ field: "socketTimeout", message: "Send Timeout is required." });

    if (txt("useParametersVariable") === "true" && !txt("parametersVariable"))
      errors.push({
        field: "parametersVariable",
        message: "Query Parameters variable name is required.",
      });

    if (txt("useHeadersVariable") === "true" && !txt("headersVariable"))
      errors.push({ field: "headersVariable", message: "Headers variable name is required." });

    const method = txt("method").toLowerCase();
    const hasBody = method === "post" || method === "put" || method === "patch";
    if (hasBody && !txt("contentType"))
      errors.push({ field: "contentType", message: "Content Type is required." });

    if (
      hasBody &&
      txt("contentType").toLowerCase().startsWith("application/x-www-form-urlencoded") &&
      txt("useParametersVariable") !== "true" &&
      doc.querySelectorAll("parameters > entry").length === 0
    )
      errors.push({
        field: "parameters",
        message: "At least one query parameter is required for form-urlencoded requests.",
      });

    return errors;
  },
};
