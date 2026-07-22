"use client";

/**
 * HTTP Authentication plugin for BridgeLink source connectors.
 *
 * Corresponds to the `httpauth` built-in plugin that injects an
 * "HTTP Authentication" panel into HTTP Listener and WebService Listener
 * source connectors.
 *
 * The plugin stores its settings inside the connector's <pluginProperties>
 * element using the fully-qualified class name as the XML tag, one element
 * per auth type:
 *
 *   <pluginProperties>
 *     <com.mirth.connect.plugins.httpauth.NoneHttpAuthProperties version="4.6.0">
 *       <authType>NONE</authType>
 *     </com.mirth.connect.plugins.httpauth.NoneHttpAuthProperties>
 *   </pluginProperties>
 *
 * Unlike the SSL plugin (which is optional), the HTTP auth plugin is always
 * present in HTTP Listener and WebService Listener channels — the default XML
 * always includes NoneHttpAuthProperties. This plugin is therefore always
 * applicable for those two transport types (no XML-detection needed).
 *
 * All XML parsing/serialization logic lives in channel-xml.ts so it can be
 * tested independently of React.
 */

import { useMemo, useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { SettingsSection, FieldRow, SummaryChip } from "@/components/settings/settings-section";
import { HoverTooltip } from "@/components/hover-tooltip";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { ConnectorPluginDefinition, ConnectorSectionProps } from "../types";
import { RadioGroup } from "../shared/radio-group";
import { inputCls, selectCls, inputErrorCls } from "../shared/styles";
import { SecretInput } from "@/components/ui/secret-input";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import {
  type HttpAuthType,
  type HttpAuthState,
  type HttpAuthCredential,
  HTTPAUTH_ALL_TAGS,
  HTTPAUTH_DEFAULT_JS_SCRIPT,
  httpAuthDefaultForType,
  httpAuthIsDefault,
  parseHttpAuthFromXml,
  updateHttpAuthInXml,
} from "@/app/(app)/channels/_lib/channel-xml";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { useTheme } from "@/lib/hooks/use-theme";
import { type BeforeMount } from "@monaco-editor/react";
import { MonacoEditor } from "@/components/monaco-editor";
import { ResizableEditorBox } from "@/components/resizable-editor-box";
import { getRhinoEditorOptions } from "@/lib/monaco-defaults";
import {
  RHINO_LANG_ID,
  registerRhinoLanguage,
  setEditorContext,
  clearEditorContextIfMatches,
} from "@/lib/monaco-rhino";
import { attachRhinoValidation } from "@/lib/monaco-rhino-validation";
import { PluginEditorOverlay } from "@/components/plugin-editor-overlay";
import { useEditorAiSeam } from "@/lib/hooks/use-editor-ai-seam";
import { type EditorContext } from "@/lib/plugin-registry";
import { tryParseJs } from "@/lib/js-validation";
import type { ValidationError } from "../shared/validate-utils";
import { cn } from "@/lib/utils";
import { fieldErrorMsgCls } from "../shared/styles";

// ─── Digest algorithm radio (mirrors Java's 3-way ButtonGroup) ─────────────────

type DigestAlgo = "BOTH" | "MD5" | "MD5_SESS";

/**
 * Derive the single radio selection from the two underlying algorithm flags.
 * Mirrors Java HttpAuthConnectorPropertiesPanel.setProperties (lines 240-246):
 * both → "Both", only MD5 → "MD5", only MD5-sess → "MD5-sess". A legacy
 * "neither" state (no Java analog) falls back to "Both".
 */
export function digestAlgoValue(algoMD5: boolean, algoMD5sess: boolean): DigestAlgo {
  if (algoMD5 && algoMD5sess) return "BOTH";
  if (algoMD5sess) return "MD5_SESS";
  if (algoMD5) return "MD5";
  return "BOTH";
}

/** Map the radio selection back to the two algorithm flags. */
export function digestAlgoFlags(value: DigestAlgo): { algoMD5: boolean; algoMD5sess: boolean } {
  switch (value) {
    case "MD5":
      return { algoMD5: true, algoMD5sess: false };
    case "MD5_SESS":
      return { algoMD5: false, algoMD5sess: true };
    case "BOTH":
    default:
      return { algoMD5: true, algoMD5sess: true };
  }
}

// ─── Validation (mirrors Java HttpAuthConnectorPropertiesPanel.checkProperties) ──

/**
 * Validate an HTTP auth state per auth type, mirroring the Java client's
 * `checkProperties` (HttpAuthConnectorPropertiesPanel.java:329-399):
 *   - Basic/Digest: realm required; at least one credential, or a credentials
 *     map variable when "Use map variable" is selected.
 *   - Custom: authenticator class required.
 *   - OAuth2: location key and verification URL required.
 * The JavaScript case (which Java does not validate) keeps the WebUI's existing
 * script-parse check as a harmless superset.
 */
export function validateHttpAuth(state: HttpAuthState): ValidationError[] {
  const errors: ValidationError[] = [];
  switch (state.authType) {
    case "BASIC":
    case "DIGEST": {
      if (state.realm.trim() === "") {
        errors.push({ field: "realm", message: "Realm is required." });
      }
      const credentialsInvalid = state.isUseCredentialsVariable
        ? state.credentialsVariable.trim() === ""
        : state.credentials.length === 0;
      if (credentialsInvalid) {
        errors.push({
          field: "credentials",
          message: state.isUseCredentialsVariable
            ? "A credentials map variable is required."
            : "At least one credential is required, or use a credentials map variable.",
        });
      }
      break;
    }
    case "CUSTOM":
      if (state.authenticatorClass.trim() === "") {
        errors.push({
          field: "authenticatorClass",
          message: "An authenticator class is required.",
        });
      }
      break;
    case "OAUTH2_VERIFICATION":
      if (state.locationKey.trim() === "") {
        errors.push({ field: "locationKey", message: "A location key is required." });
      }
      if (state.verificationURL.trim() === "") {
        errors.push({ field: "verificationURL", message: "A verification URL is required." });
      }
      break;
    case "JAVASCRIPT": {
      const err = tryParseJs(state.script);
      if (err) errors.push({ field: "script", message: err });
      break;
    }
  }
  return errors;
}

// ─── Applicable transports ────────────────────────────────────────────────────

const HTTPAUTH_TRANSPORTS = new Set(["HTTP Listener", "WebService Listener"]);

// ─── Shared styles ────────────────────────────────────────────────────────────

const addBtnCls =
  "inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded border border-dashed " +
  "border-border text-gray-500 dark:text-gray-400 " +
  "hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 " +
  "hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors";

const delBtnCls =
  "flex items-center justify-center w-6 h-6 rounded text-gray-400 " +
  "hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors";

const colHeaderCls = "text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide";

// ─── CredentialsTable — shared by Basic and Digest ───────────────────────────

interface CredentialsTableProps {
  isUseVariable: boolean;
  credentialsVariable: string;
  credentials: HttpAuthCredential[];
  /** True when credentials failed validation — highlights the input/table. */
  invalid?: boolean;
  onUseVariableChange: (v: boolean) => void;
  onVariableChange: (v: string) => void;
  onCredentialsChange: (creds: HttpAuthCredential[]) => void;
}

function CredentialsTable({
  isUseVariable,
  credentialsVariable,
  credentials,
  invalid,
  onUseVariableChange,
  onVariableChange,
  onCredentialsChange,
}: CredentialsTableProps) {
  const { viewDensity } = useCompactMode();
  return (
    <>
      <FieldRow label="Credentials:">
        <RadioGroup
          name="credentialsSource"
          value={isUseVariable ? "variable" : "table"}
          onChange={(v) => onUseVariableChange(v === "variable")}
          options={[
            { label: "Specify credentials", value: "table" },
            { label: "Use map variable", value: "variable" },
          ]}
          title="Select 'Specify credentials' to define valid credentials in the table below. Select 'Use map variable' to supply a Map<String, String> variable at runtime (keys = usernames, values = passwords)."
        />
      </FieldRow>

      {isUseVariable ? (
        <FieldRow label="Credentials Variable:">
          <div>
            <HoverTooltip content="The name of a Map<String, String> variable where keys are usernames and values are passwords.">
              <input
                type="text"
                value={credentialsVariable}
                onChange={(e) => onVariableChange(e.target.value)}
                className={`${inputCls(viewDensity)} w-52 ${invalid ? inputErrorCls : ""}`}
                placeholder="Variable name"
              />
            </HoverTooltip>
            {invalid && <p className={fieldErrorMsgCls}>A credentials map variable is required.</p>}
          </div>
        </FieldRow>
      ) : (
        <FieldRow label="Credentials:">
          <div className="w-full space-y-1.5">
            {credentials.length > 0 && (
              <div className="grid grid-cols-[1fr_1fr_1.5rem] gap-2 px-1 mb-0.5">
                <span className={colHeaderCls}>Username</span>
                <span className={colHeaderCls}>Password</span>
                <span />
              </div>
            )}
            {credentials.map((c, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_1fr_1.5rem] gap-2 items-center">
                <input
                  type="text"
                  value={c.user}
                  onChange={(e) =>
                    onCredentialsChange(
                      credentials.map((r, i) => (i === idx ? { ...r, user: e.target.value } : r))
                    )
                  }
                  placeholder="Username"
                  className={inputCls(viewDensity)}
                />
                <SecretInput
                  value={c.pass}
                  onChange={(e) =>
                    onCredentialsChange(
                      credentials.map((r, i) => (i === idx ? { ...r, pass: e.target.value } : r))
                    )
                  }
                  placeholder="Password"
                  className={inputCls(viewDensity)}
                />
                <HoverTooltip content="Remove">
                  <button
                    onClick={() => onCredentialsChange(credentials.filter((_, i) => i !== idx))}
                    className={delBtnCls}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </HoverTooltip>
              </div>
            ))}
            <button
              onClick={() => onCredentialsChange([...credentials, { user: "", pass: "" }])}
              className={addBtnCls}
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
            {invalid && (
              <p className={fieldErrorMsgCls}>
                At least one credential is required, or use a credentials map variable.
              </p>
            )}
          </div>
        </FieldRow>
      )}
    </>
  );
}

