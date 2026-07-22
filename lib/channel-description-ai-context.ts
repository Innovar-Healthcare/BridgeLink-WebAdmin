/**
 * Assembles the AI context for the channel editor's "generate/improve the
 * Channel Description" surface.
 *
 * Given the channel's current XML (already in hand on the Summary & Settings
 * tab as the editor's live serialization), this produces a compact, structured
 * summary of what the channel does — source and destination connector types,
 * the data formats flowing through, and which connectors carry filters /
 * transformers — plus a rendered plain-text block ready to drop into a prompt.
 *
 * It lives in core (not the commercial plugin) because all of this is core
 * channel-model knowledge — the plugin only presents it and calls the AI. We
 * deliberately summarise rather than send the raw XML: the XML is large and
 * noisy (verbatim connector <properties>, encoded scripts), and the structured
 * digest is both cheaper and more legible to the model. The parse helpers use
 * DOMParser, so this runs in the browser and is called only when the user
 * invokes the action, never on page load.
 */

import {
  parseChannelName,
  parseSummaryFromXml,
  parseSourceConnectorFromXml,
  parseDestinationConnectorsFromXml,
  parseDataTypesFromXml,
  parseScriptsFromXml,
  DEFAULT_SCRIPTS,
} from "@/app/(app)/channels/_lib/channel-xml";
import {
  parseFilterFromXml,
  parseTransformerFromXml,
} from "@/app/(app)/channels/_lib/filter-transformer-xml";

/** Per-connector digest — source or a single destination. */
export interface DescriptionConnectorContext {
  /** Display name (destinations only; source is always "Source"). */
  name: string;
  /** Transport/connector type, e.g. "Channel Reader", "HTTP Sender". */
  transportName: string;
  /** Destinations only: whether the connector is enabled. */
  enabled?: boolean;
  /** Inbound (received) data type for this connector's transformer. */
  inboundDataType: string;
  /** Outbound (produced) data type for this connector's transformer. */
  outboundDataType: string;
  /** Number of filter rules (0 = no filter). */
  filterRuleCount: number;
  /** Number of transformer steps (0 = no transformer). */
  transformerStepCount: number;
  /** Destinations only: number of response-transformer steps (0 = none). */
  responseTransformerStepCount?: number;
}

/** Which channel-level scripts carry non-default content. */
export interface ChannelScriptsPresence {
  preprocessor: boolean;
  postprocessor: boolean;
  deploy: boolean;
  undeploy: boolean;
}

/** Everything the assistant needs to describe one channel. */
export interface ChannelDescriptionAiContext {
  channelName: string;
  enabled: boolean;
  initialState: string;
  messageStorageMode: string;
  source: DescriptionConnectorContext;
  destinations: DescriptionConnectorContext[];
  scripts: ChannelScriptsPresence;
  /** Rendered plain-text block for the prompt. */
  text: string;
}

/** Count the elements in a filter/transformer XML fragment; 0 when absent. */
function countFilterRules(filterXml: string | null): number {
  if (!filterXml) return 0;
  return parseFilterFromXml(filterXml).elements.length;
}

function countTransformerSteps(transformerXml: string | null): number {
  if (!transformerXml) return 0;
  return parseTransformerFromXml(transformerXml).elements.length;
}

