import { useState } from "react";
import type { DataTypeDefinition, DataTypePropertiesSectionProps, MsgTreeNode } from "./types";
import {
  ScriptEditorDialog,
  PropertyRow,
  selectCls,
  setXmlText,
  parsePropsOrDefault,
} from "./panel-components";

// ── Tooltip definitions ───────────────────────────────────────────────────────

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

// ── PropertiesSection ─────────────────────────────────────────────────────────

function RawPropertiesSection({
  propsXml,
  onChange,
  side,
  transformerType,
  isDark,
  channelId,
  version,
}: DataTypePropertiesSectionProps) {
  const xml = propsXml ?? "";
  const doc = xml ? new DOMParser().parseFromString(xml, "application/xml") : null;
  const batEl = doc?.querySelector("batchProperties") ?? null;

  const [splitType, setSplitType] = useState(
    () => batEl?.querySelector("splitType")?.textContent?.trim() ?? "JavaScript"
  );
  const [batchScript, setBatchScript] = useState(
    () => batEl?.querySelector("batchScript")?.textContent?.trim() ?? ""
  );
  const [scriptOpen, setScriptOpen] = useState(false);

  // Use the shared element-creating writer (mirrors the Java client rebuilding
  // the full property set on save) and seed a valid default document when the
  // stored propsXml is null/empty — never serialize a parsererror document.
  function update(selector: string, value: string) {
    const tagName = side === "inbound" ? "inboundProperties" : "outboundProperties";
    const d = parsePropsOrDefault(
      propsXml,
      RawDataType.defaultPropertiesXml(tagName, version ?? "")
    );
    setXmlText(d, selector, value);
    onChange(new XMLSerializer().serializeToString(d.documentElement));
  }

  // Inbound: show Batch section. Batch is a source-only group (mirrors Java
  // DataTypePropertiesTableModel) — RAW inbound has no other groups, so on a
  // destination/response transformer this falls through to "no properties".
  if (side === "inbound" && transformerType === "source") {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-3 py-3 space-y-4 text-xs">
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

  // Outbound: no properties
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3">
        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
          This data type has no properties.
        </p>
      </div>
    </div>
  );
}

// ── Plugin definition ─────────────────────────────────────────────────────────

export const RawDataType: DataTypeDefinition = {
  name: "RAW",

  defaultPropertiesXml(tagName, version) {
    const base = "com.mirth.connect.plugins.datatypes.raw";
    return (
      `<${tagName} class="${base}.RawDataTypeProperties" version="${version}">` +
      `<batchProperties class="${base}.RawBatchProperties" version="${version}">` +
      `<splitType>JavaScript</splitType><batchScript></batchScript>` +
      `</batchProperties></${tagName}>`
    );
  },

  parseTemplate(text: string, prefix: string): MsgTreeNode {
    return { id: "root", label: "Raw Data", dragExpr: prefix, children: [] };
  },

  PropertiesSection: RawPropertiesSection,
};
