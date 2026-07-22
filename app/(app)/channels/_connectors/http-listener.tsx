"use client";

/**
 * HTTP Listener source connector panel.
 *
 * Replicates all fields and business logic from the BridgeLink Admin UI
 * (HttpReceiverProperties):
 *   - Local address / port
 *   - Body type (Plain / XML) — controls parseMultipart & includeMetadata
 *   - Binary MIME types (text or regex)
 *   - Context path + timeout
 *   - Response: content type, data type (text/binary), charset, status code
 *   - Response headers: table vs map-variable toggle
 *   - Static resources table
 */

import { useState } from "react";
import { MonacoEditor } from "@/components/monaco-editor";
import { ResizableEditorBox } from "@/components/resizable-editor-box";
import { MONACO_BASE_OPTIONS } from "@/lib/monaco-defaults";
import { Plus, Trash2, Globe, Reply, FolderOpen } from "lucide-react";
import { SettingsSection, FieldRow, SummaryChip } from "@/components/settings/settings-section";
import { HoverTooltip } from "@/components/hover-tooltip";
import { FormDialog } from "@/components/form-dialog";
import type { ConnectorDefinition, ConnectorSectionProps } from "./types";
import { RadioGroup } from "./shared/radio-group";
import { inputCls, selectCls, inputErrorCls, fieldErrorMsgCls } from "./shared/styles";
import {
  DEFAULT_HTTP_LISTENER_PROPERTIES_XML,
  parseHttpListenerPropsFromXml,
  updateHttpListenerPropsInXml,
  parseLinkedHashMapList,
  writeLinkedHashMapList,
  type HttpListenerProps,
  resolveXmlVersion,
  withVersion,
} from "../_lib/channel-xml";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";
import { useCharsetEncodings } from "@/lib/hooks/use-charset-encodings";
import { buildCharsetOptions } from "./shared/charset-options";
import {
  VariableOrNumberInput,
  isNumberOrVariable,
} from "@/components/ui/variable-or-number-input";
import { resolveServerHost } from "./shared/server-host";
import { useMounted } from "@/lib/hooks/use-mounted";

// ─── Response-header XML helpers ──────────────────────────────────────────────
//
// Headers are stored as an XStream linked-hash-map of `Map<String, List<String>>`
// (HttpReceiverProperties.responseHeaders) — a single header name may carry
// multiple values (e.g. duplicate Set-Cookie):
//   <responseHeaders class="linked-hash-map">
//     <entry>
//       <string>Header-Name</string>
//       <list><string>value-1</string><string>value-2</string></list>
//     </entry>
//   </responseHeaders>
//
// The editor is a flat list of { key, value } rows — one row per value — exactly
// like the Java client's table (HttpListener.setResponseHeaders/getResponseHeaders)
// and the HTTP Sender. Parse expands every list value to its own row; write groups
// rows by name back into one entry per key. Both delegate to the shared
// linked-hash-map-list helpers so the Listener and Sender stay in lockstep.

interface Header {
  key: string;
  value: string;
}

export function parseHeadersFromXml(xml: string): Header[] {
  try {
    // Wrap so <responseHeaders> is a child element the shared parser can select.
    const doc = new DOMParser().parseFromString(`<wrapper>${xml}</wrapper>`, "application/xml");
    return parseLinkedHashMapList(doc.documentElement, "responseHeaders").map((e) => ({
      key: e.name,
      value: e.value,
    }));
  } catch {
    return [];
  }
}

export function headersToXml(headers: Header[]): string {
  const doc = new DOMParser().parseFromString("<wrapper/>", "application/xml");
  const root = doc.documentElement;
  writeLinkedHashMapList(
    root,
    "responseHeaders",
    headers.map((h) => ({ name: h.key, value: h.value })),
    doc
  );
  const el = root.querySelector(":scope > responseHeaders");
  return el
    ? new XMLSerializer().serializeToString(el)
    : `<responseHeaders class="linked-hash-map"/>`;
}

// ─── Static-resource XML helpers ──────────────────────────────────────────────
//
// Static resources use the fully-qualified class name as the XML element tag:
//   <staticResources>
//     <com.mirth.connect.connectors.http.HttpStaticResource>
//       <contextPath>/path</contextPath>
//       <resourceType>FILE</resourceType>
//       <value>/local/path/to/file</value>
//       <contentType>text/plain</contentType>
//     </com.mirth.connect.connectors.http.HttpStaticResource>
//   </staticResources>

