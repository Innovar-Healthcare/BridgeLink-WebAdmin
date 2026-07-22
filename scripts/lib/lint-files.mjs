// Shared helpers for the repo lint scripts (lint-borders, lint-tables, lint-tabs).
//
// Two concerns live here:
//
// 1. File enumeration that also covers the commercial plugins overlay.
//    `plugins/` is a separate git repo (gitdir pointer `plugins/.git` ->
//    `../.git-commercial`) and is gitignored from the core repo, so a plain
//    `git ls-files` in the core cwd never sees plugin files. `getLintFiles()`
//    merges the core repo's tracked files with the plugins overlay's tracked
//    files (prefixed `plugins/`).
//
//    The overlay is enumerated two ways:
//      - `git ls-files` in `plugins/` when the gitdir pointer `plugins/.git`
//        exists (local dev checkout);
//      - a filesystem walk fallback when `plugins/` exists but has no `.git`.
//        This is the CI shape: `install-commercial-plugins.sh` / the commercial
//        repo's ci.yml drop the plugin files in with a plain `cp -r` and no git
//        marker, so `git ls-files` would return nothing and the linters would
//        silently scan zero commercial files. The walk keeps them enforced.
//    When the overlay isn't checked out at all — a clean public-repo clone —
//    neither branch fires and the plugins lookup is a silent no-op.
//
// 2. A grandfathering baseline. Existing plugin violations are snapshotted into
//    a committed `*-baseline.json` so the linters can start scanning plugin
//    files without failing CI on legacy debt. Only NEW violations fail. Each
//    entry is keyed by `"<file>\t<trimmed-snippet>"` — snippet text rather than
//    line number, so edits that shift lines don't spuriously break the baseline.

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PLUGINS_DIR = "plugins";

// The generated barrel is gitignored in both repos and is never a lint target;
// the filesystem-walk fallback must skip it explicitly since it can't ask git.
const GENERATED_BARREL = "index.ts";

/**
 * Run `git ls-files <globs>` in `cwd`, returning a list of paths. Returns `[]`
 * (never throws) when the directory isn't a git working tree.
 *
 * @param {string[]} globs - pathspec globs, e.g. ["*.tsx", "*.ts", "*.css"]
 * @param {string} cwd - directory to run git in
 * @returns {string[]}
 */
function gitLsFiles(globs, cwd) {
  try {
    const args = globs.map((g) => `'${g}'`).join(" ");
    const out = execSync(`git ls-files ${args}`, { encoding: "utf8", cwd });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Enumerate lint targets across the core repo AND the commercial plugins
 * overlay (when present). Plugin paths are returned prefixed with `plugins/`
 * so they resolve from the core repo root, matching how the scripts readFileSync.
 *
 * @param {string[]} globs - pathspec globs passed to `git ls-files`
 * @returns {string[]} de-duped list of repo-relative paths
 */
export function getLintFiles(globs) {
  const core = gitLsFiles(globs, process.cwd());

  let plugin = [];
  if (existsSync(path.join(PLUGINS_DIR, ".git"))) {
    // Local dev: the gitdir pointer exists. `git -C plugins` talks to the
    // commercial repo and lists exactly its tracked files.
    plugin = gitLsFiles(globs, PLUGINS_DIR).map((f) => `${PLUGINS_DIR}/${f}`);
  } else if (existsSync(PLUGINS_DIR)) {
    // CI / cold overlay: files were `cp -r`'d in with no `.git`, so git can't
    // see them. Walk the filesystem instead so the linters still scan the
    // commercial plugin sources.
    plugin = walkPluginFiles(PLUGINS_DIR, globs).map((f) => `${PLUGINS_DIR}/${f}`);
  }

  return [...new Set([...core, ...plugin])];
}

/**
 * Filesystem-walk fallback for enumerating overlay lint targets when the
 * commercial repo's gitdir pointer is absent (CI's `cp -r` shape). Returns
 * paths relative to `pluginsDir` whose basename matches one of `globs`.
 *
 * Skips the generated `index.ts` barrel (gitignored, never a lint target),
 * `node_modules`, and any dot-file/dot-dir (`.git`, `.github`, …) — mirroring
 * what `git ls-files` would and would not return for the tracked overlay.
 *
 * Only extension-shaped globs (`*.ts`, `*.tsx`, `*.css`) are supported here —
 * that's all the lint scripts pass — matched by suffix.
 *
 * @param {string} pluginsDir - overlay root to walk (e.g. "plugins")
 * @param {string[]} globs - extension globs, e.g. ["*.tsx", "*.ts", "*.css"]
 * @returns {string[]} paths relative to `pluginsDir`
 */
export function walkPluginFiles(pluginsDir, globs) {
  const suffixes = globs.map((g) => g.replace(/^\*/, "")); // "*.tsx" -> ".tsx"
  const matches = (name) => suffixes.some((s) => name.endsWith(s));

  const out = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (name.startsWith(".") || name === "node_modules") continue;
      const relPath = rel ? `${rel}/${name}` : name;
      if (entry.isDirectory()) {
        walk(path.join(dir, name), relPath);
      } else if (entry.isFile() && relPath !== GENERATED_BARREL && matches(name)) {
        out.push(relPath);
      }
    }
  };
  walk(pluginsDir, "");
  return out;
}

/** Stable key for a single violation: file + trimmed snippet (line-agnostic). */
export function violationKey(file, snippet) {
  return `${file}\t${snippet.trim()}`;
}

/**
 * Load a baseline file into a Set of violation keys. Missing file -> empty Set.
 *
 * @param {string} baselinePath
 * @returns {Set<string>}
 */
export function loadBaseline(baselinePath) {
  if (!existsSync(baselinePath)) return new Set();
  try {
    const arr = JSON.parse(readFileSync(baselinePath, "utf8"));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

/**
 * Write a baseline file from a list of violations. Keys are sorted for a stable
 * diff. Each violation must expose `.file` and `.snippet`.
 *
 * @param {string} baselinePath
 * @param {{file: string, snippet: string}[]} violations
 */
export function writeBaseline(baselinePath, violations) {
  const keys = [...new Set(violations.map((v) => violationKey(v.file, v.snippet)))].sort();
  writeFileSync(baselinePath, JSON.stringify(keys, null, 2) + "\n");
  return keys.length;
}
