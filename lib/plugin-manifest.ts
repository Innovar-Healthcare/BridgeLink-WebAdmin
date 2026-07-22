/**
 * Declarative plugin manifest — `definePlugin()` / `registerPlugin()`.
 *
 * One exported `PluginDefinition` fully describes a WebUI plugin: its id, the
 * server plugin gate (declared once), and every contribution it makes to the
 * app's extension points. The generated `plugins/index.ts` imports each plugin
 * module and passes it to `registerPluginModule()`, which registers the
 * default-exported definition. The pre-existing `register*()` functions remain
 * the internal implementation (and keep working as deprecated side-effect
 * entry points until every plugin is migrated).
 *
 * ── Authoring a plugin (the one documented registration surface) ─────────────
 *
 *   // plugins/<my-plugin>/index.ts
 *   import { definePlugin } from "@/lib/plugin-manifest";
 *   export default definePlugin({
 *     id: "my-plugin",
 *     serverPluginName: "My Server Plugin", // plugin.xml <name>; omit if ungated
 *     settingsTabs: [{ tabKey: "my-plugin", tabLabel: "My Plugin", ... }],
 *     routeHandlers: [
 *       { method: "POST", path: "/api/my-plugin", loader: () => import("./handler").then((m) => m.POST) },
 *     ],
 *     slots: { "editor.overlay": MyOverlay },
 *   });
 *
 * ── Duplicate semantics (uniform, enforced here) ──────────────────────────────
 *
 *  1. Plugin level: registering an id twice is a whole-plugin no-op (dev warn).
 *     This makes double-evaluation (tests importing both a plugin module and
 *     the barrel, HMR) harmless.
 *  2. Contribution level: idempotent by key, FIRST-WINS, dev warn on duplicate.
 *     Keys per surface: page slug, settings tabKey, channel-editor tab key,
 *     Monaco action id, reference-panel tab key, reference category id, route
 *     path, "METHOD path", connector transportName, data type name,
 *     transmission mode name, transformer step type, attachment viewer name,
 *     slot name. Connector plugin sections have no natural key and are
 *     covered by the plugin-id guard alone.
 *     Built-in seeding behavior inside the underlying registries is unchanged —
 *     this rule governs the registerPlugin() fan-out only.
 *
 * ── Gating ───────────────────────────────────────────────────────
 *
 *  `serverPluginName` is the gate, declared once. `registerPlugin()` stamps it
 *  as `pluginName` onto every enumeration/selection contribution that doesn't
 *  set its own: pages, settings tabs, channel editor tabs, Monaco editor
 *  actions, reference panel tabs, reference categories, connector types,
 *  connector plugin sections, data types, transmission modes, transformer
 *  steps, and attachment viewers. Read sites filter by `pluginName` against the
 *  installed-plugins cache (lib/plugin-gating.ts), so a dormant plugin whose
 *  server extension is absent/disabled contributes zero visible UI. Single-fill
 *  `slots` are gated by their owning plugin's gate via `useSlotEnabled()` /
 *  `slotSurfaceEnabled()`.
 *
 *  Lookup-by-key is deliberately NOT gated — resolving a channel's existing
 *  transportName / data type / step xmlTag to its (compiled-in) definition
 *  always succeeds, so channel XML authored on a server that has the plugin
 *  still renders and round-trips without data loss on a server that doesn't.
 *
 *  Intentionally ungated surfaces (they carry no `pluginName`):
 *   - `routePages` / `routeHandlers` — a route like the OIDC `/auth/callback`
 *     must render before an authenticated session (and thus the extensions
 *     API) exists; these are infrastructure, not user-facing chrome.
 *   - `ssoLogin` — the login page is pre-auth, so the installed-plugins cache
 *     (which needs a session) can't gate it; OIDC self-gates via its own public
 *     discovery/config endpoint.
 *   - `permissionsProvider` — an RBAC hook whose contract is to fail open; it
 *     resolves before gating state is available.
 *
 * ── Bundle hygiene ────────────────────────────────────────────────────────────
 *
 *  Route handlers accept ONLY lazy loader thunks — the manifest has no eager
 *  variant, so server-only handler modules can never enter the client page-load
 *  graph. Imports from `app/` in this file are type-only; runtime
 *  delivery to the channel-editor registries goes through the contribution
 *  sink below so this module never drags those registries' built-ins (React
 *  component graphs) into the login/route bundles.
 */

