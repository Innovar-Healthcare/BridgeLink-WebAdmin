#!/usr/bin/env node
// Fails CI if any source file implements tabs outside the shared `@/components/ui/tabs`
// primitive. Every tab UI must use `<Tabs>`, `<TabsList>`, `<TabsTrigger>`, and
// `<TabsContent>` from that module — never raw `role="tab"` / `role="tablist"` attrs,
// and never a direct import of the Radix `Tabs` primitive.
//
// To add a legitimate exception, add the path to ALLOW_LIST below and explain
// in the PR why the case can't use the shared component.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getLintFiles, loadBaseline, writeBaseline, violationKey } from "./lib/lint-files.mjs";

const BASELINE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "lint-tabs-baseline.json"
);
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

const ALLOW_LIST = [
  // The primitive itself is allowed to use the Radix import and role attrs.
  /^components\/ui\/tabs\.tsx$/,
  // Tests for the primitive may render raw Radix Tabs.
  /^__tests__\/unit\/tabs.*\.test\.tsx$/,
];

// Patterns that indicate a bespoke tab implementation.
// Each entry may have either a `regex` (tested per line) or a `test` function (receives the line string).
const VIOLATIONS = [
  { regex: /role="tab(?:list)?"/g, label: 'role="tab" / role="tablist"' },
  {
    regex:
      /from\s+["']radix-ui["'].*\bTabs\b|import\s+\{[^}]*\bTabs\b[^}]*\}\s+from\s+["']@radix-ui\/react-tabs["']/g,
    label: "direct Radix Tabs import (use @/components/ui/tabs instead)",
  },
  {
    // Catches the classic bespoke "border-bottom underline" tab button pattern.
    // Both classes on the same line means a custom <button> is acting as a tab trigger.
    test: (line) => /border-b-2/.test(line) && /-mb-px/.test(line),
    label:
      "bespoke tab-button pattern (border-b-2 + -mb-px on same line — use <Tabs>/<TabsTrigger> instead)",
  },
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
    for (const { regex, test, label } of VIOLATIONS) {
      const matched = regex ? ((regex.lastIndex = 0), regex.test(lines[i])) : test(lines[i]);
      if (matched) {
        violations.push({ file, line: i + 1, label, snippet: trimmed });
      }
    }
  }
}

if (UPDATE_BASELINE) {
  const n = writeBaseline(BASELINE_PATH, violations);
  console.log(`lint:tabs: wrote baseline with ${n} grandfathered violation(s).`);
  process.exit(0);
}

// Grandfather legacy violations recorded in the baseline (see lib/lint-files.mjs).
const baseline = loadBaseline(BASELINE_PATH);
const grandfathered = violations.filter((v) => baseline.has(violationKey(v.file, v.snippet)));
const newViolations = violations.filter((v) => !baseline.has(violationKey(v.file, v.snippet)));

if (newViolations.length > 0) {
  console.error("");
  console.error("lint:tabs: bespoke tab implementation found outside `components/ui/tabs.tsx`.");
  console.error(
    "Tabs must use the shared <Tabs>, <TabsList>, <TabsTrigger>, <TabsContent> primitive."
  );
  console.error("See CLAUDE.md → 'Shared UI components' for the canonical pattern.");
  console.error("");
  for (const v of newViolations) {
    console.error(`  ${v.file}:${v.line}  ${v.label}  — ${v.snippet}`);
  }
  console.error("");
  console.error(`${newViolations.length} new violation(s).`);
  console.error("If a violation is intentional legacy debt, regenerate the baseline:");
  console.error("  node scripts/lint-tabs.mjs --update-baseline");
  process.exit(1);
}

const summary = `${files.length} file(s) scanned (${pluginCount} from plugins overlay)`;
const grandfatheredNote =
  grandfathered.length > 0 ? `, ${grandfathered.length} grandfathered via baseline` : "";
console.log(`lint:tabs: OK — no new bespoke tab implementations. ${summary}${grandfatheredNote}.`);
