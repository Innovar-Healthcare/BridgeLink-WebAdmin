/**
 * Assembles the AI context for the message browser's "Explain this error"
 * surface.
 *
 * Given a failed connector message (channel id + metaDataId + which error slot
 * is in view), this fetches the channel, locates the failing connector, and
 * pulls together everything the assistant needs to diagnose the error without
 * the user copy-pasting stack traces:
 *
 *  - the failing connector's filter / transformer / response-transformer
 *    JavaScript (walking Iterator children), and
 *  - the code templates the channel depends on (a common error origin), and
 *  - a deep link into the channel editor, pointed as closely as possible at the
 *    failing connector's transformer/filter.
 *
 * It lives in core (not the commercial plugin) because all of this is core
 * channel-model knowledge — the plugin only presents it. The heavy XML parsing
 * runs in the browser (the parse helpers use DOMParser), so this is called
 * lazily when the explain dialog opens, never on page load.
 */

import { getChannelXml } from "@/lib/api/api-channels";
import {
  getCodeTemplatesCached,
  getCodeTemplateLibrariesCached,
} from "@/lib/api/api-code-templates";
import {
  filterTemplatesByChannel,
  isChannelScriptTemplate,
  isConnectorTemplate,
} from "@/lib/code-template-utils";
import {
  parseSourceConnectorFromXml,
  parseDestinationConnectorsFromXml,
} from "@/app/(app)/channels/_lib/channel-xml";
import {
  parseFilterFromXml,
  parseTransformerFromXml,
  type Rule,
  type Step,
} from "@/app/(app)/channels/_lib/filter-transformer-xml";
import type { CodeTemplate } from "@/lib/types";

/** Which error slot the failed message is being explained from. */
export type MessageErrorType = "processingError" | "postProcessorError" | "responseError";

/** A single named JavaScript script pulled from the failing connector. */
export interface NamedScript {
  /** Human label, e.g. `Transformer step "Set PID"`. */
  label: string;
  /** The raw JavaScript. */
  script: string;
}

/** Everything the assistant needs to explain one processing error. */
export interface MessageErrorAiContext {
  channelName: string;
  connectorName: string;
  /** true = source connector (metaDataId 0), false = a destination. */
  isSource: boolean;
  errorType: MessageErrorType;
  errorText: string;
  /**
   * The inbound (raw) message content, present ONLY when the user explicitly
   * opted in to sending it — the message is PHI-bearing by default.
   */
  messageContent?: string;
  /** Filter / transformer / response-transformer JavaScript for the connector. */
  scripts: NamedScript[];
  /** Code templates the channel depends on (scoped to the relevant context). */
  codeTemplates: { name: string; code: string }[];
  /** Deep link into the channel editor, pointed at the failing connector. */
  editorHref: string;
}

interface BuildInput {
  channelId: string;
  metaDataId: number;
  errorType: MessageErrorType;
  errorText: string;
  /** Include ONLY when the user opted in per use (PHI). */
  messageContent?: string;
  channelName?: string;
  connectorName?: string;
}

// ── Script collection (recurses into Iterator children) ─────────────────────────

function collectRuleScripts(rules: Rule[], out: NamedScript[]): void {
  for (const r of rules) {
    if (r.type === "JavaScript" && r.script.trim()) {
      out.push({ label: `Filter rule "${r.name}"`, script: r.script });
    } else if (r.type === "Iterator") {
      collectRuleScripts(r.children, out);
    }
  }
}

function collectStepScripts(steps: Step[], out: NamedScript[], kind: string): void {
  for (const s of steps) {
    if (s.type === "JavaScript" && s.script.trim()) {
      out.push({ label: `${kind} step "${s.name}"`, script: s.script });
    } else if (s.type === "Iterator") {
      collectStepScripts(s.children, out, kind);
    }
  }
}

function scriptsFrom(
  filterXml: string | null,
  transformerXml: string | null,
  responseTransformerXml: string | null
): NamedScript[] {
  const out: NamedScript[] = [];
  if (filterXml) collectRuleScripts(parseFilterFromXml(filterXml).elements, out);
  if (transformerXml)
    collectStepScripts(parseTransformerFromXml(transformerXml).elements, out, "Transformer");
  if (responseTransformerXml) {
    collectStepScripts(
      parseTransformerFromXml(responseTransformerXml).elements,
      out,
      "Response transformer"
    );
  }
  return out;
}