import type { ComponentType } from "react";
import {
  pluginRegistry,
  registerChannelEditorTab,
  registerMonacoEditorActions,
  registerPage,
  registerPermissionsProvider,
  registerReferenceCategory,
  registerReferencePanelTab,
  registerRouteHandlerLazy,
  registerRoutePage,
  registerSettingsTab,
  registerSsoLogin,
  type ChannelEditorTabPlugin,
  type MonacoEditorAction,
  type PagePlugin,
  type PermissionLevel,
  type ReferenceCategoryPlugin,
  type ReferencePanelTabPlugin,
  type RouteHandler,
  type SettingsPluginTab,
  type SsoLoginProps,
} from "@/lib/plugin-registry";
import { setSlot, type SlotTypeMap } from "@/lib/plugin-slots";
import { logWarn } from "@/lib/dev-logger";
import type {
  ConnectorDefinition,
  ConnectorPluginDefinition,
} from "@/app/(app)/channels/_connectors/types";
import type {
  DestinationConnectorDefinition,
  DestinationPluginDefinition,
} from "@/app/(app)/channels/_connectors/destinations/types";
import type { DataTypeDefinition } from "@/app/(app)/channels/_datatypes/types";
import type { TransmissionModeDefinition } from "@/app/(app)/channels/_connectors/shared/transmission-modes/types";
import type {
  TransformerStepBase,
  TransformerStepDefinition,
} from "@/app/(app)/channels/_lib/filter-transformer-steps/types";
import type { AttachmentViewerDefinition } from "@/components/messages/attachment-viewers/types";

// ── Contribution shapes ────────────────────────────────────────────────────────

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/**
 * A server-side route handler contribution. `loader` is a lazy import thunk —
 * the handler module (and its server-only deps) is imported on first request,
 * never at plugin-registration time. See.
 */
export interface RouteHandlerContribution {
  method: HttpMethod;
  /** Core route path the handler is dispatched under, e.g. "/api/oidc-discovery". */
  path: string;
  loader: () => Promise<RouteHandler>;
}

/** A page registered against a fixed core App Router path (e.g. "/auth/callback"). */
export interface RoutePageContribution {
  path: string;
  component: ComponentType;
}

/** SSO login section + mandatory post-credential-login verification hook. */
export interface SsoLoginContribution {
  section: ComponentType<SsoLoginProps>;
  postLoginVerify: (serverUrl: string, username: string) => Promise<void>;
}

/**
 * Settings tab contribution — same as SettingsPluginTab, but `pluginName` may
 * be omitted and is then stamped from the definition's `serverPluginName`
 * (empty string = ungated, mirroring the Settings page's `""` bypass).
 */
export type SettingsTabContribution = Omit<SettingsPluginTab, "pluginName"> & {
  pluginName?: string;
};

/** Source connector contribution — a ConnectorDefinition with its registry key. */
export type SourceConnectorContribution = ConnectorDefinition & { transportName: string };

/** Destination connector contribution — definition plus its registry key. */
export type DestinationConnectorContribution = DestinationConnectorDefinition & {
  transportName: string;
};

/**
 * Transformer step contribution. The registry stores definitions by their base
 * step type; a definition written against a concrete step shape needs the same
 * boundary cast `registerTransformerStep()` performs — use
 * `transformerStepContribution()` below.
 */
export type TransformerStepContribution = TransformerStepDefinition<TransformerStepBase>;

/**
 * Widen a concretely-typed transformer step definition to the registry's base
 * type. Mirrors the internal cast in `registerTransformerStep()` — callers
 * retrieve a well-typed definition back via `resolveStep<TStep>()`.
 */
export function transformerStepContribution<TStep extends TransformerStepBase>(
  def: TransformerStepDefinition<TStep>
): TransformerStepContribution {
  return def as unknown as TransformerStepContribution;
}

// ── The manifest ───────────────────────────────────────────────────────────────

/**
 * One declarative description of everything a plugin contributes.
 * Every field except `id` is optional — a plugin declares only the surfaces
 * it uses. See the authoring example in the module doc above.
 */
