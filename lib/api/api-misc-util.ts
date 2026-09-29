/**
 * Stateless server-side utility endpoints.
 *
 * Consumption-side of's two shipped helpers. Both are thin wrappers around
 * existing Core methods and return their result as raw `text/plain` (the payload IS the
 * deliverable — not the XStream envelope, and not the `{result}` JSON wrapper that
 * `_replaceTemplate` uses), so both use `rawText` and return the body verbatim:
 *
 *   - `POST /server/_prettyPrintScript` → `JavaScriptSharedUtil.prettyPrint(String)`
 *     (js-beautify 1.6.8 with `{ e4x: true }`; the same formatter the desktop client uses,
 *     E4X-aware unlike Monaco's built-in TypeScript worker). Blank input returns unchanged.
 *
 *   - `POST /codeTemplates/_generateDoc` → `CodeTemplateUtil.updateCode(String)` (parses
 *     the Rhino AST, preserves existing @param/@return, regenerates a /** … *​/ block
 *     word-wrapped at 100 cols). Blank input returns unchanged. Note the capital T in the
 *     path (confirmed against the servlet interface, not the ticket's informal lowercase).
 *
 * Both endpoints are `auditable = false` with no permission gate beyond authentication —
 * there is no Java-client call to mirror (WebAdmin-only, per the precedent).
 *
 * Gated by {@link MIN_SERVER_MISC_UTILS}: callers use the server when the connected Core is
 * new enough and fall back to the frozen client implementations otherwise
 * (`lib/monaco-rhino.ts`'s TS-worker formatter; `lib/code-template-utils.ts`'s
 * `generateJsDoc`). Both fallbacks — and the two `serverSupports*` fns below — can be
 * deleted once `MIN_SUPPORTED_SERVER_VERSION` (lib/version-compat.ts) reaches this floor.
 *
 * See PLAN-MiscUtilEndpoints-BusinessLogic.md.
 */

import { getSession } from "@/lib/auth";
import { isVersionAtLeast } from "@/lib/utils";
import { generateJsDoc } from "@/lib/code-template-utils";
import { request } from "./api-core";

/**
 * Core release that first ships `_prettyPrintScript` and `_generateDoc` (the
 * WebAdmin-adoption epic floor, same as every sibling `MIN_SERVER_*`).
 */
export const MIN_SERVER_MISC_UTILS = "26.9.0";

/**
 * True when the connected Core is new enough to serve `_prettyPrintScript`. Missing or
 * unparseable server versions return `false` (via {@link isVersionAtLeast}), so callers
 * use the client-side fallback rather than issuing a doomed request.
 */
export function serverSupportsPrettyPrint(): boolean {
  return isVersionAtLeast(getSession()?.serverVersion, MIN_SERVER_MISC_UTILS);
}

/**
 * True when the connected Core is new enough to serve `_generateDoc`. Kept separate from
 * {@link serverSupportsPrettyPrint} (identical today) so the two floors can diverge later
 * without touching call sites.
 */
export function serverSupportsGenerateDoc(): boolean {
  return isVersionAtLeast(getSession()?.serverVersion, MIN_SERVER_MISC_UTILS);
}

/**
 * Pretty-print a JavaScript/E4X script using the server's `js-beautify {e4x:true}`.
 *
 * @param script the raw script source.
 * @returns the reformatted script, verbatim (blank input is returned unchanged by Core).
 *
 * Throws `ApiError` on transport/HTTP failure; callers should fall back to the local
 * formatter on a throw or when {@link serverSupportsPrettyPrint} is false.
 */
export async function prettyPrintScript(script: string): Promise<string> {
  return request<string>("/server/_prettyPrintScript", {
    method: "POST",
    body: script,
    headers: { "Content-Type": "text/plain" },
    rawText: true,
  });
}

/**
 * Regenerate a code template's JSDoc block using the server's `CodeTemplateUtil.updateCode`.
 *
 * @param code the code template's JavaScript source.
 * @returns the code with a regenerated leading `/** … *​/` block (blank input unchanged).
 *
 * Throws `ApiError` on transport/HTTP failure; callers should fall back to
 * `generateJsDoc` (identical output) on a throw or when {@link serverSupportsGenerateDoc}
 * is false.
 */
export async function generateCodeTemplateDoc(code: string): Promise<string> {
  return request<string>("/codeTemplates/_generateDoc", {
    method: "POST",
    body: code,
    headers: { "Content-Type": "text/plain" },
    rawText: true,
  });
}

/**
 * Regenerate a code template's JSDoc block, server-first with the local port as fallback.
 *
 * Uses {@link generateCodeTemplateDoc} on a Core at or above the floor, and falls back to
 * the client {@link generateJsDoc} (identical output) below the floor or on any server
 * error — a failure here is not worth surfacing since the result is the same. Centralises
 * the fallback decision so call sites stay a single line.
 *
 * TODO: inline this to a direct `generateCodeTemplateDoc` call and delete `generateJsDoc`
 * once `MIN_SUPPORTED_SERVER_VERSION` reaches {@link MIN_SERVER_MISC_UTILS}.
 */
export async function generateCodeTemplateDocOrFallback(code: string): Promise<string> {
  // Blank input is a no-op on both paths (the local port guards, and Core's updateCode()
  // returns blank unchanged → a 200 with an EMPTY body, which request() surfaces as
  // `undefined` rather than ""). Short-circuit so a cleared editor never gets code:undefined.
  if (!code.trim()) return code;
  if (serverSupportsGenerateDoc()) {
    try {
      return await generateCodeTemplateDoc(code);
    } catch {
      // Fall back to the local port below.
    }
  }
  return generateJsDoc(code);
}
