/**
 * Server-side `${...}` template preview.
 *
 * Consumption-side of's `POST /server/_replaceTemplate`, which resolves
 * `${...}` Velocity references using the server's real `TemplateValueReplacer` — the
 * same engine channels use at runtime. There is no client-side evaluator this replaces;
 * the WebUI has never previewed resolved template values (`lib/velocity-format.ts` only
 * *formats* a variable name into a `${...}` reference string for insertion, it does not
 * evaluate one). See PLAN-TemplatePreview-BusinessLogic.md.
 *
 * This is a `RawContent` plain JSON response (NOT the XStream envelope), so this uses
 * `rawText` + `JSON.parse` to bypass `normalizeXStream` entirely, mirroring
 * `lib/api/api-cron.ts`.
 *
 * WebAdmin-only endpoint — no `Client.java` wrapper); no Java-client call to
 * mirror.
 *
 * Security note: Core declares no permission for the endpoint, and it resolves the
 * server's Configuration Map, the global map, and any channel's global channel map via
 * a caller-supplied `channelId`. On a bare server every authenticated user can call
 * it. The commercial access-control plugin gates it under `Settings.Configuration Map`
 * (View), so the caller (`message-template-editor.tsx`) hides the Preview button for a
 * role with No Permission on that module instead of offering a call that is refused.
 * The global and channel maps stay reachable to any role that can see the
 * Configuration Map.
 */

import { getSession } from "@/lib/auth";
import { isVersionAtLeast } from "@/lib/utils";
import { request } from "./api-core";

/** Core release that first shipped `_replaceTemplate` (same release as `_validateCron`). */
export const MIN_SERVER_TEMPLATE = "26.9.0";

/**
 * True when the connected Core is new enough to serve `_replaceTemplate`. Missing or
 * unparseable server versions return `false` (via {@link isVersionAtLeast}), so callers
 * hide the preview affordance rather than issuing a doomed request.
 */
export function serverSupportsTemplateEndpoint(): boolean {
  return isVersionAtLeast(getSession()?.serverVersion, MIN_SERVER_TEMPLATE);
}

/**
 * Resolve `${...}` references in `template` using the server's real Velocity engine.
 *
 * @param template the raw string containing `${...}` references to resolve.
 * @param channelId optional channel ID whose global channel variable map is included in
 *   the preview. Omitted (or blank) resolves against an empty map — the server uses a
 *   random ID internally rather than throwing.
 * @returns the resolved string, verbatim (a template with no `${...}` markers is
 *   returned unchanged).
 *
 * Throws `ApiError` on transport/HTTP failure; callers should treat a throw (and any
 * gate-off) as "hide/disable the preview affordance" — there is no client-side fallback
 * evaluator to fall back to.
 */
export async function replaceTemplate(template: string, channelId?: string): Promise<string> {
  const query = channelId ? `?channelId=${encodeURIComponent(channelId)}` : "";
  const raw = await request<string>(`/server/_replaceTemplate${query}`, {
    method: "POST",
    body: template,
    headers: { "Content-Type": "text/plain", Accept: "application/json" },
    rawText: true,
  });
  return (JSON.parse(raw) as { result: string }).result;
}
