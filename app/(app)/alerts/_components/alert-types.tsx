/**
 * Shared types, constants, and form helpers for the Alerts page and its sub-components.
 */

import React from "react";
import type { AlertChannels, AlertConnectors, AlertModel } from "@/lib/types";

// ─── Constants ────────────────────────────────────────────────────────────────

/** All ErrorEventType enum values, with display labels matching Java UI. */
export const ERROR_EVENT_TYPES: { key: string; label: string }[] = [
  { key: "ANY", label: "Any" },
  { key: "SOURCE_CONNECTOR", label: "Source Connector" },
  { key: "DESTINATION_CONNECTOR", label: "Destination Connector" },
  { key: "SERIALIZER", label: "Serializer" },
  { key: "FILTER", label: "Filter" },
  { key: "TRANSFORMER", label: "Transformer" },
  { key: "USER_DEFINED_TRANSFORMER", label: "User Defined Transformer" },
  { key: "RESPONSE_VALIDATION", label: "Response Validation" },
  { key: "RESPONSE_TRANSFORMER", label: "Response Transformer" },
  { key: "ATTACHMENT_HANDLER", label: "Attachment Handler" },
  { key: "DEPLOY_SCRIPT", label: "Deploy Script" },
  { key: "PREPROCESSOR_SCRIPT", label: "Preprocessor Script" },
  { key: "POSTPROCESSOR_SCRIPT", label: "Postprocessor Script" },
  { key: "UNDEPLOY_SCRIPT", label: "Undeploy Script" },
];

/** Velocity template variables available in alert templates (from DefaultAlertWorker). */
export const TEMPLATE_VARS = [
  "${alertId}",
  "${alertName}",
  "${serverId}",
  "${serverName}",
  "${environmentName}",
  "${globalMapVariable}",
  "${date}",
  "${systemTime}",
  "${error}",
  "${errorMessage}",
  "${errorType}",
  "${channelId}",
  "${channelName}",
  "${connectorName}",
  "${connectorType}",
  "${messageId}",
];

// ─── Shared input/label styles ────────────────────────────────────────────────

export const inputCls =
  "border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200";
export const btnCls =
  "flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-border rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed";

// ─── Form state types ─────────────────────────────────────────────────────────

export interface ActionRow {
  protocol: string;
  recipient: string;
}

/** Channel node including its connectors for the tree UI */
export interface ChannelNode {
  id: string;
  name: string;
  // connector metaDataIds; 0 = source, 1+ = destinations,
  // null = the per-channel "[New Destinations]" pseudo-connector
  connectors: { metaDataId: number | null; name: string }[];
}

export type ConnectorState = "enabled" | "disabled";
export type ChannelState = "enabled" | "disabled" | "partial";

export interface AlertForm {
  name: string;
  enabled: boolean;
  // Trigger
  errorEventTypes: Set<string>;
  regex: string;
  // Channels
  newChannelSource: boolean;
  newChannelDestination: boolean;
  /** channel-level state (computed from connectorStates, or explicit if no connectors known) */
  channelStates: Map<string, ChannelState>;
  /** per-connector state: channelId → (metaDataId → enabled); metaDataId null = [New Destinations] */
  connectorStates: Map<string, Map<number | null, ConnectorState>>;
  // Actions (one group)
  subject: string;
  template: string;
  actions: ActionRow[];
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

export function emptyForm(allChannelIds: string[]): AlertForm {
  const channelStates = new Map<string, ChannelState>();
  const connectorStates = new Map<string, Map<number | null, ConnectorState>>();
  for (const id of allChannelIds) channelStates.set(id, "enabled");
  return {
    name: "",
    // Java's AlertModel constructor defaults enabled=false; a new alert starts disabled.
    enabled: false,
    errorEventTypes: new Set(["ANY"]),
    regex: "",
    newChannelSource: true,
    newChannelDestination: true,
    channelStates,
    connectorStates,
    subject: "",
    template: "",
    actions: [],
  };
}

/** Coerce a value that should be a string[] to an actual array.
 * XStream serializes Set<String> and EnumSet in several formats depending on the server version:
 *   - null                              → []        (empty/unset set)
 *   - "value"                           → ["value"] (single string, already unwrapped)
 *   - ["v1","v2"]                       → as-is     (already an array)
 *   - {"string": "value"}              → ["value"] (XStream Set<String> without @class)
 *   - {"string": ["v1","v2"]}          → ["v1","v2"]
 *   - {"errorEventType": "ANY"}        → ["ANY"]   (XStream EnumSet, enum alias as key)
 *   - {"errorEventType": ["ANY","X"]}  → ["ANY","X"]
 * The last two formats occur on some server versions that don't emit the "set" wrapper.
 */
export function toStringArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return [v];
  // Object with a single key whose value is a string or string[] — XStream Set/EnumSet
  if (typeof v === "object" && v !== null) {
    const keys = Object.keys(v as object);
    if (keys.length === 1) {
      const inner = (v as Record<string, unknown>)[keys[0]];
      if (typeof inner === "string") return [inner];
      if (Array.isArray(inner)) return inner.map(String);
    }
  }
  return [];
}

