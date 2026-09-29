/**
 * JavaScript validation for code templates on save.
 *
 * Mirrors the Java client's CodeTemplatePanel.validateAll() (called from doSaveCodeTemplates),
 * which validates every template before persisting and aborts the save on the first error,
 * naming the offending template + library. The Web UI improves on Java by listing *every*
 * offending template — the explicit ask in ("identify which CTs contained the errors;
 * some may have errors, some may not") — instead of stopping at the first.
 *
 * When the connected Core is new enough validation runs server-side with the real
 * Rhino engine (one batch call for the changed template set); otherwise it falls back to the
 * shared acorn validator (findJsSyntaxError), which parses E4X XML literals and neutralizes E4X
 * operators so real errors are caught even in E4X templates, deferring forms it cannot represent.
 * The per-error phrasing ("Line X: message") matches the Validate action either way #3).
 */

import { findJsSyntaxError } from "@/lib/js-validation";
import {
  serverSupportsScriptValidation,
  validateScriptsBatch,
} from "@/lib/api/api-script-validation";
import type { CodeTemplate, CodeTemplateLibrary } from "@/lib/types";

export interface CodeTemplateJsError {
  templateId: string;
  templateName: string;
  /** Name of the owning library, or null if the template belongs to no library. */
  libraryName: string | null;
  /** 1-based line of the error. */
  line: number;
  /** Bare acorn message (no "Line N:" prefix). */
  message: string;
}

/** Find the library that owns a template, for naming in error messages. */
function libraryNameForTemplate(
  templateId: string,
  libraries: CodeTemplateLibrary[]
): string | null {
  return libraries.find((l) => l.codeTemplateIds.includes(templateId))?.name ?? null;
}

/**
 * Validate each template's code and return one entry per template that has a syntax error —
 * server-side when supported (one batch call), else via the acorn fallback (residual E4X
 * templates deferred → no entry). Returns an empty array when every template parses cleanly.
 */
export async function findCodeTemplateJsErrors(
  templates: CodeTemplate[],
  libraries: CodeTemplateLibrary[]
): Promise<CodeTemplateJsError[]> {
  if (serverSupportsScriptValidation()) {
    const scripts: Record<string, string> = {};
    for (const t of templates) scripts[t.id] = t.code;
    const results = await validateScriptsBatch(scripts);
    const errors: CodeTemplateJsError[] = [];
    for (const t of templates) {
      const r = results[t.id];
      // Fail safe: an invalid result blocks the save even if the server omitted the error
      // detail — never treat "invalid, no detail" as clean (mirrors scriptErrorMessage).
      if (r && !r.valid) {
        errors.push({
          templateId: t.id,
          templateName: t.name,
          libraryName: libraryNameForTemplate(t.id, libraries),
          line: r.error?.line ?? 0,
          message: r.error?.message ?? "Template failed validation.",
        });
      }
    }
    return errors;
  }

  // TRANSITIONAL FALLBACK — client-side acorn path for Core older than the endpoint.
  // Delete once MIN_SUPPORTED_SERVER_VERSION >= MIN_SERVER_VALIDATE_SCRIPTS.
  const errors: CodeTemplateJsError[] = [];
  for (const t of templates) {
    const err = findJsSyntaxError(t.code);
    if (err) {
      errors.push({
        templateId: t.id,
        templateName: t.name,
        libraryName: libraryNameForTemplate(t.id, libraries),
        line: err.line,
        message: err.message,
      });
    }
  }
  return errors;
}

/**
 * Blocking pre-save validation message naming every offending template, or `null` when all
 * the given templates parse cleanly. Callers pass the changed template set so a save is never
 * blocked by a pre-existing error in a template the user did not touch.
 */
export async function validateCodeTemplatesForSave(
  templates: CodeTemplate[],
  libraries: CodeTemplateLibrary[]
): Promise<string | null> {
  const errors = await findCodeTemplateJsErrors(templates, libraries);
  if (errors.length === 0) return null;

  const lines = errors.map((e) => {
    const where = e.libraryName
      ? `"${e.templateName}" (Library "${e.libraryName}")`
      : `"${e.templateName}"`;
    return `  ${where} — Line ${e.line}: ${e.message}`;
  });
  return (
    `${errors.length} code template(s) have JavaScript errors and cannot be saved:\n` +
    lines.join("\n")
  );
}
