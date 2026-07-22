import { useState } from "react";
import type { DataTypeDefinition, DataTypePropertiesSectionProps, MsgTreeNode } from "./types";
import {
  ScriptEditorDialog,
  PropertyRow,
  PropertyCheckbox,
  selectCls,
  inputCls,
  setXmlText,
  parsePropsOrDefault,
} from "./panel-components";
import { cn } from "@/lib/utils";
import {
  sanitizeDigits,
  fitsInt32,
  isValidPositiveIntList,
  areValidColumnNames,
  unescapeDelimiters,
} from "./datatype-input-utils";

// ── Delimited parser ───────────────────────────────────────────────────────────────
// Parses CSV / delimited text into a tree matching BridgeLink's XML representation.
// BridgeLink converts delimited rows to <row>/<rowN> elements with <column1>,
// <column2>, … children. This is a faithful port of the server-side tokenizer in
// DelimitedReader.java (getRecord / getColumnValue) so the Msg-Tree preview paths
// dragged into transformers match what the server actually produces:
//   - delimiters are unescaped via StringUtil.unescape (incl. 0xNN hex + "..." literals)
//   - fixed-width columns (columnWidths) override delimiter splitting
//   - quote-token / escape-token processing keeps embedded delimiters in one column
//   - ignoreCR gobbles all \r before tokenizing
//   - numberedRows emits <row1>, <row2>, … (1-based, no index) instead of <row>[i]

/** Options mirroring DelimitedSerializationProperties (raw, still-escaped strings). */
interface DelimitedParseOpts {
  colDelim: string;
  recDelim: string;
  quoteToken: string;
  quoteEscapeToken: string;
  escapeWithDoubleQuote: boolean;
  /** Positive fixed widths; empty means delimited mode. */
  columnWidths: number[];
  /** Comma-separated column-name overrides. */
  columnNames: string;
  numberedRows: boolean;
  ignoreCR: boolean;
}

/** Remove trailing whitespace — mirrors Java DelimitedReader.ltrim (which, despite its name, right-trims). */
function rtrim(s: string): string {
  return s.replace(/\s+$/, "");
}

/**
 * Tokenize delimited text into records (rows) of column values, mirroring
 * DelimitedReader.getRecord / getColumnValue. Delimiters/quote tokens are the
 * already-unescaped literal strings.
 */
function tokenizeDelimited(
  text: string,
  colDelim: string,
  recDelim: string,
  quote: string,
  esc: string,
  escapeWithDoubleQuote: boolean,
  columnWidths: number[],
  ignoreCR: boolean
): string[][] {
  // Java gobbles every \r at the character-read level when ignoreCR is set, so a
  // pre-strip is equivalent (and means recordDelimiter="\r\n" never matches when
  // ignoreCR is true — CRLF files split via recordDelimiter="\n" + ignoreCR).
  const src = ignoreCR ? text.replace(/\r/g, "") : text;
  const len = src.length;
  let pos = 0;
  const peek = (n: number) => src.slice(pos, pos + n);

  const records: string[][] = [];

  if (columnWidths.length > 0) {
    // Fixed-width columns: split records on recDelim, slice each by its widths.
    while (pos < len) {
      const record: string[] = [];
      for (let i = 0; i < columnWidths.length; i++) {
        let col = "";
        for (let j = 0; j < columnWidths[i]; j++) {
          if (peek(recDelim.length) === recDelim || pos >= len) break;
          col += src[pos++];
        }
        record.push(rtrim(col));
        if (pos >= len || peek(recDelim.length) === recDelim) break;
      }
      // Consume any trailing characters up to the record delimiter / EOF.
      while (pos < len && peek(recDelim.length) !== recDelim) pos++;
      // Consume the record delimiter.
      if (peek(recDelim.length) === recDelim) pos += recDelim.length;
      records.push(record);
    }
    return records;
  }

  // Delimited columns with quote/escape processing.
  while (pos < len) {
    const record: string[] = [];
    for (;;) {
      let col = "";
      if (peek(quote.length) !== quote) {
        // Unquoted column value.
        for (;;) {
          if (peek(recDelim.length) === recDelim) break;
          if (peek(colDelim.length) === colDelim) break;
          if (pos >= len) break;
          col += src[pos++];
        }
      } else {
        // Quoted column value — consume the opening quote first.
        pos += quote.length;
        let inQuote = true;
        for (;;) {
          if (inQuote) {
            if (escapeWithDoubleQuote) {
              // Two consecutive quote tokens → one embedded quote.
              if (peek(quote.length * 2) === quote + quote) {
                pos += quote.length; // consume first
                col += peek(quote.length); // add second
                pos += quote.length;
                continue;
              }
            } else {
              // escapeToken + quoteToken → embedded quote.
              if (peek(esc.length + quote.length) === esc + quote) {
                pos += esc.length;
                col += peek(quote.length);
                pos += quote.length;
                continue;
              }
              // escapeToken + escapeToken → embedded escape token.
              if (peek(esc.length * 2) === esc + esc) {
                pos += esc.length;
                col += peek(esc.length);
                pos += esc.length;
                continue;
              }
            }
          }
          // Closing quote token.
          if (inQuote && peek(quote.length) === quote) {
            pos += quote.length;
            inQuote = false;
            continue;
          }
          // Delimiters only break outside of quotes.
          if (!inQuote && peek(recDelim.length) === recDelim) break;
          if (!inQuote && peek(colDelim.length) === colDelim) break;
          if (pos >= len) break;
          col += src[pos++];
        }
      }

      record.push(col);

      if (pos >= len) break;
      if (peek(recDelim.length) === recDelim) {
        pos += recDelim.length;
        break;
      }
      if (peek(colDelim.length) === colDelim) {
        pos += colDelim.length;
      }
    }
    records.push(record);
  }

  return records;
}

