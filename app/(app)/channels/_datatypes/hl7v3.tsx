import { useState } from "react";
import type { DataTypeDefinition, DataTypePropertiesSectionProps } from "./types";
import { parseXml } from "./xml";
import {
  ScriptEditorDialog,
  PropertyRow,
  PropertyCheckbox,
  selectCls,
  setXmlText,
} from "./panel-components";

// ── Tooltip definitions ───────────────────────────────────────────────────────

const SER_TT = {
  stripNamespaces: {
    label: "Strip Namespaces",
    description:
      "Strips namespace definitions from the transformed XML message. Will not remove namespace prefixes. If you do not strip namespaces your default xml namespace will be set to the incoming data namespace. If your outbound template namespace is different, you will have to set \"default xml namespace = 'namespace';\" via JavaScript before template mappings.",
  },
};

const BAT_TT = {
  splitType: {
    label: "Split Batch By",
    description:
      "Select the method for splitting the batch message. This option has no effect unless Process Batch Files is enabled in the connector.\n\nJavaScript: Use JavaScript to split messages.",
  },
  batchScript: {
    label: "JavaScript",
    description:
      "Enter JavaScript that splits the batch, and returns the next message. This script has access to 'reader', a Java BufferedReader, to read the incoming data stream. The script must return a string containing the next message, or a null/empty string to indicate end of input. This option has no effect unless Process Batch is enabled in the connector.",
  },
};

// ── XML parse / update helpers ─────────────────────────────────────────────────

function pd(xml: string) {
  return new DOMParser().parseFromString(xml, "application/xml");
}
function bEl(el: Element | null, tag: string, fb: boolean): boolean {
  const v = el?.querySelector(tag)?.textContent?.trim();
  return v === "true" ? true : v === "false" ? false : fb;
}
function gEl(el: Element | null, tag: string, fb: string): string {
  return el?.querySelector(tag)?.textContent?.trim() ?? fb;
}

// ── PropertiesSection ─────────────────────────────────────────────────────────

function HL7V3PropertiesSection({
  propsXml,
  onChange,
  side,
  transformerType,
  isDark,
  channelId,
}: DataTypePropertiesSectionProps) {
  const xml = propsXml ?? "";
  const doc = xml ? pd(xml) : null;

  const [stripNS, setStripNS] = useState(() =>
    bEl(doc?.querySelector("serializationProperties") ?? null, "stripNamespaces", false)
  );
  const [splitType, setSplitType] = useState(() =>
    gEl(doc?.querySelector("batchProperties") ?? null, "splitType", "JavaScript")
  );
  const [batchScript, setBatchScript] = useState(() =>
    gEl(doc?.querySelector("batchProperties") ?? null, "batchScript", "")
  );
  const [scriptOpen, setScriptOpen] = useState(false);

  function update(selector: string, value: string) {
    const d = pd(xml);
    setXmlText(d, selector, value);
    onChange(new XMLSerializer().serializeToString(d.documentElement));
  }

  // ── INBOUND ────────────────────────────────────────────────────────────────

  if (side === "inbound") {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-3 py-3 space-y-4 text-xs">
            {/* Serialization */}
            <div>
              <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">Serialization</p>
              <div className="space-y-1.5">
                <PropertyCheckbox
                  label="Strip Namespaces"
                  checked={stripNS}
                  onChange={(v) => {
                    setStripNS(v);
                    update("serializationProperties > stripNamespaces", String(v));
                  }}
                  info={SER_TT.stripNamespaces}
                />
              </div>
            </div>

            {/* Batch — source-only group (mirrors Java DataTypePropertiesTableModel) */}
            {transformerType === "source" && (
              <div>
                <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">Batch</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center">
                  <PropertyRow
                    info={BAT_TT.splitType}
                    label="Split Batch By"
                    labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                  >
                    <select
                      value={splitType}
                      onChange={(e) => {
                        setSplitType(e.target.value);
                        update("batchProperties > splitType", e.target.value);
                      }}
                      className={selectCls}
                    >
                      <option value="JavaScript">JavaScript</option>
                    </select>
                  </PropertyRow>

                  <PropertyRow
                    info={BAT_TT.batchScript}
                    label="JavaScript"
                    labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                  >
                    <button
                      onClick={() => setScriptOpen(true)}
                      className="justify-self-start px-2 py-0.5 text-xs rounded border border-border text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      Edit
                    </button>
                  </PropertyRow>
                </div>
              </div>
            )}
          </div>
        </div>
        <ScriptEditorDialog
          open={scriptOpen}
          onOpenChange={setScriptOpen}
          title="Batch Script"
          value={batchScript}
          onSave={(v) => {
            setBatchScript(v);
            update("batchProperties > batchScript", v);
          }}
          isDark={isDark}
          channelId={channelId}
          contextType="CHANNEL_BATCH"
        />
      </div>
    );
  }

  // ── OUTBOUND ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-3 py-3 space-y-4 text-xs">
          <div>
            <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">
              Template Serialization
            </p>
            <div className="space-y-1.5">
              <PropertyCheckbox
                label="Strip Namespaces"
                checked={stripNS}
                onChange={(v) => {
                  setStripNS(v);
                  update("serializationProperties > stripNamespaces", String(v));
                }}
                info={SER_TT.stripNamespaces}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Plugin definition ─────────────────────────────────────────────────────────

export const HL7V3DataType: DataTypeDefinition = {
  name: "HL7V3",
  displayName: "HL7 v3.x",

  defaultPropertiesXml(tagName, version) {
    const base = "com.mirth.connect.plugins.datatypes.hl7v3";
    return (
      `<${tagName} class="${base}.HL7V3DataTypeProperties" version="${version}">` +
      `<serializationProperties class="${base}.HL7V3SerializationProperties" version="${version}">` +
      `<stripNamespaces>false</stripNamespaces></serializationProperties>` +
      `<batchProperties class="${base}.HL7V3BatchProperties" version="${version}">` +
      `<splitType>JavaScript</splitType><batchScript></batchScript>` +
      `</batchProperties></${tagName}>`
    );
  },

  parseTemplate: parseXml,

  PropertiesSection: HL7V3PropertiesSection,
};
