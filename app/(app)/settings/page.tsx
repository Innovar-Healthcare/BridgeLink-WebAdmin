"use client";

/**
 * Settings page — mirrors Java's SettingsPane with multiple sub-tabs.
 *
 * Built-in tabs: Server, Administrator, Tags, Configuration Map, Resources.
 *
 * Plugin tabs are added dynamically, mirroring Java's SettingsPane.loadPluginPanels()
 * which only adds tabs for plugins found in LoadedExtensions.getSettingsPanelPlugins()
 * (i.e., only those that are installed AND enabled).
 *
 * Enablement comes from the shared installed-plugins store (lib/installed-plugins.ts,
 * via useEnabledPluginNames) — the same source the Channels/sidebar/Monaco surfaces
 * gate on, so there's one fetch and one source of truth, not a Settings-private one.
 * A tab that is enabled + permitted but not licensed/ is shown
 * dimmed with a lock icon and its content replaced by the upgrade prompt.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DockableToolbar } from "@/components/dockable-toolbar";
import { useToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import { ServerTab } from "@/components/settings/server-tab";
import type { ServerTabActions } from "@/components/settings/server-tab";
import { AdminTab } from "@/components/settings/admin-tab";
import type { AdminTabActions } from "@/components/settings/admin-tab";
import { TagsTab } from "@/components/settings/tags-tab";
import type { TagsTabActions } from "@/components/settings/tags-tab";
import { ConfigurationMapTab } from "@/components/settings/configuration-map-tab";
import type { ConfigMapTabActions } from "@/components/settings/configuration-map-tab";
import { ResourcesTab } from "@/components/settings/resources-tab";
import type { ResourcesTabActions } from "@/components/settings/resources-tab";
import { ServerActionPanel } from "@/components/settings/server-action-panel";
import { AdminActionPanel } from "@/components/settings/admin-action-panel";
import { TagsActionPanel } from "@/components/settings/tags-action-panel";
import { ConfigMapActionPanel } from "@/components/settings/config-map-action-panel";
import { ResourcesActionPanel } from "@/components/settings/resources-action-panel";
import { useLicensedPluginIds, useLicensedPluginsReady } from "@/lib/plugin-license";
import {
  useEnabledPluginNames,
  useInstalledPluginsReady,
  useInstalledPluginsError,
} from "@/lib/installed-plugins";
import { getPluginSettingsTabs } from "@/lib/plugin-settings";
import { LockedFeature } from "@/components/locked-feature";
import { cn } from "@/lib/utils";
import { Lock } from "lucide-react";
import { useNavigationGuard, NavigationSaveCancelled } from "@/lib/navigation-guard";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { SaveDiscardCancelDialog } from "@/components/save-discard-cancel-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";

/** Permission keys for built-in settings tabs. */
const BUILTIN_TAB_PERMISSIONS: Record<string, string> = {
  server: "Settings.Server",
  administrator: "Settings.Administrator",
  tags: "Settings.Tags",
  "configuration-map": "Settings.Configuration Map",
  resources: "Settings.Resources",
};

/**
 * Toolbar-actions bag a settings tab exposes via its actionsRef. The common
 * controls are listed explicitly; plugins may expose additional plugin-specific
 * entries, so an index signature is included. This types the core-owned
 * per-tab ref map — the plugin wire contract (PluginTabProps.actionsRef in
 * lib/plugin-registry.ts) intentionally stays untyped; see.
 */
interface PluginToolbarActions {
  save?: () => void;
  refresh?: () => void;
  discard?: () => void;
  [key: string]: unknown;
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsPageInner />
    </Suspense>
  );
}

