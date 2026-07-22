/**
 * Server-side logging for API route handlers.
 *
 * Unlike `lib/dev-logger.ts` (which is a no-op outside development), these
 * helpers emit in ALL environments, including production. They are intended
 * for security-relevant operational notices that an operator must see in a
 * deployed install — e.g. "TLS verification is relaxed for the BridgeLink hop"
 * or "the server allowlist is disabled (open mode)".
 */

const firedNotices = new Set<string>();

/**
 * Emit a one-time startup/operational warning. Subsequent calls with the same
 * `key` are suppressed so the notice appears once per process, not per request.
 */
export function logStartupWarn(key: string, message: string): void {
  if (firedNotices.has(key)) return;
  firedNotices.add(key);
  console.warn(`[BridgeLink] ${message}`);
}

/**
 * Log a server-side error with full detail. Use in catch blocks where the
 * detail must NOT be returned to the client (it would aid SSRF/port probing)
 * but is still needed for operator debugging.
 */
export function logServerError(tag: string, message: string, error?: unknown): void {
  const detail =
    error instanceof Error ? error.stack || error.message : error != null ? String(error) : "";
  console.error(`[${tag}] ${message}${detail ? ": " + detail : ""}`);
}
