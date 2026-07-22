import { useState } from "react";
import type { DataTypeDefinition, DataTypePropertiesSectionProps, MsgTreeNode } from "./types";
import {
  ScriptEditorDialog,
  PropertyRow,
  PropertyCheckbox,
  inputCls,
  setXmlText,
} from "./panel-components";
import {
  getSegmentDescription,
  getFieldDescription,
  getFieldDatatype,
  getComponentDescription,
  getCompositeSubfieldCount,
} from "./hl7v2-spec";

// ── HL7v2 parser ───────────────────────────────────────────────────────────────
// Parses a raw HL7v2 pipe-delimited message into a tree.
// Expressions use bracket notation matching BridgeLink's XML representation.
// e.g. msg['MSH']['MSH.9']['MSH.9.1'].toString()

/** Append a spec description to a code, e.g. "MSH.5" → "MSH.5 (Receiving Application)" */
function labeled(code: string, desc: string | undefined): string {
  return desc ? `${code} (${desc})` : code;
}

function parseHl7v2(
  text: string,
  prefix: string,
  suffix: string,
  propsXml?: string | null
): MsgTreeNode {
  // Parse serialization properties to respect user settings
  let handleReps = true;
  let handleSubcomps = true;
  if (propsXml) {
    const doc = pd(propsXml);
    const ser = doc.querySelector("serializationProperties");
    handleReps = bEl(ser, "handleRepetitions", true);
    handleSubcomps = bEl(ser, "handleSubcomponents", true);
  }

  const lines = text.split(/\r?\n|\r/).filter((l) => l.trim().length > 0);
  const mshLine = lines.find((l) => l.startsWith("MSH"));
  if (!mshLine || mshLine.length < 8) throw new Error("No valid MSH segment");

  const fSep = mshLine[3]; // field separator: '|'
  const eSep = mshLine.charAt(4); // component separator: '^'
  const rSep = mshLine.charAt(5); // repetition separator: '~'

  // Derive root label from MSH.9 (message type) and MSH.12 (version)
  const mshFields = mshLine.split(fSep);
  const rawMsgType = mshFields[8] ?? "";
  const version = mshFields[11] ?? "";
  const typeParts = rawMsgType.split(eSep);
  const msgLabel =
    typeParts[0] && typeParts[1] ? `${typeParts[0]}-${typeParts[1]}` : rawMsgType || "HL7 Message";
  const rootLabel = version ? `${msgLabel} (${version})` : msgLabel;

  // Count how many times each segment name appears
  const segCount: Record<string, number> = {};
  for (const line of lines) segCount[line.slice(0, 3)] = (segCount[line.slice(0, 3)] ?? 0) + 1;

  const segOcc: Record<string, number> = {};
  const segmentNodes: MsgTreeNode[] = lines.map((line, lineIdx) => {
    const segName = line.slice(0, 3);
    const isRep = segCount[segName] > 1;
    const occ = (segOcc[segName] = (segOcc[segName] ?? -1) + 1);
    const segPath = isRep ? `${prefix}['${segName}'][${occ}]` : `${prefix}['${segName}']`;

    const fields = line.split(fSep);
    const isMsh = segName === "MSH";
    const fieldNodes: MsgTreeNode[] = [];

    // MSH.1 is the field separator character — add it as a synthetic first field
    if (isMsh) {
      fieldNodes.push({
        id: `${lineIdx}-f1`,
        label: labeled("MSH.1", getFieldDescription(version, "MSH", 1)),
        dragExpr: `${segPath}['MSH.1']${suffix}`,
        children: [],
        value: fSep,
      });
    }

    // Iterate remaining split values; for MSH, split[i] = field (i+1)
    for (let fi = 1; fi < fields.length; fi++) {
      const fieldNum = isMsh ? fi + 1 : fi;
      const fieldName = `${segName}.${fieldNum}`;
      const fieldVal = fields[fi];
      const fieldPath = `${segPath}['${fieldName}']`;

      // MSH.2 defines the encoding characters — treat as leaf, no component splitting
      if (isMsh && fieldNum === 2) {
        fieldNodes.push({
          id: `${lineIdx}-f2`,
          label: labeled(fieldName, getFieldDescription(version, segName, fieldNum)),
          dragExpr: `${fieldPath}${suffix}`,
          children: [],
          value: fieldVal || undefined,
        });
        continue;
      }

      const reps = handleReps ? fieldVal.split(rSep) : [fieldVal];
      let children: MsgTreeNode[] = [];

      // Look up the field's datatype so we can resolve component descriptions
      const fieldDT = getFieldDatatype(version, segName, fieldNum);

      if (reps.length > 1) {
        // Repeating field: each repetition gets an index [0], [1], …
        children = reps.map((rep, ri) => {
          const repPath = `${fieldPath}[${ri}]`;
          const comps = handleSubcomps ? rep.split(eSep) : [rep];
          let compKids: MsgTreeNode[];
          if (comps.length > 1) {
            compKids = comps.map((comp, ci) => ({
              id: `${lineIdx}-f${fieldNum}-r${ri}-c${ci + 1}`,
              label: labeled(
                `${fieldName}.${ci + 1}`,
                fieldDT ? getComponentDescription(version, fieldDT, ci + 1) : undefined
              ),
              dragExpr: `${repPath}['${fieldName}.${ci + 1}']${suffix}`,
              children: [],
              value: comp || undefined,
            }));
          } else if (rep) {
            // Java parser always wraps a non-empty single value in a .1 child
            compKids = [
              {
                id: `${lineIdx}-f${fieldNum}-r${ri}-c1`,
                label: labeled(
                  `${fieldName}.1`,
                  fieldDT ? getComponentDescription(version, fieldDT, 1) : undefined
                ),
                dragExpr: `${repPath}['${fieldName}.1']${suffix}`,
                children: [],
                value: rep,
              },
            ];
          } else {
            compKids = [];
          }
          return {
            id: `${lineIdx}-f${fieldNum}-r${ri}`,
            label: `${fieldName} [${ri}]`,
            dragExpr: `${repPath}${suffix}`,
            children: compKids,
            value: compKids.length === 0 ? rep || undefined : undefined,
          };
        });
      } else {
        // Single value — check for components
        const comps = handleSubcomps ? fieldVal.split(eSep) : [fieldVal];
        if (comps.length > 1) {
          children = comps.map((comp, ci) => ({
            id: `${lineIdx}-f${fieldNum}-c${ci + 1}`,
            label: labeled(
              `${fieldName}.${ci + 1}`,
              fieldDT ? getComponentDescription(version, fieldDT, ci + 1) : undefined
            ),
            dragExpr: `${fieldPath}['${fieldName}.${ci + 1}']${suffix}`,
            children: [],
            value: comp || undefined,
          }));
        } else if (fieldVal) {
          // Java parser always wraps a non-empty single value in a .1 child
          children = [
            {
              id: `${lineIdx}-f${fieldNum}-c1`,
              label: labeled(
                `${fieldName}.1`,
                fieldDT ? getComponentDescription(version, fieldDT, 1) : undefined
              ),
              dragExpr: `${fieldPath}['${fieldName}.1']${suffix}`,
              children: [],
              value: fieldVal,
            },
          ];
        }
      }

      // Spec-based expansion: if no children were created from the message data
      // but the spec says this field's datatype is composite, generate placeholder
      // component nodes so users can see (and drag) the expected sub-structure.
      if (children.length === 0 && handleSubcomps && fieldDT) {
        const subfieldCount = getCompositeSubfieldCount(version, fieldDT);
        if (subfieldCount > 1) {
          children = Array.from({ length: subfieldCount }, (_, ci) => ({
            id: `${lineIdx}-f${fieldNum}-c${ci + 1}`,
            label: labeled(
              `${fieldName}.${ci + 1}`,
              getComponentDescription(version, fieldDT, ci + 1)
            ),
            dragExpr: `${fieldPath}['${fieldName}.${ci + 1}']${suffix}`,
            children: [],
            value: undefined,
          }));
        }
      }

      fieldNodes.push({
        id: `${lineIdx}-f${fieldNum}`,
        label: labeled(fieldName, getFieldDescription(version, segName, fieldNum)),
        dragExpr: `${fieldPath}${suffix}`,
        children,
        value: children.length === 0 ? fieldVal || undefined : undefined,
      });
    }

    const segDesc = getSegmentDescription(version, segName);
    const segLabel = isRep ? `${labeled(segName, segDesc)} [${occ}]` : labeled(segName, segDesc);

    return {
      id: `seg-${lineIdx}`,
      label: segLabel,
      dragExpr: segPath,
      children: fieldNodes,
    };
  });

  return {
    id: "root",
    label: rootLabel,
    dragExpr: prefix,
    children: segmentNodes,
  };
}

