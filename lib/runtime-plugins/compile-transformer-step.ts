/**
 * Compiles a declared transformer step (manifest v2) into the host's
 * TransformerStepDefinition contract — everything except the React
 * EditorPanel, which the loader composes from
 * components/schema-form/runtime-transformer-step-section.tsx so this module
 * stays JSX-free (mirrors the compile-transmission-mode split).
 *
 * Wire model (PLAN-RuntimeTransformerSteps-BusinessLogic.md): the shared step
 * registry (serializeStep/parseStep in filter-transformer-steps/index.ts) owns
 * the outer `<{stepClass} version="…">` element and the name/sequenceNumber/
 * enabled children; the compiled serialize/parse own the declared fields as
 * flat text children — exactly how the built-in steps handle their own fields.
 * Every declared key is always written (from the step's `values` bag, falling
 * back to the compiled defaults), mirroring how XStream always serializes every
 * field of the Java class. String building, not DOM: the registry's serialize
 * contract returns an XML string body, and happy-dom case-normalizes
 * DOM-created tag names (corrupting FQN/camelCase names).
 *
 * No script hook: the engine's Java plugin regenerates the step's script at
 * deploy from the persisted properties, so emitScript is a display-only stub
 * for the read-only Generated Script tab.
 */

import { childTextRaw, tcStr } from "@/app/(app)/channels/_lib/filter-transformer-xml-helpers";
import type {
  TransformerStepBase,
  TransformerStepDefinition,
} from "@/app/(app)/channels/_lib/filter-transformer-steps/types";
import { validateFieldValues } from "./compile-validate";
import {
  collectionSpec,
  readCollectionFrom,
  serializeCollectionStr,
  type CollectionRows,
} from "./xml-collection-binding";
import { COLLECTION_FIELD_TYPES, type TransformerStepContribution } from "./manifest-types";

const COLLECTION_TYPES = new Set<string>(COLLECTION_FIELD_TYPES);

/**
 * A runtime-contributed step: the shared base, a flat scalar-field bag, and a
 * v3 collection-field store (map/multimap/stringList/table rows, keyed by field
 * key). Collections live outside `values` because their value is rows, not a
 * string.
 */
export interface RuntimeTransformerStep extends TransformerStepBase {
  /** Scalar declared-field values, string-typed throughout (checkbox = "true"/"false"). */
  values: Record<string, string>;
  /** Collection declared-field rows, by field key. */
  collections: Record<string, CollectionRows>;
}

/**
 * Compile a validated transformer-step contribution. The returned definition
 * registers through the same first-wins sink as compiled-in steps;
 * `pluginName` is stamped by registerPlugin from the definition's
 * serverPluginName, so server-enablement gating applies unchanged.
 */
export function compileTransformerStep(
  step: TransformerStepContribution
): Omit<TransformerStepDefinition<RuntimeTransformerStep>, "EditorPanel"> {
  const fields = step.fields ?? [];
  const scalarFields = fields.filter((f) => !COLLECTION_TYPES.has(f.type));
  const collectionFields = fields.filter((f) => COLLECTION_TYPES.has(f.type));
  const defaultValues: Record<string, string> = {};
  for (const field of scalarFields) defaultValues[field.key] = field.defaultValue ?? "";
  const emptyCollections = (): Record<string, CollectionRows> => {
    const out: Record<string, CollectionRows> = {};
    for (const field of collectionFields) out[field.key] = [];
    return out;
  };

  return {
    type: step.name,
    xmlTag: step.stepClass,
    contexts: step.contexts,
    defaults: () => ({
      // name/sequenceNumber/enabled are placeholders — the shared registry
      // owns them (parseStep overwrites on read, serializeStep emits on write).
      type: step.name,
      name: "",
      sequenceNumber: "0",
      enabled: true,
      values: { ...defaultValues },
      collections: emptyCollections(),
    }),
    parse: (el) => {
      const values: Record<string, string> = {};
      for (const field of scalarFields) {
        // childTextRaw, not a trimmed/querySelector read: field keys may contain
        // dots (CSS-hostile) and values must round-trip untrimmed.
        values[field.key] = childTextRaw(el, field.key, defaultValues[field.key]);
      }
      const collections: Record<string, CollectionRows> = {};
      for (const field of collectionFields) {
        collections[field.key] = readCollectionFrom(el, collectionSpec(field));
      }
      return { type: step.name, name: "", sequenceNumber: "0", enabled: true, values, collections };
    },
    // String building (not DOM): the registry's serialize returns an XML string
    // body, and happy-dom case-normalizes DOM-created FQN/camelCase tags. Scalars
    // via tcStr; collection elements via the string-built serializers.
    serialize: (s) =>
      scalarFields
        .map((field) => tcStr(field.key, s.values[field.key] ?? defaultValues[field.key]))
        .join("") +
      collectionFields
        .map((field) =>
          serializeCollectionStr(collectionSpec(field), s.collections?.[field.key] ?? [])
        )
        .join(""),
    validate: (s) => validateFieldValues(scalarFields, s.values)[0]?.message ?? null,
    // Display-only: the engine regenerates the deployed script at deploy time,
    // so there is nothing faithful to preview for a runtime-contributed step.
    emitScript: () =>
      `// The script for this ${step.name} step is generated by the server when the channel is deployed.\n` +
      `// No preview is available for steps provided by extensions.`,
  };
}