type ResourceType = "FILE" | "DIRECTORY" | "CUSTOM";

interface StaticResource {
  contextPath: string;
  resourceType: ResourceType;
  value: string;
  contentType: string;
}

// Escape XML special characters
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const SR_TAG = "com.mirth.connect.connectors.http.HttpStaticResource";

function parseStaticResourcesFromXml(xml: string): StaticResource[] {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const resources: StaticResource[] = [];
    // querySelectorAll doesn't support dots in element names; use getElementsByTagName
    for (const el of Array.from(doc.getElementsByTagName(SR_TAG))) {
      const str = (tag: string) => el.querySelector(tag)?.textContent?.trim() ?? "";
      resources.push({
        contextPath: str("contextPath"),
        resourceType: (str("resourceType") || "FILE") as ResourceType,
        value: str("value"),
        contentType: str("contentType"),
      });
    }
    return resources;
  } catch {
    return [];
  }
}

function staticResourcesToXml(resources: StaticResource[]): string {
  const items = resources
    .map(
      (r) =>
        `<${SR_TAG}>` +
        `<contextPath>${esc(r.contextPath)}</contextPath>` +
        `<resourceType>${r.resourceType}</resourceType>` +
        `<value>${esc(r.value)}</value>` +
        `<contentType>${esc(r.contentType)}</contentType>` +
        `</${SR_TAG}>`
    )
    .join("");
  return `<staticResources>${items}</staticResources>`;
}

// Normalizes a context path: ensures leading "/", removes trailing "/", collapses
// multiple consecutive slashes. Mirrors HttpListener.java fixContentPath() logic.
function fixContextPath(path: string): string {
  if (!path) return path;
  let p = path.trim().replace(/\/+/g, "/");
  if (!p.startsWith("/")) p = "/" + p;
  if (p.length > 1) p = p.replace(/\/$/, "");
  return p;
}

