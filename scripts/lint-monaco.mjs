#!/usr/bin/env node
// Fails CI on the two ways a Monaco editor can escape the app's single global theme.
//
// 1. Reaching @monaco-editor/react directly instead of `@/components/monaco-editor`.
//    ESLint's no-restricted-imports already blocks a *static* default import, but it
//    does not inspect ImportExpression — so `dynamic(() => import("@monaco-editor/react"))`
//    slipped past it three separate times (message-template-editor, content-viewer,
//    value-detail-dialog). An editor that bypasses the wrapper gets the library's
//    default `theme="light"`, which resets the page theme on mount.
//
// 2. Defining or setting a Monaco theme anywhere but lib/monaco-theme.ts. Monaco
//    themes are global per instance, so a second theme silently strips the first
//    one's colors for every editor on the page — that is and.
//
// To add a legitimate exception, add the path to ALLOW_LIST below and explain
// in the PR why the case can't use the shared module.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getLintFiles, loadBaseline, writeBaseline, violationKey } from "./lib/lint-files.mjs";

const BASELINE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "lint-monaco-baseline.json"
);
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

const ALLOW_LIST = [
  // The wrapper is the one place allowed to import the library's Editor.
  /^components\/monaco-editor\.tsx$/,
  // The AMD loader configures @monaco-editor/react itself.
  /^lib\/monaco-loader\.ts$/,
  // The single source of truth for themes.
  /^lib\/monaco-theme\.ts$/,
  // Tests may mock or assert on either.
  /^(__tests__|plugins\/__tests__)\//,
];

const VIOLATIONS = [
  {
    regex: /import\s*\(\s*["']@monaco-editor\/react["']\s*\)/g,
    label: 'dynamic import of "@monaco-editor/react" (use @/components/monaco-editor)',
  },
  {
    regex: /from\s+["']@monaco-editor\/react["']/g,
    label: 'import from "@monaco-editor/react" (use @/components/monaco-editor)',
    // Type-only imports are harmless — they cannot mount an editor.
    skip: (line) => /^\s*import\s+type\b/.test(line) || /\bimport\s*\{\s*type\s/.test(line),
  },
  {
    regex: /\beditor\s*\.\s*defineTheme\s*\(/g,
    label: "monaco.editor.defineTheme() outside lib/monaco-theme.ts",
  },
  {
    regex: /\beditor\s*\.\s*setTheme\s*\(/g,
    label: "monaco.editor.setTheme() outside lib/monaco-theme.ts",
  },
  // A `theme` prop on <MonacoEditor> is deliberately not checked here: the
  // wrapper's props are Omit<EditorProps, "theme">, so tsc already rejects it,
  // and a text heuristic would eventually false-positive on an unrelated
  // component's theme prop in the same file.
];

const files = getLintFiles(["*.tsx", "*.ts"]);
const pluginCount = files.filter((f) => f.startsWith("plugins/")).length;

const violations = [];
for (const file of files) {
  if (ALLOW_LIST.some((re) => re.test(file))) continue;
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    for (const { regex, label, skip } of VIOLATIONS) {
      if (skip?.(lines[i])) continue;
      regex.lastIndex = 0;
      if (regex.test(lines[i])) {
        violations.push({ file, line: i + 1, label, snippet: trimmed });
      }
    }
  }
}

if (UPDATE_BASELINE) {
  const n = writeBaseline(BASELINE_PATH, violations);
  console.log(`lint:monaco: wrote baseline with ${n} grandfathered violation(s).`);
  process.exit(0);
}

// Grandfather legacy violations recorded in the baseline (see lib/lint-files.mjs).
const baseline = loadBaseline(BASELINE_PATH);
const grandfathered = violations.filter((v) => baseline.has(violationKey(v.file, v.snippet)));
const newViolations = violations.filter((v) => !baseline.has(violationKey(v.file, v.snippet)));

if (newViolations.length > 0) {
  console.error("");
  console.error("lint:monaco: Monaco editor or theme used outside the shared modules.");
  console.error(
    "Render editors via <MonacoEditor> (components/monaco-editor.tsx) and never pass a"
  );
  console.error(
    "theme — Monaco themes are global per instance, so the wrapper owns the one app theme."
  );
  console.error("See lib/monaco-theme.ts and CLAUDE.md → Gotchas.");
  console.error("");
  for (const v of newViolations) {
    console.error(`  ${v.file}:${v.line}  ${v.label}  — ${v.snippet}`);
  }
  console.error("");
  console.error(`${newViolations.length} new violation(s).`);
  console.error("If a violation is intentional legacy debt, regenerate the baseline:");
  console.error("  node scripts/lint-monaco.mjs --update-baseline");
  process.exit(1);
}

const summary = `${files.length} file(s) scanned (${pluginCount} from plugins overlay)`;
const grandfatheredNote =
  grandfathered.length > 0 ? `, ${grandfathered.length} grandfathered via baseline` : "";
console.log(`lint:monaco: OK — no stray Monaco editors or themes. ${summary}${grandfatheredNote}.`);
