#!/usr/bin/env node
/**
 * Vendors the Monaco editor's prebuilt `min/vs` assets into `public/` so the
 * editor loads same-origin instead of from the jsdelivr CDN.
 *
 * Why: @monaco-editor/react's loader defaults to fetching monaco-editor from
 * cdn.jsdelivr.net at runtime, which breaks offline / air-gapped installs and
 * violates the app CSP (script-src 'self'). lib/monaco-loader.ts points the
 * loader at the copy produced here.
 *
 * The destination is version-namespaced (`public/monaco/<version>/vs`) so it
 * stays in lockstep with NEXT_PUBLIC_MONACO_VERSION (injected from the same
 * installed package in next.config.ts) and a monaco-editor upgrade can't serve
 * a stale, cached `editor.main.js` against new content-hashed chunks.
 *
 * The output is gitignored and regenerated on every predev / prebuild (wired in
 * package.json), mirroring how `.next/static` is treated.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const monacoModule = join(repoRoot, "node_modules", "monaco-editor");
const src = join(monacoModule, "min", "vs");

if (!existsSync(src)) {
  console.error(`[copy-monaco] ${src} not found — is monaco-editor installed? Run npm install.`);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(monacoModule, "package.json"), "utf8"));
const monacoRoot = join(repoRoot, "public", "monaco");
const dest = join(monacoRoot, version, "vs");

// rm-then-cp so a version bump never leaves an orphaned old-version directory.
rmSync(monacoRoot, { recursive: true, force: true });
mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });

console.log(`[copy-monaco] vendored monaco-editor@${version}: ${src} -> ${dest}`);
