/**
 * Runtime plugin manifest loader.
 *
 * Runs during the authenticated bootstrap in app/(app)/layout.tsx, BEFORE the
 * app shell's children mount: fetches `GET /extensions/_webadmin`, validates
 * each entry strictly, prefetches the engine-served default properties for
 * every declared connector panel, and registers each valid manifest through
 * the same `registerPlugin()` fan-out the compiled-in plugins use — with
 * `serverPluginName` = the extension name, so the existing enablement gating
 * (disable the extension on the server → its UI disappears) applies for free.
 *
 * Failure semantics are strictly fail-soft:
 *  - The list fetch failing (older Core, network) → zero runtime plugins,
 *    boot proceeds, Extensions page shows "unavailable".
 *  - One bad manifest never breaks boot or its neighbors: each entry is
 *    processed in its own try/catch and skipped with a visible reason.
 *
 * Registration is irreversible for the session (`registerPlugin` has no
 * unregister, matching compiled-in plugins). Re-login to the same server
 * re-marks entries loaded via a content fingerprint covering BOTH the
 * manifest entry and the engine-served defaults XML; same-named contributions
 * with DIFFERENT content (server switch, engine-side defaults change) are
 * skipped with a visible "reload the page" reason rather than silently
 * serving stale UI.
 */

import { request } from "@/lib/api-client";
import {
  getPluginDefinition,
  registerPlugin,
  type DestinationConnectorContribution,
  type PluginDefinition,
  type SourceConnectorContribution,
} from "@/lib/plugin-manifest";
import { compareVersions } from "@/lib/utils";
import { logWarn } from "@/lib/dev-logger";
import { registerCacheTeardown } from "@/lib/logout";
import { createRuntimeConnectorSection } from "@/components/schema-form/runtime-connector-section";
import { createRuntimeSettingsTab } from "@/components/schema-form/runtime-settings-tab";
import { RuntimeSettingsActionPanel } from "@/components/schema-form/runtime-settings-action-panel";
import { compileConnectorValidator } from "./compile-validate";
import { validateManifestEntry } from "./manifest-validator";
import { parsePropertiesDoc } from "./xml-field-binding";
import {
  recordRuntimePluginStatus,
  resetRuntimePluginStatuses,
  setRuntimeManifestListState,
  updateRuntimePluginStatus,
} from "./status-store";
import { MANIFEST_CAPS } from "./manifest-types";
import type { ValidatedManifestEntry, WebAdminManifestList } from "./manifest-types";

type LoaderPhase = "idle" | "loading" | "done";

let phase: LoaderPhase = "idle";
let inflight: Promise<void> | null = null;

/**
 * Run generation. The session teardown increments it, which invalidates any
 * still-awaiting load: a stale run must neither write status rows after the
 * reset nor let its `.finally` clobber the re-armed phase (which would make
 * the next login skip loading entirely).
 */
let generation = 0;

/** Deadline on the boot-blocking fetches — a hung upstream must not hold the
 * whole app at the skeleton forever (list fetch + per-connector defaults). */
const BOOT_FETCH_TIMEOUT_MS = 15_000;

/**
 * Content fingerprints of definitions already registered this page lifetime,
 * by plugin id: the manifest entry and the engine-served defaults XML are
 * fingerprinted separately so a defaults-only change on the server gets its
 * own, more accurate skip reason. Deliberately NOT cleared on session
 * teardown — they describe what is irreversibly in the registry until a page
 * reload.
 */
const loadedFingerprints = new Map<string, { entry: string; defaults: string }>();

/** Internal signal: skip this entry with a user-visible reason. */
class SkipEntry {
  constructor(public readonly reason: string) {}
}

/**
 * Loads and registers all runtime plugin manifests. Never rejects; idempotent
 * per session (re-entrant calls and React StrictMode double-invokes share the
 * in-flight promise). The layout awaits this before mounting children.
 */