/** A channel script counts as present only when it differs from the new-channel default. */
function isScriptPresent(script: string, def: string): boolean {
  const s = script.trim();
  return s.length > 0 && s !== def.trim();
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderConnectorLines(c: DescriptionConnectorContext, indent: string): string[] {
  const lines: string[] = [`${indent}Data: ${c.inboundDataType} → ${c.outboundDataType}`];
  if (c.filterRuleCount > 0) {
    lines.push(`${indent}Filter: ${c.filterRuleCount} rule(s)`);
  }
  if (c.transformerStepCount > 0) {
    lines.push(`${indent}Transformer: ${c.transformerStepCount} step(s)`);
  }
  if (c.responseTransformerStepCount && c.responseTransformerStepCount > 0) {
    lines.push(`${indent}Response transformer: ${c.responseTransformerStepCount} step(s)`);
  }
  return lines;
}

function renderContextText(ctx: Omit<ChannelDescriptionAiContext, "text">): string {
  const lines: string[] = [];
  lines.push(`Channel: ${ctx.channelName}`);
  lines.push(`Status: ${ctx.enabled ? "enabled" : "disabled"}, initial state ${ctx.initialState}`);
  lines.push(`Message storage: ${ctx.messageStorageMode}`);
  lines.push("");

  lines.push(`Source connector: ${ctx.source.transportName}`);
  lines.push(...renderConnectorLines(ctx.source, "  "));
  lines.push("");

  if (ctx.destinations.length === 0) {
    lines.push("Destinations: none");
  } else {
    lines.push(`Destinations (${ctx.destinations.length}):`);
    ctx.destinations.forEach((d, i) => {
      const state = d.enabled === false ? " (disabled)" : "";
      lines.push(`  ${i + 1}. ${d.name} — ${d.transportName}${state}`);
      lines.push(...renderConnectorLines(d, "     "));
    });
  }

  const activeScripts = (Object.entries(ctx.scripts) as [keyof ChannelScriptsPresence, boolean][])
    .filter(([, present]) => present)
    .map(([name]) => name);
  if (activeScripts.length > 0) {
    lines.push("");
    lines.push(`Channel scripts: ${activeScripts.join(", ")}`);
  }

  return lines.join("\n");
}

// ── Entry point ────────────────────────────────────────────────────────────

/**
 * Build the structured + rendered channel context from the channel XML.
 * Pure and synchronous — safe to call on every keystroke-free invocation of the
 * generate action. Falls back gracefully on partial/malformed XML (the parse
 * helpers already default missing fields).
 */
export function buildChannelDescriptionAiContext(xml: string): ChannelDescriptionAiContext {
  const summary = parseSummaryFromXml(xml);
  const src = parseSourceConnectorFromXml(xml);
  const dests = parseDestinationConnectorsFromXml(xml);
  const dataTypes = parseDataTypesFromXml(xml);
  const scriptsState = parseScriptsFromXml(xml);

  const sourceRow = dataTypes.connectors.find((c) => c.id === "source");
  const source: DescriptionConnectorContext = {
    name: "Source",
    transportName: src.transportName,
    inboundDataType: sourceRow?.inboundDataType ?? "RAW",
    outboundDataType: sourceRow?.outboundDataType ?? "RAW",
    filterRuleCount: countFilterRules(src.filterXml),
    transformerStepCount: countTransformerSteps(src.transformerXml),
  };

  const destinations: DescriptionConnectorContext[] = dests.map((d, i) => {
    const row = dataTypes.connectors.find((c) => c.id === `dest-${i}`);
    const respRow = dataTypes.connectors.find((c) => c.id === `dest-${i}-response`);
    return {
      name: d.name,
      transportName: d.transportName,
      enabled: d.enabled,
      inboundDataType: row?.inboundDataType ?? "RAW",
      outboundDataType: row?.outboundDataType ?? "RAW",
      filterRuleCount: countFilterRules(d.filterXml),
      transformerStepCount: countTransformerSteps(d.transformerXml),
      responseTransformerStepCount: respRow ? countTransformerSteps(d.responseTransformerXml) : 0,
    };
  });

  const scripts: ChannelScriptsPresence = {
    preprocessor: isScriptPresent(scriptsState.preprocessing, DEFAULT_SCRIPTS.preprocessing),
    postprocessor: isScriptPresent(scriptsState.postprocessing, DEFAULT_SCRIPTS.postprocessing),
    deploy: isScriptPresent(scriptsState.deploy, DEFAULT_SCRIPTS.deploy),
    undeploy: isScriptPresent(scriptsState.undeploy, DEFAULT_SCRIPTS.undeploy),
  };

  const partial = {
    channelName: parseChannelName(xml) || summary.name || "Untitled channel",
    enabled: summary.enabled,
    initialState: summary.initialState,
    messageStorageMode: summary.messageStorageMode,
    source,
    destinations,
    scripts,
  };

  return { ...partial, text: renderContextText(partial) };
}
