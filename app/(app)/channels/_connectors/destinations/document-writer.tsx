"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileOutput } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import { SettingsSection, FieldRow, FullWidthField } from "@/components/settings/settings-section";
import { useTestConn } from "../shared/use-test-conn";
import { TestConnButton } from "../shared/test-conn-button";
import type { DestinationConnectorDefinition, DestinationConnectorSectionProps } from "./types";
import {
  DEFAULT_DEST_PROPERTIES_XML,
  parseDocumentWriterPropsFromXml,
  updateDocumentWriterPropsInXml,
  withVersion,
  resolveXmlVersion,
  type DocumentWriterProps,
} from "../../_lib/channel-xml";
import { RadioGroup } from "../shared/radio-group";
import { inputCls, selectCls, inputErrorCls, fieldErrorMsgCls } from "../shared/styles";
import { SecretInput } from "@/components/ui/secret-input";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { MonacoEditor } from "@/components/monaco-editor";
import { ResizableEditorBox } from "@/components/resizable-editor-box";
import { MONACO_BASE_OPTIONS } from "@/lib/monaco-defaults";
import type * as Monaco from "monaco-editor";
import { registerMirthDropHandler } from "../shared/monaco-mirth-drop";

const DEFAULT_XML = DEFAULT_DEST_PROPERTIES_XML["Document Writer"]!;

/**
 * Page units, mirroring the Java `com.mirth.connect.connectors.doc.Unit` enum exactly
 * (`INCHES("in"), MM("mm"), TWIPS("twips")`). The labels are the enum's `toString()`
 * values, which is what the Swing combo box displays. Offering any other value (the old
 * WebUI added CM/Points) serializes a `<pageUnit>` that XStream's enum converter cannot
 * deserialize, so the channel PUT fails with an opaque 500.
 */
export const PAGE_UNIT_OPTIONS = [
  { label: "in", value: "INCHES" },
  { label: "mm", value: "MM" },
  { label: "twips", value: "TWIPS" },
] as const;

type PageUnit = "INCHES" | "MM" | "TWIPS";

/**
 * Standard paper sizes, ported verbatim from Java `PageSize.java`. Each preset carries its
 * own native unit; matching and application convert across units the way the Swing client does
 * (`PageSize.getWidth(unit)` → `Unit.convertTo`).
 */
const PAGE_SIZES: { label: string; width: number; height: number; unit: PageUnit }[] = [
  { label: "Letter", width: 8.5, height: 11, unit: "INCHES" },
  { label: "Legal", width: 8.5, height: 14, unit: "INCHES" },
  { label: "Ledger", width: 11, height: 17, unit: "INCHES" },
  { label: "Tabloid", width: 17, height: 11, unit: "INCHES" },
  { label: "Executive", width: 7.25, height: 10.55, unit: "INCHES" },
  { label: "ANSI C", width: 22, height: 17, unit: "INCHES" },
  { label: "ANSI D", width: 34, height: 22, unit: "INCHES" },
  { label: "ANSI E", width: 44, height: 34, unit: "INCHES" },
  { label: "A0", width: 841, height: 1189, unit: "MM" },
  { label: "A1", width: 594, height: 841, unit: "MM" },
  { label: "A2", width: 420, height: 594, unit: "MM" },
  { label: "A3", width: 297, height: 420, unit: "MM" },
  { label: "A4", width: 210, height: 297, unit: "MM" },
  { label: "A5", width: 148, height: 210, unit: "MM" },
  { label: "A6", width: 105, height: 148, unit: "MM" },
  { label: "A7", width: 74, height: 105, unit: "MM" },
  { label: "A8", width: 52, height: 74, unit: "MM" },
  { label: "A9", width: 37, height: 52, unit: "MM" },
  { label: "A10", width: 26, height: 37, unit: "MM" },
  { label: "B0", width: 1000, height: 1414, unit: "MM" },
  { label: "B1", width: 707, height: 1000, unit: "MM" },
  { label: "B2", width: 500, height: 707, unit: "MM" },
  { label: "B3", width: 353, height: 500, unit: "MM" },
  { label: "B4", width: 250, height: 343, unit: "MM" },
  { label: "B5", width: 176, height: 250, unit: "MM" },
  { label: "B6", width: 125, height: 176, unit: "MM" },
  { label: "B7", width: 88, height: 125, unit: "MM" },
  { label: "B8", width: 62, height: 88, unit: "MM" },
  { label: "B9", width: 44, height: 62, unit: "MM" },
  { label: "B10", width: 31, height: 44, unit: "MM" },
];