// ── XML parse / update helpers ────────────────────────────────────────────────

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
function sEl(doc: Document, sel: string, val: string): void {
  setXmlText(doc, sel, val);
}

// ── Tooltip definitions ───────────────────────────────────────────────────────

const SER_TT = {
  handleRepetitions: {
    label: "Parse Field Repetitions",
    description: "Parse field repetitions (applies to Non-Strict Parser only).",
  },
  handleSubcomponents: {
    label: "Parse Subcomponents",
    description: "Parse subcomponents (applies to Non-Strict Parser only).",
  },
  useStrictParser: {
    label: "Use Strict Parser",
    description: "Parse messages based upon strict HL7 specifications.",
  },
  useStrictValidation: {
    label: "Validate in Strict Parser",
    description: "Validate messages using HL7 specifications (applies to Strict Parser only).",
  },
  stripNamespaces: {
    label: "Strip Namespaces",
    description:
      "Strips namespace definitions from the transformed XML message (applies to Strict Parser only).",
  },
  segmentDelimiter: {
    label: "Segment Delimiter",
    description: "This is the input delimiter character(s) expected to occur after each segment.",
  },
  convertLineBreaks: {
    label: "Convert Line Breaks",
    description:
      "Convert all styles of line breaks (CRLF, CR, LF) in the raw message to the segment delimiter.",
  },
};

