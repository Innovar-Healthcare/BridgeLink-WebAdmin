"use client";

/**
 * Lazy component surfaces for the Version History plugin.
 *
 * Every UI component the plugin contributes to the manifest is wrapped here in
 * `lazyPluginComponent(() => import(...))` so its code is code-split into an
 * on-demand chunk instead of shipping in the app-shell's initial bundle. The
 * plugin's `index.ts` imports these wrappers and assigns them into the manifest
 * exactly as before — the props types are inferred through the dynamic import,
 * so the manifest/slot typings are unchanged.
 *
 * This module (not index.ts) owns all `next/dynamic` usage, and is marked
 * "use client" because `next/dynamic({ ssr: false })` is only valid in a client
 * module — index.ts is reachable from server route files via the `@/plugins`
 * barrel. See lib/plugin-lazy.tsx and docs/PLUGIN-DEVELOPMENT.md.
 *
 * Fallback rule: pages and channel-editor tabs mount on navigation and show a
 * visible `PluginSurfaceFallback`; dialogs and the overlay are mounted-but-
 * `open`-controlled, so they use the default `() => null` fallback (no stray
 * spinner behind a closed dialog).
 */

import { lazyPluginComponent, PluginSurfaceFallback } from "@/lib/plugin-lazy";

// ── Visible-fallback surfaces (mount on navigation / tab select) ──

export const VersionHistoryPage = lazyPluginComponent(
  () => import("./version-history-page").then((m) => m.VersionHistoryPage),
  { loading: PluginSurfaceFallback }
);

export const ChannelHistoryPanel = lazyPluginComponent(
  () => import("./_components/channel-history-panel").then((m) => m.ChannelHistoryPanel),
  { loading: PluginSurfaceFallback }
);

// ── Null-fallback surfaces (mounted-but-open-controlled dialogs/overlay) ──

export const TemplateHistoryDialog = lazyPluginComponent(() =>
  import("./_components/template-history-dialog").then((m) => m.TemplateHistoryDialog)
);

export const LibraryHistoryDialog = lazyPluginComponent(() =>
  import("./_components/library-history-dialog").then((m) => m.LibraryHistoryDialog)
);

export const GlobalScriptsHistoryDialog = lazyPluginComponent(() =>
  import("./_components/global-scripts-history-dialog").then((m) => m.GlobalScriptsHistoryDialog)
);

export const GlobalScriptsCommitDialog = lazyPluginComponent(() =>
  import("./_components/global-scripts-commit-dialog").then((m) => m.GlobalScriptsCommitDialog)
);

export const SaveLibrariesDialog = lazyPluginComponent(() =>
  import("./_components/save-libraries-dialog").then((m) => m.SaveLibrariesDialog)
);

export const ImportChannelDialog = lazyPluginComponent(() =>
  import("./_components/import-channel-dialog").then((m) => m.ImportChannelDialog)
);

export const ImportCodeTemplateDialog = lazyPluginComponent(() =>
  import("./_components/import-code-template-dialog").then((m) => m.ImportCodeTemplateDialog)
);

export const ChannelCommitOverlay = lazyPluginComponent(() =>
  import("./_components/channel-commit-overlay").then((m) => m.ChannelCommitOverlay)
);
