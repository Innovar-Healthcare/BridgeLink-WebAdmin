#!/usr/bin/env tsx
/**
 * CLI validator for `webadmin.json` runtime plugin manifests.
 *
 *   npm run validate:manifest -- <manifest.json | extension-dir> [...more]
 *
 * Runs the exact strict validator WebAdmin applies at load time, so a broken
 * manifest fails the plugin author's build instead of surfacing as
 * skipped-with-reason on a customer server. Exits non-zero if any target fails.
 *
 * Each target is either a `webadmin.json` file or an extension directory
 * containing `webadmin/webadmin.json`. The envelope (name/path/version) is
 * read from a sibling `extension.json` when present — `path` is LOAD-BEARING
 * because action-endpoint validation checks the `/extensions/<path>/` prefix.
 * Override any field with --name / --path / --version.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  validateManifestFile,
  type ManifestFileEnvelope,
} from "../lib/runtime-plugins/validate-manifest-file";

interface CliArgs {
  targets: string[];
  overrides: Partial<ManifestFileEnvelope>;
}

function parseArgs(argv: string[]): CliArgs {
  const targets: string[] = [];
  const overrides: Partial<ManifestFileEnvelope> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--name" || arg === "--path" || arg === "--version") {
      const value = argv[++i];
      if (value === undefined) {
        console.error(`error: ${arg} requires a value`);
        process.exit(2);
      }
      overrides[arg.slice(2) as keyof ManifestFileEnvelope] = value;
    } else if (arg.startsWith("--")) {
      console.error(`error: unknown flag "${arg}"`);
      process.exit(2);
    } else {
      targets.push(arg);
    }
  }
  return { targets, overrides };
}

/**
 * Resolves a target to its webadmin.json path, or null if not found. A
 * directory may hold the manifest at `webadmin/webadmin.json` (the engine
 * extension layout) or `webadmin.json` directly (the flattened fixture layout).
 */
function resolveManifestPath(target: string): string | null {
  if (!existsSync(target)) return null;
  if (statSync(target).isDirectory()) {
    const nested = join(target, "webadmin", "webadmin.json");
    if (existsSync(nested)) return nested;
    const flat = join(target, "webadmin.json");
    if (existsSync(flat)) return flat;
    return null;
  }
  return target;
}

/**
 * Envelope from the extension.json beside the extension dir, with overrides.
 * Handles both layouts: extension.json sits next to the manifest (flattened)
 * or one directory up (when the manifest is under `webadmin/`).
 */
function resolveEnvelope(
  manifestPath: string,
  overrides: Partial<ManifestFileEnvelope>
): ManifestFileEnvelope {
  const manifestDir = dirname(manifestPath);
  const extDir = basename(manifestDir) === "webadmin" ? dirname(manifestDir) : manifestDir;
  const envelope: ManifestFileEnvelope = {
    name: "preview-extension",
    path: basename(extDir) || "preview-extension",
    version: "0.0.0",
  };
  const extJson = join(extDir, "extension.json");
  if (existsSync(extJson)) {
    try {
      const meta = JSON.parse(readFileSync(extJson, "utf8")) as Record<string, unknown>;
      if (typeof meta.name === "string") envelope.name = meta.name;
      if (typeof meta.path === "string") envelope.path = meta.path;
      if (typeof meta.version === "string") envelope.version = meta.version;
    } catch {
      // A malformed extension.json just leaves the placeholder envelope.
    }
  }
  return { ...envelope, ...overrides };
}

function main(): void {
  const { targets, overrides } = parseArgs(process.argv.slice(2));
  if (targets.length === 0) {
    console.error(
      "usage: validate:manifest -- <manifest.json | extension-dir> [...]\n" +
        "       [--name <n>] [--path <p>] [--version <v>]"
    );
    process.exit(2);
  }

  let failures = 0;
  for (const target of targets) {
    const manifestPath = resolveManifestPath(target);
    if (manifestPath === null) {
      console.error(`${target}: no webadmin.json found`);
      failures++;
      continue;
    }
    const envelope = resolveEnvelope(manifestPath, overrides);
    const content = readFileSync(manifestPath, "utf8");
    const result = validateManifestFile(content, envelope);
    if (result.ok) {
      console.log(
        `${manifestPath}: OK (${result.connectorPanels} connector panel(s), ` +
          `${result.settingsPanels} settings panel(s), ` +
          `${result.transmissionModes} transmission mode(s), ` +
          `${result.dataTypes} data type(s), ` +
          `${result.connectorSections} connector section(s), ` +
          `${result.transformerSteps} transformer step(s), ` +
          `${result.collectionFields} collection field(s))`
      );
      for (const skipped of result.skippedKinds) {
        console.warn(
          `${manifestPath}: warning: ${skipped.kind}: ${skipped.reason} — ` +
            `a WebAdmin of this build would skip that kind with a visible reason`
        );
      }
    } else {
      console.error(`${manifestPath}: ${result.reason}`);
      failures++;
    }
  }
  process.exit(failures > 0 ? 1 : 0);
}

main();
