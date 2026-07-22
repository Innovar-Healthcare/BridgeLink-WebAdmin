#!/usr/bin/env node
// Fails CI if a plugin `index.ts` EAGERLY (statically, as a value) imports one
// of its own UI component modules. Plugin UI must be code-split out of the
// app-shell's initial bundle: components are contributed to the
// manifest via lazyPluginComponent(() => import(...)) wrappers declared in a
// "use client" `lazy-surfaces` module, never imported directly into index.ts.
//
// Heuristic: for each `plugins/*/index.ts`, walk the transitive closure of its
// EAGER same-plugin `.ts` imports (index.ts + every `.ts` it reaches via static,
// non-type imports — logic/handlers/the lazy-surfaces barrel/the
// connector-plugin split modules), and flag any static value import — a relative
// path OR an `@/plugins/<same-plugin>/...` alias back to its own directory —
// whose specifier resolves on disk to a `.tsx` file (a React component module).
// `import type` is allowed (erased at build), and so is `.ts` -> `.ts`, which
// doesn't carry a component graph. Dynamic `import(...)` (the lazy-surfaces
// wrappers) is not matched by IMPORT_REGEX, so it never registers. An alias into
// a DIFFERENT plugin's directory, or any other `@/...` import, is out of scope
// for this rule (core imports are always fine; cross-plugin imports are a
// separate, pre-existing convention).
//
// Following the eager `.ts` closure (not just index.ts) matters because a plugin
// can re-export an eager module that itself eagerly imports a `.tsx` — e.g. the
// SSL split's ssl-source-plugin.ts. index.ts alone would miss it.
//
// This mirrors the eager-route-handler ban (server side, registerRouteHandlerLazy).
// Legacy overlay violations that predate this rule are grandfathered in
// lint-plugin-lazy-baseline.json (keyed by file + snippet, line-agnostic); only
// NEW violations fail. After converting a plugin, regenerate the baseline with:
//   node scripts/lint-plugin-lazy.mjs --update-baseline
//
// See docs/PLUGIN-DEVELOPMENT.md and lib/plugin-lazy.tsx.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getLintFiles, loadBaseline, writeBaseline, violationKey } from "./lib/lint-files.mjs";

const BASELINE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "lint-plugin-lazy-baseline.json"
);
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

// Matches an import statement and captures: whole-import `type` keyword (g1),
// the import clause (g2), and the module specifier (g3). Spans multiple lines.
const IMPORT_REGEX = /import\s+(type\s+)?([\s\S]*?)\bfrom\s*["']([^"']+)["']/g;

