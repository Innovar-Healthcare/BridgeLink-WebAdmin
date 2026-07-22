"use client";

import { RefreshCw } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { useColumnConfig, type ColDef } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";

// ─── Column definitions ──────────────────────────────────────────────────────

type GlobalMapCol = "server" | "channel" | "key" | "value";

const GLOBAL_MAP_COLS: ColDef<GlobalMapCol>[] = [
  { key: "server", label: "Server", defaultWidth: 144, minWidth: 60, defaultVisible: true },
  { key: "channel", label: "Channel", defaultWidth: 160, minWidth: 60, defaultVisible: true },
  { key: "key", label: "Key", defaultWidth: 160, minWidth: 60, defaultVisible: true },
  { key: "value", label: "Value", defaultWidth: 320, minWidth: 80, defaultVisible: true },
];

interface GlobalMapRow {
  serverId: string;
  channel: string;
  key: string;
  value: string;
}

// ─── XStream global-map value deserializer ────────────────────────────────────
//
// Global map values are stored as XStream-serialized XML strings on the server.
// The Java client deserializes them back to objects and then calls StringUtil.valueOf().
// We replicate that here so values display cleanly instead of showing raw XML tags.
//
// Handles:
//   <string>foo</string>            → "foo"
//   <int>42</int>                   → "42"
//   <long>42</long>                 → "42"
//   <double>3.14</double>           → "3.14"
//   <boolean>true</boolean>         → "true"
//   <null/>                         → ""
//   <map><entry>…</entry></map>     → "{key=value, key=value}" (Java Map.toString style)
//   <list><string>a</string>…</list>→ "[a, b, c]" (Java Arrays.toString / List.toString style)
//   <entry><string>k</string><string>v</string></entry> → used inside map
//   Anything else / parse failure   → raw string as-is

export function deserializeXStreamValue(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s.startsWith("<")) return s; // Not XML — already a plain string

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<root>${s}</root>`, "application/xml");
    if (doc.querySelector("parsererror")) return s; // Malformed XML — return as-is
    const root = doc.documentElement;
    return nodeToDisplayString(root.firstElementChild ?? root);
  } catch {
    return s;
  }
}

export function nodeToDisplayString(el: Element | null): string {
  if (!el) return "";
  const tag = el.tagName.toLowerCase();

  // Primitive scalar types — return text content directly
  if (
    ["string", "int", "long", "double", "float", "short", "byte", "char", "boolean"].includes(tag)
  ) {
    return el.textContent ?? "";
  }

  // Null
  if (tag === "null") return "";

  // Map → {key=value, key=value} matching Java's AbstractMap.toString()
  if (tag === "map" || tag === "linked-hash-map" || tag === "sorted-map" || tag === "tree-map") {
    const entries = Array.from(el.querySelectorAll(":scope > entry"));
    if (entries.length === 0) return "{}";
    const pairs = entries.map((entry) => {
      const children = Array.from(entry.children);
      const k = children[0] ? nodeToDisplayString(children[0]) : "";
      const v = children[1] ? nodeToDisplayString(children[1]) : "";
      return `${k}=${v}`;
    });
    return `{${pairs.join(", ")}}`;
  }

  // List / array / set → [a, b, c] matching Java's AbstractList.toString()
  if (
    ["list", "array-list", "linked-list", "set", "tree-set", "linked-hash-set", "array"].includes(
      tag
    )
  ) {
    const children = Array.from(el.children);
    if (children.length === 0) return "[]";
    return `[${children.map(nodeToDisplayString).join(", ")}]`;
  }

  // Generic object-array fallback
  if (tag === "string-array" || tag.endsWith("-array")) {
    const children = Array.from(el.children);
    return `[${children.map(nodeToDisplayString).join(", ")}]`;
  }

  // Unknown complex type — try to get text content, fall back to outer XML
  const text = el.textContent?.trim();
  if (text) return text;
  return el.outerHTML;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface GlobalMapsTabProps {
  mapRows: Array<{ serverId: string; channel: string; key: string; value: string }>;
  mapFilter: string;
  onMapFilterChange: (filter: string) => void;
  mapLoading: boolean;
  expandedValue: string | null;
  onExpandedValueChange: (value: string | null) => void;
  onRefresh: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GlobalMapsTab({
  mapRows,
  mapFilter,
  onMapFilterChange,
  mapLoading,
  expandedValue,
  onExpandedValueChange,
  onRefresh,
}: GlobalMapsTabProps) {
  const colConfig = useColumnConfig(GLOBAL_MAP_COLS, "bl-global-maps-cols-v1");
  const sortState = useSortable<GlobalMapCol>("server", "asc");

  const filtered = mapRows.filter((r) => {
    if (!mapFilter) return true;
    const f = mapFilter.toLowerCase();
    return (
      r.key.toLowerCase().includes(f) ||
      r.value.toLowerCase().includes(f) ||
      r.channel.toLowerCase().includes(f)
    );
  });

  const sortedRows = sortState.sorted(filtered, (r) => {
    switch (sortState.sort.key) {
      case "server":
        return r.serverId;
      case "channel":
        return r.channel;
      case "key":
        return r.key;
      case "value":
        return r.value;
      default:
        return undefined;
    }
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0 bg-white dark:bg-gray-900">
        <button
          onClick={onRefresh}
          disabled={mapLoading}
          className="flex items-center gap-1 px-2 py-1 text-xs border border-border text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${mapLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">Filter:</span>
        <input
          type="text"
          value={mapFilter}
          onChange={(e) => onMapFilterChange(e.target.value)}
          placeholder="Search keys or values…"
          className="appearance-none border border-border bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 rounded px-2 py-0.5 text-xs w-40 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>
      {/* Map table */}
      <DataTable<GlobalMapRow, GlobalMapCol>
        variant="sortable"
        cols={GLOBAL_MAP_COLS}
        rows={sortedRows}
        colConfig={colConfig}
        sortState={sortState}
        rowKey={(_r, i) => `${i}`}
        loading={mapLoading}
        empty="No global map entries."
        containerClassName="flex-1 min-h-0 m-2"
        cellMono={{ server: true, key: true, value: true }}
        renderCell={(row, col) => {
          if (col === "value") {
            return (
              <span
                title="Click to view full value"
                onClick={() => onExpandedValueChange(row.value)}
                className="cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
              >
                {row.value}
              </span>
            );
          }
          if (col === "server") return <span title={row.serverId}>{row.serverId}</span>;
          if (col === "channel") return <span title={row.channel}>{row.channel}</span>;
          return <span title={row.key}>{row.key}</span>;
        }}
      />

      {/* Value expand modal */}
      {expandedValue !== null && (
        <div
          className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
          onClick={() => onExpandedValueChange(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded shadow-lg max-w-2xl w-full mx-4 p-4 max-h-[60vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Value</span>
              <button
                onClick={() => onExpandedValueChange(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <pre className="flex-1 overflow-auto text-xs font-mono bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded p-3 border border-border whitespace-pre-wrap break-all">
              {expandedValue}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
