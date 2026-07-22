#!/usr/bin/env node
// Fails CI if any source file uses raw HTML table elements
// (<table>, <thead>, <tbody>, <tr>, <th>, <td>) outside the allow-listed
// shared component module. Every table must compose `components/data-table`
// primitives (TableContainer, TableRow, TableCell, etc.) or the high-level
// `<DataTable>` wrapper instead.
//
// To add a legitimate exception, add the path to ALLOW_LIST below and explain
// in the PR why the case can't use the shared components.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getLintFiles, loadBaseline, writeBaseline, violationKey } from "./lib/lint-files.mjs";

const BASELINE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "lint-tables-baseline.json"
);
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

const ALLOW_LIST = [
  /^components\/data-table\//,
  /^components\/sortable-header-cell\.tsx$/,
  // Shared table-row primitives that legitimately render <tr>/<td> for
  // Bucket A pages (Dashboard, Channels) which compose primitives directly.
  /^components\/empty-table-state\.tsx$/,
  /^components\/table-skeleton-rows\.tsx$/,
  // Tests for the primitives themselves render raw <th>/<td> as fixtures.
  /^__tests__\/unit\/data-table-primitives\.test\.tsx$/,
  // Dashboard connector-selection test uses a minimal <table> stub as a fixture.
  /^__tests__\/unit\/dashboard-connector-selection\.test\.tsx$/,
];

const TAG_REGEX = /<(table|thead|tbody|tr|th|td)\b/g;

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
    // Skip line comments and block-comment continuation lines.
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    const matches = [...lines[i].matchAll(TAG_REGEX)];
    for (const m of matches) {
      violations.push({ file, line: i + 1, tag: m[1], snippet: trimmed });
    }
  }
}

if (UPDATE_BASELINE) {
  const n = writeBaseline(BASELINE_PATH, violations);
  console.log(`lint:tables: wrote baseline with ${n} grandfathered violation(s).`);
  process.exit(0);
}

// Grandfather legacy violations recorded in the baseline (see lib/lint-files.mjs).
const baseline = loadBaseline(BASELINE_PATH);
const grandfathered = violations.filter((v) => baseline.has(violationKey(v.file, v.snippet)));
const newViolations = violations.filter((v) => !baseline.has(violationKey(v.file, v.snippet)));

if (newViolations.length > 0) {
  console.error("");
  console.error("lint:tables: raw HTML table elements found outside `components/data-table/`.");
  console.error("Tables must compose the shared primitives or use the <DataTable> wrapper.");
  console.error("See CLAUDE.md → 'Building tables' for the canonical pattern.");
  console.error("");
  for (const v of newViolations) {
    console.error(`  ${v.file}:${v.line}  <${v.tag}>  — ${v.snippet}`);
  }
  console.error("");
  console.error(`${newViolations.length} new violation(s).`);
  console.error("If a violation is intentional legacy debt, regenerate the baseline:");
  console.error("  node scripts/lint-tables.mjs --update-baseline");
  process.exit(1);
}

const summary = `${files.length} file(s) scanned (${pluginCount} from plugins overlay)`;
const grandfatheredNote =
  grandfathered.length > 0 ? `, ${grandfathered.length} grandfathered via baseline` : "";
console.log(`lint:tables: OK — no new raw table elements. ${summary}${grandfatheredNote}.`);
