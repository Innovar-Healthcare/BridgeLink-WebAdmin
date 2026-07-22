/**
 * Condition evaluation for runtime plugin manifests.
 *
 * Evaluates a manifest field's `visibleWhen` / `enabledWhen` condition against
 * the panel's current field values. Pure data-in/boolean-out — the condition
 * algebra is deliberately tiny (eq/ne/in/truthy plus one level of allOf/anyOf)
 * and must never grow a script or expression hook.
 */

import type { Condition, LeafCondition } from "./manifest-types";

/**
 * "Truthy" semantics for the all-strings value model: the literal "true" is
 * truthy (checkbox on), "" and "false" are falsy, any other non-empty string
 * is truthy. Documented in docs/WEBADMIN-PLUGIN-CONTRACT.md.
 */
function isTruthy(value: string): boolean {
  return value !== "" && value !== "false";
}

function evaluateLeaf(cond: LeafCondition, values: Record<string, string>): boolean {
  // A field that has no XML element / property entry yet reads as "".
  const value = values[cond.field] ?? "";
  switch (cond.op) {
    case "eq":
      return value === cond.value;
    case "ne":
      return value !== cond.value;
    case "in":
      return cond.values.includes(value);
    case "truthy":
      return isTruthy(value);
  }
}

/** Evaluates a (validated) condition against the current field values. */
export function evaluateCondition(cond: Condition, values: Record<string, string>): boolean {
  if ("allOf" in cond) return cond.allOf.every((leaf) => evaluateLeaf(leaf, values));
  if ("anyOf" in cond) return cond.anyOf.some((leaf) => evaluateLeaf(leaf, values));
  return evaluateLeaf(cond, values);
}
