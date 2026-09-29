/**
 * Records that a login reached a screen demanding a password change (the
 * first-login screen, or the grace-period change-password screen) and has not
 * yet completed it. The app shell reads this and sends such a session back to
 * the login page instead of rendering the app.
 *
 * **This is defense in depth, not enforcement.** It stops someone from typing
 * /dashboard into the URL bar of this browser to skip the screen. It does not
 * — and cannot — stop anyone from driving the BridgeLink REST API directly:
 * at shipped defaults the server deliberately issues a fully privileged session
 * for a grace-period login AC4, which is correct for automation), so
 * the credentials are genuinely usable outside this UI. Nothing here makes the
 * password change "mandatory"; only the server could do that.
 *
 * localStorage, not sessionStorage: the app shell rehydrates a blank
 * sessionStorage from the per-server HttpOnly cookie via /api/auth/whoami, so a
 * per-tab flag would simply be absent in a new tab — the exact bypass this
 * guards. The flag is scoped to a server+user pair so it cannot leak onto a
 * different login, and every login that does NOT need a password change clears
 * it, which is what keeps a stale flag from turning into a redirect loop.
 */
import { logWarn } from "@/lib/dev-logger";

const PENDING_KEY = "bl-login-pending-password-change-v1";

interface PendingPasswordChange {
  serverUrl: string;
  username: string;
}

/**
 * Canonical origin for keying the flag: scheme + lowercased host + port, no
 * path or trailing slash. The two sides of the comparison arrive by different
 * routes — the login page has whatever the user typed, while the app shell's
 * new-tab path gets the value /api/auth/whoami returned, which the server has
 * already normalized. Without this, logging in as `https://MyServer:8443/`
 * flags one string and checks another, and the new tab sails past the guard.
 *
 * Deliberately a local copy of `normalizeBlOrigin` (lib/server-allowlist.ts,
 * the authority for this rule) rather than an import: that module is the
 * server-side SSRF gate and pulls in server-only logging, and this one runs in
 * the browser. Keep the two in step if the rule ever changes.
 */
function canonicalOrigin(serverUrl: string): string {
  try {
    const u = new URL(serverUrl.trim());
    return `https://${u.hostname.toLowerCase()}${u.port ? `:${u.port}` : ""}`;
  } catch {
    // Unparseable — fall back to the raw string so both sides at least agree
    // with each other, rather than silently never matching.
    return serverUrl.trim();
  }
}

/** Flag the given login as owing a password change. */
export function markPendingPasswordChange(serverUrl: string, username: string): void {
  if (typeof window === "undefined") return;
  try {
    const value: PendingPasswordChange = { serverUrl: canonicalOrigin(serverUrl), username };
    localStorage.setItem(PENDING_KEY, JSON.stringify(value));
  } catch (e) {
    // Storage unavailable (private mode, quota). The guard degrades to "no
    // guard" rather than blocking login — the server remains the only real gate.
    logWarn("PendingPasswordChange", "Failed to record pending password change", e);
  }
}

/** Clear the flag. Safe to call when nothing is flagged. */
export function clearPendingPasswordChange(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch (e) {
    logWarn("PendingPasswordChange", "Failed to clear pending password change", e);
  }
}

/**
 * Whether the given login still owes a password change. A flag left by a
 * different server or user is not this login's problem and reads as false.
 */
export function hasPendingPasswordChange(serverUrl: string, username: string): boolean {
  if (typeof window === "undefined") return false;
  let raw: string | null;
  try {
    raw = localStorage.getItem(PENDING_KEY);
  } catch (e) {
    logWarn("PendingPasswordChange", "Failed to read pending password change", e);
    return false;
  }
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingPasswordChange>;
    return parsed.serverUrl === canonicalOrigin(serverUrl) && parsed.username === username;
  } catch (e) {
    // Corrupt value — treat as no flag rather than locking the user out of the app.
    logWarn("PendingPasswordChange", "Failed to parse pending password change", e);
    return false;
  }
}
