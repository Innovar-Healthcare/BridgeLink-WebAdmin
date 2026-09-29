/**
 * Suggests an extension `path` for the preview envelope from the manifest's
 * action endpoints.
 *
 * The validator requires every action-button `endpoint` to live under
 * `/extensions/<path>/…` (the envelope's own namespace). So an action endpoint
 * reveals the path the author intends — this returns its `<path>` segment, which
 * the page offers as a suggestion (only while the user hasn't hand-edited the
 * path field; it never auto-loads).
 *
 * Only a segment that is itself a VALID extension path is suggested: an endpoint
 * like `/extensions/My Ext/…` would otherwise write an invalid path into the
 * envelope and silently convert the author's real (manifest-scoped) endpoint
 * error into an envelope-scoped one on a field they never touched.
 *
 * Kinds are scanned in the fixed order below (connector panels, then settings
 * panels, then connector sections); there is no cross-kind document order to
 * honor since each kind is a separate array. Operates on raw, possibly-invalid
 * parsed JSON (the author is mid-edit), so every access is defensive. Only these
 * three kinds declare actions.
 */

const KINDS_WITH_ACTIONS = ["connectorPanels", "settingsPanels", "connectorSections"] as const;
const ENDPOINT_PATH_RE = /^\/extensions\/([^/]+)\//;
// Mirrors EXTENSION_PATH_PATTERN in lib/runtime-plugins/manifest-validator.ts —
// keep in sync. Not exported there, so duplicated locally.
const VALID_EXTENSION_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function suggestEnvelopePath(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== "object") return null;
  const m = manifest as Record<string, unknown>;

  for (const kind of KINDS_WITH_ACTIONS) {
    const contributions = m[kind];
    if (!Array.isArray(contributions)) continue;
    for (const contribution of contributions) {
      const actions = (contribution as Record<string, unknown> | null)?.actions;
      if (!Array.isArray(actions)) continue;
      for (const action of actions) {
        const endpoint = (action as Record<string, unknown> | null)?.endpoint;
        if (typeof endpoint !== "string") continue;
        const match = ENDPOINT_PATH_RE.exec(endpoint);
        // Only suggest a segment that is itself a valid extension path — never
        // turn a manifest error into an envelope error.
        if (match && VALID_EXTENSION_PATH.test(match[1])) return match[1];
      }
    }
  }
  return null;
}
