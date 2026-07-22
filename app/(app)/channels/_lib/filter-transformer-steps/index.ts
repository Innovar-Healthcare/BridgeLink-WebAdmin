/**
 * Transformer step registry.
 *
 * ─── Adding a built-in step ───────────────────────────────────────────────────
 *   1. Create `filter-transformer-steps/<name>.ts(x)` exporting a
 *      TransformerStepDefinition.
 *   2. Import the definition below and register it with
 *      registerTransformerStep() in the built-in registration block.
 *   — No other files need to change.
 *
 * ─── Adding a commercial plugin step ──────────────────────────────────────────
 *   1. Create `plugins/<name>/index.ts` that calls registerTransformerStep().
 *   2. Add an import for that plugin from `plugins/index.ts`.
 *   — The step will appear in the Add-step dropdown on next registry read.
 *
 * Add-dropdown order follows registration order.
 */

export type {
  TransformerStepBase,
  TransformerStepDefinition,
  TransformerStepEditorProps,
  TransformerStepDestInfo,
  IteratorAncestor,
} from "./types";

import { connectContributionSink, warnDuplicateContribution } from "@/lib/plugin-manifest";
import type { TransformerStepBase, TransformerStepDefinition, IteratorAncestor } from "./types";
import {
  childText,
  childBool,
  escapeXmlAttr,
  outerXml,
  tcStr,
} from "../filter-transformer-xml-helpers";

// ─── Registry state ──────────────────────────────────────────────────────────

/**
 * Mutable transformer step registry, keyed by step type.
 * Commercial plugins self-register here by calling registerTransformerStep().
 */
export const TRANSFORMER_STEP_REGISTRY = new Map<
  string,
  TransformerStepDefinition<TransformerStepBase>
>();

/**
 * Register a transformer step. Called by built-ins at module init and by
 * commercial plugins from their `plugins/index.ts` entry point.
 *
 * Re-registering an existing type overwrites the previous definition.
 */
export function registerTransformerStep<TStep extends TransformerStepBase>(
  def: TransformerStepDefinition<TStep>
): void {
  // Cast: the registry stores definitions by their base type; callers retrieve
  // a well-typed definition via resolveStep<TStep>() when they know the shape.
  const entry = def as unknown as TransformerStepDefinition<TransformerStepBase>;
  TRANSFORMER_STEP_REGISTRY.set(def.type, entry);
}

// ─── Dispatch helpers ────────────────────────────────────────────────────────

/** Resolve a step-type string to its registered definition, or undefined. */
export function resolveStep(
  type: string
): TransformerStepDefinition<TransformerStepBase> | undefined {
  return TRANSFORMER_STEP_REGISTRY.get(type);
}

/** Resolve a definition by its XML tag (e.g. "com.mirth.connect.plugins.mapper.MapperStep"). */
export function resolveStepByXmlTag(
  xmlTag: string
): TransformerStepDefinition<TransformerStepBase> | undefined {
  for (const def of TRANSFORMER_STEP_REGISTRY.values()) {
    if (def.xmlTag === xmlTag) return def;
  }
  return undefined;
}

/**
 * Filter a list of "Add" menu type strings by server-enablement gating
 *: a plugin step type is kept only when its server extension is
 * enabled. Rule types and built-in steps carry no `pluginName` (or aren't in
 * the step registry at all), so `resolveStep(t)?.pluginName` is undefined and
 * they always pass. Gating only removes a type from the add menu — existing
 * steps of a gated type still parse, render, and serialize (lookup is ungated).
 */
export function filterEnabledStepTypes<T extends string>(
  types: readonly T[],
  isEnabled: (pluginName: string | undefined) => boolean
): T[] {
  return types.filter((t) => isEnabled(resolveStep(t)?.pluginName));
}

/**
 * Build a default step for the given type. Returns null if the type is not
 * registered (matches current behaviour where unknown types are dropped).
 */
export function stepDefaults(type: string): TransformerStepBase | null {
  const def = resolveStep(type);
  return def ? def.defaults() : null;
}

/**
 * Parse a single step element from channel XML into a typed step.
 * Returns null when the element's tag name is not a registered step.
 *
 * The registry reads name / sequenceNumber / enabled from the element and
 * delegates step-specific fields to the matching definition's parse().
 */
export function parseStep(el: Element): TransformerStepBase | null {
  const def = resolveStepByXmlTag(el.tagName);
  if (!def) {
    // Unrecognized step tag (unregistered plugin step / newer server). Preserve
    // it verbatim rather than dropping it on the next edit. Modeled
    // as the opaque UnknownElement variant of the Step union.
    return {
      type: "unknown",
      rawXml: outerXml(el) ?? "",
      name: childText(el, "name"),
      sequenceNumber: childText(el, "sequenceNumber", "0"),
      enabled: childBool(el, "enabled", true),
    } as unknown as TransformerStepBase;
  }
  const step = def.parse(el);
  return {
    ...step,
    name: childText(el, "name"),
    sequenceNumber: childText(el, "sequenceNumber", "0"),
    enabled: childBool(el, "enabled", true),
  };
}

/**
 * Serialize a step into a `<FQN version="...">...</FQN>` XML string.
 * The shared `name` / `sequenceNumber` / `enabled` fields are emitted first,
 * then the definition-specific body follows.
 */
