/**
 * Pure core of the `webadmin.json` CLI validator.
 *
 * A plugin author's build (or CI) runs the SAME strict validator WebAdmin
 * applies at load time, so a broken manifest fails the author's build instead
 * of surfacing as skipped-with-reason on a customer server. This module is the
 * testable core — parse + envelope + validate; the argv/exit shell lives in
 * `scripts/validate-webadmin-manifest.ts`.
 */

import { validateManifestEntry } from "./manifest-validator";
import { COLLECTION_FIELD_TYPES, type SkippedKind, type WebAdminManifest } from "./manifest-types";

/** Total collection-typed fields across a validated manifest's connector panels. */
function countCollectionFields(manifest: WebAdminManifest): number {
  const collectionTypes = new Set<string>(COLLECTION_FIELD_TYPES);
  let count = 0;
  for (const panel of manifest.connectorPanels ?? []) {
    for (const section of panel.sections) {
      for (const field of section.fields) {
        if (collectionTypes.has(field.type)) count++;
      }
    }
  }
  return count;
}

export interface ManifestFileEnvelope {
  /** Extension name (from the sibling extension.json, else a placeholder). */
  name: string;
  /**
   * Extension install path — LOAD-BEARING: action-endpoint validation checks
   * the `/extensions/<path>/` prefix, so a wrong path changes the verdict.
   */
  path: string;
  version: string;
}

export type ManifestFileResult =
  | {
      ok: true;
      connectorPanels: number;
      settingsPanels: number;
      transmissionModes: number;
      dataTypes: number;
      connectorSections: number;
      transformerSteps: number;
      /** Total collection-typed fields (v3) across connector panels. */
      collectionFields: number;
      /**
       * Reserved v2 kinds THIS build's validator doesn't implement — the
       * manifest is valid, but a WebAdmin of this build would skip these kinds
       * with a visible reason. Surfaced as CLI warnings so an author validating
       * against an older checkout isn't silently over-promised.
       */
      skippedKinds: SkippedKind[];
    }
  | { ok: false; reason: string };

/**
 * Validate one `webadmin.json` file's text against the manifest contract
 * (v1/v2). `content` is the manifest object (what the engine serves as
 * `entry.manifest`); it is wrapped in the given envelope and run through
 * `validateManifestEntry`.
 */
export function validateManifestFile(
  content: string,
  envelope: ManifestFileEnvelope
): ManifestFileResult {
  let manifest: unknown;
  try {
    manifest = JSON.parse(content);
  } catch (err) {
    return { ok: false, reason: `invalid JSON: ${(err as Error).message}` };
  }
  const result = validateManifestEntry({
    name: envelope.name,
    path: envelope.path,
    version: envelope.version,
    manifest,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    connectorPanels: result.entry.manifest.connectorPanels?.length ?? 0,
    settingsPanels: result.entry.manifest.settingsPanels?.length ?? 0,
    transmissionModes: result.entry.manifest.transmissionModes?.length ?? 0,
    dataTypes: result.entry.manifest.dataTypes?.length ?? 0,
    connectorSections: result.entry.manifest.connectorSections?.length ?? 0,
    transformerSteps: result.entry.manifest.transformerSteps?.length ?? 0,
    collectionFields: countCollectionFields(result.entry.manifest),
    skippedKinds: result.skippedKinds,
  };
}