export interface PluginDefinition {
  /** Unique WebUI plugin id — by convention the `plugins/<dir>` name. */
  id: string;
  /**
   * Server plugin name exactly as reported by `GET /extensions/plugins/`
   * (the Java plugin.xml `<name>`). Declared once; stamped onto gate-aware
   * contributions that don't set their own `pluginName`. Omit for plugins
   * with no server-side half (their UI is always visible).
   */
  serverPluginName?: string;
  /**
   * License-entitlement gate. The plugin's `pluginId` string as
   * reported by the License Manager's `plugin-license-statuses` endpoint (the
   * license-product name, e.g. `"SSL Settings"` — NOT necessarily the WebUI
   * `id`). When set, the plugin's license-gated surfaces are hidden unless the
   * server reports this id Active/Expiring Soon, in addition to any
   * `serverPluginName` enablement gate. Declared once; stamped onto license-
   * gated contributions (pages, settings tabs, channel-editor tabs, Monaco
   * actions, reference panel tabs, reference categories, connector plugin
   * sections) that don't set their own. Omit for core / unlicensed plugins
   * (their UI is not license-gated). The XML-round-trip-sensitive kinds
   * (connector types, data types, transmission modes, transformer steps,
   * attachment viewers) are intentionally NOT license-gated.
   */
  licensedPluginId?: string;

  // ── Main registry surfaces (lib/plugin-registry.ts) ──
  /** Full pages at /p/{slug} + sidebar nav items. */
  pages?: PagePlugin[];
  /** Tabs on the Settings page. */
  settingsTabs?: SettingsTabContribution[];
  /** Extra Channel Editor tabs (shown when editing an existing channel). */
  channelEditorTabs?: ChannelEditorTabPlugin[];
  /** Monaco editor context-menu actions. */
  monacoEditorActions?: MonacoEditorAction[];
  /** Extra tabs in the filter/transformer Reference Panel. */
  referencePanelTabs?: ReferencePanelTabPlugin[];
  /** Extra categories in the Reference Panel's built-in Reference tab. */
  referenceCategories?: ReferenceCategoryPlugin[];
  /** Pages rendered by fixed core route files (e.g. /auth/callback). */
  routePages?: RoutePageContribution[];
  /** Server-side route handlers — lazy loaders only. */
  routeHandlers?: RouteHandlerContribution[];
  /** SSO login section below the credentials form (single-fill). */
  ssoLogin?: SsoLoginContribution;
  /** RBAC permissions provider (single-fill). */
  permissionsProvider?: () => Promise<Map<string, PermissionLevel> | null>;

  // ── Channel-scoped registries (delivered via the contribution sink) ──
  /** New source connector types (Connector Type dropdown). */
  sourceConnectors?: SourceConnectorContribution[];
  /** New destination connector types. */
  destinationConnectors?: DestinationConnectorContribution[];
  /** Cross-cutting sections injected into source connector panels. */
  sourceConnectorPlugins?: ConnectorPluginDefinition[];
  /** Cross-cutting sections injected into destination connector panels. */
  destinationConnectorPlugins?: DestinationPluginDefinition[];
  /** New data types (inbound/outbound dropdowns, Monaco token markers, ...). */
  dataTypes?: DataTypeDefinition[];
  /** New TCP transmission modes (MLLP-style framing). */
  transmissionModes?: TransmissionModeDefinition[];
  /** New filter/transformer step types. */
  transformerSteps?: TransformerStepContribution[];
  /** Attachment viewers for the message browser. */
  attachmentViewers?: AttachmentViewerDefinition[];

  // ── Named single-fill mount points (lib/plugin-slots.ts) ──
  /** Typed named slots — toolbar buttons, dialogs, post-save handlers, overlays. */
  slots?: Partial<SlotTypeMap>;
}

/**
 * Identity helper that types and documents a plugin definition. Each plugin's
 * `index.ts` default-exports `definePlugin({...})` and performs no other
 * module-scope side effects.
 */
export function definePlugin(def: PluginDefinition): PluginDefinition {
  return def;
}

// ── Contribution sink (lib ↔ app decoupling) ──────────────────────────────────
//
// The channel-scoped registries live under app/(app)/channels/... and seed
// their built-ins (React component graphs) at module scope. This module is
// reachable from the login page and server route files via the plugin barrel,
// so it must never import those registries at runtime. Instead each registry's
// index.ts connects a sink here at its own module scope; contributions
// dispatched before the sink connects are queued and drained on connect.
// Consumers always read through the registry index modules, so a queued
// contribution is guaranteed delivered before any read.