export function serializeStep(step: TransformerStepBase, version: string): string {
  // Opaque preserved step (UnknownElement) — re-emit its original XML verbatim
  // so an unregistered plugin / newer-server step survives a save.
  if (step.type === "unknown") {
    return (step as unknown as { rawXml: string }).rawXml;
  }
  const def = resolveStep(step.type);
  if (!def) {
    // Unknown step type with no rawXml (should not happen — parseStep captures
    // unrecognized tags as UnknownElement above). Emit an empty element so the
    // channel XML stays structurally valid. Callers should not rely on this.
    const tag = escapeXmlAttr(step.type);
    return `<${tag} version="${escapeXmlAttr(version)}"/>`;
  }
  const base =
    tcStr("name", step.name) +
    tcStr("sequenceNumber", step.sequenceNumber) +
    tcStr("enabled", String(step.enabled));
  const body = def.serialize(step, version);
  return `<${def.xmlTag} version="${escapeXmlAttr(version)}">${base}${body}</${def.xmlTag}>`;
}

/**
 * Generate the JavaScript source for a step, mirroring the Java client's
 * `step.getScript(false)` output shown in the Generated Script tab.
 */
export function emitStepJs(step: TransformerStepBase): string {
  const def = resolveStep(step.type);
  if (!def) return `// Unknown step type: ${step.type}`;
  return def.emitScript(step);
}

/**
 * Whether a step participates in an Iterator's three-phase script composition.
 * Mirrors Java's `instanceof FilterTransformerIterable` check: such steps emit
 * an iteration-specific body (and optionally pre/post accumulator scripts)
 * instead of their standalone `emitScript` when nested inside an Iterator.
 */
export function isStepIterable(step: TransformerStepBase): boolean {
  const def = resolveStep(step.type);
  return !!def?.emitIterationScript;
}

/**
 * Emit a step's Iterator pre-script (accumulator declarations). Returns "" for
 * steps that declare none — including iterable steps like Message Builder whose
 * Java `getPreScript` returns null.
 */
export function emitStepPreJs(step: TransformerStepBase): string {
  const def = resolveStep(step.type);
  return def?.emitPreScript ? def.emitPreScript(step) : "";
}

/**
 * Emit a step's per-iteration body. Iterable steps emit their iteration script;
 * all others fall back to their standalone `emitScript` (matching Java's
 * Iterator, which calls `getScript` on non-iterable children inside the loop).
 */
export function emitStepIterationJs(
  step: TransformerStepBase,
  ancestors: IteratorAncestor[]
): string {
  const def = resolveStep(step.type);
  if (!def) return `// Unknown step type: ${step.type}`;
  return def.emitIterationScript ? def.emitIterationScript(step, ancestors) : def.emitScript(step);
}

/**
 * Emit a step's Iterator post-script (store accumulated array). Returns "" for
 * steps that declare none.
 */
export function emitStepPostJs(step: TransformerStepBase): string {
  const def = resolveStep(step.type);
  return def?.emitPostScript ? def.emitPostScript(step) : "";
}

/**
 * Validate a step, returning null when valid or a human-readable error.
 * Mirrors Java's `panel.checkProperties()` call.
 */
export function validateStepInRegistry(step: TransformerStepBase): string | null {
  const def = resolveStep(step.type);
  return def ? def.validate(step) : null;
}

/**
 * Return the child steps of a container step (e.g. Iterator), or an empty
 * array when the step has no children or is a leaf.
 */
export function visitStepChildren(step: TransformerStepBase): TransformerStepBase[] {
  const def = resolveStep(step.type);
  return def?.visitChildren ? def.visitChildren(step) : [];
}

/**
 * Return a copy of the step with its children replaced. Used by tree-walking
 * helpers (flatten / update-at-path). Returns the step unchanged when the
 * definition has no withChildren hook.
 */
export function withStepChildren(
  step: TransformerStepBase,
  children: TransformerStepBase[]
): TransformerStepBase {
  const def = resolveStep(step.type);
  return def?.withChildren ? def.withChildren(step, children) : step;
}

/**
 * Ordered list of registered step types (insertion order), filtered by
 * connector context. Used to populate the "Add" dropdown on the source or
 * destination transformer editor.
 */
export function stepTypesForContext(context: "source" | "destination"): string[] {
  return Array.from(TRANSFORMER_STEP_REGISTRY.values())
    .filter((def) => def.contexts.includes(context))
    .map((def) => def.type);
}

// ─── Built-in step registration ──────────────────────────────────────────────
// Registration order determines the Add-dropdown order.

import { MapperStepDefinition } from "./mapper";
import { MessageBuilderStepDefinition } from "./message-builder";
import { JavaScriptStepDefinition } from "./javascript";
import { XsltStepDefinition } from "./xslt";
import { ExternalScriptStepDefinition } from "./external-script";
import { DestinationSetFilterStepDefinition } from "./destination-set-filter";
import { IteratorStepDefinition } from "./iterator";

registerTransformerStep(MapperStepDefinition);
registerTransformerStep(MessageBuilderStepDefinition);
registerTransformerStep(JavaScriptStepDefinition);
registerTransformerStep(XsltStepDefinition);
registerTransformerStep(ExternalScriptStepDefinition);
registerTransformerStep(DestinationSetFilterStepDefinition);
registerTransformerStep(IteratorStepDefinition);

// Receive definePlugin() manifest contributions (first-wins by step type).
// Connected after the built-ins above so the duplicate check sees them.
connectContributionSink("transformerSteps", (def, pluginId) => {
  if (TRANSFORMER_STEP_REGISTRY.has(def.type)) {
    warnDuplicateContribution(pluginId, "transformer step", def.type);
    return false;
  }
  registerTransformerStep(def);
  return true;
});
