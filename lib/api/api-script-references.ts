/**
 * Server-side script reference catalog / Core.
 *
 * The WebUI has historically shipped a static, hand-maintained copy of the Rhino JS
 * reference catalog (autocomplete/hover/drag data) in `lib/reference-data.ts` — a
 * TypeScript port of the Swing client's `ReferenceListFactory`. Because it is frozen at
 * build time, it drifts from whatever Core version the WebAdmin is actually pointed at.
 *
 * exposes the catalog from the connected server so it always tracks that server:
 *
 *   - `GET /server/scriptReferences` — the reference/autocomplete catalog
 *
 * Gated by {@link MIN_SERVER_SCRIPT_REFERENCES}: callers fetch from the server when the
 * connected Core is new enough and fall back to the frozen client `CATEGORIES` otherwise,
 * so older servers keep working (the frozen copy is removed in a later cleanup release once
 * `MIN_SUPPORTED_SERVER_VERSION` clears the floor). See for the approach; this
 * mirrors the cron adoption.
 *
 * The endpoint returns plain JSON — a flat `ScriptReference[]` in a `RawContent` body, NOT
 * the XStream/Staxon envelope — so this uses `rawText` + `JSON.parse` to bypass
 * `normalizeXStream` entirely. With `rawText` the default `Accept` is XML/plain-first
 * (matching JSON only via `*​/*`); the endpoint declares `@Produces(application/json)`, so
 * we set `Accept: application/json` explicitly rather than relying on the q-fallback.
 *
 * This is a WebAdmin-only endpoint (no `Client.java` wrapper); there is no Java-client call
 * to mirror, matching how/1662/1663/1664 adopted their endpoints.
 *
 * NOTE on scope (validated against the live Core `feature/core-api-support-webadmin`):
 * the server ports 3 of `ReferenceListFactory`'s 4 builders. `addUserutilReferences()`
 * (HTTP Listener/Sender, File Reader, Lookup Table refs) is NOT ported, and the WebUI's
 * E4X drag-snippets use a different representation than the server's member-completion
 * refs — so those categories remain client-side permanently (not via this gate). Only the
 * categorized code-template refs + the misc `VARIABLE` globals are consumed from here. See
 * PLAN-ScriptReferences-BusinessLogic.md §2–§3.
 */

import { getSession } from "@/lib/auth";
import { isVersionAtLeast } from "@/lib/utils";
import type { ContextType } from "@/lib/types";
import { request } from "./api-core";

/** Core release that first shipped `GET /server/scriptReferences`. */
export const MIN_SERVER_SCRIPT_REFERENCES = "26.9.0";

/** Reference item kind — mirrors Core `Reference.Type`. */
export type ScriptReferenceType = "CODE" | "FUNCTION" | "VARIABLE";

/** A single function parameter — mirrors Core `Parameter`. */
export interface ScriptReferenceParameter {
  name: string;
  type: string;
  description: string;
}

/** Function signature metadata — mirrors Core `CodeTemplateFunctionDefinition`. */
export interface ScriptReferenceFunctionDefinition {
  name: string;
  parameters: ScriptReferenceParameter[];
  returnType: string;
  returnDescription: string;
  /** Insertable call form, e.g. `"appendChild(child)"`. */
  transferData: string;
}

/**
 * One reference-catalog entry — mirrors Core `com.mirth.connect.model.reference.*`
 * (`ScriptReference` and subclasses), serialized as flat JSON by `ScriptReferenceUtil`.
 *
 * `contextSet` uses the same enum names as the WebUI {@link ContextType}, so it maps
 * directly with no translation. `category` is a free-text label (e.g. `"Message
 * Functions"`) or `null`. Which of the optional fields are populated depends on `type`
 * (CODE items carry `replacementCode`/`summary`/`template`; FUNCTION items carry
 * `functionDefinition`/`beforeDotTextList`; etc.).
 */
export interface ScriptReference {
  type: ScriptReferenceType;
  contextSet: ContextType[];
  category: string | null;
  name: string;
  description: string;
  replacementCode: string | null;
  summary: string | null;
  definitionString: string | null;
  template: string | null;
  className: string | null;
  functionDefinition: ScriptReferenceFunctionDefinition | null;
  beforeDotTextList: string[] | null;
}

/**
 * True when the connected Core is new enough to serve the reference-catalog endpoint.
 * Missing or unparseable server versions return `false` (via {@link isVersionAtLeast}), so
 * callers route to the frozen client catalog rather than a doomed request.
 */
export function serverSupportsScriptReferences(): boolean {
  return isVersionAtLeast(getSession()?.serverVersion, MIN_SERVER_SCRIPT_REFERENCES);
}

/**
 * Fetch the connected server's script reference catalog.
 *
 * Returns the flat `ScriptReference[]` exactly as the server serializes it — reshaping into
 * the WebUI's `RefCategory[]`/`RefItem[]` form is the caller's job (see the adapter in
 * Phase 2). Throws `ApiError` on transport/HTTP failure; callers should treat a throw (and
 * any gate-off) as "fall back to the frozen client catalog", never as a hard failure.
 */
export async function fetchScriptReferences(): Promise<ScriptReference[]> {
  const raw = await request<string>("/server/scriptReferences", {
    method: "GET",
    headers: { Accept: "application/json" },
    rawText: true,
  });
  return JSON.parse(raw) as ScriptReference[];
}
