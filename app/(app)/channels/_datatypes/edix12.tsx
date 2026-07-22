import { useState } from "react";
import type { DataTypeDefinition, DataTypePropertiesSectionProps, MsgTreeNode } from "./types";
import {
  ScriptEditorDialog,
  PropertyRow,
  PropertyCheckbox,
  selectCls,
  inputCls,
  setXmlText,
} from "./panel-components";
import { unescapeDelimiters } from "./datatype-input-utils";

// ── EDI/X12 parser ─────────────────────────────────────────────────────────────
// Parses EDI/X12 messages into a tree matching BridgeLink's XML representation
// (produced by EDIReader.java). Structure mirrors the generated XML:
//   X12Transaction (or EDIMessage)
//     └─ ISA
//          └─ ISA.01  (field; simple → leaf, composite → has subelement children)
//               └─ ISA.01.1  (subelement — only shown when composite)
// Drag expressions follow BridgeLink's E4X path notation:
//   Simple field:     msg['ISA']['ISA.01']['ISA.01.1'].toString()
//   Composite field:  msg['ISA']['ISA.16']['ISA.16.1'].toString()

function parseEdi(
  text: string,
  prefix: string,
  suffix: string,
  propsXml?: string | null
): MsgTreeNode {
  // Default delimiters (X12 standard)
  let segDelim = "~";
  let elemDelim = "*";
  let subDelim = ":";
  let inferX12 = true;

  // Override with configured properties if available. Delimiters are stored in
  // escaped form and unescaped via StringUtil.unescape before tokenizing —
  // EDISerializer does this before constructing EDIReader (incl. 0xNN hex, e.g.
  // a 0x0a-configured segment delimiter). The inferX12 header-derived delimiters
  // below are literal characters from the ISA segment and are NOT unescaped.
  if (propsXml) {
    const doc = new DOMParser().parseFromString(propsXml, "application/xml");
    const s = doc.querySelector("serializationProperties");
    if (s) {
      const seg = s.querySelector("segmentDelimiter")?.textContent?.trim();
      const elem = s.querySelector("elementDelimiter")?.textContent?.trim();
      const sub = s.querySelector("subelementDelimiter")?.textContent?.trim();
      if (seg != null) segDelim = unescapeDelimiters(seg);
      if (elem != null) elemDelim = unescapeDelimiters(elem);
      if (sub != null) subDelim = unescapeDelimiters(sub);
      const inf = s.querySelector("inferX12Delimiters")?.textContent?.trim();
      inferX12 = inf !== "false";
    }
  }

  const t = text.trim();

  // Auto-detect X12 delimiters from ISA header (positions 3, 104, 105)
  if (inferX12 && t.startsWith("ISA") && t.length >= 106) {
    elemDelim = t[3];
    subDelim = t[104];
    segDelim = t[105];
  }

  const rawSegs = t
    .split(segDelim)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (rawSegs.length === 0) throw new Error("No EDI segments found");

  const firstId = rawSegs[0].split(elemDelim)[0].trim();
  const docLabel = firstId === "ISA" ? "X12Transaction" : "EDIMessage";

  const segCount: Record<string, number> = {};
  for (const seg of rawSegs) {
    const id = seg.split(elemDelim)[0].trim();
    segCount[id] = (segCount[id] ?? 0) + 1;
  }

  const segOcc: Record<string, number> = {};
  let nodeId = 0;

  const segNodes: MsgTreeNode[] = rawSegs.map((seg) => {
    const parts = seg.split(elemDelim);
    const segId = parts[0].trim();
    const isRep = segCount[segId] > 1;
    const occ = (segOcc[segId] = (segOcc[segId] ?? -1) + 1);
    const segPath = isRep ? `${prefix}['${segId}'][${occ}]` : `${prefix}['${segId}']`;

    const fieldNodes: MsgTreeNode[] = [];
    for (let fi = 1; fi < parts.length; fi++) {
      const fieldNum = fi.toString().padStart(2, "0");
      const fieldName = `${segId}.${fieldNum}`;
      const fieldPath = `${segPath}['${fieldName}']`;
      const rawField = parts[fi];
      const subParts = rawField.split(subDelim);

      let fieldNode: MsgTreeNode;
      if (subParts.length > 1) {
        const subNodes: MsgTreeNode[] = subParts.map((sub, si) => {
          const subName = `${fieldName}.${si + 1}`;
          return {
            id: String(nodeId++),
            label: subName,
            dragExpr: `${fieldPath}['${subName}']${suffix}`,
            children: [],
            value: sub || undefined,
          };
        });
        fieldNode = {
          id: String(nodeId++),
          label: fieldName,
          dragExpr: fieldPath,
          children: subNodes,
        };
      } else {
        fieldNode = {
          id: String(nodeId++),
          label: fieldName,
          dragExpr: `${fieldPath}['${fieldName}.1']${suffix}`,
          children: [],
          value: rawField || undefined,
        };
      }
      fieldNodes.push(fieldNode);
    }

    return {
      id: String(nodeId++),
      label: isRep ? `${segId} [${occ}]` : segId,
      dragExpr: segPath,
      children: fieldNodes,
    };
  });

  return { id: "root", label: docLabel, dragExpr: prefix, children: segNodes };
}

// ── Tooltip definitions ───────────────────────────────────────────────────────

