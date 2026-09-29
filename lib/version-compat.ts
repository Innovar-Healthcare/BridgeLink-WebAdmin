/**
 * WebAdmin ↔ BridgeLink Core version-compatibility policy.
 *
 * Web Admin can point at any Core server (the target is user-supplied per
 * request). An older Core silently breaks features (missing endpoints, changed
 * API shapes), so we compare the Core server version against a compatibility
 * policy shipped in this build and either block or warn.
 *
 * Web Admin and Core share a `major.minor.patch` version line, but a Core release
 * does not always get a matching Web Admin build (`GET /server/version` returns
 * e.g. "26.6.1"). The policy is a floor plus a tested-ceiling:
 *   - floor    — {@link MIN_SUPPORTED_SERVER_VERSION}: Core older than this is
 *                blocked (its APIs are too old for this build).
 *   - ceiling  — this Web Admin build's own MINOR line: a Core on a newer minor
 *                or major was released after this build and is therefore
 *                untested → a soft warning.
 *
 * The ceiling is a minor line rather than the exact build version because a Core
 * patch release does not change existing contracts. It may still ADD
 * surface — `plugins/version-history/use-plugin-capabilities.ts` gates on 26.3.1
 * for exactly that reason — but added endpoints are inert to a build that never
 * calls them. Comparing exactly meant every Core patch — 26.6.1 against a
 * 26.6.0 build — warned on every install until Web Admin itself was rebuilt, and
 * we do not always cut a Web Admin release alongside a Core patch. The floor is
 * deliberately NOT relaxed the same way: it must stay enforceable at patch level
 * so a genuinely breaking Core patch can still be blocked outright.
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
 * Compare only the `major.minor` of two version strings.
 *
 * Truncates to the first two numeric components and delegates to
 * {@link compareVersions}, so snapshot and build suffixes are handled exactly as
 * they are elsewhere ("26.6.1-SNAPSHOT" → "26.6"). A version with fewer than two
 * components compares on what it has ("26" < "26.6").
 */
function compareMinorLine(a: string, b: string): -1 | 0 | 1 {
  const minorLine = (v: string) =>
    v
      .split(/[.\-+]/)
      .slice(0, 2)
      .join(".");
  return compareVersions(minorLine(a), minorLine(b));
}

/**
 * Evaluate a Core server version against this build's compatibility policy.
 *
 * - `block`      — server parses and is below {@link MIN_SUPPORTED_SERVER_VERSION}.
 * - `warn-newer` — server is on a newer minor or major line than this Web Admin
 *                  build (untested). A newer patch inside our own line is `ok`.
 * - `ok`         — MIN ≤ server, up to and including the last patch of this
 *                  build's minor line, or the version is unknown.
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

  // A Core on a newer minor/major line shipped after this build → untested (soft
  // warning). A newer patch inside our own line is compatible by definition.
  if (web && compareMinorLine(server, web) > 0) {
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
