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
 *  - A data type whose engine defaults 404 (the endpoint first ships in
 *    BridgeLink 26.9.0) is dropped on its own; the manifest's other
 *    contributions register and the row reports "partial".
 *
 * Registration is irreversible for the session (`registerPlugin` has no
 * unregister, matching compiled-in plugins). Re-login to the same server
 * re-marks entries loaded via a content fingerprint covering BOTH the
 * manifest entry and the engine-served defaults XML; same-named contributions
 * with DIFFERENT content (server switch, engine-side defaults change) are
 * skipped with a visible "reload the page" reason rather than silently
 * serving stale UI.
 */

import { ApiError, request } from "@/lib/api-client";
import {
  getPluginDefinition,
  registerPlugin,
  transformerStepContribution,
  type DestinationConnectorContribution,
  type PluginDefinition,
  type SourceConnectorContribution,
} from "@/lib/plugin-manifest";
import { compareVersions } from "@/lib/utils";
import { logWarn } from "@/lib/dev-logger";
import { registerCacheTeardown } from "@/lib/logout";
import { createRuntimeConnectorSection } from "@/components/schema-form/runtime-connector-section";
import { createRuntimeConnectorPluginSection } from "@/components/schema-form/runtime-connector-plugin-section";
import { createRuntimeSettingsTab } from "@/components/schema-form/runtime-settings-tab";
import { RuntimeSettingsActionPanel } from "@/components/schema-form/runtime-settings-action-panel";
import { createRuntimeTransmissionModeSection } from "@/components/schema-form/runtime-transmission-mode-section";
import { createRuntimeDataTypeSection } from "@/components/schema-form/runtime-data-type-section";
import { createRuntimeTransformerStepEditor } from "@/components/schema-form/runtime-transformer-step-section";
import { compileConnectorSection } from "./compile-connector-section";
import { compileConnectorValidator } from "./compile-validate";
import { compileDataType } from "./compile-data-type";
import { compileTransformerStep } from "./compile-transformer-step";
import { compileTransmissionMode } from "./compile-transmission-mode";
import { validateManifestEntry, VERSION_PATTERN } from "./manifest-validator";
import { parsePropertiesDoc } from "./xml-field-binding";
import {
  recordRuntimePluginStatus,
  resetRuntimePluginStatuses,
  setRuntimeManifestListState,
  updateRuntimePluginStatus,
} from "./status-store";
import { MANIFEST_CAPS } from "./manifest-types";
import type {
  DroppedContribution,
  SkippedKind,
  ValidatedManifestEntry,
  WebAdminManifestList,
} from "./manifest-types";

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
 * The registration outcome captured at fresh load, replayed verbatim on the
 * re-login fingerprint-match path so a re-login reports the same fidelity as
 * the fresh load — same status, same accepted-vs-declared count, same dropped
 * rows — instead of silently upgrading a partial card to a clean "Loaded"
 *. Mutated in place when a deferred contribution settles as dropped,
 * so a drain that happens after a re-login also carries through.
 */
interface RegisteredOutcome {
  status: "loaded" | "partial";
  contributionCount: number;
  droppedContributions?: DroppedContribution[];
}

/**
 * Content fingerprints of definitions already registered this page lifetime,
 * by plugin id: the manifest entry and the engine-served defaults XML are
 * fingerprinted separately so a defaults-only change on the server gets its
 * own, more accurate skip reason. The captured `outcome` rides alongside so the
 * re-login path can replay it. Deliberately NOT cleared on session
 * teardown — they describe what is irreversibly in the registry until a page
 * reload.
 */
const loadedFingerprints = new Map<
  string,
  { entry: string; defaults: string; outcome: RegisteredOutcome }
>();

/**
 * Why a data type was dropped when its engine defaults 404. The status alone
 * cannot tell the two causes apart — pre-26.9 servers lack the route, and a
 * 26.9 server 404s when the extension does not declare the data type — and the
 * server version is not reliably known yet while the loader runs.
 */
const DATA_TYPE_DEFAULTS_404_REASON =
  "the server has no default properties for this data type (HTTP 404). Data types need " +
  "BridgeLink 26.9.0 or newer; on a newer server this means the extension does not declare " +
  "the data type";

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
    // Best-effort version gate BEFORE strict validation: a manifest written
    // for a newer WebAdmin may use grammar this build's validator rejects, and
    // the author's declared floor is the friendlier skip reason than "unknown
    // key". The authoritative (post-validation) gate in registerEntry remains.
    const versionSkip = preValidationVersionGate(raw);
    if (versionSkip) throw new SkipEntry(versionSkip);
    const outcome = validateManifestEntry(raw);
    if (!outcome.ok) throw new SkipEntry(outcome.reason);
    if (seenNames.has(outcome.entry.name)) {
      throw new SkipEntry("duplicate manifest entry for this extension name");
    }
    seenNames.add(outcome.entry.name);
    await registerEntry(outcome.entry, outcome.skippedKinds, runGeneration);
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

