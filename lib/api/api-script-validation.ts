/**
 * Server-side JavaScript validation.
 *
 * The Java Swing client validates scripts by compiling them with an in-process
 * Rhino engine (`JavaScriptSharedUtil.validateScript`). The browser has no Rhino,
 * so the WebUI has historically approximated this with an acorn/acorn-jsx parser
 * (`lib/js-validation.ts`) that defers on residual-E4X forms and can mis-flag valid
 * E4X. `POST /server/_validateScripts` gives true Rhino parity for the on-demand
 * validation paths (save / enable / explicit Validate), one round-trip for the whole
 * batch of scripts.
 *
 * Gated by {@link MIN_SERVER_VALIDATE_SCRIPTS}: callers use the server when the
 * connected Core is new enough and fall back to the acorn validator otherwise, so
 * older servers keep working (the fallback is removed in a later cleanup release once
 * `MIN_SUPPORTED_SERVER_VERSION` clears the floor). See for the approach.
 *
 * The endpoint returns clean JSON (not the XStream envelope), so this uses
 * `skipNormalize`.
 */

import { getSession } from "@/lib/auth";
import { isVersionAtLeast } from "@/lib/utils";
import { request } from "./api-core";

/** Core release that first shipped `POST /server/_validateScripts`. */
export const MIN_SERVER_VALIDATE_SCRIPTS = "26.9.0";

/**
 * A single syntax error, mirroring the server's `ScriptValidationResult.ScriptValidationError`.
 * `line`/`column` are 1-based (`column` 0 = the engine could not determine one); the
 * internal Rhino wrapper offset is already subtracted server-side.
 */
export interface ScriptValidationError {
  line: number;
  column: number;
  message: string;
}

/** Result for one script: `valid`, plus the first error when invalid. */
export interface ScriptValidationResult {
  valid: boolean;
  error: ScriptValidationError | null;
}

/**
 * True when the connected Core is new enough to serve `_validateScripts`. Missing or
 * unparseable server versions return `false` (via {@link isVersionAtLeast}), so callers
 * route to the acorn fallback rather than a doomed request.
 */
export function serverSupportsScriptValidation(): boolean {
  return isVersionAtLeast(getSession()?.serverVersion, MIN_SERVER_VALIDATE_SCRIPTS);
}

/**
 * Format a {@link ScriptValidationResult} as the one-line message the acorn fallback
 * already produces (`Error on line N: <message>`), or `null` when valid — so a call
 * site can swap between the server and acorn paths without changing how it renders.
 * The message text is Rhino's (server) rather than acorn's, but the shape matches the
 * Java client's `ScriptPanel` formatting.
 */
export function scriptErrorMessage(result: ScriptValidationResult): string | null {
  if (result.valid) return null;
  // Invalid with no error detail (server contract drift): fail safe as an error, never as valid.
  if (!result.error) return "Script failed validation.";
  return `Error on line ${result.error.line}: ${result.error.message}`;
}

/**
 * Validate a batch of scripts with the server's Rhino engine.
 *
 * `scripts` maps a caller-supplied id to the script body; the server echoes each id
 * with its {@link ScriptValidationResult}. Ids are opaque to the server — callers use
 * them to map results back to UI locations, so they MUST be unique within one call (a
 * duplicate key silently overwrites in the request map before it is ever sent).
 *
 * Fail-safe: any id that is absent from the response (a partial response, or a server
 * bug) is reported as invalid rather than silently treated as valid — a script must
 * never pass validation just because no result came back for it.
 */
export async function validateScriptsBatch(
  scripts: Record<string, string>
): Promise<Record<string, ScriptValidationResult>> {
  const results = await request<Record<string, ScriptValidationResult>>(
    "/server/_validateScripts",
    {
      method: "POST",
      body: JSON.stringify(scripts),
      skipNormalize: true,
    }
  );

  // Fail-safe: fill any missing id with an invalid result so an unvalidated script
  // can never slip through as "valid".
  for (const id of Object.keys(scripts)) {
    if (!(id in results)) {
      results[id] = {
        valid: false,
        error: { line: 0, column: 0, message: "Validation returned no result for this script." },
      };
    }
  }

  return results;
}