// Seeds a unique context path for a new static-resource row — the first unused
// "pathN" (path1, path2, …). Mirrors HttpListener.java's
// staticResourcesNewButtonActionPerformed + checkStaticResourceContextPath, so a
// fresh row passes validation immediately instead of starting empty. Collisions
// are checked on the normalized form to match validateContextPath's dedup.
export function firstUnusedStaticResourcePath(resources: StaticResource[]): string {
  const used = new Set(resources.map((r) => fixContextPath(r.contextPath)));
  let n = 1;
  while (used.has(fixContextPath(`path${n}`))) n++;
  return `path${n}`;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RESOURCE_TYPES: { label: string; value: ResourceType }[] = [
  { label: "File", value: "FILE" },
  { label: "Directory", value: "DIRECTORY" },
  { label: "Custom", value: "CUSTOM" },
];

// Shared Add-row button classes (same style as PollingSection cron row)
const addBtnCls =
  "inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded border border-dashed " +
  "border-border text-gray-500 dark:text-gray-400 " +
  "hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 " +
  "hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors";

const delBtnCls =
  "flex items-center justify-center w-6 h-6 rounded text-gray-400 " +
  "hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors";

const colHeaderCls = "text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide";

// ─── Bottom section ───────────────────────────────────────────────────────────

function HttpListenerBottomSection({
  propertiesXml,
  onChange,
  isDark,
  securesTransport,
  invalidFields,
}: ConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const invalid = invalidFields ?? new Set<string>();
  const serverCharsets = useCharsetEncodings();
  const mounted = useMounted();
  const propsXml =
    propertiesXml ?? withVersion(DEFAULT_HTTP_LISTENER_PROPERTIES_XML, resolveXmlVersion());
  const props = parseHttpListenerPropsFromXml(propertiesXml);

  function update(patch: Partial<HttpListenerProps>) {
    onChange({ propertiesXml: updateHttpListenerPropsInXml(propsXml, { ...props, ...patch }) });
  }

  // Parse complex XML sub-structures for display
  const headers = parseHeadersFromXml(props.responseHeadersXml);
  const staticResources = parseStaticResourcesFromXml(props.staticResourcesXml);

  // Business logic derived state:
  // Parse Multipart and Include Metadata are only available when Body = XML.
  // When Body = Plain, those fields are disabled in the Java UI.
  const plainBody = !props.xmlBody;

  // Charset is only editable when Data Type = Text.
  const charsetDisabled = props.responseDataTypeBinary;

  // HTTP-S-3: tracks which static resource row's custom value is being edited.
  const [customValueEdit, setCustomValueEdit] = useState<{ idx: number; draft: string } | null>(
    null
  );

  // HTTP-S-2: per-row context path validation error messages.
  const [contextPathErrors, setContextPathErrors] = useState<Record<number, string>>({});

  function validateContextPath(normalized: string, idx: number): string | null {
    if (!normalized || normalized.trim() === "") return "Path cannot be empty.";
    if (normalized === "/") return 'Path cannot be "/".';
    for (let i = 0; i < staticResources.length; i++) {
      if (i !== idx && fixContextPath(staticResources[i].contextPath) === normalized) {
        return "Path is already used by another resource.";
      }
    }
    return null;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── HTTP Listener Settings ─────────────────────────────────────────── */}

      <SettingsSection title="HTTP Listener Settings" icon={Globe}>
        <FieldRow label="Local Address:">
          <HoverTooltip content="The address that the HTTP listener binds to.">
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
          <HoverTooltip content="The port that the HTTP listener binds to.">
            <VariableOrNumberInput
              min={1}
              max={65535}
              value={props.port}
              onChange={(port) => update({ port })}
              className={`${inputCls(viewDensity)} w-24 ${invalid.has("port") ? inputErrorCls : ""}`}
            />
          </HoverTooltip>
        </FieldRow>

        {/* Body type — Plain vs XML.
            When Plain is selected, Parse Multipart and Include Metadata are
            disabled (greyed out), matching the Java UI behaviour. */}
        <FieldRow label="Body:">
          <RadioGroup
            name="xmlBody"
            value={props.xmlBody ? "xml" : "plain"}
            onChange={(v) => update({ xmlBody: v === "xml" })}
            options={[
              { label: "Plain Text", value: "plain" },
              { label: "XML", value: "xml" },
            ]}
            title="If Plain Body is selected, the request body will be sent to the channel as a raw string. If XML Body is selected, the request body will be sent to the channel as serialized XML."
          />
        </FieldRow>

        <FieldRow label="Parse Multipart:">
          <RadioGroup
            name="parseMultipart"
            value={props.parseMultipart ? "yes" : "no"}
            onChange={(v) => update({ parseMultipart: v === "yes" })}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            disabled={plainBody}
            title="Select Yes to automatically parse multipart requests into separate XML nodes. Select No to always keep the request body as a single XML node."
          />
        </FieldRow>

        <FieldRow label="Include Metadata:">
          <RadioGroup
            name="includeMetadata"
            value={props.includeMetadata ? "yes" : "no"}
            onChange={(v) => update({ includeMetadata: v === "yes" })}
            options={[
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ]}
            disabled={plainBody}
            title="Select Yes to include request metadata (method, context path, headers, query parameters) in the XML content. Note that regardless of this setting, the same metadata is always available in the source map."
          />
        </FieldRow>

        {/* Binary MIME types — text field + regex toggle */}
        <FieldRow label="Binary MIME Types:">
          <div className="flex flex-col gap-1.5">
            <HoverTooltip content="When a response comes in with a Content-Type header that matches one of these entries, the content will be encoded into a Base64 string. If Regular Expression is unchecked, specify multiple entries with commas. Otherwise, enter a valid regular expression to match MIME types against.">
              <input
                type="text"
                value={props.binaryMimeTypes}
                onChange={(e) => update({ binaryMimeTypes: e.target.value })}
                className={`${inputCls(viewDensity)} w-96 font-mono text-xs`}
              />
            </HoverTooltip>
            <RadioGroup
              name="binaryMimeTypesRegex"
              value={props.binaryMimeTypesRegex ? "regex" : "literal"}
              onChange={(v) => update({ binaryMimeTypesRegex: v === "regex" })}
              options={[
                { label: "Regular Expression", value: "regex" },
                { label: "Literal", value: "literal" },
              ]}
              title="When a response comes in with a Content-Type header that matches one of these entries, the content will be encoded into a Base64 string. If Regular Expression is unchecked, specify multiple entries with commas. Otherwise, enter a valid regular expression to match MIME types against."
            />
          </div>
        </FieldRow>

        {/* Context path and timeout */}
        <FieldRow label="Context Path:">
          <HoverTooltip content="The context path for the HTTP Listener URL.">
            <input
              type="text"
              value={props.contextPath}
              onChange={(e) => update({ contextPath: e.target.value })}
              className={`${inputCls(viewDensity)} w-64`}
              placeholder="/"
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label={securesTransport ? "HTTPS URL:" : "HTTP URL:"}>
          <HoverTooltip content="Displays the generated HTTP URL for the HTTP Listener.">
            <input
              type="text"
              readOnly
              value={(() => {
                // Mirrors Java HttpListener.updateHttpUrl(): scheme is https when
                // the SSL plugin secures the transport, host is the connected
                // server's host, port is the listener port.
                const scheme = securesTransport ? "https" : "http";
                const host = mounted ? resolveServerHost() : "<server ip>";
                const port = props.port;
                const path = props.contextPath;
                const sep = path.startsWith("/") ? "" : "/";
                const trail = path.trim() !== "" && !path.endsWith("/") ? "/" : "";
                return `${scheme}://${host}:${port}${sep}${path}${trail}`;
              })()}
              className={`${inputCls(viewDensity)} w-96 text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 cursor-default select-all`}
            />
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Timeout (ms):">
          <HoverTooltip content="Enter the maximum idle time in milliseconds for a connection.">
            <VariableOrNumberInput
              min={0}
              value={props.timeout}
              onChange={(timeout) => update({ timeout })}
              className={`${inputCls(viewDensity)} w-32`}
            />
          </HoverTooltip>
          <span className="text-xs text-gray-500 dark:text-gray-400">(0 = no timeout)</span>
        </FieldRow>

        <FieldRow label="Request Header Size (bytes):">
          <HoverTooltip content="The maximum total size in bytes of all HTTP request headers combined. Jetty's default is 8192 (8 KB). Increase this value when clients send large headers such as mTLS certificate chains forwarded by an AWS ALB (e.g., X-Amzn-Mtls-Clientcert-Chain). 32768 (32 KB) covers most mTLS use cases.">
            <VariableOrNumberInput
              min={1}
              value={props.requestHeaderSize}
              onChange={(requestHeaderSize) => update({ requestHeaderSize })}
              className={`${inputCls(viewDensity)} w-32`}
            />
          </HoverTooltip>
        </FieldRow>
      </SettingsSection>

      {/* ── Response Settings ──────────────────────────────────────────────── */}

      <SettingsSection
        title="Response Settings"
        icon={Reply}
        defaultExpanded={true}
        storageKey="bl-http-listener-response"
        summary={
          <>
            <SummaryChip label="Type" value={props.responseContentType} />
            <SummaryChip label="Status" value={props.responseStatusCode || "200"} />
          </>
        }
      >
        <FieldRow label="Content Type:">
          <HoverTooltip content="The MIME type to be used for the response.">
            <input
              type="text"
              value={props.responseContentType}
              onChange={(e) => update({ responseContentType: e.target.value })}
              className={`${inputCls(viewDensity)} w-52`}
              placeholder="text/plain"
            />
          </HoverTooltip>
        </FieldRow>

        {/* Data Type — Text vs Binary.
            When Binary, charset is disabled (greyed out). */}
        <FieldRow label="Data Type:">
          <RadioGroup
            name="responseDataTypeBinary"
            value={props.responseDataTypeBinary ? "binary" : "text"}
            onChange={(v) => {
              const binary = v === "binary";
              update({
                responseDataTypeBinary: binary,
                ...(binary ? { charset: "DEFAULT_ENCODING" } : {}),
              });
            }}
            options={[
              { label: "Text", value: "text" },
              { label: "Binary", value: "binary" },
            ]}
            title="If Binary is selected, responses will be decoded from Base64 into raw byte streams. If Text is selected, responses will be encoded with the specified character set encoding."
          />
        </FieldRow>

        <FieldRow label="Charset:">
          <HoverTooltip content="Select the character set encoding to be used for the response to the sending system. Set to Default to assume the default character set encoding for the JVM running BridgeLink.">
            <select
              value={props.charset}
              onChange={(e) => update({ charset: e.target.value })}
              className={selectCls(viewDensity)}
              disabled={charsetDisabled}
            >
              {buildCharsetOptions(serverCharsets, props.charset).map(({ label, value }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </HoverTooltip>
        </FieldRow>

        <FieldRow label="Response Status Code:">
          <HoverTooltip content='Enter the status code for the HTTP response. If this field is left blank a default status code of 200 will be returned for a successful message, and 500 will be returned for an errored message. If a "Respond from" value is chosen, that response will be used to determine a successful or errored response.'>
            <input
              type="text"
              value={props.responseStatusCode}
              onChange={(e) => update({ responseStatusCode: e.target.value })}
              className={`${inputCls(viewDensity)} w-32`}
              placeholder="e.g. 200"
            />
          </HoverTooltip>
        </FieldRow>

        {/* Response Headers — two modes: table vs map variable */}
        <FieldRow label="Response Headers:">
          <RadioGroup
            name="useResponseHeadersVariable"
            value={props.useResponseHeadersVariable ? "variable" : "table"}
            onChange={(v) => update({ useResponseHeadersVariable: v === "variable" })}
            options={[
              { label: "Specify headers", value: "table" },
              { label: "Use map variable", value: "variable" },
            ]}
            title="Select 'Specify headers' to use the table below to populate response headers. Select 'Use map variable' to use a Java map variable with String keys and either String or List values."
          />
        </FieldRow>

        {props.useResponseHeadersVariable ? (
          /* Variable name field */
          <FieldRow label="Headers Variable:">
            <HoverTooltip content="The variable of a Java map to use to populate response headers. The map must have String keys and either String or List<String> values.">
              <input
                type="text"
                value={props.responseHeadersVariable}
                onChange={(e) => update({ responseHeadersVariable: e.target.value })}
                className={`${inputCls(viewDensity)} w-52`}
                placeholder="Variable name"
              />
            </HoverTooltip>
          </FieldRow>
        ) : (
          /* Inline header table */
          <FieldRow label="Headers:">
            <div className="w-full space-y-1.5">
              {headers.length > 0 && (
                <div className="grid grid-cols-[1fr_1fr_1.5rem] gap-2 px-1 mb-0.5">
                  <span className={`${colHeaderCls} min-w-0 truncate`}>Name</span>
                  <span className={`${colHeaderCls} min-w-0 truncate`}>Value</span>
                  <span />
                </div>
              )}
              {headers.map((h, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_1.5rem] gap-2 items-center">
                  <input
                    type="text"
                    value={h.key}
                    onChange={(e) => {
                      const next = headers.map((r, i) =>
                        i === idx ? { ...r, key: e.target.value } : r
                      );
                      update({ responseHeadersXml: headersToXml(next) });
                    }}
                    placeholder="Header name"
                    className={`${inputCls(viewDensity)} w-full min-w-0`}
                  />
                  <input
                    type="text"
                    value={h.value}
                    onChange={(e) => {
                      const next = headers.map((r, i) =>
                        i === idx ? { ...r, value: e.target.value } : r
                      );
                      update({ responseHeadersXml: headersToXml(next) });
                    }}
                    placeholder="Value"
                    className={`${inputCls(viewDensity)} w-full min-w-0`}
                  />
                  <HoverTooltip content="Remove">
                    <button
                      onClick={() => {
                        update({
                          responseHeadersXml: headersToXml(headers.filter((_, i) => i !== idx)),
                        });
                      }}
                      className={delBtnCls}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </HoverTooltip>
                </div>
              ))}
              <button
                onClick={() => {
                  update({
                    responseHeadersXml: headersToXml([...headers, { key: "", value: "" }]),
                  });
                }}
                className={addBtnCls}
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
          </FieldRow>
        )}
      </SettingsSection>

      {/* ── Static Resources ───────────────────────────────────────────────── */}

      <SettingsSection
        title="Static Resources"
        icon={FolderOpen}
        defaultExpanded={false}
        storageKey="bl-http-listener-static"
        summary={
          <SummaryChip
            value={
              staticResources.length === 0
                ? "None"
                : `${staticResources.length} resource${staticResources.length > 1 ? "s" : ""}`
            }
          />
        }
      >
        <FieldRow label="Resources:">
          <div className="w-full space-y-1.5">
            {staticResources.length > 0 && (
              <div className="grid grid-cols-[1fr_6.5rem_1fr_1fr_1.5rem] gap-2 px-1 mb-0.5">
                <span className={`${colHeaderCls} min-w-0 truncate`}>Context Path</span>
                <span className={`${colHeaderCls} min-w-0 truncate`}>Type</span>
                <span className={`${colHeaderCls} min-w-0 truncate`}>Value</span>
                <span className={`${colHeaderCls} min-w-0 truncate`}>Content Type</span>
                <span />
              </div>
            )}
            {staticResources.map((r, idx) => {
              const cpError = contextPathErrors[idx];
              return (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_6.5rem_1fr_1fr_1.5rem] gap-2 items-start"
                >
                  {/* Context path — composite prefix+input with validation (HTTP-S-2) */}
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <HoverTooltip content="The context path that serves this resource. Must be unique per resource.">
                      <div
                        className={`flex items-center overflow-hidden rounded border ${
                          cpError ? "border-red-500 dark:border-red-400" : "border-border"
                        } bg-white dark:bg-gray-800 ${densityHeight(viewDensity)}`}
                      >
                        {props.contextPath && (
                          <span className="shrink-0 select-none self-stretch flex items-center px-1.5 text-xs text-gray-400 dark:text-gray-500 border-r border-border bg-gray-50 dark:bg-gray-700/50">
                            {props.contextPath}
                          </span>
                        )}
                        <input
                          type="text"
                          value={r.contextPath}
                          onChange={(e) => {
                            const next = staticResources.map((s, i) =>
                              i === idx ? { ...s, contextPath: e.target.value } : s
                            );
                            update({ staticResourcesXml: staticResourcesToXml(next) });
                            setContextPathErrors((prev) => {
                              const n = { ...prev };
                              delete n[idx];
                              return n;
                            });
                          }}
                          onBlur={() => {
                            const normalized = fixContextPath(r.contextPath);
                            const err = validateContextPath(normalized, idx);
                            const next = staticResources.map((s, i) =>
                              i === idx ? { ...s, contextPath: normalized } : s
                            );
                            update({ staticResourcesXml: staticResourcesToXml(next) });
                            setContextPathErrors((prev) =>
                              err
                                ? { ...prev, [idx]: err }
                                : Object.fromEntries(
                                    Object.entries(prev).filter(([k]) => Number(k) !== idx)
                                  )
                            );
                          }}
                          placeholder="/path"
                          className="flex-1 min-w-0 px-1.5 text-sm bg-transparent focus:outline-none text-gray-900 dark:text-gray-100"
                        />
                      </div>
                    </HoverTooltip>
                    {cpError && <p className={fieldErrorMsgCls}>{cpError}</p>}
                  </div>

                  <HoverTooltip content="How the resource value is interpreted: a single file, a directory, or custom content.">
                    <select
                      value={r.resourceType}
                      onChange={(e) => {
                        const next = staticResources.map((s, i) =>
                          i === idx ? { ...s, resourceType: e.target.value as ResourceType } : s
                        );
                        update({ staticResourcesXml: staticResourcesToXml(next) });
                      }}
                      className={`${selectCls(viewDensity)} w-full min-w-0`}
                    >
                      {RESOURCE_TYPES.map(({ label, value }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </HoverTooltip>

                  {/* Value — "Edit…" button for CUSTOM, plain input for FILE/DIRECTORY (HTTP-S-3) */}
                  {r.resourceType === "CUSTOM" ? (
                    <HoverTooltip content="Click to open the custom content editor.">
                      <button
                        type="button"
                        onClick={() => setCustomValueEdit({ idx, draft: r.value })}
                        className={`${inputCls(viewDensity)} w-full min-w-0 text-left truncate ${
                          r.value
                            ? "text-gray-900 dark:text-gray-100"
                            : "text-gray-400 dark:text-gray-500"
                        }`}
                      >
                        {r.value || "Edit content…"}
                      </button>
                    </HoverTooltip>
                  ) : (
                    <HoverTooltip content="The file path or directory path for this resource.">
                      <input
                        type="text"
                        value={r.value}
                        onChange={(e) => {
                          const next = staticResources.map((s, i) =>
                            i === idx ? { ...s, value: e.target.value } : s
                          );
                          update({ staticResourcesXml: staticResourcesToXml(next) });
                        }}
                        placeholder="File/directory path"
                        className={`${inputCls(viewDensity)} w-full min-w-0`}
                      />
                    </HoverTooltip>
                  )}

                  <HoverTooltip content="The Content-Type header returned when serving this resource.">
                    <input
                      type="text"
                      value={r.contentType}
                      onChange={(e) => {
                        const next = staticResources.map((s, i) =>
                          i === idx ? { ...s, contentType: e.target.value } : s
                        );
                        update({ staticResourcesXml: staticResourcesToXml(next) });
                      }}
                      placeholder="text/plain"
                      className={`${inputCls(viewDensity)} w-full min-w-0`}
                    />
                  </HoverTooltip>

                  <HoverTooltip content="Remove">
                    <button
                      onClick={() => {
                        update({
                          staticResourcesXml: staticResourcesToXml(
                            staticResources.filter((_, i) => i !== idx)
                          ),
                        });
                        setContextPathErrors((prev) => {
                          const n = { ...prev };
                          delete n[idx];
                          return n;
                        });
                      }}
                      className={`${delBtnCls} self-center`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </HoverTooltip>
                </div>
              );
            })}
            <button
              onClick={() => {
                update({
                  staticResourcesXml: staticResourcesToXml([
                    ...staticResources,
                    {
                      contextPath: firstUnusedStaticResourcePath(staticResources),
                      resourceType: "FILE",
                      value: "",
                      contentType: "text/plain",
                    },
                  ]),
                });
              }}
              className={addBtnCls}
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
        </FieldRow>
      </SettingsSection>

      {/* HTTP-S-3: Custom Value editor dialog */}
      <FormDialog
        open={customValueEdit !== null}
        onOpenChange={(o) => {
          if (!o) setCustomValueEdit(null);
        }}
        title="Custom Value"
        submitLabel="OK"
        maxWidth="sm:max-w-2xl"
        onSubmit={() => {
          if (customValueEdit === null) return;
          const next = staticResources.map((s, i) =>
            i === customValueEdit.idx ? { ...s, value: customValueEdit.draft } : s
          );
          update({ staticResourcesXml: staticResourcesToXml(next) });
          setCustomValueEdit(null);
        }}
      >
        <ResizableEditorBox className="overflow-hidden rounded border border-border" height={400}>
          <MonacoEditor
            language="plaintext"
            value={customValueEdit?.draft ?? ""}
            onChange={(v) =>
              setCustomValueEdit((prev) => (prev ? { ...prev, draft: v ?? "" } : prev))
            }
            theme={isDark ? "vs-dark" : "light"}
            height="100%"
            width="100%"
            options={{
              ...MONACO_BASE_OPTIONS,
            }}
          />
        </ResizableEditorBox>
      </FormDialog>
    </>
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────
//
// HTTP Listener is a persistent listener (no polling), so there is no TopSection.
// The SSL Settings plugin section is rendered automatically by SslSettingsPlugin
// in PLUGIN_REGISTRY when the SSL plugin XML is detected in pluginProperties.

export const HttpListenerConnector: ConnectorDefinition = {
  BottomSection: HttpListenerBottomSection,
  defaultPropertiesXml: DEFAULT_HTTP_LISTENER_PROPERTIES_XML,
  getRequiredInboundDataType(propertiesXml) {
    return parseHttpListenerPropsFromXml(propertiesXml).xmlBody ? "XML" : null;
  },
  validate(propertiesXml) {
    if (!propertiesXml) return [];
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const txt = (tag: string) => doc.querySelector(tag)?.textContent?.trim() ?? "";
    const errors: import("./shared/validate-utils").ValidationError[] = [];

    const timeout = txt("timeout");
    if (!timeout || !isNumberOrVariable(timeout))
      errors.push({ field: "timeout", message: "Timeout is required." });

    const headerSize = txt("requestHeaderSize");
    if (!headerSize || !isNumberOrVariable(headerSize) || Number(headerSize) <= 0)
      errors.push({
        field: "requestHeaderSize",
        message: "Request Header Size must be a positive integer.",
      });

    const responseVariable = txt("responseVariable");
    if (
      responseVariable &&
      responseVariable.toLowerCase() !== "none" &&
      !txt("responseContentType")
    )
      errors.push({
        field: "responseContentType",
        message: "Response Content Type is required when a Respond From destination is configured.",
      });

    if (txt("useResponseHeadersVariable") === "true" && !txt("responseHeadersVariable"))
      errors.push({
        field: "responseHeadersVariable",
        message: "Headers Variable is required when Use Map is selected.",
      });

    return errors;
  },
};
