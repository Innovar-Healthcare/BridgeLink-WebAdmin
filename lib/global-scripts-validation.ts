/**
 * Save-time validation for the four global scripts.
 *
 * Mirrors Java GlobalScriptsPanel.validateAllScripts() (called from
 * Frame.doSaveGlobalScripts()): every script is compiled before the save is
 * allowed, and any syntax error aborts the save. The Java client uses Rhino;
 * the WebUI uses the shared acorn-jsx-based validator, which parses E4X XML
 * literals and neutralizes E4X operators so real errors are caught even in E4X
 * scripts; forms it cannot represent are deferred to server-side validation.
 */

import { tryParseJs } from "@/lib/js-validation";
import { GLOBAL_SCRIPT_KEYS, type GlobalScriptKey } from "@/lib/api/api-settings";

/**
 * Validate a single global script. Returns a one-line error string
 * (`Error on line N: …`) or `null` when the script is valid. Residual E4X forms
 * `tryParseJs` cannot represent resolve to `null` here (deferred); the server
 * validates those on save.
 */
export function validateGlobalScript(script: string): string | null {
  return tryParseJs(script);
}

export interface GlobalScriptValidationError {
  key: GlobalScriptKey;
  message: string;
}

/**
 * Validate all four global scripts. Returns the list of failures (empty when
 * all valid), in `GLOBAL_SCRIPT_KEYS` order. Mirrors Java
 * `GlobalScriptsPanel.validateAllScripts()`.
 */
export function validateAllGlobalScripts(
  scripts: Record<GlobalScriptKey, string>
): GlobalScriptValidationError[] {
  const errors: GlobalScriptValidationError[] = [];
  for (const key of GLOBAL_SCRIPT_KEYS) {
    const message = validateGlobalScript(scripts[key]);
    if (message) errors.push({ key, message });
  }
  return errors;
}
