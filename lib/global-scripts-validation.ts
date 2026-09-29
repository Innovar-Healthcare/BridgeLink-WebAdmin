/**
 * Save-time validation for the four global scripts.
 *
 * Mirrors Java GlobalScriptsPanel.validateAllScripts() (called from
 * Frame.doSaveGlobalScripts()): every script is compiled before the save is
 * allowed, and any syntax error aborts the save.
 *
 * When the connected Core is new enough validation runs server-side with
 * the real Rhino engine (one batch call for all four scripts); otherwise it falls back
 * to the shared acorn-jsx-based validator, which parses E4X XML literals and
 * neutralizes E4X operators so real errors are caught even in E4X scripts, deferring
 * forms it cannot represent.
 */

import { tryParseJs } from "@/lib/js-validation";
import { GLOBAL_SCRIPT_KEYS, type GlobalScriptKey } from "@/lib/api/api-settings";
import {
  scriptErrorMessage,
  serverSupportsScriptValidation,
  validateScriptsBatch,
} from "@/lib/api/api-script-validation";

/**
 * Validate a single global script with the acorn fallback. Returns a one-line error
 * string (`Error on line N: …`) or `null` when the script is valid. Residual E4X forms
 * `tryParseJs` cannot represent resolve to `null` (deferred).
 */
export function validateGlobalScript(script: string): string | null {
  return tryParseJs(script);
}

/**
 * Validate a single global script, server-side when supported (real Rhino), else via
 * the acorn fallback. Used by the interactive "Validate" action.
 */
export async function validateGlobalScriptGated(script: string): Promise<string | null> {
  if (serverSupportsScriptValidation()) {
    const results = await validateScriptsBatch({ script });
    return scriptErrorMessage(results.script);
  }
  // TRANSITIONAL FALLBACK — client-side acorn path for Core older than the endpoint.
  // Delete once MIN_SUPPORTED_SERVER_VERSION >= MIN_SERVER_VALIDATE_SCRIPTS.
  return validateGlobalScript(script);
}

export interface GlobalScriptValidationError {
  key: GlobalScriptKey;
  message: string;
}

/**
 * Validate all four global scripts, server-side when supported (one batch call) else
 * via the acorn fallback. Returns the list of failures (empty when all valid), in
 * `GLOBAL_SCRIPT_KEYS` order. Mirrors Java `GlobalScriptsPanel.validateAllScripts()`.
 */
export async function validateAllGlobalScripts(
  scripts: Record<GlobalScriptKey, string>
): Promise<GlobalScriptValidationError[]> {
  if (serverSupportsScriptValidation()) {
    const results = await validateScriptsBatch(scripts);
    const errors: GlobalScriptValidationError[] = [];
    for (const key of GLOBAL_SCRIPT_KEYS) {
      const message = scriptErrorMessage(results[key]);
      if (message) errors.push({ key, message });
    }
    return errors;
  }

  // TRANSITIONAL FALLBACK — client-side acorn path for Core older than the endpoint.
  // Delete once MIN_SUPPORTED_SERVER_VERSION >= MIN_SERVER_VALIDATE_SCRIPTS.
  const errors: GlobalScriptValidationError[] = [];
  for (const key of GLOBAL_SCRIPT_KEYS) {
    const message = validateGlobalScript(scripts[key]);
    if (message) errors.push({ key, message });
  }
  return errors;
}
