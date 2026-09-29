/**
 * Pure preview-model core for the Manifest Preview page Slice 3).
 *
 * Assembles the pasted manifest JSON text with the envelope inputs into
 * exactly the shape `validateManifestEntry` expects (the same
 * envelope+manifest composition the engine's `GET /extensions/_webadmin`
 * response uses, and the same one `manifest-schema-lockstep.test.ts` builds
 * for its corpus). No registration, no rendering — this module only turns
 * raw editor text into a typed result the page can branch on.
 */

import { validateManifestEntry } from "@/lib/runtime-plugins/manifest-validator";
import type { ValidatedManifestEntry } from "@/lib/runtime-plugins/manifest-types";

export interface PreviewEnvelope {
  name: string;
  path: string;
  version: string;
}

export type PreviewResult =
  | { kind: "syntax-error"; message: string }
  | { kind: "rejected"; reason: string }
  | { kind: "ok"; entry: ValidatedManifestEntry };

/** Parses `manifestText` as JSON, then validates it under `envelope`. Never throws. */
export function buildPreview(envelope: PreviewEnvelope, manifestText: string): PreviewResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch (err) {
    return { kind: "syntax-error", message: err instanceof Error ? err.message : "Invalid JSON" };
  }
  try {
    const result = validateManifestEntry({ ...envelope, manifest: parsed });
    return result.ok
      ? { kind: "ok", entry: result.entry }
      : { kind: "rejected", reason: result.reason };
  } catch (err) {
    // validateManifestEntry only catches its own ManifestRejection; anything
    // else (e.g. a RangeError from JSON.stringify on a pathologically deep
    // manifest in the validator's size gate) would escape. Since the manifest
    // text is persisted, an uncaught throw here would crash the page on every
    // load — so map any unexpected error to a rejection instead.
    return {
      kind: "rejected",
      reason: err instanceof Error ? err.message : "Manifest could not be validated",
    };
  }
}
