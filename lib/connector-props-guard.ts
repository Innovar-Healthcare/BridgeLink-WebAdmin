/**
 * Send-boundary guard for connector-properties XML.
 *
 * Live per-connector API calls (Test Connection, Test Write, Get Operations /
 * WSDL cache) POST the *in-memory* connector properties XML straight to the
 * server, bypassing the whole-channel `serialize()` save path where cross-cutting
 * fixups like `{{VERSION}}` resolution happen (see `withVersion` /
 * `resolveXmlVersion` in `app/(app)/channels/_lib/channel-xml.ts`). `{{VERSION}}`
 * resolution lives at ~5 independent injection sites; if any one is missed, an
 * unresolved `version="{{VERSION}}"` reaches the server, whose Staxon→XStream
 * deserializer rejects the non-numeric version with an opaque HTTP 500
 * ("Request failed.") — the exact class of bug fixed in PR #609/1270).
 *
 * This guard sits at the send boundary and converts that "silent 500 in prod"
 * into "fails immediately in dev/test/QA," regardless of which injection site
 * slipped. It kills the bug *class*, not just one instance: call it from every
 * live seam that ships connector-props XML.
 */

/**
 * The exact token `withVersion()` substitutes. Scoping the check to the full
 * `version="{{VERSION}}"` attribute token (not a bare `{{VERSION}}`) means a
 * user-authored `{{VERSION}}` literal inside a script/template body never
 * false-positives — mirroring `withVersion`'s deliberate scoping.
 */
const UNRESOLVED_VERSION_TOKEN = 'version="{{VERSION}}"';

/**
 * Assert that an outbound connector-properties body carries no unresolved
 * `{{VERSION}}` placeholder.
 *
 * - No-op when `body` is not a string, or is a string that does not contain the
 *   `version="{{VERSION}}"` token (so plain non-XML payloads like the Document
 *   Writer directory string, and user scripts with literal `{{VERSION}}`, pass
 *   through untouched).
 * - When the token is present:
 *   - In non-production (`NODE_ENV !== "production"`): **throw**, so tests and QA
 *     fail loudly at the seam.
 *   - In production: `console.error` and return without throwing, so a leak is
 *     diagnosable but never breaks a running server (it would 500 downstream
 *     anyway; we do not want the guard itself to be the thing that crashes).
 *
 * @param body    the request body about to be sent
 * @param context short identifier of the send site, e.g.
 *                `"connectors/http/_testConnection"`
 */
export function assertNoUnresolvedVersion(body: unknown, context: string): void {
  if (typeof body !== "string" || !body.includes(UNRESOLVED_VERSION_TOKEN)) return;

  const message =
    `Unresolved {{VERSION}} placeholder in outbound connector properties (${context}). ` +
    `Resolve with withVersion(xml, resolveXmlVersion()) before sending.`;

  if (process.env.NODE_ENV !== "production") {
    throw new Error(message);
  }
  console.error(`[connector-props-guard] ${message}`);
}