function parseDelimited(
  text: string,
  prefix: string,
  suffix: string,
  opts: DelimitedParseOpts
): MsgTreeNode {
  // Unescape delimiters/quote tokens exactly as DelimitedReader does on init.
  const colDelim = unescapeDelimiters(opts.colDelim) || ",";
  const recDelim = unescapeDelimiters(opts.recDelim) || "\\n";
  const quote = unescapeDelimiters(opts.quoteToken) || '"';
  const esc = unescapeDelimiters(opts.quoteEscapeToken) || "\\";

  const records = tokenizeDelimited(
    text,
    colDelim,
    recDelim,
    quote,
    esc,
    opts.escapeWithDoubleQuote,
    opts.columnWidths,
    opts.ignoreCR
  );

  const names = opts.columnNames
    ? opts.columnNames
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const multiRow = records.length > 1;

  const children = records.map((cols, ri) => {
    // numberedRows → <row1>, <row2>, … (recordNo is 1-based in Java);
    // otherwise repeated <row> elements addressed positionally.
    const rowPath = opts.numberedRows
      ? `${prefix}['row${ri + 1}']`
      : multiRow
        ? `${prefix}['row'][${ri}]`
        : `${prefix}['row']`;
    const rowLabel = opts.numberedRows ? `row${ri + 1}` : multiRow ? `row [${ri}]` : "row";
    const colKids: MsgTreeNode[] = cols.map((col, ci) => {
      const colName = names[ci] || `column${ci + 1}`;
      return {
        id: `r${ri}-c${ci}`,
        label: colName,
        dragExpr: `${rowPath}['${colName}']${suffix}`,
        children: [],
        value: col || undefined,
      };
    });
    return {
      id: `r${ri}`,
      label: rowLabel,
      dragExpr: rowPath,
      children: colKids,
    };
  });

  return { id: "root", label: "Delimited Message", dragExpr: prefix, children };
}

// ── Tooltip definitions ───────────────────────────────────────────────────────