/** Coerce a value that should be a Set<Integer> to an actual (number | null)[].
 * Numeric analog of {@link toStringArray} for AlertConnectors' enabled/disabledConnectors.
 * XStream/Staxon serializes Set<Integer> in several shapes; after normalizeXStream the
 * `{int: N}` wrappers are usually already unwrapped, but we handle both forms defensively:
 *   - null / undefined                 → []            (unset set; the whole field absent)
 *   - 5                                → [5]           (single, already unwrapped)
 *   - [0, 1]                           → [0, 1]        (already an array)
 *   - [0, null]                        → [0, null]     (null element = [New Destinations])
 *   - {"int": 5}                       → [5]           (raw XStream, single)
 *   - {"int": [0, 1]}                  → [0, 1]
 *   - {"int": [0], "null": ""}         → [0, null]     (mixed int + XStream <null/> member)
 * A literal `null` *element* (or a "null" key) is the per-channel "[New Destinations]"
 * pseudo-connector; a `null` value for the whole field means the set is unset → [].
 */
export function toNumberArray(v: unknown): (number | null)[] {
  if (v === null || v === undefined) return [];
  if (typeof v === "number") return [v];
  if (typeof v === "string") {
    if (v === "null") return [null];
    const n = Number(v);
    return Number.isNaN(n) ? [] : [n];
  }
  if (Array.isArray(v)) {
    const out: (number | null)[] = [];
    for (const x of v) {
      if (x === null) out.push(null);
      else out.push(...toNumberArray(x));
    }
    return out;
  }
  if (typeof v === "object") {
    const rec = v as Record<string, unknown>;
    const out: (number | null)[] = [];
    if ("int" in rec) out.push(...toNumberArray(rec.int));
    if ("null" in rec) out.push(null); // XStream <null/> member ([New Destinations])
    if (out.length === 0) {
      // Unknown single-key primitive wrapper (e.g. {"integer": N}) — unwrap once.
      const keys = Object.keys(rec);
      if (keys.length === 1 && keys[0] !== "int" && keys[0] !== "null") {
        return toNumberArray(rec[keys[0]]);
      }
    }
    return out;
  }
  return [];
}

/** Normalize the loaded `partialChannels` value into a clean channelId → AlertConnectors map.
 * Mirrors Java's Map<String, AlertConnectors>. The value can arrive in several shapes
 * depending on how normalizeXStream collapsed the XStream entry envelope:
 *   - already keyed:   { "<id>": { alertConnectors?: {...} | enabledConnectors,... } }
 *   - entry envelope:  { entry: [{ string, alertConnectors }] } | { entry: {...} }
 *   - bare entry array: [{ string, alertConnectors }]
 * Connector sets are coerced via {@link toNumberArray} (handles scalar/array/null member).
 */