/** Contribution kind → item type delivered to that kind's sink. */
export interface ContributionKindMap {
  sourceConnectors: SourceConnectorContribution;
  destinationConnectors: DestinationConnectorContribution;
  sourceConnectorPlugins: ConnectorPluginDefinition;
  destinationConnectorPlugins: DestinationPluginDefinition;
  dataTypes: DataTypeDefinition;
  transmissionModes: TransmissionModeDefinition;
  transformerSteps: TransformerStepContribution;
  attachmentViewers: AttachmentViewerDefinition;
}

export type ContributionKind = keyof ContributionKindMap;

/**
 * Sinks return whether the contribution was ACCEPTED into the registry —
 * `false` means a first-wins duplicate dropped it. The result feeds the
 * registration report so callers like the runtime plugin loader
 * can surface dropped contributions instead of reporting "loaded".
 */
type ContributionSink<K extends ContributionKind> = (
  item: ContributionKindMap[K],
  pluginId: string
) => boolean;

// Params are contravariant, so `never` is the storage type every concrete sink
// is assignable to without casting; dispatch() re-narrows per kind.
const sinks = new Map<ContributionKind, ContributionSink<never>>();
const pending = new Map<
  ContributionKind,
  { item: unknown; pluginId: string; settle?: (accepted: boolean) => void }[]
>();

/**
 * Connect the sink for one contribution kind. Called at module scope by the
 * owning registry's index.ts (e.g. the data type registry connects
 * "dataTypes"). Drains any contributions queued before the registry loaded,
 * settling each queued item's deferred registration outcome.
 */
export function connectContributionSink<K extends ContributionKind>(
  kind: K,
  sink: ContributionSink<K>
): void {
  sinks.set(kind, sink);
  const queued = pending.get(kind);
  if (!queued) return;
  pending.delete(kind);
  for (const entry of queued) {
    // Safe by construction: the queue is keyed by kind and only written by
    // dispatch() with matching item types.
    const accepted = sink(entry.item as ContributionKindMap[K], entry.pluginId);
    entry.settle?.(accepted);
  }
}

/** One channel-scoped item paired with its live report outcome. */
interface DispatchEntry<K extends ContributionKind> {
  item: ContributionKindMap[K];
  outcome: ContributionOutcome;
}

const FIRST_WINS_REASON = "already registered (first-wins)";

function dispatch<K extends ContributionKind>(
  kind: K,
  entries: DispatchEntry<K>[],
  pluginId: string,
  notifyDeferred: (outcome: ContributionOutcome) => void
): void {
  if (entries.length === 0) return;
  const sink = sinks.get(kind) as ContributionSink<K> | undefined;
  if (sink) {
    for (const { item, outcome } of entries) {
      const accepted = sink(item, pluginId);
      outcome.result = accepted ? "accepted" : "dropped";
      if (!accepted) outcome.reason = FIRST_WINS_REASON;
    }
    return;
  }
  // Registry not evaluated yet (channel registries load with the channels
  // chunk) — queue, report "deferred", and settle the outcome at drain time.
  // A drain may never happen this session (the user never opens Channels);
  // callers treat a never-settled "deferred" as optimistically accepted.
  const queue = pending.get(kind) ?? [];
  for (const { item, outcome } of entries) {
    outcome.result = "deferred";
    queue.push({
      item,
      pluginId,
      settle: (accepted) => {
        outcome.result = accepted ? "accepted" : "dropped";
        if (!accepted) outcome.reason = FIRST_WINS_REASON;
        notifyDeferred(outcome);
      },
    });
  }
  pending.set(kind, queue);
}

// ── Registration ───────────────────────────────────────────────────────────────

const definitions = new Map<string, PluginDefinition>();

/**
 * Dev-warn for a duplicate contribution key. Also used by the contribution
 * sinks in the channel-scoped registries so first-wins messaging is uniform.
 */
export function warnDuplicateContribution(pluginId: string, kind: string, key: string): void {
  logWarn(
    "plugin-manifest",
    `plugin "${pluginId}": ${kind} "${key}" is already registered — ignoring duplicate (first-wins)`
  );
}

// ── Registration report ────────────────────────────────────────────

export type ContributionResult = "accepted" | "dropped" | "deferred";