const SER_TT = {
  segmentDelimiter: {
    label: "Segment Delimiter",
    description: "Characters that delimit the segments in the message.",
  },
  elementDelimiter: {
    label: "Element Delimiter",
    description: "Characters that delimit the elements in the message.",
  },
  subelementDelimiter: {
    label: "Subelement Delimiter",
    description: "Characters that delimit the subelements in the message.",
  },
  inferX12Delimiters: {
    label: "Infer X12 Delimiters",
    description:
      "This property only applies to X12 messages. If checked, the delimiters are inferred from the incoming message and the delimiter properties will not be used.",
  },
};

const BAT_TT = {
  splitType: {
    label: "Split Batch By",
    description:
      "Select the method for splitting the batch message.  This option has no effect unless Process Batch Files is enabled in the connector.\n\nJavaScript: Use JavaScript to split messages.",
  },
  batchScript: {
    label: "JavaScript",
    description:
      "Enter JavaScript that splits the batch, and returns the next message.  This script has access to 'reader', a Java BufferedReader, to read the incoming data stream.  The script must return a string containing the next message, or a null/empty string to indicate end of input.  This option has no effect unless Process Batch is enabled in the connector.",
  },
};

// ── XML parse / update helpers ─────────────────────────────────────────────────

function pd(xml: string) {
  return new DOMParser().parseFromString(xml, "application/xml");
}
function gEl(el: Element | null, tag: string, fb: string): string {
  return el?.querySelector(tag)?.textContent?.trim() ?? fb;
}
function bEl(el: Element | null, tag: string, fb: boolean): boolean {
  const v = el?.querySelector(tag)?.textContent?.trim();
  return v === "true" ? true : v === "false" ? false : fb;
}

// ── PropertiesSection ─────────────────────────────────────────────────────────

function EDIPropertiesSection({
  propsXml,
  onChange,
  side,
  transformerType,
  isDark,
  channelId,
}: DataTypePropertiesSectionProps) {
  const xml = propsXml ?? "";
  const doc = xml ? pd(xml) : null;
  const serEl = doc?.querySelector("serializationProperties") ?? null;
  const batEl = doc?.querySelector("batchProperties") ?? null;

  const [segDelim, setSegDelim] = useState(() => gEl(serEl, "segmentDelimiter", "~"));
  const [elemDelim, setElemDelim] = useState(() => gEl(serEl, "elementDelimiter", "*"));
  const [subDelim, setSubDelim] = useState(() => gEl(serEl, "subelementDelimiter", ":"));
  const [inferX12, setInferX12] = useState(() => bEl(serEl, "inferX12Delimiters", true));
  const [splitType, setSplitType] = useState(() => gEl(batEl, "splitType", "JavaScript"));
  const [batchScript, setBatchScript] = useState(() => gEl(batEl, "batchScript", ""));
  const [scriptOpen, setScriptOpen] = useState(false);

  function update(selector: string, value: string) {
    const d = pd(xml);
    setXmlText(d, selector, value);
    onChange(new XMLSerializer().serializeToString(d.documentElement));
  }

  const serFields = (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center">
      <PropertyRow
        info={SER_TT.segmentDelimiter}
        label="Segment Delimiter"
        labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
      >
        <input
          type="text"
          value={segDelim}
          onChange={(e) => {
            setSegDelim(e.target.value);
            update("serializationProperties > segmentDelimiter", e.target.value);
          }}
          className={`${inputCls} w-16`}
        />
      </PropertyRow>

      <PropertyRow
        info={SER_TT.elementDelimiter}
        label="Element Delimiter"
        labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
      >
        <input
          type="text"
          value={elemDelim}
          onChange={(e) => {
            setElemDelim(e.target.value);
            update("serializationProperties > elementDelimiter", e.target.value);
          }}
          className={`${inputCls} w-16`}
        />
      </PropertyRow>

      <PropertyRow
        info={SER_TT.subelementDelimiter}
        label="Subelement Delimiter"
        labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
      >
        <input
          type="text"
          value={subDelim}
          onChange={(e) => {
            setSubDelim(e.target.value);
            update("serializationProperties > subelementDelimiter", e.target.value);
          }}
          className={`${inputCls} w-16`}
        />
      </PropertyRow>

      <div className="col-span-2">
        <PropertyCheckbox
          info={SER_TT.inferX12Delimiters}
          label="Infer X12 Delimiters"
          checked={inferX12}
          onChange={(v) => {
            setInferX12(v);
            update("serializationProperties > inferX12Delimiters", String(v));
          }}
        />
      </div>
    </div>
  );

  // ── INBOUND ────────────────────────────────────────────────────────────────

  if (side === "inbound") {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-3 py-3 space-y-4 text-xs">
            <div>
              <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">Serialization</p>
              {serFields}
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
            {serFields}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Plugin definition ─────────────────────────────────────────────────────────

export const EDIDataType: DataTypeDefinition = {
  name: "EDI/X12",
  displayName: "EDI / X12",

  defaultPropertiesXml(tagName, version) {
    const base = "com.mirth.connect.plugins.datatypes.edi";
    return (
      `<${tagName} class="${base}.EDIDataTypeProperties" version="${version}">` +
      `<serializationProperties class="${base}.EDISerializationProperties" version="${version}">` +
      `<segmentDelimiter>~</segmentDelimiter>` +
      `<elementDelimiter>*</elementDelimiter>` +
      `<subelementDelimiter>:</subelementDelimiter>` +
      `<inferX12Delimiters>true</inferX12Delimiters>` +
      `</serializationProperties>` +
      `<batchProperties class="${base}.EDIBatchProperties" version="${version}">` +
      `<splitType>JavaScript</splitType><batchScript></batchScript>` +
      `</batchProperties>` +
      `</${tagName}>`
    );
  },

  parseTemplate: parseEdi,

  PropertiesSection: EDIPropertiesSection,
};