const DES_TT = {
  useStrictParser: {
    label: "Use Strict Parser",
    description: "Parse messages based upon strict HL7 specifications.",
  },
  useStrictValidation: {
    label: "Validate in Strict Parser",
    description: "Validate messages using HL7 specifications (applies to Strict Parser only).",
  },
  segmentDelimiter: {
    label: "Segment Delimiter",
    description: "This is the delimiter character(s) that will be used after each segment.",
  },
};

const BAT_TT = {
  splitType: {
    label: "Split Batch By",
    description:
      "Select the method for splitting the batch message.  This option has no effect unless Process Batch Files is enabled in the connector.\n\nMSH Segment: Each MSH Segment indicates the start of a new message in the batch.\n\nJavaScript: Use JavaScript to split messages.",
  },
  batchScript: {
    label: "JavaScript",
    description:
      "Enter JavaScript that splits the batch, and returns the next message.  This script has access to 'reader', a Java BufferedReader, to read the incoming data stream.  The script must return a string containing the next message, or a null/empty string to indicate end of input.  This option has no effect unless Process Batch is enabled in the connector.",
  },
};

const RG_TT = {
  segmentDelimiter: {
    label: "Segment Delimiter",
    description:
      'This is the delimiter character(s) that will be used after each segment. This option has no effect unless an "Auto-generate" item has been selected in the response settings.',
  },
  successfulACKCode: {
    label: "Successful ACK Code",
    description:
      'The ACK code to respond with when the message processes successfully. This option has no effect unless an "Auto-generate" item has been selected in the response settings.',
  },
  successfulACKMessage: {
    label: "Successful ACK Message",
    description:
      'The ACK message to respond with when the message processes successfully. This option has no effect unless an "Auto-generate" item has been selected in the response settings.',
  },
  errorACKCode: {
    label: "Error ACK Code",
    description:
      'The ACK code to respond with when an error occurs during message processing. This option has no effect unless an "Auto-generate" item has been selected in the response settings.',
  },
  errorACKMessage: {
    label: "Error ACK Message",
    description:
      'The ACK message to respond with when an error occurs during message processing. This option has no effect unless an "Auto-generate" item has been selected in the response settings.',
  },
  rejectedACKCode: {
    label: "Rejected ACK Code",
    description:
      'The ACK code to respond with when the message is filtered. This option has no effect unless an "Auto-generate" item has been selected in the response settings.',
  },
  rejectedACKMessage: {
    label: "Rejected ACK Message",
    description:
      'The ACK message to respond with when the message is filtered. This option has no effect unless an "Auto-generate" item has been selected in the response settings.',
  },
  msh15ACKAccept: {
    label: "MSH-15 ACK Accept",
    description:
      "If enabled, checks the MSH-15 field of an incoming message to control acknowledgment conditions (always, never, or on error only).",
  },
  dateFormat: {
    label: "Date Format",
    description:
      "The date format used for the timestamp in the generated ACK. Uses Java SimpleDateFormat patterns. Default: yyyyMMddHHmmss.SSS",
  },
};

