/**
 * WebAdmin ↔ BridgeLink Core version-compatibility policy.
 *
 * Web Admin can point at any Core server (the target is user-supplied per
 * request). An older Core silently breaks features (missing endpoints, changed
 * API shapes), so we compare the Core server version against a compatibility
 * policy shipped in this build and either block or warn.
 *
 * Web Admin and Core are versioned in lockstep on `major.minor.patch` (both are
 * 26.3.1 today; `GET /server/version` returns e.g. "26.3.1"). The policy is a
 * floor plus a tested-ceiling:
 *   - floor    — {@link MIN_SUPPORTED_SERVER_VERSION}: Core older than this is
 *                blocked (its APIs are too old for this build).
 *   - ceiling  — this Web Admin build's own version: a Core newer than the build
 *                was released after it and is therefore untested → a soft warning.
 *
 * This is a WebUI-only concern — the Java Swing client never gated login on
 * server version — so there is no Java source to mirror. To change support,
 * bump {@link MIN_SUPPORTED_SERVER_VERSION} below (and cut a new Web Admin
 * release, which advances the tested-ceiling automatically).
 */
import { compareVersions } from "@/lib/utils";

/**
 * Oldest Core server version this Web Admin build supports. Core older than this
 * is hard-blocked at login and in the app shell. Bump when we drop support for
 * an old Core release.
 */
export const MIN_SUPPORTED_SERVER_VERSION = "26.3.0";

export type CompatLevel = "ok" | "warn-newer" | "block";

export interface CompatResult {
  level: CompatLevel;
  /** The Core server version evaluated (empty string when unknown). */
  serverVersion: string;
  /** This Web Admin build's version (the tested-ceiling). */
  webAdminVersion: string;
  /** Short label for the About row / banner heading. */
  title: string;
  /** Full explanation for the block screen / banner body. */
  message: string;
}

/**
 * Evaluate a Core server version against this build's compatibility policy.
 *
 * - `block`      — server parses and is below {@link MIN_SUPPORTED_SERVER_VERSION}.
 * - `warn-newer` — server is newer than this Web Admin build (untested).
 * - `ok`         — MIN ≤ server ≤ this build, or the version is unknown.
 *
 * Fail-open: a missing or unparseable `serverVersion` returns `ok`. A hard block
 * must rest on a version we can confidently read as too old — never on a parse
 * quirk that would lock a user out of a server that might be fine.
 */
export function evaluateServerCompatibility(
  serverVersion: string | null | undefined,
  webAdminVersion: string = process.env.NEXT_PUBLIC_APP_VERSION ?? ""
): CompatResult {
  const server = (serverVersion ?? "").trim();
  const web = webAdminVersion.trim();

  const base = { serverVersion: server, webAdminVersion: web };

  // Fail-open when we can't read the server version.
  if (!server || !/\d/.test(server)) {
    return {
      ...base,
      level: "ok",
      title: "Compatible",
      message: "",
    };
  }

  if (compareVersions(server, MIN_SUPPORTED_SERVER_VERSION) < 0) {
    return {
      ...base,
      level: "block",
      title: "Incompatible server version",
      message:
        `This Web Admin build (${web || "unknown"}) does not support BridgeLink ` +
        `server ${server}. The server must be version ${MIN_SUPPORTED_SERVER_VERSION} ` +
        `or newer. Upgrade the BridgeLink server, or use a Web Admin build that ` +
        `matches it.`,
    };
  }

  // A Core newer than this build shipped after it → untested (soft warning).
  if (web && compareVersions(server, web) > 0) {
    return {
      ...base,
      level: "warn-newer",
      title: "Untested server version",
      message:
        `BridgeLink server ${server} is newer than this Web Admin build (${web}). ` +
        `Some features may not work as expected. Update Web Admin to match the server.`,
    };
  }

  return {
    ...base,
    level: "ok",
    title: "Compatible",
    message: "",
  };
}