/**
 * The channel's display name from its XML. Used as the fallback when the
 * caller has no name at hand — `getCache().channelMap` is only populated by
 * the channels/dashboard fetch paths, so direct navigation to Messages would
 * otherwise put a bare UUID in the prompt.
 */
function parseChannelName(xml: string): string | undefined {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return doc.querySelector("channel > name")?.textContent?.trim() || undefined;
}

// ── Deep link ────────────────────────────────────────────────────────────────

/**
 * Builds `/channels/{id}/edit?...` targeting the failing connector as closely
 * as the editor's URL contract allows (see app/(app)/channels/[id]/edit/page.tsx).
 * The postprocessor error is a channel-level script, so it targets the Scripts
 * tab rather than a connector.
 */
function buildEditorHref(
  channelId: string,
  metaDataId: number,
  errorType: MessageErrorType,
  destIndex: number
): string {
  const params = new URLSearchParams();
  if (errorType === "postProcessorError") {
    params.set("tab", "scripts");
    params.set("script", "postprocessing");
  } else {
    const sub = errorType === "responseError" ? "responseTransformer" : "transformer";
    if (metaDataId === 0) {
      params.set("tab", "source");
    } else if (destIndex >= 0) {
      params.set("tab", "destination");
      params.set("dest", String(destIndex));
    }
    // metaDataId 0 has no response transformer; only set sub when it applies.
    if (!(metaDataId === 0 && errorType === "responseError")) {
      params.set("sub", sub);
    }
  }
  return `/channels/${channelId}/edit?${params.toString()}`;
}

// ── Code templates ──────────────────────────────────────────────────────────

/**
 * Returns the channel's depended-on templates, scoped to the context most
 * likely to hold the error: connector (filter/transformer) templates for a
 * connector error, channel-script templates for a postprocessor error. Falls
 * back to the full depended-on set if the scoped set is empty.
 */
async function relevantCodeTemplates(
  channelId: string,
  errorType: MessageErrorType
): Promise<{ name: string; code: string }[]> {
  let depended: CodeTemplate[];
  try {
    const [templates, libraries] = await Promise.all([
      getCodeTemplatesCached(),
      getCodeTemplateLibrariesCached(),
    ]);
    depended = filterTemplatesByChannel(templates, libraries, channelId);
  } catch {
    // Code templates are best-effort context — never block the explanation.
    return [];
  }
  const scoped = depended.filter((t) =>
    errorType === "postProcessorError" ? isChannelScriptTemplate(t) : isConnectorTemplate(t)
  );
  const chosen = scoped.length > 0 ? scoped : depended;
  return chosen.filter((t) => t.code.trim()).map((t) => ({ name: t.name, code: t.code }));
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function buildMessageErrorAiContext(
  input: BuildInput
): Promise<MessageErrorAiContext> {
  const { channelId, metaDataId, errorType } = input;
  const xml = await getChannelXml(channelId);

  const isSource = metaDataId === 0;
  let connectorName = input.connectorName ?? (isSource ? "Source" : "Destination");
  let scripts: NamedScript[] = [];
  let destIndex = -1;

  if (isSource) {
    const src = parseSourceConnectorFromXml(xml);
    scripts = scriptsFrom(src.filterXml, src.transformerXml, null);
  } else {
    const dests = parseDestinationConnectorsFromXml(xml);
    destIndex = dests.findIndex((d) => d.metaDataId === metaDataId);
    const dest = destIndex >= 0 ? dests[destIndex] : undefined;
    if (dest) {
      connectorName = input.connectorName ?? dest.name;
      scripts = scriptsFrom(dest.filterXml, dest.transformerXml, dest.responseTransformerXml);
    }
  }

  const codeTemplates = await relevantCodeTemplates(channelId, errorType);

  return {
    channelName: input.channelName ?? parseChannelName(xml) ?? channelId,
    connectorName,
    isSource,
    errorType,
    errorText: input.errorText,
    // Conditional spread: absent (not undefined-valued) when not opted in.
    ...(input.messageContent ? { messageContent: input.messageContent } : {}),
    scripts,
    codeTemplates,
    editorHref: buildEditorHref(channelId, metaDataId, errorType, destIndex),
  };
}
