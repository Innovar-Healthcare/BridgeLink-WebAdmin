/**
 * Adapter: server `ScriptReference[]` → the WebUI's `RefCategory[]` catalog.
 *
 * `GET /server/scriptReferences` returns a FLAT list of `ScriptReference` (see
 * `api-script-references.ts`). Every WebUI consumer instead keys off the categorized
 * `RefCategory[] { id, label, items: RefItem[] }` shape with stable `id` slugs. This module
 * reshapes the former into the latter, reproducing today's category headers and on-screen
 * order so the six consumers need no logic change.
 *
 * Scope (per PLAN-ScriptReferences-BusinessLogic.md §3, Thai's rulings 2026-08-11):
 *   - Adopted from the server: the 10 labeled code-template categories + the misc
 *     `VARIABLE` globals (server `category: null`, `type: "VARIABLE"`) → our `variables`.
 *   - IGNORED: server `category: null`, `type: "FUNCTION"` items (43 msg/tmp E4X members +
 *     10 logger members + constructors). The WebUI keeps its hand-authored `e4x` drag-
 *     snippet category client-side (different UX; E4X does not drift with Core version).
 *   - The `e4x` + 4 userutil categories (`httpListener`/`httpSender`/`fileReader`/
 *     `lookupTable`) are appended by the caller from the client-side set; they have no
 *     server counterpart. Because they all sort AFTER the server-derived categories in the
 *     current on-screen order, assembly is a plain concatenation ({@link assembleCatalog}).
 *
 * Field mapping per item: `name`←`name`, `description`←`description`,
 * `code`←`replacementCode`, `monacoSnippet`←`template` (the `${…}` form; the Monaco
 * provider runs it through `toMonacoSnippet`, gaining tab-stops), `contexts`←`contextSet`
 * (enum names match {@link ContextType} 1:1). `scriptExclude` is intentionally not set:
 * the server always carries an explicit context set, and `isRefItemVisibleInContext`
 * honors explicit `contexts` first.
 */

import type { ScriptReference } from "@/lib/api/api-script-references";
import type { RefCategory, RefItem } from "@/lib/reference-data";
import { logWarn } from "@/lib/dev-logger";

/** A server-derived category's id + display label. */
interface CategoryDef {
  id: string;
  label: string;
}

/** Bucket for the misc `VARIABLE` globals the server emits with `category: null`. */
const VARIABLES_CATEGORY: CategoryDef = { id: "variables", label: "Variables" };

/**
 * Server free-text `category` label → our category id + display label. Keys are the exact
 * strings Core's `ScriptReferenceCategory` emits. A label not in this map is dropped (an
 * unknown/future server category) and reported once via {@link logWarn}.
 */
const LABEL_TO_CATEGORY: Readonly<Record<string, CategoryDef>> = {
  "Message Functions": { id: "message", label: "Message Functions" },
  "Map Functions": { id: "map", label: "Map Functions" },
  "Logging and Alerts": { id: "logging", label: "Logging and Alerts" },
  "Database Functions": { id: "database", label: "Database Functions" },
  "Utility Functions": { id: "utility", label: "Utility Functions" },
  "Conversion Functions": { id: "conversion", label: "Conversion Functions" },
  "Date Functions": { id: "date", label: "Date Functions" },
  "Response Transformer": { id: "response", label: "Response Transformer" },
  "Channel Functions": { id: "channel", label: "Channel Functions" },
  "Postprocessor Functions": { id: "postprocessor", label: "Postprocessor Functions" },
};

/**
 * Canonical on-screen order of the server-derived categories (variables first, then the
 * labeled ones) — matches the frozen client `CATEGORIES` order. Empty categories are
 * omitted from the output so a header never renders with zero items.
 */
const SERVER_CATEGORY_ORDER: readonly CategoryDef[] = [
  VARIABLES_CATEGORY,
  LABEL_TO_CATEGORY["Message Functions"],
  LABEL_TO_CATEGORY["Map Functions"],
  LABEL_TO_CATEGORY["Logging and Alerts"],
  LABEL_TO_CATEGORY["Database Functions"],
  LABEL_TO_CATEGORY["Utility Functions"],
  LABEL_TO_CATEGORY["Conversion Functions"],
  LABEL_TO_CATEGORY["Date Functions"],
  LABEL_TO_CATEGORY["Response Transformer"],
  LABEL_TO_CATEGORY["Channel Functions"],
  LABEL_TO_CATEGORY["Postprocessor Functions"],
];

/** Resolve a server ref to a target category id, or `null` to drop it. */
function resolveCategoryId(ref: ScriptReference, unknownLabels: Set<string>): string | null {
  if (ref.category === null) {
    // Misc globals → variables; null-category FUNCTION (E4X/logger members) → drop (the
    // client keeps its own `e4x` category).
    return ref.type === "VARIABLE" ? VARIABLES_CATEGORY.id : null;
  }
  const def = LABEL_TO_CATEGORY[ref.category];
  if (!def) {
    unknownLabels.add(ref.category);
    return null;
  }
  return def.id;
}

/** Map a single server ref to a `RefItem`, carrying only the fields the server populates. */
function toRefItem(ref: ScriptReference): RefItem {
  const item: RefItem = { name: ref.name, description: ref.description };
  // FUNCTION items carry a declaration skeleton in `replacementCode`
  // (`function addAttachment(data, type, base64Encode) {}`) and the insertable CALL form in
  // `functionDefinition.transferData` (`addAttachment(data, type, base64Encode)`). Drag and
  // autocomplete want the call, matching the Java client's templateToRefItem() convention.
  const code =
    ref.type === "FUNCTION"
      ? (ref.functionDefinition?.transferData ?? ref.replacementCode)
      : ref.replacementCode;
  if (code != null) item.code = code;
  if (ref.template != null) item.monacoSnippet = ref.template;
  if (ref.contextSet.length > 0) item.contexts = ref.contextSet;
  return item;
}

/**
 * Reshape the server's flat `ScriptReference[]` into the server-derived `RefCategory[]`,
 * in canonical on-screen order. Drops null-category FUNCTION items and unknown-label items
 * (see module doc). Empty categories are omitted. Item order within a category follows the
 * server's array order.
 */
export function reshapeServerReferences(refs: ScriptReference[]): RefCategory[] {
  const itemsById = new Map<string, RefItem[]>();
  const unknownLabels = new Set<string>();

  for (const ref of refs) {
    const id = resolveCategoryId(ref, unknownLabels);
    if (id === null) continue;
    const bucket = itemsById.get(id);
    if (bucket) bucket.push(toRefItem(ref));
    else itemsById.set(id, [toRefItem(ref)]);
  }

  if (unknownLabels.size > 0) {
    logWarn(
      "script-references",
      `Dropped ${unknownLabels.size} unknown server category label(s): ${[...unknownLabels].join(", ")}`
    );
  }

  const result: RefCategory[] = [];
  for (const { id, label } of SERVER_CATEGORY_ORDER) {
    const items = itemsById.get(id);
    if (items && items.length > 0) result.push({ id, label, items });
  }
  return result;
}

/**
 * Assemble the full catalog: server-derived categories followed by the client-only
 * categories (`e4x` + userutil). Concatenation is correct because every client-only
 * category sorts after every server-derived one in the current on-screen order.
 */
export function assembleCatalog(
  refs: ScriptReference[],
  clientOnlyCategories: RefCategory[]
): RefCategory[] {
  return [...reshapeServerReferences(refs), ...clientOnlyCategories];
}
