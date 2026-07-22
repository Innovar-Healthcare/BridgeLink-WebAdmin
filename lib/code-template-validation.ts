/**
 * Client-side JavaScript validation for code templates on save.
 *
 * Mirrors the Java client's CodeTemplatePanel.validateAll() (called from doSaveCodeTemplates),
 * which validates every template before persisting and aborts the save on the first error,
 * naming the offending template + library. The Web UI improves on Java by listing *every*
 * offending template — the explicit ask in ("identify which CTs contained the errors;
 * some may have errors, some may not") — instead of stopping at the first.
 *
 * The per-error phrasing ("Line X: message") matches the Validate action, so Save and Validate
 * report identically sub-issue #3). Uses the shared validator (findJsSyntaxError),
 * which parses E4X XML literals and neutralizes E4X operators so real errors are caught even in
 * E4X templates; residual forms it cannot represent are deferred, exactly like the real-time
 * editor markers.
 */

import { findJsSyntaxError } from "@/lib/js-validation";
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
 * Run the validator over each template's code and return one entry per template that has a
 * syntax error. Residual E4X templates are deferred (findJsSyntaxError returns null). Returns an
 * empty array when every template parses cleanly.
 */
export function findCodeTemplateJsErrors(
  templates: CodeTemplate[],
  libraries: CodeTemplateLibrary[]
): CodeTemplateJsError[] {
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
export function validateCodeTemplatesForSave(
  templates: CodeTemplate[],
  libraries: CodeTemplateLibrary[]
): string | null {
  const errors = findCodeTemplateJsErrors(templates, libraries);
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