// ─── Auth-type display labels ─────────────────────────────────────────────────

const AUTH_TYPE_LABELS: Record<HttpAuthType, string> = {
  NONE: "None",
  BASIC: "Basic Authentication",
  DIGEST: "Digest Authentication",
  JAVASCRIPT: "JavaScript",
  CUSTOM: "Custom Java Class",
  OAUTH2_VERIFICATION: "OAuth 2.0 Token Verification",
};

// ─── Section component ────────────────────────────────────────────────────────

function HttpAuthSection({
  propertiesXml,
  onChange,
  transportName,
  channelName,
  invalidFields,
  channelId = "",
}: ConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const { isDark } = useTheme();
  const xml = propertiesXml ?? "";
  const state = parseHttpAuthFromXml(propertiesXml);

  // AI seam — orb + Explain/Generate/Fix actions, JavaScript auth type only.
  const seam = useEditorAiSeam(state.authType === "JAVASCRIPT");
  const aiContext = useMemo<EditorContext>(
    () => ({
      location: "connector-script",
      isSource: true,
      channelId,
      channelName,
      connectorType: transportName,
    }),
    [channelId, channelName, transportName]
  );

  const storeMonaco: BeforeMount = (monaco) => {
    registerRhinoLanguage(monaco);
  };

  const storageKey = transportName
    ? `bl-auth-${transportName.toLowerCase().replace(/ /g, "-")}`
    : undefined;

  const authSummary = <SummaryChip label="Auth" value={state.authType} />;
  const [pendingType, setPendingType] = useState<HttpAuthType | null>(null);

  function update(newState: HttpAuthState) {
    onChange({ propertiesXml: updateHttpAuthInXml(xml, newState) });
  }

  function handleTypeChange(newType: HttpAuthType) {
    if (newType === state.authType) return;
    // Mirrors Java authTypeChanged(): confirm before discarding non-default settings.
    if (!httpAuthIsDefault(state)) {
      setPendingType(newType);
      return;
    }
    update(httpAuthDefaultForType(newType));
  }

  return (
    <SettingsSection
      title="HTTP Authentication"
      icon={KeyRound}
      defaultExpanded={false}
      storageKey={storageKey}
      summary={authSummary}
    >
      {pendingType && (
        <ConfirmDialog
          title="Change Authentication Type"
          description="The current HTTP authentication properties will be lost. Are you sure you want to continue?"
          confirmLabel="Continue"
          confirmVariant="default"
          onConfirm={() => {
            update(httpAuthDefaultForType(pendingType));
            setPendingType(null);
          }}
          onCancel={() => setPendingType(null)}
        />
      )}

      {/* Authentication Type — always shown */}
      <FieldRow label="Authentication Type:">
        <HoverTooltip content="Select the type of HTTP authentication to use to protect this endpoint.">
          <select
            value={state.authType}
            onChange={(e) => handleTypeChange(e.target.value as HttpAuthType)}
            className={selectCls(viewDensity)}
          >
            {HTTPAUTH_ALL_TAGS.map(({ type }) => (
              <option key={type} value={type}>
                {AUTH_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </HoverTooltip>
      </FieldRow>

      {/* ── Basic Authentication ─────────────────────────────────────────────── */}

      {state.authType === "BASIC" && (
        <>
          <FieldRow label="Realm:">
            <div>
              <HoverTooltip content="The realm of the HTTP Basic authentication request.">
                <input
                  type="text"
                  value={state.realm}
                  onChange={(e) => update({ ...state, realm: e.target.value })}
                  className={`${inputCls(viewDensity)} w-52 ${invalidFields?.has("realm") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
              {invalidFields?.has("realm") && (
                <p className={fieldErrorMsgCls}>Realm is required.</p>
              )}
            </div>
          </FieldRow>
          <CredentialsTable
            isUseVariable={state.isUseCredentialsVariable}
            credentialsVariable={state.credentialsVariable}
            credentials={state.credentials}
            invalid={invalidFields?.has("credentials")}
            onUseVariableChange={(v) => update({ ...state, isUseCredentialsVariable: v })}
            onVariableChange={(v) => update({ ...state, credentialsVariable: v })}
            onCredentialsChange={(creds) => update({ ...state, credentials: creds })}
          />
        </>
      )}

      {/* ── Digest Authentication ────────────────────────────────────────────── */}

      {state.authType === "DIGEST" && (
        <>
          <FieldRow label="Realm:">
            <div>
              <HoverTooltip content="The realm of the HTTP Digest authentication request.">
                <input
                  type="text"
                  value={state.realm}
                  onChange={(e) => update({ ...state, realm: e.target.value })}
                  className={`${inputCls(viewDensity)} w-52 ${invalidFields?.has("realm") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
              {invalidFields?.has("realm") && (
                <p className={fieldErrorMsgCls}>Realm is required.</p>
              )}
            </div>
          </FieldRow>

          <FieldRow label="Algorithms:">
            <RadioGroup
              name="digestAlgorithm"
              value={digestAlgoValue(state.algoMD5, state.algoMD5sess)}
              onChange={(v) => update({ ...state, ...digestAlgoFlags(v as DigestAlgo) })}
              options={[
                { label: "Both", value: "BOTH" },
                { label: "MD5", value: "MD5" },
                { label: "MD5-sess", value: "MD5_SESS" },
              ]}
              title="The digest algorithm(s) the server will accept. 'Both' accepts MD5 and MD5-sess."
            />
          </FieldRow>

          <FieldRow label="QOP:">
            <div className="flex items-center gap-4">
              <FormCheckbox
                label="auth"
                checked={state.qopAuth}
                onChange={(v) => update({ ...state, qopAuth: v })}
              />
              <FormCheckbox
                label="auth-int"
                checked={state.qopAuthInt}
                onChange={(v) => update({ ...state, qopAuthInt: v })}
              />
            </div>
          </FieldRow>

          <FieldRow label="Opaque:">
            <HoverTooltip content="An opaque value to include in Digest authentication challenges.">
              <input
                type="text"
                value={state.opaque}
                onChange={(e) => update({ ...state, opaque: e.target.value })}
                className={`${inputCls(viewDensity)} w-80`}
              />
            </HoverTooltip>
          </FieldRow>

          <CredentialsTable
            isUseVariable={state.isUseCredentialsVariable}
            credentialsVariable={state.credentialsVariable}
            credentials={state.credentials}
            invalid={invalidFields?.has("credentials")}
            onUseVariableChange={(v) => update({ ...state, isUseCredentialsVariable: v })}
            onVariableChange={(v) => update({ ...state, credentialsVariable: v })}
            onCredentialsChange={(creds) => update({ ...state, credentials: creds })}
          />
        </>
      )}

      {/* ── JavaScript ───────────────────────────────────────────────────────── */}

      {state.authType === "JAVASCRIPT" && (
        <FieldRow label="Script:">
          <HoverTooltip content="JavaScript code that runs to authenticate inbound requests. Return AuthenticationResult.Success() to allow the request, or AuthenticationResult.Failure() to reject it.">
            <ResizableEditorBox
              className={cn(
                "w-full rounded border overflow-hidden",
                invalidFields?.has("script")
                  ? "border-red-500 dark:border-red-400"
                  : "border-border"
              )}
              height={192}
            >
              <MonacoEditor
                language={RHINO_LANG_ID}
                value={state.script}
                onChange={(v) => update({ ...state, script: v ?? "" })}
                theme={isDark ? "mirth-js-dark" : "mirth-js"}
                height="100%"
                beforeMount={storeMonaco}
                onMount={(editor, monaco) => {
                  // Real-time JS syntax validation (squiggles + hover tooltips) via the shared
                  // acorn parser. Self-cleans on dispose.
                  attachRhinoValidation(editor, monaco);
                  const uri = editor.getModel()?.uri.toString();
                  if (uri) {
                    const ctx = { contextType: "SOURCE_RECEIVER" as const, channelId };
                    setEditorContext(uri, ctx);
                    editor.getModel()!.onWillDispose(() => clearEditorContextIfMatches(uri, ctx));
                  }
                  seam.registerEditor(editor, monaco);
                }}
                options={getRhinoEditorOptions({
                  folding: true,
                  suggestOnTriggerCharacters: true,
                })}
              />
            </ResizableEditorBox>
          </HoverTooltip>
          {invalidFields?.has("script") && (
            <p className={fieldErrorMsgCls}>{tryParseJs(state.script) ?? "Invalid JavaScript."}</p>
          )}
          <PluginEditorOverlay
            editorRef={seam.editorRef}
            monacoRef={seam.monacoRef}
            context={aiContext}
          />
        </FieldRow>
      )}

      {/* ── Custom Java Class ────────────────────────────────────────────────── */}

      {state.authType === "CUSTOM" && (
        <>
          <FieldRow label="Authenticator Class:">
            <div>
              <HoverTooltip content="The fully-qualified class name of the custom HTTP authenticator to use.">
                <input
                  type="text"
                  value={state.authenticatorClass}
                  onChange={(e) => update({ ...state, authenticatorClass: e.target.value })}
                  className={`${inputCls(viewDensity)} w-96 ${invalidFields?.has("authenticatorClass") ? inputErrorCls : ""}`}
                  placeholder="com.example.MyAuthenticator"
                />
              </HoverTooltip>
              {invalidFields?.has("authenticatorClass") && (
                <p className={fieldErrorMsgCls}>An authenticator class is required.</p>
              )}
            </div>
          </FieldRow>

          <FieldRow label="Properties:">
            <div className="w-full space-y-1.5">
              {state.properties.length > 0 && (
                <div className="grid grid-cols-[1fr_1fr_1.5rem] gap-2 px-1 mb-0.5">
                  <span className={colHeaderCls}>Name</span>
                  <span className={colHeaderCls}>Value</span>
                  <span />
                </div>
              )}
              {state.properties.map((p, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_1.5rem] gap-2 items-center">
                  <input
                    type="text"
                    value={p.key}
                    onChange={(e) =>
                      update({
                        ...state,
                        properties: state.properties.map((r, i) =>
                          i === idx ? { ...r, key: e.target.value } : r
                        ),
                      })
                    }
                    placeholder="Property name"
                    className={inputCls(viewDensity)}
                  />
                  <input
                    type="text"
                    value={p.val}
                    onChange={(e) =>
                      update({
                        ...state,
                        properties: state.properties.map((r, i) =>
                          i === idx ? { ...r, val: e.target.value } : r
                        ),
                      })
                    }
                    placeholder="Value"
                    className={inputCls(viewDensity)}
                  />
                  <HoverTooltip content="Remove">
                    <button
                      onClick={() =>
                        update({
                          ...state,
                          properties: state.properties.filter((_, i) => i !== idx),
                        })
                      }
                      className={delBtnCls}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </HoverTooltip>
                </div>
              ))}
              <button
                onClick={() =>
                  update({ ...state, properties: [...state.properties, { key: "", val: "" }] })
                }
                className={addBtnCls}
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
          </FieldRow>
        </>
      )}

      {/* ── OAuth 2.0 Token Verification ─────────────────────────────────────── */}

      {state.authType === "OAUTH2_VERIFICATION" && (
        <>
          <FieldRow label="Token Location:">
            <HoverTooltip content="The location in the HTTP request where the OAuth 2.0 bearer token can be found.">
              <select
                value={state.tokenLocation}
                onChange={(e) => update({ ...state, tokenLocation: e.target.value })}
                className={selectCls(viewDensity)}
              >
                <option value="HEADER">Request Header</option>
                <option value="QUERY">Query Parameter</option>
              </select>
            </HoverTooltip>
          </FieldRow>

          <FieldRow label="Location Key:">
            <div>
              <HoverTooltip content="The header name or query parameter name where the OAuth 2.0 bearer token can be found.">
                <input
                  type="text"
                  value={state.locationKey}
                  onChange={(e) => update({ ...state, locationKey: e.target.value })}
                  className={`${inputCls(viewDensity)} w-52 ${invalidFields?.has("locationKey") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
              {invalidFields?.has("locationKey") && (
                <p className={fieldErrorMsgCls}>A location key is required.</p>
              )}
            </div>
          </FieldRow>

          <FieldRow label="Verification URL:">
            <div>
              <HoverTooltip content="The URL used to verify the OAuth 2.0 bearer token.">
                <input
                  type="text"
                  value={state.verificationURL}
                  onChange={(e) => update({ ...state, verificationURL: e.target.value })}
                  className={`${inputCls(viewDensity)} w-96 ${invalidFields?.has("verificationURL") ? inputErrorCls : ""}`}
                  placeholder="https://auth.example.com/token/verify"
                />
              </HoverTooltip>
              {invalidFields?.has("verificationURL") && (
                <p className={fieldErrorMsgCls}>A verification URL is required.</p>
              )}
            </div>
          </FieldRow>
        </>
      )}
    </SettingsSection>
  );
}

// ─── Plugin definition ────────────────────────────────────────────────────────

export const HttpAuthPlugin: ConnectorPluginDefinition = {
  /**
   * HTTP auth is always applicable for HTTP Listener and WebService Listener —
   * the default XML for both transports always includes NoneHttpAuthProperties,
   * so this is not an optional/detected plugin like SSL Settings.
   */
  isApplicable(transportName) {
    return HTTPAUTH_TRANSPORTS.has(transportName);
  },
  validate(propertiesXml): ValidationError[] {
    return validateHttpAuth(parseHttpAuthFromXml(propertiesXml));
  },
  Section: HttpAuthSection,
};

// Re-export the default script constant for use in tests / documentation.
export { HTTPAUTH_DEFAULT_JS_SCRIPT };
