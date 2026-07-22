/**
 * Dev-only fixture mode for the runtime plugin UI spike.
 *
 * Phase 1 of the spike is WebAdmin-only: the two Core endpoints
 * (`GET /extensions/_webadmin` and
 * `GET /extensions/{name}/webadmin/defaults/{transportName}`) don't exist on
 * a real engine yet. When `BL_WEBADMIN_PLUGINS_FIXTURE_DIR` is set — and the
 * build is NOT production — the proxy route answers those endpoints from that
 * directory instead of forwarding upstream. The CLIENT code path is identical
 * to the real one (same URLs through `request()`), so removing the flag later
 * changes nothing client-side.
 *
 * Fixture directory layout (see fixtures/webadmin-plugins/README.md):
 *
 *   <dir>/<ext-dir>/extension.json           { name, path, version, enabled? }
 *   <dir>/<ext-dir>/webadmin.json            the manifest (served verbatim, even if invalid)
 *   <dir>/<ext-dir>/defaults/<transport>.xml default properties per declared connector
 *   <dir>/<ext-dir>/actions/<action>.json    canned action-button responses
 *
 * Directories starting with "_" (e.g. _contract/) are skipped.
 *
 * To make the existing enablement-gating chain work unmodified, fixture mode
 * also (a) answers `GET /extensions/{name}/enabled` for fixture extensions
 * from `extension.json.enabled`, and (b) merges fixture extensions into the
 * real `GET /extensions/plugins/` response — in the RAW XStream JSON envelope
 * shape ({"map":{"entry":[{"string":..., "pluginMetaData":{...}}]}}) that the
 * client's normalizeXStream later flattens.
 *
 * Production exclusion: `isFixtureModeActive()` requires
 * `NODE_ENV !== "production"`, mirroring lib/server-allowlist.ts open mode.
 * A production process with the var set logs a loud one-time warning and
 * ignores it. `node:fs`/`node:path` are loaded via bundler-ignored dynamic
 * imports (the lib/bl-dispatcher.ts pattern) so this module stays inert if it
 * is ever pulled toward a client bundle.
 */

import { logServerError, logStartupWarn } from "./server-log";

export interface FixtureResponse {
  status: number;
  contentType: string;
  body: string;
}

interface FixtureExtension {
  /** Directory name under the fixture dir (filesystem lookups). */
  dirName: string;
  name: string;
  path: string;
  version: string;
  enabled: boolean;
  /** Parsed webadmin.json, or null when the file isn't valid JSON. */
  manifest: unknown;
}

let warnedInactive = false;

function isFixtureModeActive(): boolean {
  const dirSet = Boolean(process.env.BL_WEBADMIN_PLUGINS_FIXTURE_DIR);
  if (!dirSet) return false;
  // Fail CLOSED: active only in the two environments the dev workflow uses.
  // Any other NODE_ENV (production, staging, unset, ...) ignores the variable
  // — a deployment that forgets NODE_ENV must never serve fixtures.
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    return true;
  }
  if (!warnedInactive) {
    warnedInactive = true;
    logStartupWarn(
      "webadmin-fixtures",
      "BL_WEBADMIN_PLUGINS_FIXTURE_DIR is set but NODE_ENV is not development/test — " +
        "fixture mode is dev-only and the variable is being IGNORED."
    );
  }
  return false;
}

async function loadNodeDeps(): Promise<{
  fs: typeof import("node:fs/promises");
  path: typeof import("node:path");
}> {
  const fs = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "node:fs/promises");
  const path = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "node:path");
  return { fs, path };
}

/**
 * Filesystem-name safety for URL-derived segments (extension names, transport
 * names, action names, fixture dir names). Conservative charset plus explicit
 * dot-segment rejection; a resolve-prefix check backs this up at read time.
 */
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9 ._()-]+$/;

function isSafeSegment(segment: string): boolean {
  return segment !== "." && segment !== ".." && SAFE_SEGMENT_PATTERN.test(segment);
}

