/**
 * Logs a warning in development only. No-op in production.
 * Use in catch blocks where silent fallback is intentional but debugging visibility is useful.
 */
export function logWarn(tag: string, message: string, error?: unknown): void {
  if (process.env.NODE_ENV !== "development") return;
  const detail = error instanceof Error ? error.message : error != null ? String(error) : "";
  console.warn(`[${tag}] ${message}${detail ? ": " + detail : ""}`);
}
