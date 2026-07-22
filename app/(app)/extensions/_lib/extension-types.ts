import type { ColDef } from "@/lib/hooks/use-column-config";
import type { ConnectorMetaData, PluginMetaData } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExtensionKind = "connector" | "plugin";

export interface ExtensionRow {
  kind: ExtensionKind;
  name: string;
  author: string;
  version: string;
  url: string;
  description: string;
  path: string; // extension folder path — required by uninstall API
  connectorType?: string; // "SOURCE" | "DESTINATION" — connectors only
  enabled: boolean;
}

// ─── Row builders ─────────────────────────────────────────────────────────────

/**
 * Build the ExtensionRow fields shared by connectors and plugins.
 *
 * `path` is the uninstall target (the extension's folder name, e.g. "smtp"). The server
 * serializes `MetaData.path` as an XStream attribute (`@XStreamAsAttribute`), so after
 * `normalizeXStream` it arrives as `"@path"`, never `"path"`. We read `"@path"` first, fall
 * back to a bare `"path"`, then to the display name. Reading only `path` (undefined here) and
 * falling back to the name makes uninstall a silent no-op for every extension.
 */
function baseExtensionRow(
  name: string,
  meta: ConnectorMetaData | PluginMetaData,
  kind: ExtensionKind,
  enabled: boolean
): ExtensionRow {
  return {
    kind,
    name: meta.name ?? name,
    author: meta.author ?? "",
    version: meta.pluginVersion ?? "",
    url: meta.url ?? "",
    description: meta.description ?? "",
    path: meta["@path"] ?? meta.path ?? name,
    enabled,
  };
}

/** Map normalized connector metadata to a table row. */
export function connectorMetaToRow(
  name: string,
  meta: ConnectorMetaData,
  enabled: boolean
): ExtensionRow {
  return { ...baseExtensionRow(name, meta, "connector", enabled), connectorType: meta.type };
}

/** Map normalized plugin metadata to a table row. */
export function pluginMetaToRow(
  name: string,
  meta: PluginMetaData,
  enabled: boolean
): ExtensionRow {
  return baseExtensionRow(name, meta, "plugin", enabled);
}

// ─── Column definitions ───────────────────────────────────────────────────────

export type ExtCol = "status" | "name" | "author" | "url" | "version" | "description";

export const EXT_COLS: ColDef<ExtCol>[] = [
  {
    key: "status",
    label: "Status",
    defaultWidth: 100,
    minWidth: 80,
    defaultVisible: true,
    canHide: false,
  },
  {
    key: "name",
    label: "Name",
    defaultWidth: 220,
    minWidth: 120,
    defaultVisible: true,
    canHide: false,
  },
  {
    key: "author",
    label: "Author",
    defaultWidth: 180,
    minWidth: 100,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "url",
    label: "URL",
    defaultWidth: 180,
    minWidth: 100,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "version",
    label: "Version",
    defaultWidth: 90,
    minWidth: 60,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "description",
    label: "Description",
    defaultWidth: 340,
    minWidth: 120,
    defaultVisible: true,
    canHide: true,
  },
];
