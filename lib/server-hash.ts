import crypto from "crypto";

/** First 8 hex characters of SHA-256(serverUrl) — stable, per-server cookie key. */
export function serverHash(serverUrl: string): string {
  return crypto.createHash("sha256").update(serverUrl).digest("hex").slice(0, 8);
}