async function registerEntry(
  entry: ValidatedManifestEntry,
  skippedKinds: SkippedKind[],
  runGeneration: number
): Promise<void> {
  const { manifest } = entry;
  const connectorPanels = manifest.connectorPanels ?? [];
  const settingsPanels = manifest.settingsPanels ?? [];
  const transmissionModes = manifest.transmissionModes ?? [];
  const dataTypes = manifest.dataTypes ?? [];
  const connectorSections = manifest.connectorSections ?? [];
  const transformerSteps = manifest.transformerSteps ?? [];

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

  // Data type defaults join the same map under a "datatype:" prefix
  // (collision-proof — TRANSPORT_NAME_PATTERN forbids ":"), so they share the
  // fingerprint below: a datatype-defaults-only change on the server gets the
  // same "reload the page" re-login skip as connector defaults.
  //
  // A 404 drops only that data type: registering it without
  // defaults would write class-less XStream XML on first save, but the rest of
  // the manifest needs no engine endpoint. Every other failure still skips the
  // whole entry — a transient error baked into an irreversible partial
  // registration would only resurface as a "reload the page" skip on re-login,
  // whereas a skipped entry retries cleanly.
  const notFoundDataTypes = new Set<string>();
  await Promise.all(
    dataTypes.map(async (dataType) => {
      let xml: string;
      try {
        xml = await request<string>(
          `/extensions/${encodeURIComponent(entry.name)}/webadmin/datatype-defaults/` +
            encodeURIComponent(dataType.name),
          {
            rawText: true,
            // Raw XStream XML — ask for it explicitly rather than relying on
            // the engine's Accept tolerance (Core PR #173)..
            headers: { Accept: "application/xml" },
            signal: AbortSignal.timeout(BOOT_FETCH_TIMEOUT_MS),
          }
        );
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          notFoundDataTypes.add(dataType.name);
          return;
        }
        throw new SkipEntry(`failed to fetch default properties for data type "${dataType.name}"`);
      }
      if (xml && xml.length > MANIFEST_CAPS.MAX_DEFAULTS_XML_BYTES) {
        throw new SkipEntry(
          `default properties for data type "${dataType.name}" exceed ` +
            `${MANIFEST_CAPS.MAX_DEFAULTS_XML_BYTES} bytes`
        );
      }
      const doc = xml ? parsePropertiesDoc(xml) : null;
      if (!doc) {
        throw new SkipEntry(
          `default properties for data type "${dataType.name}" are not valid XML`
        );
      }
      const root = doc.documentElement;
      // The compiled defaultPropertiesXml retags this root — namespaced XML
      // has no sound retag (and XStream never emits it), so reject it here
      // with a reason instead of producing a mangled element later.
      if (
        root.namespaceURI !== null ||
        Array.from(root.attributes).some((a) => a.name === "xmlns" || a.name.startsWith("xmlns:"))
      ) {
        throw new SkipEntry(
          `default properties for data type "${dataType.name}" use XML namespaces, ` +
            "which are not supported"
        );
      }
      // Every declared group element must exist in the defaults: a missing
      // group would degrade to an empty form whose first save writes a
      // class-less group element strict XStream cannot deserialize.
      const childTags = new Set(Array.from(root.children).map((child) => child.tagName));
      for (const group of dataType.propertyGroups ?? []) {
        const groupTag = `${group.group}Properties`;
        if (!childTags.has(groupTag)) {
          throw new SkipEntry(
            `default properties for data type "${dataType.name}" are missing the ` +
              `<${groupTag}> element declared by the manifest`
          );
        }
      }
      defaultsByTransport.set(`datatype:${dataType.name}`, xml);
    })
  );

  // Only data types whose defaults arrived register. Both lists are derived in
  // declaration order — Promise.all settles in fetch-completion order.
  const availableDataTypes = dataTypes.filter((dataType) =>
    defaultsByTransport.has(`datatype:${dataType.name}`)
  );
  const unavailableDataTypes: DroppedContribution[] = dataTypes
    .filter((dataType) => notFoundDataTypes.has(dataType.name))
    .map((dataType) => ({
      // The registry's singular outcome kind, so rows from both drop causes
      // read the same on one status line.
      kind: "dataType",
      key: dataType.name,
      reason: DATA_TYPE_DEFAULTS_404_REASON,
    }));

  // Sorted for determinism — Promise.all insertion order follows fetch
  // completion, not panel order.
  const defaultsFingerprint = JSON.stringify(
    [...defaultsByTransport.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );

  if (getPluginDefinition(id)) {
    const stored = loadedFingerprints.get(id);
    if (stored?.entry === entryFingerprint && stored.defaults === defaultsFingerprint) {
      // Re-login to the same server with identical content: the definition is
      // already registered — replay the outcome captured at fresh load so a
      // partial (collision or 404-dropped data type) card stays partial with its dropped
      // rows, rather than silently upgrading to a clean "Loaded".
      // Report the registered count/status, NOT the raw declared contribution
      // count. skippedKinds is recomputed fresh here (it may differ from the
      // first load if only a reserved-v2 kind changed server-side, which the
      // entry fingerprint deliberately ignores). The dropped-rows array is
      // copied so successive re-logins don't hand the same reference to
      // multiple immutable status-store snapshots.
      if (generation === runGeneration) {
        recordRuntimePluginStatus({
          ...identityOf(entry),
          status: stored.outcome.status,
          contributionCount: stored.outcome.contributionCount,
          ...(stored.outcome.droppedContributions
            ? { droppedContributions: [...stored.outcome.droppedContributions] }
            : {}),
          ...(skippedKinds.length > 0 ? { skippedKinds } : {}),
        });
      }
      return;
    }
    if (stored?.entry === entryFingerprint) {
      throw new SkipEntry(
        "this extension's server-provided defaults changed — reload the page to pick them up"
      );
    }
    throw new SkipEntry(
      "a different version of this extension's web contributions is already registered " +
        "from a previous session — reload the page to load this one"
    );
  }

  // Nothing left to register once the 404'd data types are dropped: skip with
  // the accurate reason rather than record an empty "partial" registration.
  // Deliberately after the already-registered check, so a same-page switch
  // from a 26.9 server keeps its accurate "reload the page" reason — the data
  // type registered there is still in the dropdowns.
  const remainingContributions =
    connectorPanels.length +
    settingsPanels.length +
    transmissionModes.length +
    availableDataTypes.length +
    connectorSections.length +
    transformerSteps.length;
  if (unavailableDataTypes.length > 0 && remainingContributions === 0) {
    const names = unavailableDataTypes.map((d) => `"${d.key}"`).join(", ");
    throw new SkipEntry(
      `data type${unavailableDataTypes.length === 1 ? "" : "s"} ${names}: ` +
        DATA_TYPE_DEFAULTS_404_REASON
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

  if (transmissionModes.length > 0) {
    // No defaults fetch: the mode's element is built client-side from the
    // compiled defaults (there are no engine-served defaults for
    // <transmissionModeProperties>, even for built-ins). The SettingsSection
    // renders for every runtime mode so the attribution always shows.
    def.transmissionModes = transmissionModes.map((mode) => ({
      ...compileTransmissionMode(mode),
      SettingsSection: createRuntimeTransmissionModeSection(mode, entry),
    }));
  }

  if (availableDataTypes.length > 0) {
    // The PropertiesSection renders for every runtime data type (even a
    // group-less one) so the attribution always shows and Restore Defaults
    // stays available.
    def.dataTypes = availableDataTypes.map((dataType) => {
      // availableDataTypes holds only data types whose defaults were stored —
      // the fallback is unreachable, it only satisfies the string type.
      const defaultsXml = defaultsByTransport.get(`datatype:${dataType.name}`) ?? "";
      const compiled = compileDataType(dataType, defaultsXml);
      return {
        ...compiled,
        PropertiesSection: createRuntimeDataTypeSection(dataType, entry, compiled),
      };
    });
  }

  if (connectorSections.length > 0) {
    // No defaults fetch: the section's container element is built client-side
    // from the manifest defaults — the Swing client synthesizes it the same
    // way (panel.getDefaults()), and no engine endpoint serves it. The
    // compiled object + structural Section satisfies both the source and
    // destination plugin-definition contracts; registerPlugin stamps
    // serverPluginName as each section's pluginName, so the existing
    // extension-enablement gating in both tabs applies for free.
    const sourceSections = connectorSections
      .filter((section) => section.mode === "source")
      .map((section) => ({
        ...compileConnectorSection(section),
        ownedElementClass: section.propertiesClass,
        Section: createRuntimeConnectorPluginSection(section, entry),
      }));
    const destinationSections = connectorSections
      .filter((section) => section.mode === "destination")
      .map((section) => ({
        ...compileConnectorSection(section),
        ownedElementClass: section.propertiesClass,
        Section: createRuntimeConnectorPluginSection(section, entry),
      }));
    if (sourceSections.length > 0) def.sourceConnectorPlugins = sourceSections;
    if (destinationSections.length > 0) def.destinationConnectorPlugins = destinationSections;
  }

  if (transformerSteps.length > 0) {
    // No defaults fetch: the step's element is built client-side from the
    // declared fields, and the engine regenerates the deployed script from the
    // persisted properties (no engine endpoint serves step defaults). The
    // compiled definition registers through the existing first-wins
    // transformerSteps sink; registerPlugin stamps serverPluginName as each
    // step's pluginName, so extension-enablement gating in the Add dropdown
    // applies for free (XML-round-trip kinds are never license-gated).
    def.transformerSteps = transformerSteps.map((step) =>
      transformerStepContribution({
        ...compileTransformerStep(step),
        EditorPanel: createRuntimeTransformerStepEditor(step, entry),
      })
    );
  }

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

  // Report what actually registered, not what the manifest declared: a
  // first-wins collision (e.g. a settings tabKey or connector transportName
  // already taken) drops the contribution, and the status card must say so
  // instead of "Loaded". Deferred outcomes (channel registries
  // load lazily) count as accepted until their sink drains and says otherwise.
  // Data types dropped for a 404 before registration join the same rows, but
  // never reached registerPlugin, so they don't reduce the registered count.
  const registryDropped = report.outcomes
    .filter((o) => o.result === "dropped")
    .map((o) => ({ kind: o.kind, key: o.key, reason: o.reason ?? "dropped" }));
  const dropped = [...unavailableDataTypes, ...registryDropped];
  const outcome: RegisteredOutcome = {
    status: dropped.length > 0 ? "partial" : "loaded",
    contributionCount: report.outcomes.length - registryDropped.length,
    ...(dropped.length > 0 ? { droppedContributions: dropped } : {}),
  };
  // Captured alongside the fingerprints so the re-login path replays it rather
  // than the raw declared count.
  loadedFingerprints.set(id, {
    entry: entryFingerprint,
    defaults: defaultsFingerprint,
    outcome,
  });
  recordRuntimePluginStatus({
    ...identityOf(entry),
    status: outcome.status,
    contributionCount: outcome.contributionCount,
    // Copy so the captured outcome and the immutable status-store row never
    // share an array reference.
    ...(outcome.droppedContributions
      ? { droppedContributions: [...outcome.droppedContributions] }
      : {}),
    ...(skippedKinds.length > 0 ? { skippedKinds } : {}),
  });
  report.onDeferredOutcome((deferred) => {
    if (deferred.result !== "dropped") return;
    const droppedRow: DroppedContribution = {
      kind: deferred.kind,
      key: deferred.key,
      reason: deferred.reason ?? "dropped",
    };
    // The drop is permanent for the page lifetime. Fold it into the captured
    // outcome so a later re-login replays the downgraded (partial) card — this
    // must happen regardless of the current generation, since the settlement
    // can land after a teardown/re-login.
    const stored = loadedFingerprints.get(id);
    if (stored) {
      stored.outcome = {
        status: "partial",
        contributionCount: Math.max(0, stored.outcome.contributionCount - 1),
        droppedContributions: [...(stored.outcome.droppedContributions ?? []), droppedRow],
      };
    }
    // Downgrade the currently-visible row too. updateRuntimePluginStatus
    // matches by name and no-ops when no row exists, so a post-teardown late
    // settlement can't resurrect a stale row (no generation gate needed).
    // Names collide across duplicate entries: a same-named entry that lost the
    // dedup is a separate "skipped" row — leave it untouched; only this entry's
    // own registered (loaded/partial) row downgrades.
    updateRuntimePluginStatus(entry.name, (row) => {
      if (row.status === "skipped") return row;
      return {
        ...row,
        status: "partial",
        contributionCount: Math.max(0, row.contributionCount - 1),
        droppedContributions: [...(row.droppedContributions ?? []), droppedRow],
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

/**
 * Best-effort read of `manifest.minWebAdminVersion` from a raw, UNVALIDATED
 * entry. Returns the skip reason when the floor is newer than this build,
 * else null. This is what makes the contract's evolution mechanics true: a
 * manifest using future grammar inside an implemented kind must skip with the
 * author's declared version floor, not with the strict validator's
 * "unknown key" (validation runs after this gate). Malformed values return
 * null and fall through to strict validation, which reports them properly.
 */
function preValidationVersionGate(raw: unknown): string | null {
  if (raw === null || typeof raw !== "object") return null;
  const manifest = (raw as Record<string, unknown>).manifest;
  if (manifest === null || typeof manifest !== "object") return null;
  const min = (manifest as Record<string, unknown>).minWebAdminVersion;
  if (typeof min !== "string" || !VERSION_PATTERN.test(min)) return null;
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
  if (!appVersion || compareVersions(appVersion, min) < 0) {
    return (
      `requires WebAdmin ${min} or newer ` + `(this build is ${appVersion || "of unknown version"})`
    );
  }
  return null;
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