export function parsePartialChannels(raw: unknown): Record<string, AlertConnectors> {
  const out: Record<string, AlertConnectors> = {};
  if (!raw || typeof raw !== "object") return out;

  const readConnectors = (val: unknown): AlertConnectors => {
    const obj = (val ?? {}) as Record<string, unknown>;
    // Value may be the AlertConnectors object directly, or still wrapped in `alertConnectors`.
    const inner =
      obj.alertConnectors && typeof obj.alertConnectors === "object"
        ? (obj.alertConnectors as Record<string, unknown>)
        : obj;
    return {
      enabledConnectors: toNumberArray(inner.enabledConnectors),
      disabledConnectors: toNumberArray(inner.disabledConnectors),
    };
  };

  const rec = raw as Record<string, unknown>;
  let entries: unknown[] | null = null;
  if (Array.isArray(raw)) {
    entries = raw;
  } else if ("entry" in rec) {
    entries = Array.isArray(rec.entry) ? rec.entry : [rec.entry];
  }

  if (entries) {
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const id = e.string == null ? "" : String(e.string);
      if (!id) continue;
      out[id] = readConnectors(e);
    }
    return out;
  }

  // Already keyed by channelId.
  for (const [id, val] of Object.entries(rec)) {
    if (!id) continue;
    out[id] = readConnectors(val);
  }
  return out;
}

export function modelToForm(model: AlertModel, channelNodes: ChannelNode[]): AlertForm {
  const ch = model.trigger.alertChannels;
  // Guard: server serializes unset collections as null, not []/{}
  // Also coerce: normalizer may return a plain string for a single-item XStream set
  const enabledChannels = toStringArray(ch.enabledChannels);
  const disabledChannels = toStringArray(ch.disabledChannels);
  const partialChannels = parsePartialChannels(ch.partialChannels);
  const newChannelSource = ch.newChannelSource ?? true;
  const newChannelDestination = ch.newChannelDestination ?? true;

  const channelStates = new Map<string, ChannelState>();
  const connectorStates = new Map<string, Map<number | null, ConnectorState>>();

  for (const node of channelNodes) {
    const id = node.id;
    if (disabledChannels.includes(id)) {
      channelStates.set(id, "disabled");
    } else if (enabledChannels.includes(id)) {
      channelStates.set(id, "enabled");
    } else if (partialChannels[id]) {
      channelStates.set(id, "partial");
      const pcMap = new Map<number | null, ConnectorState>();
      const pc = partialChannels[id];
      for (const mid of pc.enabledConnectors) pcMap.set(mid, "enabled");
      for (const mid of pc.disabledConnectors) pcMap.set(mid, "disabled");
      connectorStates.set(id, pcMap);
    } else {
      // Not explicitly listed — Java's addChannel omits channels whose connector
      // states all match the new-channel defaults, so reconstruct that state here
      // (mirrors AlertChannels.isConnectorEnabled for an unlisted channel: source →
      // newChannelSource, destinations + [New Destinations] → newChannelDestination).
      if (newChannelSource === newChannelDestination) {
        channelStates.set(id, newChannelSource ? "enabled" : "disabled");
      } else {
        channelStates.set(id, "partial");
        const pcMap = new Map<number | null, ConnectorState>();
        for (const c of node.connectors) {
          const on = c.metaDataId === 0 ? newChannelSource : newChannelDestination;
          pcMap.set(c.metaDataId, on ? "enabled" : "disabled");
        }
        connectorStates.set(id, pcMap);
      }
    }
  }

  const group = model.actionGroups[0] ?? { actions: [], subject: "", template: "" };
  // Guard errorEventTypes: null (unset) or single string (XStream single-item set)
  const errorEventTypes = new Set<string>(toStringArray(model.trigger.errorEventTypes));
  return {
    name: model.name,
    enabled: model.enabled,
    errorEventTypes,
    regex: model.trigger.regex ?? "",
    newChannelSource,
    newChannelDestination,
    channelStates,
    connectorStates,
    subject: group.subject ?? "",
    template: group.template ?? "",
    actions: (group.actions ?? []).map((a) => ({ protocol: a.protocol, recipient: a.recipient })),
  };
}

/**
 * Faithful port of Java AlertChannels.addChannel (server/.../model/alert/AlertChannels.java):
 * classify each channel from its per-connector enabled state and the new-channel defaults,
 * OMITTING any channel whose connectors all match the defaults (storage minimization). A
 * channel with all connectors enabled → enabledChannels; all disabled → disabledChannels;
 * a mix → partialChannels with the per-connector Set<Integer> (where `null` is the
 * [New Destinations] pseudo-connector).
 */
