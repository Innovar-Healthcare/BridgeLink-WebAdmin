/**
 * dependency-analysis.ts
 *
 * Pure functions for analyzing dependencies between code templates.
 * - findCalledFunctions: what other template functions does this template call?
 * - findCallers: what other templates call this template's function?
 */

import type { CodeTemplate, CodeTemplateLibrary } from "@/lib/types";
import {
  extractFunctionName,
  buildSnippet,
  buildFunctionPattern,
  stripJsComments,
} from "./find-usage";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CalledFunction {
  templateId: string;
  templateName: string;
  libraryName: string;
  functionName: string;
}

export interface CallerTemplate {
  templateId: string;
  templateName: string;
  libraryName: string;
  snippet: string;
}

// ─── Build library lookup ─────────────────────────────────────────────────────

function buildLibraryLookup(libraries: CodeTemplateLibrary[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const lib of libraries) {
    for (const tid of lib.codeTemplateIds) {
      map.set(tid, lib.name);
    }
  }
  return map;
}

// ─── findCalledFunctions ──────────────────────────────────────────────────────

/**
 * Scan a template's code for references to functions defined in other templates.
 * Returns an array of { templateId, templateName, libraryName, functionName }
 * for each other template whose function is called.
 */
export function findCalledFunctions(
  template: CodeTemplate,
  allTemplates: Map<string, CodeTemplate>,
  libraries: CodeTemplateLibrary[]
): CalledFunction[] {
  if (!template.code) return [];

  const libLookup = buildLibraryLookup(libraries);
  const results: CalledFunction[] = [];

  for (const [id, other] of allTemplates) {
    if (id === template.id) continue;

    const fnName = extractFunctionName(other.code);
    if (!fnName) continue;

    const pattern = buildFunctionPattern(fnName);
    if (pattern.test(stripJsComments(template.code))) {
      results.push({
        templateId: id,
        templateName: other.name,
        libraryName: libLookup.get(id) ?? "Unknown Library",
        functionName: fnName,
      });
    }
  }

  results.sort((a, b) => a.functionName.localeCompare(b.functionName));
  return results;
}

// ─── findCallers ──────────────────────────────────────────────────────────────

/**
 * Find other templates whose code references this template's function.
 * Returns an array of { templateId, templateName, libraryName, snippet }.
 */
export function findCallers(
  template: CodeTemplate,
  allTemplates: Map<string, CodeTemplate>,
  libraries: CodeTemplateLibrary[]
): CallerTemplate[] {
  const fnName = extractFunctionName(template.code);
  if (!fnName) return [];

  const libLookup = buildLibraryLookup(libraries);
  const pattern = buildFunctionPattern(fnName);
  const results: CallerTemplate[] = [];

  for (const [id, other] of allTemplates) {
    if (id === template.id) continue;
    if (!other.code || !pattern.test(stripJsComments(other.code))) continue;

    results.push({
      templateId: id,
      templateName: other.name,
      libraryName: libLookup.get(id) ?? "Unknown Library",
      snippet: buildSnippet(other.code, fnName),
    });
  }

  results.sort((a, b) => a.templateName.localeCompare(b.templateName));
  return results;
}
