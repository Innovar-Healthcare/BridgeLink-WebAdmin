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
  | { ok: true; connectorPanels: number; settingsPanels: number }
  | { ok: false; reason: string };

/**
 * Validate one `webadmin.json` file's text against the frozen v1 contract.
 * `content` is the manifest object (what the engine serves as `entry.manifest`);
 * it is wrapped in the given envelope and run through `validateManifestEntry`.
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
  };
}