export function buildAlertChannels(form: AlertForm, channelNodes: ChannelNode[]): AlertChannels {
  const enabledChannels: string[] = [];
  const disabledChannels: string[] = [];
  const partialChannels: Record<string, AlertConnectors> = {};
  const { newChannelSource, newChannelDestination } = form;

  for (const node of channelNodes) {
    const state = form.channelStates.get(node.id) ?? "enabled";
    const pcMap = form.connectorStates.get(node.id);

    // Effective enabled state for a connector — explicit override wins, else the channel
    // is on unless it is wholly disabled (mirrors the channels-tab effective-state rule).
    const connectorEnabled = (metaDataId: number | null): boolean => {
      const explicit = pcMap?.get(metaDataId);
      return explicit ? explicit === "enabled" : state !== "disabled";
    };

    // Connectors unknown (channel cache miss) — fall back to the channel-level state so the
    // scope isn't silently dropped; new-channel minimization can't be evaluated here.
    if (node.connectors.length === 0) {
      if (state === "disabled") disabledChannels.push(node.id);
      else enabledChannels.push(node.id);
      continue;
    }

    const enabledConnectors: (number | null)[] = [];
    const disabledConnectors: (number | null)[] = [];
    let allEnabled = true;
    let allDisabled = true;
    let matchesNewChannel = true;

    for (const c of node.connectors) {
      const enabled = connectorEnabled(c.metaDataId);
      if (enabled) {
        allDisabled = false;
        enabledConnectors.push(c.metaDataId);
      } else {
        allEnabled = false;
        disabledConnectors.push(c.metaDataId);
      }
      // null ([New Destinations]) or >0 (destination) → newChannelDestination; 0 (source) → newChannelSource.
      const expected =
        c.metaDataId === null || c.metaDataId > 0 ? newChannelDestination : newChannelSource;
      if (enabled !== expected) matchesNewChannel = false;
    }

    if (matchesNewChannel) continue; // fully matches new-channel defaults → omit
    if (allEnabled) enabledChannels.push(node.id);
    else if (allDisabled) disabledChannels.push(node.id);
    else partialChannels[node.id] = { enabledConnectors, disabledConnectors };
  }

  return {
    newChannelSource,
    newChannelDestination,
    enabledChannels,
    disabledChannels,
    partialChannels,
  };
}

/** Serialize an AlertChannels into the XStream JSON shape the server expects (the value of
 * the trigger's `alertChannels` field). Set<String> → {string: …} (single collapses to scalar);
 * Map<String, AlertConnectors> → {entry: [{string, alertConnectors}]} with the entry list ALWAYS
 * an array (the proven map-body shape; single-entry-as-object risks a 500); Set<Integer> →
 * {int: …} with a `null` member ([New Destinations]) emitted as {null: ""} → XStream <null/>.
 * Verified end-to-end against the demo server. */
export function alertChannelsToXStream(ac: AlertChannels): Record<string, unknown> {
  const toStringSet = (ids: string[]) =>
    ids.length === 0 ? null : { string: ids.length === 1 ? ids[0] : ids };
  const toIntSet = (nums: (number | null)[]) => {
    if (nums.length === 0) return null;
    const ints = nums.filter((n): n is number => n !== null);
    const out: { int?: number | number[]; null?: string } = {};
    if (ints.length === 1) out.int = ints[0];
    else if (ints.length > 1) out.int = ints;
    if (nums.some((n) => n === null)) out.null = "";
    return out;
  };
  const partialEntries = Object.entries(ac.partialChannels);
  return {
    "@version": "4.6.1",
    newChannelSource: ac.newChannelSource,
    newChannelDestination: ac.newChannelDestination,
    enabledChannels: toStringSet(ac.enabledChannels),
    disabledChannels: toStringSet(ac.disabledChannels),
    partialChannels:
      partialEntries.length === 0
        ? null
        : {
            entry: partialEntries.map(([channelId, conns]) => ({
              string: channelId,
              alertConnectors: {
                enabledConnectors: toIntSet(conns.enabledConnectors),
                disabledConnectors: toIntSet(conns.disabledConnectors),
              },
            })),
          },
  };
}

export function computeChannelState(
  connMap: Map<number | null, ConnectorState> | undefined
): ChannelState {
  if (!connMap || connMap.size === 0) return "enabled";
  const states = [...connMap.values()];
  const allOn = states.every((s) => s === "enabled");
  const allOff = states.every((s) => s === "disabled");
  if (allOn) return "enabled";
  if (allOff) return "disabled";
  return "partial";
}

// ─── Shared field label wrapper ───────────────────────────────────────────────

export function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