const SER_TT = {
  columnDelimiter: {
    label: "Column Delimiter",
    description:
      "If column values are delimited, enter the characters that separate columns. For example, this is a comma in a CSV file.",
  },
  recordDelimiter: {
    label: "Record Delimiter",
    description:
      "Enter the characters that separate each record (a message may contain multiple records). For example, this is a newline (\\n) in a CSV file.",
  },
  columnWidths: {
    label: "Column Widths",
    description:
      "If the column values are fixed width, enter a comma separated list of fixed column widths. By default, column values are assumed to be delimited.",
  },
  quoteToken: {
    label: "Quote Token",
    description:
      'Enter the quote characters that are used to bracket delimit column values containing embedded special characters like column delimiters, record delimiters, quote characters and/or message delimiters. For example, this is a double quote (") in a CSV file.',
  },
  escapeWithDoubleQuote: {
    label: "Double Quote Escaping",
    description:
      "By default, two consecutive quote tokens within a quoted value are treated as an embedded quote token. Uncheck to enable escaped quote token processing (and specify the Escape Token).",
  },
  quoteEscapeToken: {
    label: "Escape Token",
    description:
      "Enter the characters used to escape embedded quote tokens. By default, this is a back slash. This option has no effect unless Double Quote Escaping is unchecked.",
  },
  columnNames: {
    label: "Column Names",
    description:
      "To override the default column names (column1, ..., columnN), enter a comma separated list of column names.",
  },
  numberedRows: {
    label: "Numbered Rows",
    description: "Check to number each row in the XML representation of the message.",
  },
  ignoreCR: {
    label: "Ignore Carriage Returns",
    description:
      "Ignores carriage return (\\r) characters. These are read over and skipped without processing them.",
  },
};