const RV_TT = {
  successfulACKCode: {
    label: "Successful ACK Codes",
    description:
      "The ACK code(s) to expect when the message is accepted by the downstream system. By default, the message status will be set to SENT. Specify multiple codes with a list of comma separated values.",
  },
  errorACKCode: {
    label: "Error ACK Codes",
    description:
      "The ACK code(s) to expect when an error occurs on the downstream system. By default, the message status will be set to ERROR. Specify multiple codes with a list of comma separated values.",
  },
  rejectedACKCode: {
    label: "Rejected ACK Codes",
    description:
      "The ACK code(s) to expect when the message is rejected by the downstream system. By default, the message status will be set to ERROR. Specify multiple codes with a list of comma separated values.",
  },
  validateMessageControlId: {
    label: "Validate Message Control Id",
    description:
      "Select this option to validate the Message Control Id (MSA-2) returned from the response.",
  },
  originalMessageControlId: {
    label: "Original Message Control Id",
    description:
      "Select the source of the original Message Control Id used to validate the response. If Destination Encoded is selected, the Id will be extracted from the MSH-10 field of the destination's encoded content. If Map Variable is selected, the Id will be retrieved from the destination's connector map or the channel map.",
  },
  originalIdMapVariable: {
    label: "Original Id Map Variable",
    description:
      "This field must be populated if the Original Message Control Id is set to Map Variable. The Id will be read from this variable in the destination's connector map or the channel map.",
  },
};

// ── PropertiesSection ─────────────────────────────────────────────────────────

/** Labelled single-line text input row. Hoisted to module scope so it isn't
 *  re-created on every render of HL7V2PropertiesSection (react-hooks/static-components). */
function TextRow({
  label,
  value,
  onTRChange,
  info,
  width = "w-16",
}: {
  label: string;
  value: string;
  onTRChange: (v: string) => void;
  info: { label: string; description: string };
  width?: string;
}) {
  return (
    <PropertyRow
      info={info}
      label={label}
      labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => onTRChange(e.target.value)}
        className={`${inputCls} ${width}`}
      />
    </PropertyRow>
  );
}