/**
 * Per-contribution registration outcome. `kind`/`key` use the same vocabulary
 * as `listContributions()`. Outcome objects are LIVE: a "deferred" outcome
 * (channel-scoped kind whose registry hasn't evaluated yet) mutates to its
 * final result when the sink drains — subscribe via
 * `RegistrationReport.onDeferredOutcome` to observe the settlement.
 */
export interface ContributionOutcome {
  kind: string;
  key: string;
  result: ContributionResult;
  /** Present when dropped. */
  reason?: string;
}

/**
 * What `registerPlugin()` did with each declared contribution. Existing
 * compiled-in call sites can (and do) ignore the return value.
 */
export interface RegistrationReport {
  pluginId: string;
  outcomes: ContributionOutcome[];
  /**
   * Fires once per deferred outcome when its registry's sink drains — which
   * may never happen this session (the channels chunk loads lazily). Callers
   * treat a never-settled "deferred" as optimistically accepted and only
   * downgrade on a "dropped" settlement.
   */
  onDeferredOutcome(cb: (outcome: ContributionOutcome) => void): void;
}

/**
 * Register a plugin from its declarative definition. Synchronous — safe to
 * call at module scope; the whole fan-out completes before `pluginsReady`
 * resolves. Duplicate ids are a whole-plugin no-op (see module doc).
 *
 * Returns a report of what happened to each declared contribution: accepted,
 * dropped (first-wins duplicate), or deferred (channel-scoped registry not
 * evaluated yet). See RegistrationReport.
 */
