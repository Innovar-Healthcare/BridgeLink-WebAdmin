import type { ConnectorDataTypeRow } from "./channel-xml";
import {
  defaultPropertiesXml,
  parseDataTypesFromXml,
  serializeDataTypesToXml,
} from "./channel-xml";

// ─── Pure data-type change + cascade (mirrors Java DataTypesDialog.updateSingleDataType) ──────
//
// Returns a new connectors array with the type change applied and the same
// cascades the Java client performs. Both the "Set Data Types" dialog (table cell
// and properties panel) and the transformer Message Templates path funnel
// through this single function so every entry point behaves identically:
//   • source outbound → every destination inbound follows
//   • destination outbound → that destination's response row inbound + outbound follow
//
// Destinations receive the target type's *default* properties (a fresh object per row),
// not the source's configured properties — matching Java's getDefaultProperties() reset.
export function applyDataTypeChange(
  connectors: ConnectorDataTypeRow[],
  id: string,
  side: "in" | "out",
  newType: string,
  version: string
): ConnectorDataTypeRow[] {
  return connectors.map((c) => {
    if (c.id === id) {
      return side === "in"
        ? {
            ...c,
            inboundDataType: newType,
            inboundPropertiesXml: defaultPropertiesXml(newType, "inboundProperties", version),
          }
        : {
            ...c,
            outboundDataType: newType,
            outboundPropertiesXml: defaultPropertiesXml(newType, "outboundProperties", version),
          };
    }
    // When source outbound changes, cascade to all destination inbound types
    // (destination inbound must always equal source outbound)
    if (id === "source" && side === "out" && !c.parentId && c.id !== "source") {
      return {
        ...c,
        inboundDataType: newType,
        inboundPropertiesXml: defaultPropertiesXml(newType, "inboundProperties", version),
      };
    }
    // When a destination outbound changes, cascade to its response row both inbound and outbound
    // (response inbound + outbound must match destination outbound — mirrors Java client behavior)
    if (side === "out" && c.parentId === id) {
      return {
        ...c,
        inboundDataType: newType,
        inboundPropertiesXml: defaultPropertiesXml(newType, "inboundProperties", version),
        outboundDataType: newType,
        outboundPropertiesXml: defaultPropertiesXml(newType, "outboundProperties", version),
      };
    }
    return c;
  });
}

// ─── Transformer-path outbound cascade ──────────────────────────────
//
// A connector's OUTBOUND data type can be changed from two places: the Summary
// "Set Data Types" dialog (handled by applyDataTypeChange directly) and the
// transformer's Message Templates tab. The transformer path only re-serializes
// that one connector's XML, so this helper re-applies the same cross-connector
// cascade after the fact, given the channel XML before and after the transformer
// edit:
//   • rowId "source"  → every destination inbound follows the source outbound
//   • rowId "dest-N"  → that destination's response row inbound + outbound follow
//
// Guarded on an actual outbound-type change: when the outbound type is unchanged
// (an ordinary transformer edit — steps, scripts, template text) `nextXml` is
// returned unchanged, so a caller comparing `result !== nextXml` can cheaply skip
// re-derivation. A real cascade always produces a different string (every stale
// destination inbound in `nextXml` gets rewritten), so the comparison is reliable.
export function cascadeOutboundDataType(prevXml: string, nextXml: string, rowId: string): string {
  const oldOut = parseDataTypesFromXml(prevXml).connectors.find(
    (c) => c.id === rowId
  )?.outboundDataType;
  const after = parseDataTypesFromXml(nextXml);
  const newOut = after.connectors.find((c) => c.id === rowId)?.outboundDataType;
  if (!newOut || newOut === oldOut) return nextXml;
  const cascaded = applyDataTypeChange(after.connectors, rowId, "out", newOut, after.version);
  return serializeDataTypesToXml(nextXml, { ...after, connectors: cascaded });
}
