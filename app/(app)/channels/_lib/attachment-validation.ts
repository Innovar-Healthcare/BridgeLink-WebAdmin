// Save-time validation for the Custom and JavaScript attachment-handler dialogs.
//
// Java saves these handlers with essentially no validation: CustomAttachmentDialog
// stores the class name and property rows verbatim (empty class name allowed —
// AttachmentHandlerType.CUSTOM's default class name is ""), and JavaScriptAttachmentDialog
// stores the script unconditionally (its "Validate" button is informational only). To
// avoid making channels that are valid in the Swing client unsaveable in the WebUI, these
// helpers return a *warning* (soft block → "Save anyway?" prompt) rather than a hard block.
// A null result means no issue. See #45.

import { tryParseJs } from "@/lib/js-validation";
import {
  scriptErrorMessage,
  serverSupportsScriptValidation,
  validateScriptsBatch,
} from "@/lib/api/api-script-validation";
import type { AttachmentHandlerState } from "./channel-xml";

/**
 * Non-null warning when a Custom handler has an empty class name, an empty property name,
 * or duplicate property names. Java saves all of these without complaint (the empty class
 * name is even its CUSTOM default), so these are advisory, not blocking.
 */
export function customHandlerSaveWarning(state: AttachmentHandlerState): string | null {
  const issues: string[] = [];
  if (!state.customClassName.trim()) issues.push("the class name is empty");
  const names = state.customProperties.map((p) => p.name.trim());
  if (names.some((n) => !n)) issues.push("one or more property names are empty");
  if (new Set(names).size < names.length) issues.push("property names are not unique");
  if (issues.length === 0) return null;
  return `This custom attachment handler has issues: ${issues.join("; ")}. The Java client saves it anyway. Save anyway?`;
}

/**
 * Validate a JavaScript attachment script and return the one-line error message, or `null`
 * when it parses cleanly. Server-side (real Rhino) when the connected Core supports it
 *, else via the acorn fallback, which parses E4X XML literals and neutralizes E4X
 * operators so real errors are caught even in E4X scripts (deferring forms it cannot represent).
 */
export async function validateJsAttachmentScript(script: string): Promise<string | null> {
  if (serverSupportsScriptValidation()) {
    return scriptErrorMessage((await validateScriptsBatch({ script })).script);
  }
  // TRANSITIONAL FALLBACK — client-side acorn path for Core older than the endpoint.
  // Delete once MIN_SUPPORTED_SERVER_VERSION >= MIN_SERVER_VALIDATE_SCRIPTS.
  return tryParseJs(script);
}

/**
 * Non-null warning when a JavaScript attachment script fails to parse. Soft block ("Save
 * anyway?") rather than a hard block — Java saves the script freely and its Validate button is
 * informational only, so an E4X/Rhino construct the validator flags must not make a valid script
 * unsaveable #45); the server compiles the script at deploy time regardless.
 */
export async function jsAttachmentSaveWarning(script: string): Promise<string | null> {
  const err = await validateJsAttachmentScript(script);
  if (!err) return null;
  return `The script has a possible syntax error (${err}). If it uses Rhino/E4X syntax this may be a false positive. Save anyway?`;
}