/** Resolves a path inside the fixture dir, guarding against path escape. */
async function resolveFixturePath(relativeSegments: string[]): Promise<string | null> {
  const dir = process.env.BL_WEBADMIN_PLUGINS_FIXTURE_DIR;
  if (!dir) return null;
  for (const segment of relativeSegments) {
    if (!isSafeSegment(segment)) return null;
  }
  const { path } = await loadNodeDeps();
  const root = path.resolve(dir);
  const target = path.resolve(root, ...relativeSegments);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

/** Reads a file inside the fixture dir, guarding against path escape. */
async function readFixtureFile(relativeSegments: string[]): Promise<string | null> {
  const target = await resolveFixturePath(relativeSegments);
  if (target === null) return null;
  const { fs } = await loadNodeDeps();
  try {
    return await fs.readFile(target, "utf8");
  } catch {
    return null;
  }
}

/** Writes a file inside the fixture dir (dev-only _setEnabled persistence). */
async function writeFixtureFile(relativeSegments: string[], content: string): Promise<void> {
  const target = await resolveFixturePath(relativeSegments);
  if (target === null) throw new Error("path escapes the fixture directory");
  const { fs } = await loadNodeDeps();
  await fs.writeFile(target, content, "utf8");
}

/** Scans the fixture dir into extension records. Bad directories are skipped with a log. */
async function scanFixtureExtensions(): Promise<FixtureExtension[]> {
  const dir = process.env.BL_WEBADMIN_PLUGINS_FIXTURE_DIR;
  if (!dir) return [];
  const { fs, path } = await loadNodeDeps();
  let dirents: import("node:fs").Dirent[];
  try {
    dirents = await fs.readdir(path.resolve(dir), { withFileTypes: true });
  } catch (err) {
    logServerError("webadmin-fixtures", `Fixture directory is not readable: ${dir}`, err);
    return [];
  }

  const extensions: FixtureExtension[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const dirName = dirent.name;
    if (dirName.startsWith("_") || dirName.startsWith(".") || !isSafeSegment(dirName)) continue;

    const metaText = await readFixtureFile([dirName, "extension.json"]);
    const manifestText = await readFixtureFile([dirName, "webadmin.json"]);
    if (metaText === null || manifestText === null) continue;

    let meta: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(metaText);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      meta = parsed as Record<string, unknown>;
    } catch {
      logServerError("webadmin-fixtures", `${dirName}/extension.json is not a JSON object`);
      continue;
    }
    const { name, path: extPath, version } = meta;
    if (typeof name !== "string" || typeof extPath !== "string" || typeof version !== "string") {
      logServerError(
        "webadmin-fixtures",
        `${dirName}/extension.json must declare string name, path, and version`
      );
      continue;
    }

    // The manifest is passed through even when invalid — the CLIENT validator
    // is what rejects it, keeping the client code path identical to a real
    // Core serving a broken manifest. A non-JSON file becomes null.
    let manifest: unknown = null;
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      manifest = null;
    }

    extensions.push({
      dirName,
      name,
      path: extPath,
      version,
      enabled: meta.enabled !== false,
      manifest,
    });
  }
  return extensions;
}