/** Conversion rates, mirroring Java `Unit.getConversionRate`. */
const UNIT_RATE: Record<PageUnit, Partial<Record<PageUnit, number>>> = {
  INCHES: { MM: 25.4, TWIPS: 1440 },
  MM: { INCHES: 1 / 25.4, TWIPS: 1440 / 25.4 },
  TWIPS: { INCHES: 1 / 1440, MM: 25.4 / 1440 },
};

/** Convert a value between page units, mirroring Java `Unit.convertTo`. */
function convertUnit(value: number, from: PageUnit, to: PageUnit): number {
  if (from === to) return value;
  return (UNIT_RATE[from][to] ?? 1) * value;
}

/** Format a preset dimension like Java `BigDecimal(value).setScale(2, DOWN)` → e.g. "8.50". */
function fmtDim(value: number): string {
  return (Math.trunc(value * 100) / 100).toFixed(2);
}

// ─── Bottom section ───────────────────────────────────────────────────────────

function DocumentWriterBottomSection({
  propertiesXml,
  onChange,
  channelId,
  channelName,
  invalidFields,
  isDark,
}: DestinationConnectorSectionProps) {
  const { viewDensity } = useCompactMode();
  const invalid = invalidFields ?? new Set<string>();
  const propsXml = propertiesXml ?? withVersion(DEFAULT_XML, resolveXmlVersion());
  const [local, setLocal] = useState<DocumentWriterProps>(() =>
    parseDocumentWriterPropsFromXml(propsXml)
  );
  const {
    testing: tcTesting,
    result: tcResult,
    test: tcTest,
  } = useTestConn("doc", "_testWrite", local.host, channelId, channelName, {
    contentType: "text/plain",
  });

  // Template field is always Velocity (never JS), so preferJsRef is always false.
  const preferJsRef = useRef(false);
  const dropCleanupRef = useRef<(() => void) | null>(null);
  const handleMount = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
      dropCleanupRef.current?.();
      dropCleanupRef.current = registerMirthDropHandler(editor, monaco, preferJsRef);
    },
    []
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(
      parseDocumentWriterPropsFromXml(
        propertiesXml ?? withVersion(DEFAULT_XML, resolveXmlVersion())
      )
    );
  }, [propertiesXml]);

  function commit(updated: DocumentWriterProps) {
    setLocal(updated);
    onChange({ propertiesXml: updateDocumentWriterPropsInXml(propsXml, updated) });
  }

  function set<K extends keyof DocumentWriterProps>(key: K, val: DocumentWriterProps[K]) {
    commit({ ...local, [key]: val });
  }

  const fileEnabled = local.output !== "ATTACHMENT";
  const isPdf = local.documentType === "pdf";

  /**
   * Resolved preset label, or "" when the current dimensions don't match any preset.
   * Mirrors Java `updatePageSizeComboBox`: a preset matches when its width/height, converted
   * into the currently-selected unit, equal the entered values. An epsilon guards float noise.
   */
  const curUnit = local.pageUnit as PageUnit;
  const curW = Number(local.pageWidth);
  const curH = Number(local.pageHeight);
  const selectedPreset =
    (!Number.isNaN(curW) &&
      !Number.isNaN(curH) &&
      PAGE_SIZES.find(
        (p) =>
          Math.abs(convertUnit(p.width, p.unit, curUnit) - curW) < 1e-9 &&
          Math.abs(convertUnit(p.height, p.unit, curUnit) - curH) < 1e-9
      )?.label) ||
    "";

  function applyPreset(label: string) {
    const preset = PAGE_SIZES.find((p) => p.label === label);
    if (preset)
      // Java sets the fields via BigDecimal.setScale(2, DOWN) and switches the unit combo to
      // the preset's native unit.
      commit({
        ...local,
        pageWidth: fmtDim(preset.width),
        pageHeight: fmtDim(preset.height),
        pageUnit: preset.unit,
      });
  }

  return (
    <SettingsSection
      title="Document Writer Settings"
      icon={FileOutput}
      defaultExpanded={true}
      storageKey="bl-doc-writer-main"
    >
      {/* Output */}
      <FieldRow label="Output:">
        <RadioGroup
          name="doc-output"
          value={local.output}
          onChange={(v) => set("output", v)}
          options={[
            { label: "File", value: "FILE" },
            { label: "Attachment", value: "ATTACHMENT" },
            { label: "Both", value: "BOTH" },
          ]}
          title="File: write to a file. Attachment: write to an attachment. Both: write to file and attachment."
        />
      </FieldRow>

      {/* Directory + inline Test Write (only for File/Both output) */}
      {fileEnabled && (
        <>
          <FieldRow label="Directory:">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <HoverTooltip content="The directory (folder) where the generated file should be written.">
                  <input
                    type="text"
                    value={local.host}
                    // Mirror Java getProperties() `directoryField.getText().replace('\\', '/')`.
                    onChange={(e) => set("host", e.target.value.replace(/\\/g, "/"))}
                    className={`${inputCls(viewDensity)} flex-1 ${invalid.has("host") ? inputErrorCls : ""}`}
                  />
                </HoverTooltip>
                <TestConnButton
                  label="Test Write"
                  testing={tcTesting}
                  result={tcResult}
                  onTest={tcTest}
                />
              </div>
              {invalid.has("host") && <p className={fieldErrorMsgCls}>Directory is required.</p>}
            </div>
          </FieldRow>
          <FieldRow label="File Name:">
            <div className="flex-1 min-w-0">
              <HoverTooltip content="The file name to give to the generated file.">
                <input
                  type="text"
                  value={local.outputPattern}
                  onChange={(e) => set("outputPattern", e.target.value)}
                  className={`${inputCls(viewDensity)} w-full ${invalid.has("outputPattern") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
              {invalid.has("outputPattern") && (
                <p className={fieldErrorMsgCls}>File Name is required.</p>
              )}
            </div>
          </FieldRow>
        </>
      )}

      {/* Document Type */}
      <FieldRow label="Document Type:">
        <RadioGroup
          name="doc-type"
          value={local.documentType}
          // Java only disables the encryption controls for RTF; the encrypt flag and password
          // round-trip intact (DocumentWriter.java documentTypeRTFRadioActionPerformed). Keep
          // the values — the encryption section is merely hidden for non-PDF below.
          onChange={(v) => set("documentType", v)}
          options={[
            { label: "PDF", value: "pdf" },
            { label: "RTF", value: "rtf" },
          ]}
          title="The type of document to be created for each message."
        />
      </FieldRow>

      {/* Encryption (PDF only) */}
      {isPdf && (
        <>
          <FieldRow label="Encrypted:">
            <RadioGroup
              name="doc-encrypt"
              value={local.encrypt ? "yes" : "no"}
              // Java disables (not clears) the password field when Encrypted=No; the value
              // round-trips. Only the flag changes here — the password input hides below.
              onChange={(v) => set("encrypt", v === "yes")}
              options={[
                { label: "Yes", value: "yes" },
                { label: "No", value: "no" },
              ]}
              title="If Document Type PDF is selected, generated documents can optionally be encrypted."
            />
          </FieldRow>
          {local.encrypt && (
            <FieldRow label="Password:">
              <HoverTooltip content="The password to be used to view the encrypted PDF document.">
                <SecretInput
                  value={local.password}
                  onChange={(e) => set("password", e.target.value)}
                  className={`${inputCls(viewDensity)} w-56 ${invalid.has("password") ? inputErrorCls : ""}`}
                />
              </HoverTooltip>
            </FieldRow>
          )}
        </>
      )}

      {/* Page Size */}
      <FieldRow label="Page Size:">
        <div className="flex items-center gap-2 flex-wrap">
          <HoverTooltip content="The width of the page.">
            <input
              type="text"
              value={local.pageWidth}
              onChange={(e) => set("pageWidth", e.target.value)}
              className={`${inputCls(viewDensity)} w-16 ${invalid.has("pageWidth") ? inputErrorCls : ""}`}
            />
          </HoverTooltip>
          <span className="text-sm text-gray-500">×</span>
          <HoverTooltip content="The height of the page.">
            <input
              type="text"
              value={local.pageHeight}
              onChange={(e) => set("pageHeight", e.target.value)}
              className={`${inputCls(viewDensity)} w-16 ${invalid.has("pageHeight") ? inputErrorCls : ""}`}
            />
          </HoverTooltip>
          <HoverTooltip content="The units for the page width and height.">
            <select
              value={local.pageUnit}
              onChange={(e) => set("pageUnit", e.target.value)}
              className={selectCls(viewDensity)}
            >
              {PAGE_UNIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </HoverTooltip>
          {/* Standard paper size preset */}
          <HoverTooltip content="Select a standard paper size to fill in the width and height (in inches).">
            <select
              value={selectedPreset}
              onChange={(e) => applyPreset(e.target.value)}
              className={selectCls(viewDensity)}
            >
              <option value="">Custom</option>
              {PAGE_SIZES.map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label}
                </option>
              ))}
            </select>
          </HoverTooltip>
        </div>
      </FieldRow>

      {/* HTML Template */}
      <FullWidthField label="HTML Template:">
        <HoverTooltip content="HTML content to render as a PDF or RTF document. May contain message variables.">
          <ResizableEditorBox
            className={`rounded border ${invalid.has("template") ? "border-red-500" : "border-border"}`}
            height={300}
          >
            <MonacoEditor
              language="html"
              value={local.template}
              onChange={(v) => set("template", v ?? "")}
              onMount={handleMount}
              theme={isDark ? "vs-dark" : "vs"}
              height="100%"
              options={{
                ...MONACO_BASE_OPTIONS,
                automaticLayout: true,
                dragAndDrop: false,
                lineNumbers: "off",
                // Disable suggestion machinery — word-based completions intercept Enter
                // (acceptSuggestionOnEnter) causing newlines to be rejected.
                quickSuggestions: false,
                suggestOnTriggerCharacters: false,
                acceptSuggestionOnEnter: "off",
                tabCompletion: "off",
                wordBasedSuggestions: "off",
                parameterHints: { enabled: false },
              }}
            />
          </ResizableEditorBox>
        </HoverTooltip>
        {invalid.has("template") && (
          <p className={fieldErrorMsgCls}>Document Content is required.</p>
        )}
      </FullWidthField>
    </SettingsSection>
  );
}

// ─── Connector definition ─────────────────────────────────────────────────────

export const DocumentWriterConnector: DestinationConnectorDefinition = {
  canValidateResponse: false,
  BottomSection: DocumentWriterBottomSection,
  defaultPropertiesXml: DEFAULT_XML,
  validate(propertiesXml) {
    if (!propertiesXml) return [];
    const doc = new DOMParser().parseFromString(propertiesXml, "application/xml");
    const txt = (tag: string) => doc.querySelector(tag)?.textContent?.trim() ?? "";
    const errors: import("../shared/validate-utils").ValidationError[] = [];

    // Directory + File Name are hidden for ATTACHMENT output, so only require them otherwise.
    // Mirrors DocumentWriter.java checkProperties, which gates both checks on
    // !outputAttachmentRadioButton.isSelected().
    const isAttachment = txt("output") === "ATTACHMENT";
    if (!isAttachment && !txt("host"))
      errors.push({ field: "host", message: "Directory is required." });
    if (!isAttachment && !txt("outputPattern"))
      errors.push({ field: "outputPattern", message: "File Name is required." });
    if (!txt("template"))
      errors.push({ field: "template", message: "Document Content is required." });

    if (txt("encrypt") === "true" && !txt("password"))
      errors.push({
        field: "password",
        message: "Password is required when encryption is enabled.",
      });

    // Mirror Java checkProperties: invalid only when blank, or when the value parses to a
    // number <= 0. Java uses NumberUtils.toDouble(str, 1), so an unparseable value (e.g. a
    // Velocity template like ${pageWidth}, which the server replaces at dispatch) is accepted.
    const pageWidth = txt("pageWidth");
    const pw = Number(pageWidth);
    if (!pageWidth || (!isNaN(pw) && pw <= 0))
      errors.push({ field: "pageWidth", message: "Page Width must be a positive number." });

    const pageHeight = txt("pageHeight");
    const ph = Number(pageHeight);
    if (!pageHeight || (!isNaN(ph) && ph <= 0))
      errors.push({ field: "pageHeight", message: "Page Height must be a positive number." });

    return errors;
  },
};