export function registerPlugin(def: PluginDefinition): RegistrationReport {
  if (definitions.has(def.id)) {
    logWarn("plugin-manifest", `plugin "${def.id}" is already registered — ignoring duplicate`);
    return {
      pluginId: def.id,
      outcomes: contributionsOf(def).map((c) => ({
        ...c,
        result: "dropped" as const,
        reason: `plugin "${def.id}" is already registered`,
      })),
      onDeferredOutcome: () => undefined,
    };
  }
  definitions.set(def.id, def);

  const outcomes: ContributionOutcome[] = [];
  const deferredListeners: ((outcome: ContributionOutcome) => void)[] = [];
  const notifyDeferred = (outcome: ContributionOutcome): void => {
    for (const listener of deferredListeners) listener(outcome);
  };
  const record = (
    kind: string,
    key: string,
    result: ContributionResult,
    reason?: string
  ): ContributionOutcome => {
    const outcome: ContributionOutcome = { kind, key, result, ...(reason ? { reason } : {}) };
    outcomes.push(outcome);
    return outcome;
  };

  const gate = def.serverPluginName;
  const license = def.licensedPluginId;

  for (const page of def.pages ?? []) {
    if (pluginRegistry.pages.some((p) => p.slug === page.slug)) {
      warnDuplicateContribution(def.id, "page", page.slug);
      record("page", page.slug, "dropped", FIRST_WINS_REASON);
      continue;
    }
    registerPage({
      ...page,
      pluginName: page.pluginName ?? gate,
      licensedPluginId: page.licensedPluginId ?? license,
    });
    record("page", page.slug, "accepted");
  }

  for (const tab of def.settingsTabs ?? []) {
    if (pluginRegistry.settingsTabs.some((t) => t.tabKey === tab.tabKey)) {
      warnDuplicateContribution(def.id, "settings tab", tab.tabKey);
      record("settingsTab", tab.tabKey, "dropped", FIRST_WINS_REASON);
      continue;
    }
    // "" = ungated, mirroring the Settings page's empty-pluginName bypass.
    registerSettingsTab({
      ...tab,
      pluginName: tab.pluginName ?? gate ?? "",
      licensedPluginId: tab.licensedPluginId ?? license,
    });
    record("settingsTab", tab.tabKey, "accepted");
  }

  for (const tab of def.channelEditorTabs ?? []) {
    if (pluginRegistry.channelEditorTabs.some((t) => t.key === tab.key)) {
      warnDuplicateContribution(def.id, "channel editor tab", tab.key);
      record("channelEditorTab", tab.key, "dropped", FIRST_WINS_REASON);
      continue;
    }
    registerChannelEditorTab({
      ...tab,
      pluginName: tab.pluginName ?? gate,
      licensedPluginId: tab.licensedPluginId ?? license,
    });
    record("channelEditorTab", tab.key, "accepted");
  }

  for (const action of def.monacoEditorActions ?? []) {
    if (pluginRegistry.monacoEditorActions.some((a) => a.id === action.id)) {
      warnDuplicateContribution(def.id, "Monaco editor action", action.id);
      record("monacoEditorAction", action.id, "dropped", FIRST_WINS_REASON);
      continue;
    }
    registerMonacoEditorActions([
      {
        ...action,
        pluginName: action.pluginName ?? gate,
        licensedPluginId: action.licensedPluginId ?? license,
      },
    ]);
    record("monacoEditorAction", action.id, "accepted");
  }

  for (const tab of def.referencePanelTabs ?? []) {
    if (pluginRegistry.referencePanelTabs.some((t) => t.key === tab.key)) {
      warnDuplicateContribution(def.id, "reference panel tab", tab.key);
      record("referencePanelTab", tab.key, "dropped", FIRST_WINS_REASON);
      continue;
    }
    registerReferencePanelTab({
      ...tab,
      pluginName: tab.pluginName ?? gate,
      licensedPluginId: tab.licensedPluginId ?? license,
    });
    record("referencePanelTab", tab.key, "accepted");
  }

  for (const category of def.referenceCategories ?? []) {
    if (pluginRegistry.referenceCategories.some((c) => c.id === category.id)) {
      warnDuplicateContribution(def.id, "reference category", category.id);
      record("referenceCategory", category.id, "dropped", FIRST_WINS_REASON);
      continue;
    }
    registerReferenceCategory({
      ...category,
      pluginName: category.pluginName ?? gate,
      licensedPluginId: category.licensedPluginId ?? license,
    });
    record("referenceCategory", category.id, "accepted");
  }

  for (const routePage of def.routePages ?? []) {
    if (pluginRegistry.routePages.some((p) => p.path === routePage.path)) {
      warnDuplicateContribution(def.id, "route page", routePage.path);
      record("routePage", routePage.path, "dropped", FIRST_WINS_REASON);
      continue;
    }
    registerRoutePage(routePage.path, routePage.component);
    record("routePage", routePage.path, "accepted");
  }

  for (const handler of def.routeHandlers ?? []) {
    const key = `${handler.method} ${handler.path}`;
    if (pluginRegistry.routeHandlers.has(key)) {
      warnDuplicateContribution(def.id, "route handler", key);
      record("routeHandler", key, "dropped", FIRST_WINS_REASON);
      continue;
    }
    registerRouteHandlerLazy(handler.method, handler.path, handler.loader);
    record("routeHandler", key, "accepted");
  }

  if (def.ssoLogin) {
    if (pluginRegistry.ssoLoginSection !== null) {
      warnDuplicateContribution(def.id, "SSO login section", "sso-login");
      record("ssoLogin", "sso-login", "dropped", FIRST_WINS_REASON);
    } else {
      registerSsoLogin(def.ssoLogin.section, def.ssoLogin.postLoginVerify);
      record("ssoLogin", "sso-login", "accepted");
    }
  }

  if (def.permissionsProvider) {
    if (pluginRegistry.permissionsProvider !== null) {
      warnDuplicateContribution(def.id, "permissions provider", "permissions-provider");
      record("permissionsProvider", "permissions-provider", "dropped", FIRST_WINS_REASON);
    } else {
      registerPermissionsProvider(def.permissionsProvider);
      record("permissionsProvider", "permissions-provider", "accepted");
    }
  }

  // Every channel-scoped contribution kind is server-enablement gated
  //: stamp the definition's `serverPluginName` as each item's
  // `pluginName` when the item doesn't declare its own. Read sites filter
  // enumeration surfaces (dropdowns, add-menus, viewers) by this tag while
  // lookup-by-key stays ungated, so existing channel XML always round-trips.
  const gated = <T extends { pluginName?: string }>(items: T[] | undefined): T[] | undefined =>
    items?.map((item) => ({ ...item, pluginName: item.pluginName ?? gate }));

  // Connector plugin sections also carry the license gate. The other
  // channel-scoped kinds (connector types, data types, transmission modes,
  // transformer steps, attachment viewers) stay enablement-only — they are
  // XML-round-trip-sensitive and no licensed plugin contributes them.
  const licenseGated = <T extends { pluginName?: string; licensedPluginId?: string }>(
    items: T[] | undefined
  ): T[] | undefined =>
    items?.map((item) => ({
      ...item,
      pluginName: item.pluginName ?? gate,
      licensedPluginId: item.licensedPluginId ?? license,
    }));

  // Pair each channel-scoped item with a report outcome up front; dispatch
  // finalizes it synchronously (sink connected) or settles it at drain time.
  const entriesOf = <K extends ContributionKind>(
    items: ContributionKindMap[K][] | undefined,
    outcomeKind: string,
    keyOf: (item: ContributionKindMap[K], index: number) => string
  ): DispatchEntry<K>[] =>
    (items ?? []).map((item, i) => ({
      item,
      outcome: record(outcomeKind, keyOf(item, i), "deferred"),
    }));

  dispatch(
    "sourceConnectors",
    entriesOf(gated(def.sourceConnectors), "sourceConnector", (c) => c.transportName),
    def.id,
    notifyDeferred
  );
  dispatch(
    "destinationConnectors",
    entriesOf(gated(def.destinationConnectors), "destinationConnector", (c) => c.transportName),
    def.id,
    notifyDeferred
  );
  dispatch(
    "sourceConnectorPlugins",
    entriesOf(
      licenseGated(def.sourceConnectorPlugins),
      "sourceConnectorPlugin",
      (p, i) => p.pluginName ?? `[${i}]`
    ),
    def.id,
    notifyDeferred
  );
  dispatch(
    "destinationConnectorPlugins",
    entriesOf(
      licenseGated(def.destinationConnectorPlugins),
      "destinationConnectorPlugin",
      (p, i) => p.pluginName ?? `[${i}]`
    ),
    def.id,
    notifyDeferred
  );
  dispatch(
    "dataTypes",
    entriesOf(gated(def.dataTypes), "dataType", (d) => d.name),
    def.id,
    notifyDeferred
  );
  dispatch(
    "transmissionModes",
    entriesOf(gated(def.transmissionModes), "transmissionMode", (m) => m.name),
    def.id,
    notifyDeferred
  );
  dispatch(
    "transformerSteps",
    entriesOf(gated(def.transformerSteps), "transformerStep", (s) => s.type),
    def.id,
    notifyDeferred
  );
  dispatch(
    "attachmentViewers",
    entriesOf(gated(def.attachmentViewers), "attachmentViewer", (v) => v.name),
    def.id,
    notifyDeferred
  );

  if (def.slots) {
    for (const name of Object.keys(def.slots) as (keyof SlotTypeMap)[]) {
      const value = def.slots[name];
      if (value === undefined) continue;
      if (setSlot(name, value, def.id)) {
        record("slot", name, "accepted");
      } else {
        record("slot", name, "dropped", FIRST_WINS_REASON);
      }
    }
  }

  return {
    pluginId: def.id,
    outcomes,
    onDeferredOutcome: (cb) => deferredListeners.push(cb),
  };
}