function HL7V2PropertiesSection({
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
  const desEl = doc?.querySelector("deserializationProperties") ?? null;
  const batEl = doc?.querySelector("batchProperties") ?? null;
  const rgEl = doc?.querySelector("responseGenerationProperties") ?? null;
  const rvEl = doc?.querySelector("responseValidationProperties") ?? null;

  // Serialization state (inbound)
  const [hlRepetitions, setHlRepetitions] = useState(() => bEl(serEl, "handleRepetitions", true));
  const [hlSubcomponents, setHlSubcomponents] = useState(() =>
    bEl(serEl, "handleSubcomponents", true)
  );
  const [hlStrictParser, setHlStrictParser] = useState(() => bEl(serEl, "useStrictParser", false));
  const [hlStrictValid, setHlStrictValid] = useState(() =>
    bEl(serEl, "useStrictValidation", false)
  );
  const [hlStripNS, setHlStripNS] = useState(() => bEl(serEl, "stripNamespaces", false));
  const [hlSegDelim, setHlSegDelim] = useState(() => gEl(serEl, "segmentDelimiter", "\\r"));
  const [hlConvertLB, setHlConvertLB] = useState(() => bEl(serEl, "convertLineBreaks", true));

  // Deserialization state (outbound)
  const [hlDStrictParser, setHlDStrictParser] = useState(() =>
    bEl(desEl, "useStrictParser", false)
  );
  const [hlDStrictValid, setHlDStrictValid] = useState(() =>
    bEl(desEl, "useStrictValidation", false)
  );
  const [hlDSegDelim, setHlDSegDelim] = useState(() => gEl(desEl, "segmentDelimiter", "\\r"));

  // Batch state (inbound)
  const [splitType, setSplitType] = useState(() => gEl(batEl, "splitType", "MSH_Segment"));
  const [batchScript, setBatchScript] = useState(() => gEl(batEl, "batchScript", ""));
  const [scriptOpen, setScriptOpen] = useState(false);

  // Response Generation state (inbound)
  const [rgSegDelim, setRgSegDelim] = useState(() => gEl(rgEl, "segmentDelimiter", "\\r"));
  const [rgSuccCode, setRgSuccCode] = useState(() => gEl(rgEl, "successfulACKCode", "AA"));
  const [rgSuccMsg, setRgSuccMsg] = useState(() => gEl(rgEl, "successfulACKMessage", ""));
  const [rgErrCode, setRgErrCode] = useState(() => gEl(rgEl, "errorACKCode", "AE"));
  const [rgErrMsg, setRgErrMsg] = useState(() =>
    gEl(rgEl, "errorACKMessage", "An Error Occurred Processing Message.")
  );
  const [rgRejCode, setRgRejCode] = useState(() => gEl(rgEl, "rejectedACKCode", "AR"));
  const [rgRejMsg, setRgRejMsg] = useState(() =>
    gEl(rgEl, "rejectedACKMessage", "Message Rejected.")
  );
  const [rgMsh15, setRgMsh15] = useState(() => bEl(rgEl, "msh15ACKAccept", false));
  const [rgDateFmt, setRgDateFmt] = useState(() => gEl(rgEl, "dateFormat", "yyyyMMddHHmmss.SSS"));

  // Response Validation state (inbound)
  const [rvSuccCodes, setRvSuccCodes] = useState(() => gEl(rvEl, "successfulACKCode", "AA,CA"));
  const [rvErrCodes, setRvErrCodes] = useState(() => gEl(rvEl, "errorACKCode", "AE,CE"));
  const [rvRejCodes, setRvRejCodes] = useState(() => gEl(rvEl, "rejectedACKCode", "AR,CR"));
  const [rvValidateMCI, setRvValidateMCI] = useState(() =>
    bEl(rvEl, "validateMessageControlId", true)
  );
  const [rvOrigMCI, setRvOrigMCI] = useState(() =>
    gEl(rvEl, "originalMessageControlId", "Destination_Encoded")
  );
  const [rvOrigIdVar, setRvOrigIdVar] = useState(() => gEl(rvEl, "originalIdMapVariable", ""));

  function update(selector: string, value: string) {
    const d = pd(xml);
    sEl(d, selector, value);
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
                  label="Parse Field Repetitions"
                  checked={hlRepetitions}
                  onChange={(v) => {
                    setHlRepetitions(v);
                    update("serializationProperties > handleRepetitions", String(v));
                  }}
                  info={SER_TT.handleRepetitions}
                />
                <PropertyCheckbox
                  label="Parse Subcomponents"
                  checked={hlSubcomponents}
                  onChange={(v) => {
                    setHlSubcomponents(v);
                    update("serializationProperties > handleSubcomponents", String(v));
                  }}
                  info={SER_TT.handleSubcomponents}
                />
                <PropertyCheckbox
                  label="Use Strict Parser"
                  checked={hlStrictParser}
                  onChange={(v) => {
                    setHlStrictParser(v);
                    update("serializationProperties > useStrictParser", String(v));
                  }}
                  info={SER_TT.useStrictParser}
                />
                <PropertyCheckbox
                  label="Validate in Strict Parser"
                  checked={hlStrictValid}
                  onChange={(v) => {
                    setHlStrictValid(v);
                    update("serializationProperties > useStrictValidation", String(v));
                  }}
                  info={SER_TT.useStrictValidation}
                />
                <PropertyCheckbox
                  label="Strip Namespaces"
                  checked={hlStripNS}
                  onChange={(v) => {
                    setHlStripNS(v);
                    update("serializationProperties > stripNamespaces", String(v));
                  }}
                  info={SER_TT.stripNamespaces}
                />
                <PropertyCheckbox
                  label="Convert Line Breaks"
                  checked={hlConvertLB}
                  onChange={(v) => {
                    setHlConvertLB(v);
                    update("serializationProperties > convertLineBreaks", String(v));
                  }}
                  info={SER_TT.convertLineBreaks}
                />
                <PropertyRow
                  info={SER_TT.segmentDelimiter}
                  label="Segment Delimiter"
                  labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                >
                  <input
                    type="text"
                    value={hlSegDelim}
                    onChange={(e) => {
                      setHlSegDelim(e.target.value);
                      update("serializationProperties > segmentDelimiter", e.target.value);
                    }}
                    className={`${inputCls} w-16`}
                  />
                </PropertyRow>
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
                      className="h-7 px-1.5 text-xs rounded border border-border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500 w-40"
                    >
                      <option value="MSH_Segment">MSH Segment</option>
                      <option value="JavaScript">JavaScript</option>
                    </select>
                  </PropertyRow>
                  {splitType === "JavaScript" && (
                    <PropertyRow
                      info={BAT_TT.batchScript}
                      label="JavaScript"
                      labelClassName="text-gray-600 dark:text-gray-400"
                    >
                      <button
                        onClick={() => setScriptOpen(true)}
                        className="justify-self-start px-2 py-0.5 text-xs rounded border border-border text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        Edit
                      </button>
                    </PropertyRow>
                  )}
                </div>
              </div>
            )}

            {/* Response Generation — source-only group (mirrors Java DataTypePropertiesTableModel) */}
            {transformerType === "source" && (
              <div>
                <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">
                  Response Generation
                </p>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center">
                  <TextRow
                    label="Segment Delimiter"
                    value={rgSegDelim}
                    onTRChange={(v) => {
                      setRgSegDelim(v);
                      update("responseGenerationProperties > segmentDelimiter", v);
                    }}
                    info={RG_TT.segmentDelimiter}
                  />
                  <TextRow
                    label="Successful ACK Code"
                    value={rgSuccCode}
                    onTRChange={(v) => {
                      setRgSuccCode(v);
                      update("responseGenerationProperties > successfulACKCode", v);
                    }}
                    info={RG_TT.successfulACKCode}
                  />
                  <TextRow
                    label="Successful ACK Message"
                    value={rgSuccMsg}
                    onTRChange={(v) => {
                      setRgSuccMsg(v);
                      update("responseGenerationProperties > successfulACKMessage", v);
                    }}
                    info={RG_TT.successfulACKMessage}
                    width="w-full"
                  />
                  <TextRow
                    label="Error ACK Code"
                    value={rgErrCode}
                    onTRChange={(v) => {
                      setRgErrCode(v);
                      update("responseGenerationProperties > errorACKCode", v);
                    }}
                    info={RG_TT.errorACKCode}
                  />
                  <TextRow
                    label="Error ACK Message"
                    value={rgErrMsg}
                    onTRChange={(v) => {
                      setRgErrMsg(v);
                      update("responseGenerationProperties > errorACKMessage", v);
                    }}
                    info={RG_TT.errorACKMessage}
                    width="w-full"
                  />
                  <TextRow
                    label="Rejected ACK Code"
                    value={rgRejCode}
                    onTRChange={(v) => {
                      setRgRejCode(v);
                      update("responseGenerationProperties > rejectedACKCode", v);
                    }}
                    info={RG_TT.rejectedACKCode}
                  />
                  <TextRow
                    label="Rejected ACK Message"
                    value={rgRejMsg}
                    onTRChange={(v) => {
                      setRgRejMsg(v);
                      update("responseGenerationProperties > rejectedACKMessage", v);
                    }}
                    info={RG_TT.rejectedACKMessage}
                    width="w-full"
                  />
                  <TextRow
                    label="Date Format"
                    value={rgDateFmt}
                    onTRChange={(v) => {
                      setRgDateFmt(v);
                      update("responseGenerationProperties > dateFormat", v);
                    }}
                    info={RG_TT.dateFormat}
                    width="w-full"
                  />
                </div>
                <div className="mt-1.5">
                  <PropertyCheckbox
                    label="MSH-15 ACK Accept"
                    checked={rgMsh15}
                    onChange={(v) => {
                      setRgMsh15(v);
                      update("responseGenerationProperties > msh15ACKAccept", String(v));
                    }}
                    info={RG_TT.msh15ACKAccept}
                  />
                </div>
              </div>
            )}

            {/* Response Validation — response-only group (mirrors Java DataTypePropertiesTableModel) */}
            {transformerType === "response" && (
              <div>
                <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">
                  Response Validation
                </p>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center">
                  <TextRow
                    label="Successful ACK Codes"
                    value={rvSuccCodes}
                    onTRChange={(v) => {
                      setRvSuccCodes(v);
                      update("responseValidationProperties > successfulACKCode", v);
                    }}
                    info={RV_TT.successfulACKCode}
                    width="w-20"
                  />
                  <TextRow
                    label="Error ACK Codes"
                    value={rvErrCodes}
                    onTRChange={(v) => {
                      setRvErrCodes(v);
                      update("responseValidationProperties > errorACKCode", v);
                    }}
                    info={RV_TT.errorACKCode}
                    width="w-20"
                  />
                  <TextRow
                    label="Rejected ACK Codes"
                    value={rvRejCodes}
                    onTRChange={(v) => {
                      setRvRejCodes(v);
                      update("responseValidationProperties > rejectedACKCode", v);
                    }}
                    info={RV_TT.rejectedACKCode}
                    width="w-20"
                  />
                  <PropertyRow
                    info={RV_TT.originalMessageControlId}
                    label="Original Message Control Id"
                    labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                  >
                    <select
                      value={rvOrigMCI}
                      onChange={(e) => {
                        setRvOrigMCI(e.target.value);
                        update(
                          "responseValidationProperties > originalMessageControlId",
                          e.target.value
                        );
                      }}
                      className="h-7 px-1.5 text-xs rounded border border-border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-blue-500 w-44"
                    >
                      <option value="Destination_Encoded">Destination Encoded</option>
                      <option value="Map_Variable">Map Variable</option>
                    </select>
                  </PropertyRow>
                  {rvOrigMCI === "Map_Variable" && (
                    <TextRow
                      label="Original Id Map Variable"
                      value={rvOrigIdVar}
                      onTRChange={(v) => {
                        setRvOrigIdVar(v);
                        update("responseValidationProperties > originalIdMapVariable", v);
                      }}
                      info={RV_TT.originalIdMapVariable}
                      width="w-full"
                    />
                  )}
                </div>
                <div className="mt-1.5">
                  <PropertyCheckbox
                    label="Validate Message Control Id"
                    checked={rvValidateMCI}
                    onChange={(v) => {
                      setRvValidateMCI(v);
                      update("responseValidationProperties > validateMessageControlId", String(v));
                    }}
                    info={RV_TT.validateMessageControlId}
                  />
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
          {/* Deserialization */}
          <div>
            <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">Deserialization</p>
            <div className="space-y-1.5">
              <PropertyCheckbox
                label="Use Strict Parser"
                checked={hlDStrictParser}
                onChange={(v) => {
                  setHlDStrictParser(v);
                  update("deserializationProperties > useStrictParser", String(v));
                }}
                info={DES_TT.useStrictParser}
              />
              <PropertyCheckbox
                label="Validate in Strict Parser"
                checked={hlDStrictValid}
                onChange={(v) => {
                  setHlDStrictValid(v);
                  update("deserializationProperties > useStrictValidation", String(v));
                }}
                info={DES_TT.useStrictValidation}
              />
              <PropertyRow
                info={DES_TT.segmentDelimiter}
                label="Segment Delimiter"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={hlDSegDelim}
                  onChange={(e) => {
                    setHlDSegDelim(e.target.value);
                    update("deserializationProperties > segmentDelimiter", e.target.value);
                  }}
                  className={`${inputCls} w-16`}
                />
              </PropertyRow>
            </div>
          </div>

          {/* Template Serialization */}
          <div>
            <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">
              Template Serialization
            </p>
            <div className="space-y-1.5">
              <PropertyCheckbox
                label="Parse Field Repetitions"
                checked={hlRepetitions}
                onChange={(v) => {
                  setHlRepetitions(v);
                  update("serializationProperties > handleRepetitions", String(v));
                }}
                info={SER_TT.handleRepetitions}
              />
              <PropertyCheckbox
                label="Parse Subcomponents"
                checked={hlSubcomponents}
                onChange={(v) => {
                  setHlSubcomponents(v);
                  update("serializationProperties > handleSubcomponents", String(v));
                }}
                info={SER_TT.handleSubcomponents}
              />
              <PropertyCheckbox
                label="Use Strict Parser"
                checked={hlStrictParser}
                onChange={(v) => {
                  setHlStrictParser(v);
                  update("serializationProperties > useStrictParser", String(v));
                }}
                info={SER_TT.useStrictParser}
              />
              <PropertyCheckbox
                label="Validate in Strict Parser"
                checked={hlStrictValid}
                onChange={(v) => {
                  setHlStrictValid(v);
                  update("serializationProperties > useStrictValidation", String(v));
                }}
                info={SER_TT.useStrictValidation}
              />
              <PropertyCheckbox
                label="Strip Namespaces"
                checked={hlStripNS}
                onChange={(v) => {
                  setHlStripNS(v);
                  update("serializationProperties > stripNamespaces", String(v));
                }}
                info={SER_TT.stripNamespaces}
              />
              <PropertyCheckbox
                label="Convert Line Breaks"
                checked={hlConvertLB}
                onChange={(v) => {
                  setHlConvertLB(v);
                  update("serializationProperties > convertLineBreaks", String(v));
                }}
                info={SER_TT.convertLineBreaks}
              />
              <PropertyRow
                info={SER_TT.segmentDelimiter}
                label="Segment Delimiter"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={hlSegDelim}
                  onChange={(e) => {
                    setHlSegDelim(e.target.value);
                    update("serializationProperties > segmentDelimiter", e.target.value);
                  }}
                  className={`${inputCls} w-16`}
                />
              </PropertyRow>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Plugin definition ─────────────────────────────────────────────────────────

export const HL7V2DataType: DataTypeDefinition = {
  name: "HL7V2",
  displayName: "HL7 v2.x",

  defaultPropertiesXml(tagName, version) {
    const base = "com.mirth.connect.plugins.datatypes.hl7v2";
    // prettier-ignore
    return (
      `<${tagName} class="${base}.HL7v2DataTypeProperties" version="${version}">` +
      `<serializationProperties class="${base}.HL7v2SerializationProperties" version="${version}">` +
      `<handleRepetitions>true</handleRepetitions>` +
      `<handleSubcomponents>true</handleSubcomponents>` +
      `<useStrictParser>false</useStrictParser>` +
      `<useStrictValidation>false</useStrictValidation>` +
      `<stripNamespaces>false</stripNamespaces>` +
      `<segmentDelimiter>\\r</segmentDelimiter>` +
      `<convertLineBreaks>true</convertLineBreaks>` +
      `</serializationProperties>` +
      `<deserializationProperties class="${base}.HL7v2DeserializationProperties" version="${version}">` +
      `<useStrictParser>false</useStrictParser>` +
      `<useStrictValidation>false</useStrictValidation>` +
      `<segmentDelimiter>\\r</segmentDelimiter>` +
      `</deserializationProperties>` +
      `<batchProperties class="${base}.HL7v2BatchProperties" version="${version}">` +
      `<splitType>MSH_Segment</splitType><batchScript></batchScript>` +
      `</batchProperties>` +
      `<responseGenerationProperties class="${base}.HL7v2ResponseGenerationProperties" version="${version}">` +
      `<segmentDelimiter>\\r</segmentDelimiter>` +
      `<successfulACKCode>AA</successfulACKCode>` +
      `<successfulACKMessage></successfulACKMessage>` +
      `<errorACKCode>AE</errorACKCode>` +
      `<errorACKMessage>An Error Occurred Processing Message.</errorACKMessage>` +
      `<rejectedACKCode>AR</rejectedACKCode>` +
      `<rejectedACKMessage>Message Rejected.</rejectedACKMessage>` +
      `<msh15ACKAccept>false</msh15ACKAccept>` +
      `<dateFormat>yyyyMMddHHmmss.SSS</dateFormat>` +
      `</responseGenerationProperties>` +
      `<responseValidationProperties class="${base}.HL7v2ResponseValidationProperties" version="${version}">` +
      `<successfulACKCode>AA,CA</successfulACKCode>` +
      `<errorACKCode>AE,CE</errorACKCode>` +
      `<rejectedACKCode>AR,CR</rejectedACKCode>` +
      `<validateMessageControlId>true</validateMessageControlId>` +
      `<originalMessageControlId>Destination_Encoded</originalMessageControlId>` +
      `<originalIdMapVariable></originalIdMapVariable>` +
      `</responseValidationProperties>` +
      `</${tagName}>`
    );
  },

  parseTemplate: parseHl7v2,

  PropertiesSection: HL7V2PropertiesSection,
};