// Default actions to avoid null checks
const EMPTY_SERVER_ACTIONS: ServerTabActions = {
  save: () => {},
  refresh: () => {},
  dirty: false,
  saving: false,
  loading: false,
  backup: () => {},
  restore: () => {},
  backingUp: false,
  restoring: false,
  clearStats: () => {},
  clearingStats: false,
};
const EMPTY_ADMIN_ACTIONS: AdminTabActions = {
  save: () => {},
  refresh: () => {},
  restoreDefaults: () => {},
  dirty: false,
  saving: false,
  loading: false,
};
const EMPTY_TAGS_ACTIONS: TagsTabActions = {
  save: () => {},
  refresh: () => {},
  dirty: false,
  saving: false,
  loading: false,
};
const EMPTY_CONFIG_ACTIONS: ConfigMapTabActions = {
  save: () => {},
  refresh: () => {},
  importMap: () => {},
  exportMap: () => {},
  dirty: false,
  saving: false,
  loading: false,
  canExport: false,
};
const EMPTY_RESOURCES_ACTIONS: ResourcesTabActions = {
  save: () => {},
  refresh: () => {},
  addResource: () => {},
  removeResource: () => {},
  reloadResource: () => {},
  dirty: false,
  saving: false,
  loading: false,
  canRemove: false,
  canReload: false,
  reloading: false,
};

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") ?? "server";

  // ── Active tab (controlled) ────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState(initialTab);

  // Sub-tab switch guard: when leaving a dirty tab, hold the intended target here
  // and prompt save/discard/cancel (mirrors SettingsPane.setSelectedIndex →
  // confirmLeave). null = no pending switch.
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const [tabSwitchSaving, setTabSwitchSaving] = useState(false);
  const [tabSwitchError, setTabSwitchError] = useState<string | null>(null);

  // ── Dockable toolbar ───────────────────────────────────────────────────────
  const { position: toolbarPos, setToolbarPosition } = useToolbarPosition();
  const isHorizontal = toolbarPos === "top" || toolbarPos === "bottom";

  // Re-render trigger — incremented by tabs via onActionsChanged so the parent
  // re-renders and renderActionPanel() spreads fresh actionsRef values into the toolbar.
  const [actionsVersion, setActionsVersion] = useState(0);
  const bumpActions = useCallback(() => setActionsVersion((v) => v + 1), []);
  // actionsVersion is intentionally read here to keep the linter happy; the value
  // itself isn't used — the re-render it causes is what matters.
  void actionsVersion;

  // Which server plugins are installed AND enabled — read from the shared
  // installed-plugins store (the same source the Channels/sidebar/Monaco
  // surfaces gate on, so Settings and those stay consistent and there's a
  // single fetch, not a Settings-private duplicate). Empty while loading so no
  // plugin tab flashes before the check resolves. `pluginsResolved` (loaded OR
  // error) feeds the deep-link redirect hold below (finding 23).
  const enabledPlugins = useEnabledPluginNames();
  const pluginsResolved = useInstalledPluginsReady();
  const installError = useInstalledPluginsError();

  // License entitlement. A settings tab with a `licensedPluginId` is
  // hidden (or shown locked, unless the server reports that plugin
  // licensed — the enablement check above does NOT reflect licensing (an
  // installed-but-unlicensed plugin still reports enabled server-side). Empty
  // while loading; `licenseReady` feeds the deep-link redirect hold below.
  const licensedPluginIds = useLicensedPluginIds();
  const licenseReady = useLicensedPluginsReady();

  // Surface an enablement-fetch failure (L34) instead of silently hiding every
  // plugin tab. The shared store fetches once per session and fails closed; a
  // transient failure (server cold-start race after login, a network blip) is
  // recovered by refreshing the page, so the toast says so. Stable id dedupes
  // (and avoids a StrictMode double-toast).
  useEffect(() => {
    if (!installError) return;
    toast.error("Failed to load plugin settings tabs. Refresh to retry.", {
      id: "plugin-tabs-load-error",
    });
  }, [installError]);

  // Holds the pending refresh/discard action while the "unsaved changes will be
  // lost" confirm is open. null = no confirm open. Mirrors Java Frame.alertRefresh
  // gating every editable panel's doRefresh (finding 5).
  const [pendingRefresh, setPendingRefresh] = useState<(() => void) | null>(null);

  // ── Navigation guard: unsaved-changes prompt ──────────────────────────────

  const { registerGuard, unregisterGuard } = useNavigationGuard();

  // Per-tab dirty tracking: Record<tabKey, isDirty>
  const [dirtyTabs, setDirtyTabs] = useState<Record<string, boolean>>({});
  const anyDirty = Object.values(dirtyTabs).some(Boolean);

  // Stable callback so tab effects don't re-fire when the parent re-renders
  const handleTabDirty = useCallback((tab: string, isDirty: boolean) => {
    setDirtyTabs((prev) => {
      if (prev[tab] === isDirty) return prev; // no change → skip re-render
      return { ...prev, [tab]: isDirty };
    });
  }, []);

  // Save refs — each tab sets saveRef.current = its doSave() on every render
  const serverSaveRef = useRef<() => Promise<void>>(async () => {});
  const adminSaveRef = useRef<() => Promise<void>>(async () => {});
  const tagsSaveRef = useRef<() => Promise<void>>(async () => {});
  const configSaveRef = useRef<() => Promise<void>>(async () => {});
  const resourcesSaveRef = useRef<() => Promise<void>>(async () => {});

  // Actions refs — each tab populates with its toolbar-actionable handlers
  const serverActionsRef = useRef<ServerTabActions>({ ...EMPTY_SERVER_ACTIONS });
  const adminActionsRef = useRef<AdminTabActions>({ ...EMPTY_ADMIN_ACTIONS });
  const tagsActionsRef = useRef<TagsTabActions>({ ...EMPTY_TAGS_ACTIONS });
  const configActionsRef = useRef<ConfigMapTabActions>({ ...EMPTY_CONFIG_ACTIONS });
  const resourcesActionsRef = useRef<ResourcesTabActions>({ ...EMPTY_RESOURCES_ACTIONS });

  // Plugin actions refs — keyed by tabKey
  const pluginActionsRefs = useRef<Record<string, React.MutableRefObject<PluginToolbarActions>>>(
    {}
  );
  const getPluginActionsRef = useCallback((tabKey: string) => {
    if (!pluginActionsRefs.current[tabKey]) {
      pluginActionsRefs.current[tabKey] = { current: {} };
    }
    return pluginActionsRefs.current[tabKey];
  }, []);

  // Plugin save refs — keyed by tabKey. Each plugin settings tab sets .current to
  // its pure (throwing, no-toast) saveOrThrow, so the guard can save a dirty
  // plugin tab exactly like a built-in tab and abort the leave when it fails.
  const pluginSaveRefs = useRef<Record<string, React.MutableRefObject<() => Promise<void>>>>({});
  const getPluginSaveRef = useCallback((tabKey: string) => {
    if (!pluginSaveRefs.current[tabKey]) {
      pluginSaveRefs.current[tabKey] = { current: async () => {} };
    }
    return pluginSaveRefs.current[tabKey];
  }, []);

  // Always-current refs so guard closures never go stale
  const anyDirtyRef = useRef(anyDirty);
  // eslint-disable-next-line react-hooks/refs
  anyDirtyRef.current = anyDirty;

  const dirtyTabsRef = useRef(dirtyTabs);
  // eslint-disable-next-line react-hooks/refs
  dirtyTabsRef.current = dirtyTabs;

  // Save a single tab by key — built-in via its pure saveRef, plugin via its
  // host-populated saveRef. Both throw on failure so the guard aborts the leave.
  function saveTab(tabKey: string): Promise<void> {
    switch (tabKey) {
      case "server":
        return serverSaveRef.current();
      case "administrator":
        return adminSaveRef.current();
      case "tags":
        return tagsSaveRef.current();
      case "configuration-map":
        return configSaveRef.current();
      case "resources":
        return resourcesSaveRef.current();
      default:
        return getPluginSaveRef(tabKey).current();
    }
  }

  // The navigation guard saves ONLY the active tab if it is dirty — mirrors Java
  // Frame.confirmLeave → getCurrentSettingsPanel().doSave() (not an aggregate over
  // every dirty tab). The per-switch prompt keeps only the active tab dirty anyway.
  const saveActiveTabRef = useRef<() => Promise<void>>(async () => {});
  async function saveActiveTab() {
    if (dirtyTabsRef.current[activeTab]) await saveTab(activeTab);
  }
  // eslint-disable-next-line react-hooks/refs
  saveActiveTabRef.current = saveActiveTab;

  // Register guard once on mount; refs keep isDirty/save always current
  useEffect(() => {
    registerGuard(
      () => anyDirtyRef.current,
      () => saveActiveTabRef.current(),
      "settings"
    );
    return () => unregisterGuard();
  }, [registerGuard, unregisterGuard]);

  // Native beforeunload for browser close/refresh
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (anyDirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyDirty]);

  // Note (finding 8 — refresh on tab activation): no explicit refresh is needed.
  // The shared <Tabs> (Radix) unmounts inactive TabsContent, so activating a tab
  // REMOUNTS its component, which re-runs its mount-load and re-fetches fresh data
  // — exactly SettingsPane.doRefresh's effect. Adding an explicit refresh here
  // would double-fetch. (The settings-parity report's premise that tabs "mount
  // once / CSS-visibility only" was incorrect; verified against the Radix source
  // and a mount-probe test.)

  const { hasPermission, isViewOnly } = usePermissions();

  // Visible plugin settings tabs = server-enabled + permitted. A tab that is
  // enabled + permitted but NOT licensed is included as `locked`
  // (rendered dimmed, its content replaced by the upgrade prompt) rather than
  // hidden — this is the installed-but-unlicensed state. Dormant / unpermitted
  // tabs are still excluded entirely.
  const enabledPluginTabs = getPluginSettingsTabs()
    .filter(
      (t) =>
        // Always-enabled: tabs with empty pluginName bypass the server check
        (t.pluginName === "" || enabledPlugins.has(t.pluginName)) &&
        (!t.permissionKey || hasPermission(t.permissionKey))
    )
    // While the license fetch is still resolving, hold license-gated tabs out of
    // the list rather than flash them enabled-then-locked (or vice versa).
    .filter((t) => !(t.licensedPluginId && !licenseReady))
    .map((t) => ({
      ...t,
      locked: !!t.licensedPluginId && !licensedPluginIds.has(t.licensedPluginId),
    }));

  /** Returns true if a built-in tab should be visible (permission check). */
  const isBuiltinTabVisible = (tabKey: string): boolean => {
    const permKey = BUILTIN_TAB_PERMISSIONS[tabKey];
    return !permKey || hasPermission(permKey);
  };

  const BUILTIN_TAB_KEYS = ["server", "administrator", "tags", "configuration-map", "resources"];
  const visibleBuiltinTabs = BUILTIN_TAB_KEYS.filter(isBuiltinTabVisible);

  // Auto-navigate to first visible tab if active tab becomes hidden. Adjusted
  // during render (the condition itself guards re-fires: once activeTab is a
  // visible key, this no longer sets state) so the redirect happens in the same
  // commit instead of an extra effect pass.
  const allVisibleKeys = [...visibleBuiltinTabs, ...enabledPluginTabs.map((t) => t.tabKey)];
  const visibleKeysKey = allVisibleKeys.join(",");
  {
    const keys = visibleKeysKey.split(",").filter(Boolean);
    // Don't bounce a deep-linked plugin tab (e.g. /settings?tab=data-pruner) to
    // Server before the async installed/enabled check has resolved — its key
    // legitimately isn't in `keys` yet. Built-in keys are always known
    // synchronously, so only hold for registered plugin keys (finding 23).
    // License-gated tabs additionally hold until the independently-
    // loading license fetch resolves, or a licensed tab deep-link would bounce
    // whenever the enablement check happens to win the race.
    const activeTabDef = getPluginSettingsTabs().find((t) => t.tabKey === activeTab);
    const holdForPlugins =
      activeTabDef !== undefined &&
      (!pluginsResolved || (!!activeTabDef.licensedPluginId && !licenseReady));
    if (!holdForPlugins && keys.length > 0 && !keys.includes(activeTab)) {
      const vanished = activeTab;
      setActiveTab(keys[0]);
      // The active tab vanished (e.g. permission lost) — any pending switch
      // prompt for it is moot. setState bails when already null.
      setPendingTab(null);
      // Drop the now-hidden tab's dirty entry so it doesn't linger as a phantom
      // navigation-guard prompt whose Save is a no-op (L33). The tab is
      // unmounted, so its own onDirty(false) effect won't fire.
      handleTabDirty(vanished, false);
    }
  }

  // Human-readable tab name for the unsaved-changes prompt.
  function tabLabel(tabKey: string): string {
    switch (tabKey) {
      case "server":
        return "Server";
      case "administrator":
        return "Administrator";
      case "tags":
        return "Tags";
      case "configuration-map":
        return "Configuration Map";
      case "resources":
        return "Resources";
      default:
        return enabledPluginTabs.find((t) => t.tabKey === tabKey)?.tabLabel ?? tabKey;
    }
  }

  // Commit a tab switch. The newly-activated tab remounts (Radix unmounts inactive
  // TabsContent), which reloads its data — no explicit refresh needed (finding 8).
  function commitTabChange(next: string) {
    setActiveTab(next);
  }

  // Intercept Radix tab switches — mirrors SettingsPane.setSelectedIndex, which
  // routes through confirmLeave when the outgoing tab is dirty.
  function handleTabChange(next: string) {
    if (next === activeTab) return;
    // A prompt is already open — ignore further trigger clicks so we don't
    // overwrite the pending target.
    if (pendingTab !== null) return;
    if (dirtyTabs[activeTab]) {
      setTabSwitchError(null);
      setPendingTab(next);
      return;
    }
    commitTabChange(next);
  }

  // Gate a toolbar Refresh/Discard behind a Yes/No confirm when the active tab is
  // dirty — mirrors Java, where every editable SettingsPanel.doRefresh() starts
  // with `if (Frame.alertRefresh()) return;` (finding 5). Clean tab → run now.
  function requestRefresh(doRefresh: () => void) {
    if (dirtyTabs[activeTab]) {
      setPendingRefresh(() => doRefresh);
    } else {
      doRefresh();
    }
  }

  // Keep a live handle to handleTabChange so the search-param effect can call the
  // latest closure without re-subscribing on every dirty/tab change (same
  // always-current-ref idiom as anyDirtyRef/dirtyTabsRef above).
  const handleTabChangeRef = useRef(handleTabChange);
  // eslint-disable-next-line react-hooks/refs
  handleTabChangeRef.current = handleTabChange;

  // Sync external URL changes (e.g. the in-app global search pushing
  // /settings?tab=X while already on /settings) into the active tab. Routing
  // through handleTabChange preserves the dirty prompt; it no-ops when the param
  // already matches, so the initial mount is a no-op (L32).
  const tabParam = searchParams.get("tab");
  useEffect(() => {
    if (tabParam) handleTabChangeRef.current(tabParam);
  }, [tabParam]);

  // Prompt resolutions (Yes / No / Cancel), scoped to the outgoing (active) tab.
  async function handleSwitchSave() {
    if (pendingTab === null) return;
    const target = pendingTab;
    setTabSwitchError(null);
    setTabSwitchSaving(true);
    try {
      await saveTab(activeTab);
      // The outgoing tab unmounts on switch before its onDirty(false) effect can
      // run, so clear its dirty entry explicitly to avoid a stale-true lingering.
      handleTabDirty(activeTab, false);
      setTabSwitchSaving(false);
      setPendingTab(null);
      commitTabChange(target);
    } catch (err) {
      if (err instanceof NavigationSaveCancelled) {
        // The tab aborted its own save (e.g. declined an overwrite-conflict
        // prompt) — close the prompt and stay put, no error.
        setTabSwitchSaving(false);
        setPendingTab(null);
        return;
      }
      setTabSwitchError(err instanceof Error ? err.message : "Save failed. Please try again.");
      setTabSwitchSaving(false);
    }
  }

  function handleSwitchDiscard() {
    if (pendingTab === null) return;
    const target = pendingTab;
    setPendingTab(null);
    setTabSwitchError(null);
    // Discard: the outgoing tab unmounts on switch (Radix), dropping its in-memory
    // edits; re-activating it later remounts and reloads the server copy. Clear its
    // dirty entry now so it doesn't linger as stale (unmount won't fire onDirty).
    handleTabDirty(activeTab, false);
    commitTabChange(target);
  }

  function handleSwitchCancel() {
    setPendingTab(null);
    setTabSwitchError(null);
  }

  // ── Render active action panel based on current tab ────────────────────────
  // Computed inline (no useMemo) so that every re-render triggered by bumpActions
  // spreads the latest actionsRef.current values into the panel.

  function renderActionPanel() {
    switch (activeTab) {
      case "server":
        return (
          <ServerActionPanel
            position={toolbarPos}
            {...serverActionsRef.current}
            viewOnly={isViewOnly("Settings.Server")}
            save={() => serverActionsRef.current.save()}
            refresh={() => requestRefresh(() => serverActionsRef.current.refresh())}
            backup={() => serverActionsRef.current.backup()}
            restore={() => serverActionsRef.current.restore()}
            clearStats={() => serverActionsRef.current.clearStats()}
          />
        );
      case "administrator":
        return (
          <AdminActionPanel
            position={toolbarPos}
            {...adminActionsRef.current}
            viewOnly={isViewOnly("Settings.Administrator")}
            save={() => adminActionsRef.current.save()}
            refresh={() => requestRefresh(() => adminActionsRef.current.refresh())}
            restoreDefaults={() => adminActionsRef.current.restoreDefaults()}
          />
        );
      case "tags":
        return (
          <TagsActionPanel
            position={toolbarPos}
            {...tagsActionsRef.current}
            viewOnly={isViewOnly("Settings.Tags")}
            save={() => tagsActionsRef.current.save()}
            refresh={() => requestRefresh(() => tagsActionsRef.current.refresh())}
          />
        );
      case "configuration-map":
        return (
          <ConfigMapActionPanel
            position={toolbarPos}
            {...configActionsRef.current}
            viewOnly={isViewOnly("Settings.Configuration Map")}
            save={() => configActionsRef.current.save()}
            refresh={() => requestRefresh(() => configActionsRef.current.refresh())}
            importMap={() => configActionsRef.current.importMap()}
            exportMap={() => configActionsRef.current.exportMap()}
          />
        );
      case "resources":
        return (
          <ResourcesActionPanel
            position={toolbarPos}
            {...resourcesActionsRef.current}
            viewOnly={isViewOnly("Settings.Resources")}
            save={() => resourcesActionsRef.current.save()}
            refresh={() => requestRefresh(() => resourcesActionsRef.current.refresh())}
            addResource={() => resourcesActionsRef.current.addResource()}
            removeResource={() => resourcesActionsRef.current.removeResource()}
            reloadResource={() => resourcesActionsRef.current.reloadResource()}
          />
        );
      default: {
        const pt = enabledPluginTabs.find((t) => t.tabKey === activeTab);
        if (pt?.actionPanel) {
          const Panel = pt.actionPanel;
          const ref = getPluginActionsRef(pt.tabKey);
          return (
            <Panel
              position={toolbarPos}
              {...ref.current}
              {...(pt.permissionKey && { viewOnly: isViewOnly(pt.permissionKey) })}
              {...(typeof ref.current.save === "function" && {
                save: () => ref.current.save?.(),
              })}
              {...(typeof ref.current.refresh === "function" && {
                refresh: () => requestRefresh(() => ref.current.refresh?.()),
              })}
              {...(typeof ref.current.discard === "function" && {
                discard: () => requestRefresh(() => ref.current.discard?.()),
              })}
            />
          );
        }
        return null;
      }
    }
  }

  // eslint-disable-next-line react-hooks/refs -- renderActionPanel reads actionsRef.current to populate toolbar; intentional always-current-ref pattern
  const actionPanelNode = renderActionPanel();
  const toolbar = actionPanelNode ? (
    <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
      {actionPanelNode}
    </DockableToolbar>
  ) : null;

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Settings" />
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <TabsList className="shrink-0 overflow-x-auto flex-nowrap">
          {/* ── Built-in tabs (filtered by RBAC permissions) ── */}
          {isBuiltinTabVisible("server") && <TabsTrigger value="server">Server</TabsTrigger>}
          {isBuiltinTabVisible("administrator") && (
            <TabsTrigger value="administrator">Administrator</TabsTrigger>
          )}
          {isBuiltinTabVisible("tags") && <TabsTrigger value="tags">Tags</TabsTrigger>}
          {isBuiltinTabVisible("configuration-map") && (
            <TabsTrigger value="configuration-map">Configuration Map</TabsTrigger>
          )}
          {isBuiltinTabVisible("resources") && (
            <TabsTrigger value="resources">Resources</TabsTrigger>
          )}

          {/* ── Plugin tabs (enabled on server; locked = installed-but-unlicensed) ── */}
          {enabledPluginTabs.map((pt) => (
            <TabsTrigger
              key={pt.tabKey}
              value={pt.tabKey}
              className={cn(pt.locked && "gap-1.5 text-muted-foreground")}
              title={pt.locked ? "Licensed feature — upgrade to unlock" : undefined}
            >
              {pt.tabLabel}
              {pt.locked && <Lock className="h-3 w-3 opacity-70" />}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Toolbar + content wrapper ── */}
        <div className={`flex flex-1 min-h-0 ${isHorizontal ? "flex-col" : "flex-row"}`}>
          {(toolbarPos === "left" || toolbarPos === "top") && toolbar}

          <div className="flex-1 overflow-hidden flex flex-col">
            {/* ── Built-in tab content ── */}
            <TabsContent
              value="server"
              className="flex-1 overflow-y-auto bg-white dark:bg-gray-900"
            >
              <ServerTab
                onDirty={(d) => handleTabDirty("server", d)}
                saveRef={serverSaveRef}
                actionsRef={serverActionsRef}
                onActionsChanged={bumpActions}
              />
            </TabsContent>
            <TabsContent
              value="administrator"
              className="flex-1 overflow-y-auto bg-white dark:bg-gray-900"
            >
              <AdminTab
                onDirty={(d) => handleTabDirty("administrator", d)}
                saveRef={adminSaveRef}
                actionsRef={adminActionsRef}
                onActionsChanged={bumpActions}
              />
            </TabsContent>
            <TabsContent value="tags" className="flex-1 overflow-y-auto bg-white dark:bg-gray-900">
              <TagsTab
                onDirty={(d) => handleTabDirty("tags", d)}
                saveRef={tagsSaveRef}
                actionsRef={tagsActionsRef}
                onActionsChanged={bumpActions}
              />
            </TabsContent>
            <TabsContent
              value="configuration-map"
              className="flex-1 overflow-y-auto bg-white dark:bg-gray-900"
            >
              <ConfigurationMapTab
                onDirty={(d) => handleTabDirty("configuration-map", d)}
                saveRef={configSaveRef}
                actionsRef={configActionsRef}
                onActionsChanged={bumpActions}
              />
            </TabsContent>
            <TabsContent
              value="resources"
              className="flex-1 overflow-auto p-6 bg-white dark:bg-gray-900"
            >
              <ResourcesTab
                onDirty={(d) => handleTabDirty("resources", d)}
                saveRef={resourcesSaveRef}
                actionsRef={resourcesActionsRef}
                onActionsChanged={bumpActions}
              />
            </TabsContent>

            {/* ── Plugin tab content ── */}
            {/* eslint-disable-next-line react-hooks/refs -- getPluginActionsRef reads pluginActionsRefs.current; intentional always-current-ref pattern */}
            {enabledPluginTabs.map((pt) => (
              <TabsContent
                key={pt.tabKey}
                value={pt.tabKey}
                className="flex-1 overflow-y-auto bg-white dark:bg-gray-900"
              >
                {pt.locked ? (
                  // Installed-but-unlicensed: show the upgrade prompt
                  // instead of mounting the real tab (which would fire unlicensed
                  // API calls). licensedPluginId is present whenever locked.
                  <LockedFeature
                    licensedPluginId={pt.licensedPluginId!}
                    featureName={pt.tabLabel}
                  />
                ) : (
                  <pt.component
                    actionsRef={getPluginActionsRef(pt.tabKey)}
                    onActionsChanged={bumpActions}
                    onDirty={(d) => handleTabDirty(pt.tabKey, d)}
                    saveRef={getPluginSaveRef(pt.tabKey)}
                  />
                )}
              </TabsContent>
            ))}
          </div>

          {(toolbarPos === "right" || toolbarPos === "bottom") && toolbar}
        </div>
      </Tabs>

      {/* Unsaved-changes prompt when switching away from a dirty sub-tab
          (mirrors SettingsPane.confirmLeave on tab switch). */}
      <SaveDiscardCancelDialog
        open={pendingTab !== null}
        description={`Would you like to save the ${tabLabel(activeTab)} settings changes?`}
        saving={tabSwitchSaving}
        error={tabSwitchError}
        onSave={handleSwitchSave}
        onDiscard={handleSwitchDiscard}
        onCancel={handleSwitchCancel}
      />

      {/* Refresh/Discard confirm when the active tab is dirty
          (mirrors Java Frame.alertRefresh gating doRefresh — finding 5). */}
      {pendingRefresh !== null && (
        <ConfirmDialog
          title="Warning"
          description="Any unsaved changes will be lost. Would you like to continue?"
          confirmLabel="Yes"
          cancelLabel="No"
          confirmVariant="default"
          onConfirm={() => {
            const run = pendingRefresh;
            setPendingRefresh(null);
            run();
          }}
          onCancel={() => setPendingRefresh(null)}
        />
      )}
    </div>
  );
}