/**
 * Module-tolerant registration entry point used by the generated
 * plugins/index.ts. Registers the module's default-exported definition when
 * present; a module without one (a not-yet-migrated plugin that registers via
 * import-time `register*()` side effects) is a no-op here.
 */
export interface PluginModule {
  default?: PluginDefinition;
}

export function registerPluginModule(mod: PluginModule): void {
  if (mod.default) registerPlugin(mod.default);
}

// ── Introspection ──────────────────────────────────────────────────────────────

/** All registered plugin definitions, in registration order. */
export function getRegisteredPluginDefinitions(): readonly PluginDefinition[] {
  return [...definitions.values()];
}

/** The stored definition for one plugin id, if registered. */
export function getPluginDefinition(id: string): PluginDefinition | undefined {
  return definitions.get(id);
}

/**
 * True when at least one registered plugin declares a `licensedPluginId` —
 * at the definition level OR on any individual license-gated contribution
 *. The license-status store (lib/plugin-license.ts) uses this to
 * skip its fetch entirely on core-only / open-source installs where no plugin
 * is license-gated, so an absent License Manager is never probed.
 *
 * ORDERING INVARIANT: this is evaluated lazily from the store's first hook
 * read, which is safe because all plugin registration happens at module scope
 * (the generated plugins/index.ts is imported by the app-shell layouts), so it
 * completes before any gated component renders and the answer is stable for the
 * session. (lazy plugin components) PRESERVED this invariant: only the
 * component PAYLOAD is deferred (via lazyPluginComponent → next/dynamic), while
 * `definePlugin({...})` — including `licensedPluginId` and every other metadata
 * field — still runs synchronously at registration. So `hasLicenseGatedPlugins`
 * still sees license gates before first render. If registration itself ever
 * becomes lazy/async, a false→true flip after first render would NOT re-trigger
 * the store's fetch — the lazy loader must then poke lib/plugin-license.ts (or
 * this guard must be replaced) as part of that work.
 */