export function loadRuntimePlugins(): Promise<void> {
  if (phase === "done") return Promise.resolve();
  if (inflight) return inflight;
  phase = "loading";
  const runGeneration = generation;
  inflight = doLoad(runGeneration)
    .catch((err) => {
      logWarn("runtime-plugins", "unexpected failure while loading runtime plugin manifests", err);
    })
    .finally(() => {
      // A teardown (or reset) superseded this run mid-flight: it already
      // re-armed phase/inflight, and this stale run must not clobber them.
      if (generation !== runGeneration) return;
      phase = "done";
      inflight = null;
    });
  return inflight;
}

async function doLoad(runGeneration: number): Promise<void> {
  const isCurrent = () => generation === runGeneration;
  let list: WebAdminManifestList;
  try {
    // Plain JSON by contract (docs/WEBADMIN-PLUGIN-CONTRACT.md) — not XStream.
    list = await request<WebAdminManifestList>("/extensions/_webadmin", {
      skipNormalize: true,
      signal: AbortSignal.timeout(BOOT_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    // Older Core without the endpoint (404), unreachable server, timeout —
    // boot proceeds with zero runtime plugins.
    logWarn("runtime-plugins", "manifest list unavailable", err);
    if (isCurrent()) setRuntimeManifestListState("unavailable");
    return;
  }
  if (!isCurrent()) return;
  if (!list || !Array.isArray(list.entries)) {
    logWarn("runtime-plugins", "manifest list response had an unexpected shape");
    setRuntimeManifestListState("unavailable");
    return;
  }
  setRuntimeManifestListState("loaded");

  let entries = list.entries;
  if (entries.length > MANIFEST_CAPS.MAX_MANIFEST_ENTRIES) {
    logWarn(
      "runtime-plugins",
      `manifest list has ${entries.length} entries — processing the first ` +
        `${MANIFEST_CAPS.MAX_MANIFEST_ENTRIES} only`
    );
    entries = entries.slice(0, MANIFEST_CAPS.MAX_MANIFEST_ENTRIES);
  }

  // Sequential on purpose: status rows keep the server's entry order, and a
  // typical install has few manifests. Defaults within an entry fetch in
  // parallel.
  const seenNames = new Set<string>();
  for (const raw of entries) {
    if (!isCurrent()) return;
    await processEntry(raw, runGeneration, seenNames);
  }
}

async function processEntry(
  raw: unknown,
  runGeneration: number,
  seenNames: Set<string>
): Promise<void> {
  const identity = bestEffortIdentity(raw);
  try {
    const outcome = validateManifestEntry(raw);
    if (!outcome.ok) throw new SkipEntry(outcome.reason);
    if (seenNames.has(outcome.entry.name)) {
      throw new SkipEntry("duplicate manifest entry for this extension name");
    }
    seenNames.add(outcome.entry.name);
    await registerEntry(outcome.entry, runGeneration);
  } catch (err) {
    const reason =
      err instanceof SkipEntry ? err.reason : "unexpected error while loading the manifest";
    if (!(err instanceof SkipEntry)) {
      logWarn("runtime-plugins", `manifest for "${identity.name}" threw while loading`, err);
    }
    if (generation !== runGeneration) return;
    recordRuntimePluginStatus({
      ...identity,
      status: "skipped",
      reason,
      contributionCount: 0,
    });
  }
}

async function registerEntry(entry: ValidatedManifestEntry, runGeneration: number): Promise<void> {
  const { manifest } = entry;
  const connectorPanels = manifest.connectorPanels ?? [];
  const settingsPanels = manifest.settingsPanels ?? [];
  const contributionCount = connectorPanels.length + settingsPanels.length;

  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
  if (manifest.minWebAdminVersion) {
    // An unknown own-version compares lowest — skipping is the safe direction.
    if (!appVersion || compareVersions(appVersion, manifest.minWebAdminVersion) < 0) {
      throw new SkipEntry(
        `requires WebAdmin ${manifest.minWebAdminVersion} or newer ` +
          `(this build is ${appVersion || "of unknown version"})`
      );
    }
  }

  const id = `runtime:${entry.name}`;
  const entryFingerprint = JSON.stringify(entry);

  // Engine-served defaults, prefetched so registration stays synchronous
  // (ConnectorDefinition.defaultPropertiesXml is read synchronously on
  // connector-type switch). Fetched BEFORE the already-registered check so a
  // defaults-only change on the server is detected on re-login instead of
  // silently serving the stale defaults baked into the registration
  //. The engine XML carries real class/version attributes;
  // withVersion() only replaces the literal {{VERSION}} token, so it passes
  // through the editor's version stamp untouched.
  const defaultsByTransport = new Map<string, string>();
  await Promise.all(
    connectorPanels.map(async (panel) => {
      let xml: string;
      try {
        xml = await request<string>(
          `/extensions/${encodeURIComponent(entry.name)}/webadmin/defaults/` +
            encodeURIComponent(panel.transportName),
          {
            rawText: true,
            // The defaults endpoint returns raw XStream XML; ask for it explicitly
            // rather than relying on the engine's Accept tolerance (Core PR #173).
            //.
            headers: { Accept: "application/xml" },
            signal: AbortSignal.timeout(BOOT_FETCH_TIMEOUT_MS),
          }
        );
      } catch {
        throw new SkipEntry(
          `failed to fetch default properties for connector "${panel.transportName}"`
        );
      }
      if (xml && xml.length > MANIFEST_CAPS.MAX_DEFAULTS_XML_BYTES) {
        throw new SkipEntry(
          `default properties for connector "${panel.transportName}" exceed ` +
            `${MANIFEST_CAPS.MAX_DEFAULTS_XML_BYTES} bytes`
        );
      }
      if (!xml || !parsePropertiesDoc(xml)) {
        throw new SkipEntry(
          `default properties for connector "${panel.transportName}" are not valid XML`
        );
      }
      defaultsByTransport.set(panel.transportName, xml);
    })
  );

  // Sorted for determinism — Promise.all insertion order follows fetch
  // completion, not panel order.
  const defaultsFingerprint = JSON.stringify(
    [...defaultsByTransport.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );

  if (getPluginDefinition(id)) {
    const stored = loadedFingerprints.get(id);
    if (stored?.entry === entryFingerprint && stored.defaults === defaultsFingerprint) {
      // Re-login to the same server with identical content: the definition is
      // already registered — just mark it loaded.
      if (generation === runGeneration) {
        recordRuntimePluginStatus({ ...identityOf(entry), status: "loaded", contributionCount });
      }
      return;
    }
    if (stored?.entry === entryFingerprint) {
      throw new SkipEntry(
        "this extension's connector defaults changed on the server — reload the page to pick them up"
      );
    }
    throw new SkipEntry(
      "a different version of this extension's web contributions is already registered " +
        "from a previous session — reload the page to load this one"
    );
  }

  const def: PluginDefinition = {
    id,
    // The extension name gates every contribution through the existing
    // installed+enabled plugin cache. Runtime manifests can never
    // carry a licensedPluginId — the schema has no such field.
    serverPluginName: entry.name,
  };

  const sources: SourceConnectorContribution[] = [];
  const destinations: DestinationConnectorContribution[] = [];
  for (const panel of connectorPanels) {
    const contribution = {
      transportName: panel.transportName,
      defaultPropertiesXml: defaultsByTransport.get(panel.transportName),
      validate: compileConnectorValidator(panel),
      BottomSection: createRuntimeConnectorSection(panel, entry),
    };
    if (panel.mode === "source") sources.push(contribution);
    else destinations.push(contribution);
  }
  if (sources.length > 0) def.sourceConnectors = sources;
  if (destinations.length > 0) def.destinationConnectors = destinations;

  if (settingsPanels.length > 0) {
    // tabKey is namespaced with the extension name so two extensions declaring
    // the same slug never collide on the Settings page's Tabs value.
    // The Settings host only renders a toolbar (and therefore Save/Refresh)
    // for a plugin tab that registers an actionPanel — the generic runtime
    // panel wires the handlers the tab exposes through its actionsRef.
    def.settingsTabs = settingsPanels.map((panel) => ({
      tabKey: `rt-${slugify(entry.name)}-${panel.tabKey}`,
      tabLabel: panel.tabLabel,
      component: createRuntimeSettingsTab(panel, entry),
      actionPanel: RuntimeSettingsActionPanel,
    }));
  }

  // A teardown superseded this run while defaults were in flight — don't
  // register against the next session's state or write a stale status row.
  if (generation !== runGeneration) return;

  const report = registerPlugin(def);
  loadedFingerprints.set(id, { entry: entryFingerprint, defaults: defaultsFingerprint });

  // Report what actually registered, not what the manifest declared: a
  // first-wins collision (e.g. a settings tabKey or connector transportName
  // already taken) drops the contribution, and the status card must say so
  // instead of "Loaded". Deferred outcomes (channel registries
  // load lazily) count as accepted until their sink drains and says otherwise.
  const dropped = report.outcomes
    .filter((o) => o.result === "dropped")
    .map((o) => ({ kind: o.kind, key: o.key, reason: o.reason ?? "dropped" }));
  recordRuntimePluginStatus({
    ...identityOf(entry),
    status: dropped.length > 0 ? "partial" : "loaded",
    contributionCount: report.outcomes.length - dropped.length,
    ...(dropped.length > 0 ? { droppedContributions: dropped } : {}),
  });
  report.onDeferredOutcome((outcome) => {
    if (outcome.result !== "dropped" || generation !== runGeneration) return;
    updateRuntimePluginStatus(entry.name, (row) => {
      // updateRuntimePluginStatus matches by name, and names collide across
      // duplicate entries: a same-named entry that lost the dedup is a separate
      // "skipped" row. Only this entry's own registered (loaded/partial) row —
      // unique among non-skipped rows for a given name — downgrades; leave any
      // skipped duplicate untouched.
      if (row.status === "skipped") return row;
      return {
        ...row,
        status: "partial",
        contributionCount: Math.max(0, row.contributionCount - 1),
        droppedContributions: [
          ...(row.droppedContributions ?? []),
          { kind: outcome.kind, key: outcome.key, reason: outcome.reason ?? "dropped" },
        ],
      };
    });
  });
}

function identityOf(entry: ValidatedManifestEntry): {
  name: string;
  path: string;
  version: string;
} {
  return { name: entry.name, path: entry.path, version: entry.version };
}

/** Extension name → settings tabKey namespace segment. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Display identity for status rows of entries that fail validation. */
function bestEffortIdentity(raw: unknown): { name: string; path: string; version: string } {
  const obj = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown): string => (typeof v === "string" && v.trim() !== "" ? v : "");
  return {
    name: str(obj.name) || "(unknown extension)",
    path: str(obj.path),
    version: str(obj.version),
  };
}

// Session teardown (logout, idle-logout, 401): clear statuses and let the
// next login re-run the loader. Fingerprints survive — registrations do too.
// An in-flight load at teardown time is abandoned; its results are cleared on
// the next reset or superseded by the reload the skip reason asks for.
registerCacheTeardown(() => {
  generation++;
  phase = "idle";
  inflight = null;
  resetRuntimePluginStatuses();
});

/** Test-only helpers (mirrors lib/plugin-manifest.ts convention). */
export const __testing = {
  reset(): void {
    generation++;
    phase = "idle";
    inflight = null;
    loadedFingerprints.clear();
    resetRuntimePluginStatuses();
  },
};
