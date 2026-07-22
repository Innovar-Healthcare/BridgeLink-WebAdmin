"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import type { LookupGroup, AdvancedJsonFilter, JsonOperator } from "@/lib/api-client";
import { InfoDialog } from "@/components/info-dialog";

// ─── Operator → symbol for JS snippet ────────────────────────────────────────

// Operators supported by the channel-script lookup runtime. Mirrors the Java
// AdvancedJsonFilterBuilder.mapOperatorToSymbol(): the runtime parser
// (fromLookupHelperInputs) only accepts these six symbols and rejects anything
// else, so CONTAINS / NOT_CONTAINS are intentionally absent — they cannot appear
// in a working snippet and are dropped (with a note) when present.
const SNIPPET_OP_SYMBOLS: Partial<Record<JsonOperator, string>> = {
  EQUAL: "=",
  NOT_EQUAL: "!=",
  GREATER_THAN: ">",
  LESS_THAN: "<",
  GREATER_OR_EQUAL: ">=",
  LESS_OR_EQUAL: "<=",
};

// ─── Code generation ─────────────────────────────────────────────────────────

// Builds a JavaScript Transformer snippet matching the Java client's
// AdvancedSearchSnippetHelper.buildJavaScriptSnippet(). The result of
// LookupHelper.searchValuesByJsonFields() is a java.util.Map<String, String>, so
// the snippet iterates it via keySet().iterator() — not as a List (the previous
// results.get(i)/entry.getKey() form errored at channel-test time,.
export function generateSnippet(group: LookupGroup, filter: AdvancedJsonFilter): string {
  // Mirror Java toConditionsJsonArray(): skip conditions with empty field/value
  // and map each operator to its runtime symbol.
  const complete = filter.conditions.filter((c) => c.field.trim() && c.value.trim());
  const supported = complete.filter((c) => SNIPPET_OP_SYMBOLS[c.op]);
  const droppedUnsupported = complete.length !== supported.length;

  const filterArray = supported.map((c) => ({
    field: c.field.trim(),
    op: SNIPPET_OP_SYMBOLS[c.op] as string,
    valueType: c.valueType,
    value: c.value.trim(),
  }));

  const lines: string[] = [];

  lines.push(`// JavaScript snippet for Dynamic Lookup (Advanced Search)`);
  lines.push(`var groupName = ${JSON.stringify(group.name)};`);
  lines.push(``);

  if (filter.keyPattern && filter.keyPattern.trim()) {
    lines.push(`// Optional KEY pattern filter (SQL LIKE)`);
    lines.push(`var keyPattern = ${JSON.stringify(filter.keyPattern.trim())};`);
  } else {
    lines.push(`// No KEY pattern filter`);
    lines.push(`var keyPattern = null;`);
  }
  lines.push(``);

  if (droppedUnsupported) {
    lines.push(`// NOTE: 'Contains' / 'Not Contains' conditions were omitted — the channel-script`);
    lines.push(`// lookup only supports the operators =, !=, >, <, >=, <=.`);
  }
  lines.push(`// JSON field filters (array form; easy to edit)`);
  lines.push(
    `// NOTE: The server normalizes "value" to text; valueType controls validation and casting (STRING/NUMBER/BOOLEAN).`
  );
  lines.push(
    `var filterObj = ${filterArray.length > 0 ? JSON.stringify(filterArray, null, 2) : "[]"};`
  );
  lines.push(`var filterJson = JSON.stringify(filterObj);`);
  lines.push(``);

  lines.push(`// NOTE:`);
  lines.push(`// The lookup returns only the FIRST 1000 matching entries.`);
  lines.push(`// This limit is applied to protect performance.`);
  lines.push(``);

  lines.push(`var start = new Date().getTime();`);
  lines.push(`var results = LookupHelper.searchValuesByJsonFields(`);
  lines.push(`    groupName,`);
  lines.push(`    keyPattern,`);
  lines.push(`    filterJson`);
  lines.push(`);`);
  lines.push(`var elapsed = new Date().getTime() - start;`);
  lines.push(``);

  lines.push(`// DEBUG OUTPUT (remove or comment out in production)`);
  lines.push(`if (results == null) {`);
  lines.push(`    logger.error("Lookup failed for group: " + groupName);`);
  lines.push(`} else if (results.isEmpty()) {`);
  lines.push(
    `    logger.info("No matching entries (elapsed=" + elapsed + " ms) in group=" + groupName);`
  );
  lines.push(`} else {`);
  lines.push(`    logger.info("Sample results (showing up to 2 entries):");`);
  lines.push(`    var iter = results.keySet().iterator();`);
  lines.push(`    var count = 0;`);
  lines.push(``);
  lines.push(`    while (iter.hasNext() && count < 2) {`);
  lines.push(`        var key = iter.next();`);
  lines.push(`        var value = results.get(key);`);
  lines.push(`        logger.info("  key=" + key + ", value=" + value);`);
  lines.push(`        count++;`);
  lines.push(`    }`);
  lines.push(``);
  lines.push(`    logger.info(`);
  lines.push(
    `        "Found " + results.size() + " matching entries (elapsed=" + elapsed + " ms) in group=" + groupName`
  );
  lines.push(`    );`);
  lines.push(`}`);

  return lines.join("\n");
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SnippetDialogProps {
  group: LookupGroup;
  filter: AdvancedJsonFilter;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SnippetDialog({ group, filter, onClose }: SnippetDialogProps) {
  const [copied, setCopied] = useState(false);
  const snippet = generateSnippet(group, filter);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text
    }
  }

  return (
    <InfoDialog
      open={true}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title="Channel Script Snippet"
      description="Copy this JavaScript into your BridgeLink channel script"
      maxWidth="sm:max-w-4xl"
      footerLeft={
        <Button size="sm" onClick={handleCopy}>
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 mr-1.5" /> Copied!
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy
            </>
          )}
        </Button>
      }
    >
      <pre className="w-full rounded-md border border-border bg-gray-50 dark:bg-gray-900 p-4 text-xs leading-relaxed font-mono text-gray-800 dark:text-gray-200 overflow-auto max-h-[50vh] whitespace-pre">
        {snippet}
      </pre>
    </InfoDialog>
  );
}