/** Resolve a base path (already relative-to-cwd) to an on-disk file, or null. */
function resolveOnDisk(base) {
  const candidates = [
    `${base}.tsx`,
    `${base}.ts`,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** The `plugins/<name>` a file belongs to, or null if not under plugins/. */
function ownPluginOf(file) {
  const m = file.match(/^plugins\/([^/]+)\//);
  return m ? m[1] : null;
}

/**
 * Resolve an import specifier written in `fromFile` to an on-disk file, but
 * ONLY when it points at `fromFile`'s own plugin directory (relative import,
 * or an `@/plugins/<same-name>/...` alias back to itself). Everything else —
 * bare packages, core `@/...` aliases, a different plugin's `@/plugins/...` —
 * returns null (out of scope for this rule).
 */
function resolveOwnPluginImport(fromFile, spec) {
  if (spec.startsWith(".")) {
    return resolveOnDisk(path.resolve(path.dirname(fromFile), spec));
  }
  if (spec.startsWith("@/plugins/")) {
    const ownPlugin = ownPluginOf(fromFile);
    const specPlugin = spec.slice("@/plugins/".length).split("/")[0];
    if (!ownPlugin || specPlugin !== ownPlugin) return null; // different plugin — not this rule's job
    return resolveOnDisk(path.resolve(spec.slice(2))); // "@/x" -> "x", resolved from repo root (cwd)
  }
  return null; // bare package or a non-plugins @/ alias — always fine
}

/** Read a file, returning "" if it can't be read (missing/unreadable). */
function readOrEmpty(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/**
 * Yield each EAGER (static, non-`type`) import in `content` as `{ spec, line }`.
 * Dynamic `import(...)` has no `from` clause and is not matched by IMPORT_REGEX.
 */
function* eagerImports(content) {
  for (const m of content.matchAll(IMPORT_REGEX)) {
    if (m[1]) continue; // `import type ...` — erased at build
    yield { spec: m[3], line: content.slice(0, m.index).split("\n").length };
  }
}

/**
 * Transitive closure of the EAGER same-plugin `.ts` modules reachable from
 * `entryFile` (inclusive). Follows only imports that resolve to a `.ts` inside
 * the entry's own plugin dir; `.tsx` targets are violations to report, not nodes
 * to recurse into.
 */
export function collectEagerModuleGraph(entryFile) {
  const visited = new Set([entryFile]);
  const queue = [entryFile];
  while (queue.length) {
    const file = queue.shift();
    for (const { spec } of eagerImports(readOrEmpty(file))) {
      const resolved = resolveOwnPluginImport(file, spec);
      if (resolved && resolved.endsWith(".ts") && !visited.has(resolved)) {
        visited.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return visited;
}

/**
 * All eager `.tsx` imports reachable from `entryFile` via its eager `.ts`
 * closure, as `{ file, line, snippet }` violations. Includes `entryFile` itself,
 * so a `.tsx` imported directly by index.ts is still caught.
 */
export function findEagerTsxViolations(entryFile) {
  const out = [];
  for (const file of collectEagerModuleGraph(entryFile)) {
    for (const { spec, line } of eagerImports(readOrEmpty(file))) {
      const resolved = resolveOwnPluginImport(file, spec);
      if (resolved && resolved.endsWith(".tsx")) {
        out.push({ file, line, snippet: `import … from "${spec}"` });
      }
    }
  }
  return out;
}

function main() {
  // Only `plugins/<name>/index.ts` files.
  const indexFiles = getLintFiles(["*.ts"]).filter((f) => /^plugins\/[^/]+\/index\.ts$/.test(f));

  const violations = indexFiles.flatMap(findEagerTsxViolations);

  if (UPDATE_BASELINE) {
    const n = writeBaseline(BASELINE_PATH, violations);
    console.log(`lint:plugin-lazy: wrote baseline with ${n} grandfathered violation(s).`);
    process.exit(0);
  }

  const baseline = loadBaseline(BASELINE_PATH);
  const grandfathered = violations.filter((v) => baseline.has(violationKey(v.file, v.snippet)));
  const newViolations = violations.filter((v) => !baseline.has(violationKey(v.file, v.snippet)));

  if (newViolations.length > 0) {
    console.error("");
    console.error(
      "lint:plugin-lazy: a plugin index.ts (or an eager .ts module it reaches) imports a UI component module."
    );
    console.error(
      "Plugin components must be code-split: wrap them with lazyPluginComponent"
    );
    console.error('(() => import("./x")) in a "use client" lazy-surfaces module and import that.');
    console.error("See docs/PLUGIN-DEVELOPMENT.md and lib/plugin-lazy.tsx.");
    console.error("");
    for (const v of newViolations) {
      console.error(`  ${v.file}:${v.line}  — ${v.snippet}`);
    }
    console.error("");
    console.error(`${newViolations.length} new violation(s).`);
    console.error("If a violation is intentional legacy debt, regenerate the baseline:");
    console.error("  node scripts/lint-plugin-lazy.mjs --update-baseline");
    process.exit(1);
  }

  const pluginNote = `${indexFiles.length} plugin index.ts file(s) + their eager .ts closures scanned`;
  const grandfatheredNote =
    grandfathered.length > 0 ? `, ${grandfathered.length} grandfathered via baseline` : "";
  console.log(
    `lint:plugin-lazy: OK — no eager plugin component imports. ${pluginNote}${grandfatheredNote}.`
  );
}

// Run the scan only when invoked as a script (`node scripts/lint-plugin-lazy.mjs`),
// not when imported by a unit test — the exported helpers are testable in isolation
// and the top-level scan calls process.exit().
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