function jsonResponse(status: number, body: unknown): FixtureResponse {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

/**
 * Pre-hook: answer a request locally instead of forwarding it upstream.
 * Returns null (instantly when fixture mode is off) to fall through to the
 * normal proxy path. `pathStr` is the decoded, joined proxy path; `search`
 * is the raw query string (e.g. "?enabled=false"), used by _setEnabled.
 */
export async function getFixtureShortCircuit(
  method: string,
  pathStr: string,
  search = ""
): Promise<FixtureResponse | null> {
  if (!isFixtureModeActive()) return null;

  const segments = pathStr.split("/");
  if (segments[0] !== "extensions") return null;

  // GET /extensions/_webadmin — the manifest list.
  if (method === "GET" && segments.length === 2 && segments[1] === "_webadmin") {
    const extensions = await scanFixtureExtensions();
    return jsonResponse(200, {
      entries: extensions
        .filter((ext) => ext.enabled)
        .map((ext) => ({
          name: ext.name,
          path: ext.path,
          version: ext.version,
          manifest: ext.manifest,
        })),
    });
  }

  // GET /extensions/{name}/enabled — only for fixture extensions; real ones
  // fall through to the server.
  if (method === "GET" && segments.length === 3 && segments[2] === "enabled") {
    const extensions = await scanFixtureExtensions();
    const ext = extensions.find((e) => e.name === segments[1]);
    if (!ext) return null;
    return jsonResponse(200, ext.enabled);
  }

  // POST /extensions/{name}/_setEnabled?enabled=<bool> — only for fixture
  // extensions; persists to the fixture's extension.json so the Extensions
  // page enable/disable toggle drives the gating demo end-to-end (the
  // contributed UI disappears on next login, mirroring a real server where
  // the flag flips immediately but takes effect on restart).
  if (method === "POST" && segments.length === 3 && segments[2] === "_setEnabled") {
    const extensions = await scanFixtureExtensions();
    const ext = extensions.find((e) => e.name === segments[1]);
    if (!ext) return null;
    const enabledParam = new URLSearchParams(search).get("enabled");
    if (enabledParam !== "true" && enabledParam !== "false") {
      return jsonResponse(400, { error: "enabled must be true or false" });
    }
    const metaText = await readFixtureFile([ext.dirName, "extension.json"]);
    if (metaText === null) return jsonResponse(404, { error: "extension.json not found" });
    try {
      const meta = JSON.parse(metaText) as Record<string, unknown>;
      meta.enabled = enabledParam === "true";
      await writeFixtureFile([ext.dirName, "extension.json"], JSON.stringify(meta, null, 2) + "\n");
    } catch (err) {
      logServerError("webadmin-fixtures", `failed to update ${ext.dirName}/extension.json`, err);
      return jsonResponse(500, { error: "failed to update extension.json" });
    }
    // Mirrors the real endpoint's 204 No Content.
    return { status: 204, contentType: "application/json", body: "" };
  }

  // GET /extensions/{name}/webadmin/defaults/{transportName}
  if (
    method === "GET" &&
    segments.length === 5 &&
    segments[2] === "webadmin" &&
    segments[3] === "defaults"
  ) {
    const extensions = await scanFixtureExtensions();
    const ext = extensions.find((e) => e.name === segments[1]);
    if (!ext) return null;
    const xml = await readFixtureFile([ext.dirName, "defaults", `${segments[4]}.xml`]);
    if (xml === null) {
      return jsonResponse(404, {
        error: `No default properties fixture for transport "${segments[4]}"`,
      });
    }
    return { status: 200, contentType: "application/xml", body: xml };
  }

  // GET/POST /extensions/{path}/webadmin/actions/{action} — canned responses
  // for declared action buttons. Matched on the extension PATH (the action
  // endpoint namespace), unlike enabled/defaults which are name-based.
  if (
    (method === "GET" || method === "POST") &&
    segments.length === 5 &&
    segments[2] === "webadmin" &&
    segments[3] === "actions"
  ) {
    const extensions = await scanFixtureExtensions();
    const ext = extensions.find((e) => e.path === segments[1]);
    if (!ext) return null;
    const body = await readFixtureFile([ext.dirName, "actions", `${segments[4]}.json`]);
    if (body === null) {
      return jsonResponse(404, { error: `No action fixture "${segments[4]}"` });
    }
    return { status: 200, contentType: "application/json", body };
  }

  return null;
}

/**
 * Post-hook: merge fixture extensions into the real
 * `GET /extensions/plugins/` response so the installed-plugins cache (and
 * therefore all serverPluginName gating) sees them as installed. Returns null
 * when fixture mode is off or the path doesn't match; otherwise ALWAYS
 * returns a response (the upstream body has been consumed). On any merge
 * problem the upstream body is passed through unchanged.
 */
export async function mergeFixtureExtensions(
  pathStr: string,
  upstreamRes: Response
): Promise<FixtureResponse | null> {
  if (!isFixtureModeActive()) return null;
  if (pathStr !== "extensions/plugins") return null;
  if (!upstreamRes.ok) return null;

  const text = await upstreamRes.text();
  const passthrough: FixtureResponse = {
    status: upstreamRes.status,
    contentType: upstreamRes.headers.get("content-type") ?? "application/json",
    body: text,
  };
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") return passthrough;
    const root = parsed as { map?: { entry?: unknown } };
    if (root.map === null || typeof root.map !== "object") return passthrough;
    const map = root.map as { entry?: unknown };
    // Staxon collapses a single-entry map to a plain object — normalize.
    const entries: unknown[] =
      map.entry === undefined ? [] : Array.isArray(map.entry) ? map.entry : [map.entry];

    const existingNames = new Set<string>();
    for (const entry of entries) {
      const name = (entry as { string?: unknown } | null)?.string;
      if (typeof name === "string") existingNames.add(name);
    }

    for (const ext of await scanFixtureExtensions()) {
      if (existingNames.has(ext.name)) continue;
      entries.push({
        string: ext.name,
        pluginMetaData: {
          "@path": ext.path,
          name: ext.name,
          author: "Fixture",
          pluginVersion: ext.version,
          description: "Local WebAdmin runtime-plugin fixture",
        },
      });
    }
    map.entry = entries;
    return { status: 200, contentType: "application/json", body: JSON.stringify(parsed) };
  } catch {
    return passthrough;
  }
}
