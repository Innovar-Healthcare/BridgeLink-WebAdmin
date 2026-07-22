/**
 * Client-side auth helpers using sessionStorage so state survives page
 * refreshes within a tab but is cleared when the browser tab closes.
 */
import { logWarn } from "@/lib/dev-logger";
import { clearInstalledPluginsCache } from "@/lib/installed-plugins";
import { clearVersionHistoryEnabledCache } from "@/lib/version-history";
import { clearPluginLicensesCache } from "@/lib/plugin-license";

const SESSION_KEY = "bl_session";

export interface SessionInfo {
  username: string;
  serverUrl: string;
  /** Server version string from GET /server/version, e.g. "26.3.1".
   *  Mirrors Java's PlatformUI.SERVER_VERSION — used as the version attribute
   *  on exported XML objects (channelGroup, channel, etc.) and for the
   *  WebAdmin↔Core compatibility check (see lib/version-compat.ts,. */
  serverVersion?: string;
  /** BridgeLink user ID of the currently logged-in user.
   *  Used to populate exportData.metadata.userId in newly created channels,
   *  matching the Java UI's behaviour of tracking who created/last modified a channel. */
  userId?: number;
}

export function saveSession(info: SessionInfo) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(info));
}

export function getSession(): SessionInfo | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionInfo;
  } catch (e) {
    logWarn("Auth", "Failed to parse session from storage", e);
    return null;
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_KEY);
  clearInstalledPluginsCache();
  clearVersionHistoryEnabledCache();
  clearPluginLicensesCache();
}

export function updateSession(patch: Partial<SessionInfo>) {
  const current = getSession();
  if (!current) return;
  saveSession({ ...current, ...patch });
}

export function isAuthenticated(): boolean {
  return getSession() !== null;
}

/**
 * Returns a storage-key prefix scoped to the current user, e.g. "admin:".
 * Falls back to "" when no session exists (pre-login), so keys still work
 * but won't collide with a real user's data once they log in.
 */
export function getUserKeyPrefix(): string {
  const session = getSession();
  return session?.username ? `${session.username}:` : "";
}

/**
 * Builds a sessionStorage/localStorage key scoped to the logged-in user.
 * e.g. userScopedKey("bl-filter-messages-text") → "admin:bl-filter-messages-text"
 */
export function userScopedKey(key: string): string {
  return `${getUserKeyPrefix()}${key}`;
}
