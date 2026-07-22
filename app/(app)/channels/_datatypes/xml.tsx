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
import { sanitizeDigits, fitsInt32 } from "./datatype-input-utils";

// ── XML parser ─────────────────────────────────────────────────────────────────
// The root element is "transparent" in BridgeLink's path notation — its children are
// accessed directly via the prefix. e.g. msg['PID']['PID.3'].toString()

let _xmlIdCounter = 0;
function nextXmlId() {
  return String(_xmlIdCounter++);
}

function xmlNodeToTree(el: Element, basePath: string, suffix: string): MsgTreeNode {
  const children: MsgTreeNode[] = [];

  // Attributes → ['@attrName']
  for (const attr of Array.from(el.attributes)) {
    const aPath = `${basePath}['@${attr.name}']`;
    children.push({
      id: nextXmlId(),
      label: `@${attr.name}`,
      dragExpr: `${aPath}${suffix}`,
      children: [],
      value: attr.value,
    });
  }

  // Child elements — handle repeated sibling names with [0], [1], …
  const childEls = Array.from(el.children);
  const nameCount: Record<string, number> = {};
  for (const c of childEls) nameCount[c.localName] = (nameCount[c.localName] ?? 0) + 1;
  const nameOcc: Record<string, number> = {};
  for (const c of childEls) {
    const cn = c.localName;
    const isRep = nameCount[cn] > 1;
    const occ = (nameOcc[cn] = (nameOcc[cn] ?? -1) + 1);
    const childPath = isRep ? `${basePath}['${cn}'][${occ}]` : `${basePath}['${cn}']`;
    const child = xmlNodeToTree(c, childPath, suffix);
    child.label = isRep ? `${cn} [${occ}]` : cn;
    child.dragExpr = `${childPath}${suffix}`;
    children.push(child);
  }

  // Leaf text value
  let value: string | undefined;
  if (childEls.length === 0 && el.textContent) {
    value = el.textContent.trim() || undefined;
  }

  return {
    id: nextXmlId(),
    label: el.localName,
    dragExpr: `${basePath}${suffix}`,
    children,
    value,
  };
}

export function parseXml(text: string, prefix: string, suffix: string): MsgTreeNode {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid XML");
  _xmlIdCounter = 0;

  const root = doc.documentElement;
  const children: MsgTreeNode[] = [];

  // Root element's attributes
  for (const attr of Array.from(root.attributes)) {
    const aPath = `${prefix}['@${attr.name}']`;
    children.push({
      id: nextXmlId(),
      label: `@${attr.name}`,
      dragExpr: `${aPath}${suffix}`,
      children: [],
      value: attr.value,
    });
  }

  // Root element's children — the root itself is transparent in BridgeLink path notation
  const childEls = Array.from(root.children);
  const nameCount: Record<string, number> = {};
  for (const c of childEls) nameCount[c.localName] = (nameCount[c.localName] ?? 0) + 1;
  const nameOcc: Record<string, number> = {};
  for (const c of childEls) {
    const cn = c.localName;
    const isRep = nameCount[cn] > 1;
    const occ = (nameOcc[cn] = (nameOcc[cn] ?? -1) + 1);
    const childPath = isRep ? `${prefix}['${cn}'][${occ}]` : `${prefix}['${cn}']`;
    const child = xmlNodeToTree(c, childPath, suffix);
    child.label = isRep ? `${cn} [${occ}]` : cn;
    child.dragExpr = `${childPath}${suffix}`;
    children.push(child);
  }

  return {
    id: "root",
    label: root.localName,
    dragExpr: prefix,
    children,
  };
}

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
      "Select the method for splitting the batch message. This option has no effect unless Process Batch Files is enabled in the connector.\n\nElement Name: Use the element name to split messages. Does not work with namespaces.\n\nLevel: Use the element level to split messages.\n\nXPath Query: Use a custom XPath Query to split messages.\n\nJavaScript: Use JavaScript to split messages.",
  },
  elementName: {
    label: "Element Name",
    description: "Each element with this name will split into its own message.",
  },
  level: {
    label: "Level",
    description:
      "Each element at this level will be split into its own message. The root element is at level 0.",
  },
  query: {
    label: "XPath Query",
    description: "Each element found with the XPath Query will be split into its own message.",
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

export function XMLPropertiesSection({
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
    gEl(doc?.querySelector("batchProperties") ?? null, "splitType", "Element_Name")
  );
  const [elementName, setElementName] = useState(() =>
    gEl(doc?.querySelector("batchProperties") ?? null, "elementName", "")
  );
  const [level, setLevel] = useState(() =>
    gEl(doc?.querySelector("batchProperties") ?? null, "level", "1")
  );
  const [query, setQuery] = useState(() =>
    gEl(doc?.querySelector("batchProperties") ?? null, "query", "")
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
                      <option value="Element_Name">Element Name</option>
                      <option value="Level">Level</option>
                      <option value="XPath_Query">XPath Query</option>
                      <option value="JavaScript">JavaScript</option>
                    </select>
                  </PropertyRow>

                  <PropertyRow
                    info={BAT_TT.elementName}
                    label="Element Name"
                    labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                  >
                    <input
                      type="text"
                      value={elementName}
                      onChange={(e) => {
                        setElementName(e.target.value);
                        update("batchProperties > elementName", e.target.value);
                      }}
                      className={`${inputCls} w-full`}
                    />
                  </PropertyRow>

                  <PropertyRow
                    info={BAT_TT.level}
                    label="Level"
                    labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                  >
                    <input
                      type="text"
                      value={level}
                      onChange={(e) => {
                        // Digits-only (>= 0); empty or out-of-int-range keeps the previous
                        // value (Java isNotEmpty + Integer.parseInt + tempLevel >= 0 guard).
                        const v = sanitizeDigits(e.target.value);
                        setLevel(v);
                        if (fitsInt32(v)) update("batchProperties > level", v);
                      }}
                      className={`${inputCls} w-16`}
                    />
                  </PropertyRow>

                  <PropertyRow
                    info={BAT_TT.query}
                    label="XPath Query"
                    labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                  >
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        update("batchProperties > query", e.target.value);
                      }}
                      className={`${inputCls} w-full`}
                    />
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

export const XMLDataType: DataTypeDefinition = {
  name: "XML",

  defaultPropertiesXml(tagName, version) {
    const base = "com.mirth.connect.plugins.datatypes.xml";
    // prettier-ignore
    return (
      `<${tagName} class="${base}.XMLDataTypeProperties" version="${version}">` +
      `<serializationProperties class="${base}.XMLSerializationProperties" version="${version}">` +
      `<stripNamespaces>false</stripNamespaces></serializationProperties>` +
      `<batchProperties class="${base}.XMLBatchProperties" version="${version}">` +
      `<splitType>Element_Name</splitType><elementName></elementName>` +
      `<level>1</level><query></query><batchScript></batchScript>` +
      `</batchProperties></${tagName}>`
    );
  },

  parseTemplate: parseXml,

  PropertiesSection: XMLPropertiesSection,
};