export function hasLicenseGatedPlugins(): boolean {
  for (const def of definitions.values()) {
    if (def.licensedPluginId) return true;
    // Per-contribution overrides — a plugin may license-gate a single surface
    // without a definition-level id; the fetch must still fire for it.
    const gatedKinds = [
      def.pages,
      def.settingsTabs,
      def.channelEditorTabs,
      def.monacoEditorActions,
      def.referencePanelTabs,
      def.referenceCategories,
      def.sourceConnectorPlugins,
      def.destinationConnectorPlugins,
    ];
    for (const items of gatedKinds) {
      if (items?.some((item) => item.licensedPluginId)) return true;
    }
  }
  return false;
}

/** One contribution of a plugin, identified by extension-point kind and key. */
export interface PluginContribution {
  kind: string;
  key: string;
}

/**
 * List every contribution a registered plugin declares — the introspection
 * surface for debugging and for central gating enforcement.
 */
export function listContributions(id: string): PluginContribution[] {
  const def = definitions.get(id);
  return def ? contributionsOf(def) : [];
}

/** Every contribution a definition declares, registered or not. */
function contributionsOf(def: PluginDefinition): PluginContribution[] {
  const out: PluginContribution[] = [];
  const add = (kind: string, key: string) => out.push({ kind, key });

  for (const p of def.pages ?? []) add("page", p.slug);
  for (const t of def.settingsTabs ?? []) add("settingsTab", t.tabKey);
  for (const t of def.channelEditorTabs ?? []) add("channelEditorTab", t.key);
  for (const a of def.monacoEditorActions ?? []) add("monacoEditorAction", a.id);
  for (const t of def.referencePanelTabs ?? []) add("referencePanelTab", t.key);
  for (const c of def.referenceCategories ?? []) add("referenceCategory", c.id);
  for (const p of def.routePages ?? []) add("routePage", p.path);
  for (const h of def.routeHandlers ?? []) add("routeHandler", `${h.method} ${h.path}`);
  if (def.ssoLogin) add("ssoLogin", "sso-login");
  if (def.permissionsProvider) add("permissionsProvider", "permissions-provider");
  for (const c of def.sourceConnectors ?? []) add("sourceConnector", c.transportName);
  for (const c of def.destinationConnectors ?? []) add("destinationConnector", c.transportName);
  def.sourceConnectorPlugins?.forEach((p, i) =>
    add("sourceConnectorPlugin", p.pluginName ?? `[${i}]`)
  );
  def.destinationConnectorPlugins?.forEach((p, i) =>
    add("destinationConnectorPlugin", p.pluginName ?? `[${i}]`)
  );
  for (const d of def.dataTypes ?? []) add("dataType", d.name);
  for (const m of def.transmissionModes ?? []) add("transmissionMode", m.name);
  for (const s of def.transformerSteps ?? []) add("transformerStep", s.type);
  for (const v of def.attachmentViewers ?? []) add("attachmentViewer", v.name);
  if (def.slots) for (const name of Object.keys(def.slots)) add("slot", name);

  return out;
}

// ── Test helpers ───────────────────────────────────────────────────────────────

/**
 * Test-only helpers (mirrors lib/installed-plugins.ts convention). Clears the
 * definition store and pending queues; connected sinks stay connected. Does
 * NOT undo contributions already fanned out into the underlying registries.
 */
export const __testing = {
  reset(): void {
    definitions.clear();
    pending.clear();
  },
  /**
   * Disconnect all contribution sinks so a test can exercise the queued
   * ("deferred") dispatch path even after another test connected a sink for
   * the same kind. Production never disconnects sinks.
   */
  resetSinks(): void {
    sinks.clear();
  },
};