const BAT_TT = {
  splitType: {
    label: "Split Batch By",
    description:
      "Select the method for splitting the batch message. This option has no effect unless Process Batch is enabled in the connector.\n\nRecord: Treat each record as a message. Records are separated by the record delimiter.\n\nDelimiter: Use the Batch Delimiter to separate messages.\n\nGrouping Column: Use a column to group multiple records into a single message. When the specified column value changes, this signifies the boundary between messages.\n\nJavaScript: Use JavaScript to split messages.",
  },
  batchSkipRecords: {
    label: "Number of Header Records",
    description:
      "The number of header records to skip. By default, no header records are skipped. This option has no effect unless Process Batch is enabled in the connector.",
  },
  batchMessageDelimiter: {
    label: "Batch Delimiter",
    description:
      "The delimiter that separates messages. The batch delimiter may be a sequence of characters. This option has no effect unless Process Batch is enabled in the connector.",
  },
  batchMessageDelimiterIncluded: {
    label: "Include Batch Delimiter",
    description:
      "Check to include the batch delimiter in the message returned by the batch processer. By default, batch delimiters are consumed. This option has no effect unless Process Batch is enabled in the connector.",
  },
  batchGroupingColumn: {
    label: "Grouping Column",
    description:
      "The name of the column used to group multiple records into a single message. When the specified column value changes, this signifies the boundary between messages. This option has no effect unless Process Batch is enabled in the connector.",
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
function gEl(el: Element | null, tag: string, fb: string): string {
  return el?.querySelector(tag)?.textContent?.trim() ?? fb;
}
function bEl(el: Element | null, tag: string, fb: boolean): boolean {
  const v = el?.querySelector(tag)?.textContent?.trim();
  return v === "true" ? true : v === "false" ? false : fb;
}

function readXStreamIntArray(parent: Element | null, tag: string): string {
  const el = parent?.querySelector(tag) ?? null;
  if (!el) return "";
  return Array.from(el.children)
    .filter((c) => c.tagName === "int")
    .map((c) => c.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(",");
}
function readXStreamStringArray(parent: Element | null, tag: string): string {
  const el = parent?.querySelector(tag) ?? null;
  if (!el) return "";
  return Array.from(el.children)
    .filter((c) => c.tagName === "string")
    .map((c) => c.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(",");
}
export function setXStreamIntArray(
  doc: Document,
  parentTag: string,
  tag: string,
  csv: string
): void {
  const parent = doc.querySelector(parentTag);
  if (!parent) return;
  const existing = parent.querySelector(tag);
  const trimmed = csv.trim();
  if (!trimmed) {
    // Empty → clear the element (Java sets columnWidths = null).
    existing?.remove();
    return;
  }
  // Java keeps the previous value when any width is non-numeric or <= 0.
  if (!isValidPositiveIntList(trimmed)) return;
  const parts = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const el =
    existing ??
    (() => {
      const e = doc.createElement(tag);
      parent.appendChild(e);
      return e;
    })();
  el.removeAttribute("class");
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const p of parts) {
    const c = doc.createElement("int");
    c.textContent = p;
    el.appendChild(c);
  }
}
export function setXStreamStringArray(
  doc: Document,
  parentTag: string,
  tag: string,
  csv: string
): void {
  const parent = doc.querySelector(parentTag);
  if (!parent) return;
  const existing = parent.querySelector(tag);
  const trimmed = csv.trim();
  if (!trimmed) {
    // Empty → clear the element (Java sets columnNames = null).
    existing?.remove();
    return;
  }
  // Java keeps the previous value when any column name is not a valid XML element name.
  if (!areValidColumnNames(trimmed)) return;
  const parts = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const el =
    existing ??
    (() => {
      const e = doc.createElement(tag);
      parent.appendChild(e);
      return e;
    })();
  el.removeAttribute("class");
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const p of parts) {
    const c = doc.createElement("string");
    c.textContent = p;
    el.appendChild(c);
  }
}

// ── PropertiesSection ─────────────────────────────────────────────────────────

function DelimitedPropertiesSection({
  propsXml,
  onChange,
  side,
  transformerType,
  isDark,
  channelId,
  version,
}: DataTypePropertiesSectionProps) {
  const xml = propsXml ?? "";
  const doc = xml ? pd(xml) : null;
  const serEl = doc?.querySelector("serializationProperties") ?? null;
  const desEl = doc?.querySelector("deserializationProperties") ?? null;
  const batEl = doc?.querySelector("batchProperties") ?? null;

  // Inbound (serialization) state
  const [sColDelim, setSColDelim] = useState(() => gEl(serEl, "columnDelimiter", ","));
  const [sRecDelim, setSRecDelim] = useState(() => gEl(serEl, "recordDelimiter", "\\n"));
  const [sColWidths, setSColWidths] = useState(() => readXStreamIntArray(serEl, "columnWidths"));
  const [sQuote, setSQuote] = useState(() => gEl(serEl, "quoteToken", '"'));
  const [sDblQ, setSDblQ] = useState(() => bEl(serEl, "escapeWithDoubleQuote", true));
  const [sEscape, setSEscape] = useState(() => gEl(serEl, "quoteEscapeToken", "\\"));
  const [sColNames, setSColNames] = useState(() => readXStreamStringArray(serEl, "columnNames"));
  const [sNumRows, setSNumRows] = useState(() => bEl(serEl, "numberedRows", false));
  const [sIgnoreCR, setSIgnoreCR] = useState(() => bEl(serEl, "ignoreCR", true));

  // Outbound (deserialization) state
  const [dColDelim, setDColDelim] = useState(() => gEl(desEl, "columnDelimiter", ","));
  const [dRecDelim, setDRecDelim] = useState(() => gEl(desEl, "recordDelimiter", "\\n"));
  const [dColWidths, setDColWidths] = useState(() => readXStreamIntArray(desEl, "columnWidths"));
  const [dQuote, setDQuote] = useState(() => gEl(desEl, "quoteToken", '"'));
  const [dDblQ, setDDblQ] = useState(() => bEl(desEl, "escapeWithDoubleQuote", true));
  const [dEscape, setDEscape] = useState(() => gEl(desEl, "quoteEscapeToken", "\\"));

  // Batch state (inbound only)
  const [splitType, setSplitType] = useState(() => gEl(batEl, "splitType", "Record"));
  const [skipRecords, setSkipRecords] = useState(() => gEl(batEl, "batchSkipRecords", "0"));
  const [batchDelim, setBatchDelim] = useState(() => gEl(batEl, "batchMessageDelimiter", ""));
  const [inclDelim, setInclDelim] = useState(() =>
    bEl(batEl, "batchMessageDelimiterIncluded", false)
  );
  const [groupingCol, setGroupingCol] = useState(() => gEl(batEl, "batchGroupingColumn", ""));
  const [batchScript, setBatchScript] = useState(() => gEl(batEl, "batchScript", ""));
  const [scriptOpen, setScriptOpen] = useState(false);

  // All three writers seed a valid default document when the stored propsXml is
  // null/empty (never serialize a parsererror doc) and use the shared
  // element-creating helpers so an edit to a field/array missing from older or
  // hand-edited channels is persisted rather than silently dropped.
  function mutate(fn: (doc: Document) => void) {
    const tagName = side === "inbound" ? "inboundProperties" : "outboundProperties";
    const d = parsePropsOrDefault(
      propsXml,
      DelimitedDataType.defaultPropertiesXml(tagName, version ?? "")
    );
    fn(d);
    onChange(new XMLSerializer().serializeToString(d.documentElement));
  }
  function updateText(selector: string, value: string) {
    mutate((d) => setXmlText(d, selector, value));
  }
  function updateIntArray(parentTag: string, tag: string, value: string) {
    mutate((d) => setXStreamIntArray(d, parentTag, tag, value));
  }
  function updateStringArray(parentTag: string, tag: string, value: string) {
    mutate((d) => setXStreamStringArray(d, parentTag, tag, value));
  }
  // Java guards these string fields with StringUtils.isNotEmpty — an empty value
  // keeps the previously persisted value rather than writing an empty element.
  function updateTextIfNotEmpty(selector: string, value: string) {
    if (value === "") return;
    updateText(selector, value);
  }

  // Red-border cue: the value won't be persisted (kept-previous, mirroring Java)
  // when a width is not a positive integer, or a column name is not a valid XML name.
  const widthsInvalid = (v: string) => v.trim() !== "" && !isValidPositiveIntList(v);
  const namesInvalid = (v: string) => v.trim() !== "" && !areValidColumnNames(v);

  // ── INBOUND ────────────────────────────────────────────────────────────────

  if (side === "inbound") {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-3 py-3 space-y-4 text-xs">
            {/* Serialization */}
            <div>
              <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">Serialization</p>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center">
                <PropertyRow
                  info={SER_TT.columnDelimiter}
                  label="Column Delimiter"
                  labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                >
                  <input
                    type="text"
                    value={sColDelim}
                    onChange={(e) => {
                      setSColDelim(e.target.value);
                      updateTextIfNotEmpty(
                        "serializationProperties > columnDelimiter",
                        e.target.value
                      );
                    }}
                    className={`${inputCls} w-16`}
                  />
                </PropertyRow>

                <PropertyRow
                  info={SER_TT.recordDelimiter}
                  label="Record Delimiter"
                  labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                >
                  <input
                    type="text"
                    value={sRecDelim}
                    onChange={(e) => {
                      setSRecDelim(e.target.value);
                      updateTextIfNotEmpty(
                        "serializationProperties > recordDelimiter",
                        e.target.value
                      );
                    }}
                    className={`${inputCls} w-16`}
                  />
                </PropertyRow>

                <PropertyRow
                  info={SER_TT.columnWidths}
                  label="Column Widths"
                  labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                >
                  <input
                    type="text"
                    value={sColWidths}
                    onChange={(e) => {
                      setSColWidths(e.target.value);
                      updateIntArray("serializationProperties", "columnWidths", e.target.value);
                    }}
                    className={cn(
                      inputCls,
                      "w-full",
                      widthsInvalid(sColWidths) && "border-red-500"
                    )}
                  />
                </PropertyRow>

                <PropertyRow
                  info={SER_TT.quoteToken}
                  label="Quote Token"
                  labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                >
                  <input
                    type="text"
                    value={sQuote}
                    onChange={(e) => {
                      setSQuote(e.target.value);
                      updateTextIfNotEmpty("serializationProperties > quoteToken", e.target.value);
                    }}
                    className={`${inputCls} w-16`}
                  />
                </PropertyRow>

                <PropertyRow
                  info={SER_TT.quoteEscapeToken}
                  label="Escape Token"
                  labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                >
                  <input
                    type="text"
                    value={sEscape}
                    onChange={(e) => {
                      setSEscape(e.target.value);
                      updateTextIfNotEmpty(
                        "serializationProperties > quoteEscapeToken",
                        e.target.value
                      );
                    }}
                    className={`${inputCls} w-16`}
                  />
                </PropertyRow>

                <PropertyRow
                  info={SER_TT.columnNames}
                  label="Column Names"
                  labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                >
                  <input
                    type="text"
                    value={sColNames}
                    onChange={(e) => {
                      setSColNames(e.target.value);
                      updateStringArray("serializationProperties", "columnNames", e.target.value);
                    }}
                    className={cn(inputCls, "w-full", namesInvalid(sColNames) && "border-red-500")}
                  />
                </PropertyRow>
              </div>
              <div className="mt-1.5 space-y-1.5">
                <PropertyCheckbox
                  label="Double Quote Escaping"
                  checked={sDblQ}
                  onChange={(v) => {
                    setSDblQ(v);
                    updateText("serializationProperties > escapeWithDoubleQuote", String(v));
                  }}
                  info={SER_TT.escapeWithDoubleQuote}
                />
                <PropertyCheckbox
                  label="Numbered Rows"
                  checked={sNumRows}
                  onChange={(v) => {
                    setSNumRows(v);
                    updateText("serializationProperties > numberedRows", String(v));
                  }}
                  info={SER_TT.numberedRows}
                />
                <PropertyCheckbox
                  label="Ignore Carriage Returns"
                  checked={sIgnoreCR}
                  onChange={(v) => {
                    setSIgnoreCR(v);
                    updateText("serializationProperties > ignoreCR", String(v));
                  }}
                  info={SER_TT.ignoreCR}
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
                        updateText("batchProperties > splitType", e.target.value);
                      }}
                      className={selectCls}
                    >
                      <option value="Record">Record</option>
                      <option value="Delimiter">Delimiter</option>
                      <option value="Grouping_Column">Grouping Column</option>
                      <option value="JavaScript">JavaScript</option>
                    </select>
                  </PropertyRow>

                  <PropertyRow
                    info={BAT_TT.batchSkipRecords}
                    label="Number of Header Records"
                    labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                  >
                    <input
                      type="text"
                      value={skipRecords}
                      onChange={(e) => {
                        // Digits-only; empty or out-of-int-range keeps the previous
                        // value (Java isNotEmpty + Integer.parseInt guard).
                        const v = sanitizeDigits(e.target.value);
                        setSkipRecords(v);
                        if (fitsInt32(v)) updateText("batchProperties > batchSkipRecords", v);
                      }}
                      className={`${inputCls} w-16`}
                    />
                  </PropertyRow>

                  <PropertyRow
                    info={BAT_TT.batchMessageDelimiter}
                    label="Batch Delimiter"
                    labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                  >
                    <input
                      type="text"
                      value={batchDelim}
                      onChange={(e) => {
                        setBatchDelim(e.target.value);
                        updateText("batchProperties > batchMessageDelimiter", e.target.value);
                      }}
                      className={`${inputCls} w-full`}
                    />
                  </PropertyRow>

                  <PropertyRow
                    info={BAT_TT.batchGroupingColumn}
                    label="Grouping Column"
                    labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
                  >
                    <input
                      type="text"
                      value={groupingCol}
                      onChange={(e) => {
                        setGroupingCol(e.target.value);
                        updateText("batchProperties > batchGroupingColumn", e.target.value);
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
                <div className="mt-1.5">
                  <PropertyCheckbox
                    label="Include Batch Delimiter"
                    checked={inclDelim}
                    onChange={(v) => {
                      setInclDelim(v);
                      updateText("batchProperties > batchMessageDelimiterIncluded", String(v));
                    }}
                    info={BAT_TT.batchMessageDelimiterIncluded}
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
            updateText("batchProperties > batchScript", v);
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
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center">
              <PropertyRow
                info={SER_TT.columnDelimiter}
                label="Column Delimiter"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={dColDelim}
                  onChange={(e) => {
                    setDColDelim(e.target.value);
                    updateTextIfNotEmpty(
                      "deserializationProperties > columnDelimiter",
                      e.target.value
                    );
                  }}
                  className={`${inputCls} w-16`}
                />
              </PropertyRow>

              <PropertyRow
                info={SER_TT.recordDelimiter}
                label="Record Delimiter"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={dRecDelim}
                  onChange={(e) => {
                    setDRecDelim(e.target.value);
                    updateTextIfNotEmpty(
                      "deserializationProperties > recordDelimiter",
                      e.target.value
                    );
                  }}
                  className={`${inputCls} w-16`}
                />
              </PropertyRow>

              <PropertyRow
                info={SER_TT.columnWidths}
                label="Column Widths"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={dColWidths}
                  onChange={(e) => {
                    setDColWidths(e.target.value);
                    updateIntArray("deserializationProperties", "columnWidths", e.target.value);
                  }}
                  className={cn(inputCls, "w-full", widthsInvalid(dColWidths) && "border-red-500")}
                />
              </PropertyRow>

              <PropertyRow
                info={SER_TT.quoteToken}
                label="Quote Token"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={dQuote}
                  onChange={(e) => {
                    setDQuote(e.target.value);
                    updateTextIfNotEmpty("deserializationProperties > quoteToken", e.target.value);
                  }}
                  className={`${inputCls} w-16`}
                />
              </PropertyRow>

              <PropertyRow
                info={SER_TT.quoteEscapeToken}
                label="Escape Token"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={dEscape}
                  onChange={(e) => {
                    setDEscape(e.target.value);
                    updateTextIfNotEmpty(
                      "deserializationProperties > quoteEscapeToken",
                      e.target.value
                    );
                  }}
                  className={`${inputCls} w-16`}
                />
              </PropertyRow>
            </div>
            <div className="mt-1.5">
              <PropertyCheckbox
                label="Double Quote Escaping"
                checked={dDblQ}
                onChange={(v) => {
                  setDDblQ(v);
                  updateText("deserializationProperties > escapeWithDoubleQuote", String(v));
                }}
                info={SER_TT.escapeWithDoubleQuote}
              />
            </div>
          </div>

          {/* Template Serialization */}
          <div>
            <p className="font-semibold text-gray-700 dark:text-gray-200 mb-2">
              Template Serialization
            </p>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center">
              <PropertyRow
                info={SER_TT.columnDelimiter}
                label="Column Delimiter"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={sColDelim}
                  onChange={(e) => {
                    setSColDelim(e.target.value);
                    updateText("serializationProperties > columnDelimiter", e.target.value);
                  }}
                  className={`${inputCls} w-16`}
                />
              </PropertyRow>

              <PropertyRow
                info={SER_TT.recordDelimiter}
                label="Record Delimiter"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={sRecDelim}
                  onChange={(e) => {
                    setSRecDelim(e.target.value);
                    updateText("serializationProperties > recordDelimiter", e.target.value);
                  }}
                  className={`${inputCls} w-16`}
                />
              </PropertyRow>

              <PropertyRow
                info={SER_TT.columnWidths}
                label="Column Widths"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={sColWidths}
                  onChange={(e) => {
                    setSColWidths(e.target.value);
                    updateIntArray("serializationProperties", "columnWidths", e.target.value);
                  }}
                  className={`${inputCls} w-full`}
                />
              </PropertyRow>

              <PropertyRow
                info={SER_TT.quoteToken}
                label="Quote Token"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={sQuote}
                  onChange={(e) => {
                    setSQuote(e.target.value);
                    updateText("serializationProperties > quoteToken", e.target.value);
                  }}
                  className={`${inputCls} w-16`}
                />
              </PropertyRow>

              <PropertyRow
                info={SER_TT.quoteEscapeToken}
                label="Escape Token"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={sEscape}
                  onChange={(e) => {
                    setSEscape(e.target.value);
                    updateText("serializationProperties > quoteEscapeToken", e.target.value);
                  }}
                  className={`${inputCls} w-16`}
                />
              </PropertyRow>

              <PropertyRow
                info={SER_TT.columnNames}
                label="Column Names"
                labelClassName="text-gray-600 dark:text-gray-400 whitespace-nowrap"
              >
                <input
                  type="text"
                  value={sColNames}
                  onChange={(e) => {
                    setSColNames(e.target.value);
                    updateStringArray("serializationProperties", "columnNames", e.target.value);
                  }}
                  className={`${inputCls} w-full`}
                />
              </PropertyRow>
            </div>
            <div className="mt-1.5 space-y-1.5">
              <PropertyCheckbox
                label="Double Quote Escaping"
                checked={sDblQ}
                onChange={(v) => {
                  setSDblQ(v);
                  updateText("serializationProperties > escapeWithDoubleQuote", String(v));
                }}
                info={SER_TT.escapeWithDoubleQuote}
              />
              <PropertyCheckbox
                label="Numbered Rows"
                checked={sNumRows}
                onChange={(v) => {
                  setSNumRows(v);
                  updateText("serializationProperties > numberedRows", String(v));
                }}
                info={SER_TT.numberedRows}
              />
              <PropertyCheckbox
                label="Ignore Carriage Returns"
                checked={sIgnoreCR}
                onChange={(v) => {
                  setSIgnoreCR(v);
                  updateText("serializationProperties > ignoreCR", String(v));
                }}
                info={SER_TT.ignoreCR}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Plugin definition ─────────────────────────────────────────────────────────

export const DelimitedDataType: DataTypeDefinition = {
  name: "DELIMITED",
  displayName: "Delimited Text",

  defaultPropertiesXml(tagName, version) {
    const base = "com.mirth.connect.plugins.datatypes.delimited";
    // prettier-ignore
    return (
      `<${tagName} class="${base}.DelimitedDataTypeProperties" version="${version}">` +
      `<serializationProperties class="${base}.DelimitedSerializationProperties" version="${version}">` +
      `<columnDelimiter>,</columnDelimiter>` +
      `<recordDelimiter>\\n</recordDelimiter>` +
      `<quoteToken>"</quoteToken>` +
      `<escapeWithDoubleQuote>true</escapeWithDoubleQuote>` +
      `<quoteEscapeToken>\\</quoteEscapeToken>` +
      `<numberedRows>false</numberedRows>` +
      `<ignoreCR>true</ignoreCR>` +
      `</serializationProperties>` +
      `<deserializationProperties class="${base}.DelimitedDeserializationProperties" version="${version}">` +
      `<columnDelimiter>,</columnDelimiter>` +
      `<recordDelimiter>\\n</recordDelimiter>` +
      `<quoteToken>"</quoteToken>` +
      `<escapeWithDoubleQuote>true</escapeWithDoubleQuote>` +
      `<quoteEscapeToken>\\</quoteEscapeToken>` +
      `</deserializationProperties>` +
      `<batchProperties class="${base}.DelimitedBatchProperties" version="${version}">` +
      `<splitType>Record</splitType>` +
      `<batchSkipRecords>0</batchSkipRecords>` +
      `<batchMessageDelimiter></batchMessageDelimiter>` +
      `<batchMessageDelimiterIncluded>false</batchMessageDelimiterIncluded>` +
      `<batchGroupingColumn></batchGroupingColumn>` +
      `<batchScript></batchScript>` +
      `</batchProperties>` +
      `</${tagName}>`
    );
  },

  parseTemplate(text, prefix, suffix, propsXml) {
    const s = propsXml ? pd(propsXml).querySelector("serializationProperties") : null;
    const widths = readXStreamIntArray(s, "columnWidths")
      .split(",")
      .map((w) => Number(w.trim()))
      .filter((w) => Number.isFinite(w) && w > 0);
    return parseDelimited(text, prefix, suffix, {
      colDelim: gEl(s, "columnDelimiter", ","),
      recDelim: gEl(s, "recordDelimiter", "\\n"),
      quoteToken: gEl(s, "quoteToken", '"'),
      quoteEscapeToken: gEl(s, "quoteEscapeToken", "\\"),
      escapeWithDoubleQuote: bEl(s, "escapeWithDoubleQuote", true),
      columnWidths: widths,
      columnNames: readXStreamStringArray(s, "columnNames"),
      numberedRows: bEl(s, "numberedRows", false),
      ignoreCR: bEl(s, "ignoreCR", true),
    });
  },

  PropertiesSection: DelimitedPropertiesSection,
};
