#!/usr/bin/env node
// Fails CI if any source file uses hardcoded neutral-gray border Tailwind classes
// instead of the design token `border-border` (or `border-input` for form inputs).
//
// Forbidden: border-gray-*, border-slate-*, border-zinc-*, border-neutral-*,
//            border-stone-*, divide-gray-*, divide-slate-*, divide-zinc-*,
//            divide-neutral-*, divide-stone-*.
//
// To add a legitimate exception, add the path regex to ALLOW_LIST below and
// explain in the PR why the case can't use the shared token.
//
// See CLAUDE.md → 'Borders' for the canonical pattern.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getLintFiles, loadBaseline, writeBaseline, violationKey } from "./lib/lint-files.mjs";

const BASELINE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "lint-borders-baseline.json"
);
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

const ALLOW_LIST = [
  // brand-on-brand navy divider on the sidebar surface — #2a4a7a is intentional
  /^components\/sidebar\.tsx$/,
  // The lint script itself contains the forbidden pattern strings as regex literals
  /^scripts\/lint-borders\.mjs$/,
  // State indicator dots: bg-gray-400/border-gray-500 pair conveys "disabled/off"
  // state, analogous to bg-blue-500/border-blue-600 for "enabled/on". Semantic use.
  /^app\/\(app\)\/alerts\/page\.tsx$/,
  /^app\/\(app\)\/extensions\/_components\/extension-table\.tsx$/,
];

// Matches neutral-gray border / divide classes (Tailwind color scale, any shade)
const BORDER_REGEX = /\bborder-(?:gray|slate|zinc|neutral|stone)-[0-9]+\b/;
const DIVIDE_REGEX = /\bdivide-(?:gray|slate|zinc|neutral|stone)-[0-9]+\b/;

const files = getLintFiles(["*.tsx", "*.ts", "*.css"]);
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
    // Skip pure line comments and block-comment continuation lines
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    if (BORDER_REGEX.test(lines[i]) || DIVIDE_REGEX.test(lines[i])) {
      violations.push({ file, line: i + 1, snippet: trimmed });
    }
  }
}

if (UPDATE_BASELINE) {
  const n = writeBaseline(BASELINE_PATH, violations);
  console.log(`lint:borders: wrote baseline with ${n} grandfathered violation(s).`);
  process.exit(0);
}

// Grandfather legacy violations recorded in the baseline (see lib/lint-files.mjs).
const baseline = loadBaseline(BASELINE_PATH);
const grandfathered = violations.filter((v) => baseline.has(violationKey(v.file, v.snippet)));
const newViolations = violations.filter((v) => !baseline.has(violationKey(v.file, v.snippet)));

if (newViolations.length > 0) {
  console.error("");
  console.error(
    "lint:borders: hardcoded neutral-gray border classes found outside the allow-list."
  );
  console.error(
    "Use `border-border` for all neutral surface borders, `border-input` for form inputs."
  );
  console.error("See CLAUDE.md → 'Borders' for the canonical pattern.");
  console.error("");
  for (const v of newViolations) {
    console.error(`  ${v.file}:${v.line}  — ${v.snippet}`);
  }
  console.error("");
  console.error(`${newViolations.length} new violation(s).`);
  console.error("If a violation is intentional legacy debt, regenerate the baseline:");
  console.error("  node scripts/lint-borders.mjs --update-baseline");
  process.exit(1);
}

const summary = `${files.length} file(s) scanned (${pluginCount} from plugins overlay)`;
const grandfatheredNote =
  grandfathered.length > 0 ? `, ${grandfathered.length} grandfathered via baseline` : "";
console.log(
  `lint:borders: OK — no new hardcoded neutral-gray border classes. ${summary}${grandfatheredNote}.`
);
