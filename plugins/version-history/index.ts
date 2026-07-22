/**
 * Version History Plugin — commercial implementation
 *
 * Declares the plugin's contributions via a single definePlugin() manifest
 *: the Version History page in the "Build" navigation group, the
 * channel editor history tab, and the named slots that power the history /
 * import / commit dialogs and post-save git hooks across the Channels, Code
 * Templates, and Global Scripts pages.
 *
 * The settings tab (general, git config, auto-commit) is a built-in tab in
 * lib/plugin-settings.ts and is NOT declared here.
 */

import { GitBranch } from "lucide-react";
import { definePlugin } from "@/lib/plugin-manifest";
import type { RepoChangesSummary } from "@/lib/plugin-registry";
import { getSession } from "@/lib/auth";
import {
  VERSION_HISTORY_PLUGIN_NAME,
  loadVersionHistoryEnabled,
  isVersionHistoryEnabledSnapshot,
} from "@/lib/version-history";
import { clearRepoChangesCache } from "@/lib/hooks/repo-changes-cache";
// UI components are lazy-loaded: index.ts references only the
// dynamic-import wrappers in ./lazy-surfaces, so the plugin's component graph is
// code-split out of the app-shell's initial bundle. The manifest metadata below
// stays eager/synchronous. The pending-commit setter comes from the tiny
// ./_components/channel-commit-bus (not the heavy overlay) so it stays
// import-cheap for the synchronous post-save handler.
import { setPendingChannelCommit } from "./_components/channel-commit-bus";
import {
  VersionHistoryPage,
  ChannelHistoryPanel,
  TemplateHistoryDialog,
  LibraryHistoryDialog,
  GlobalScriptsHistoryDialog,
  GlobalScriptsCommitDialog,
  SaveLibrariesDialog,
  ImportChannelDialog,
  ImportCodeTemplateDialog,
  ChannelCommitOverlay,
} from "./lazy-surfaces";
import {
  getRepoChanges,
  writeChannelToRepo,
  getVersionHistoryAutoCommitSettings,
  commitAndPushChannel,
  saveLibraries,
} from "./api-version-history";

/**
 * True when Version History is active — extension enabled AND the plugin's
 * "Enable" setting on. Warms the cache first so an un-loaded cache doesn't read
 * as "disabled" and wrongly skip work. Used by the always-run save/provider
 * handlers below.
 */
async function versionHistoryEnabled(): Promise<boolean> {
  await loadVersionHistoryEnabled();
  return isVersionHistoryEnabledSnapshot();
}

async function fetchRepoChangesSummary(): Promise<RepoChangesSummary> {
  // No uncommitted-change indicators when the plugin is disabled — return empty
  // sets rather than calling the (unavailable) repo endpoint.
  if (!(await versionHistoryEnabled())) {
    return { channelIds: new Set(), templateIds: new Set() };
  }
  const changes = await getRepoChanges();
  const allPaths = [...changes.modifiedFiles, ...changes.deletedFiles, ...changes.untrackedFiles];
  const channelIds = new Set<string>();
  const templateIds = new Set<string>();
  for (const p of allPaths) {
    const slashIdx = p.indexOf("/");
    if (slashIdx === -1) continue;
    const folder = p.slice(0, slashIdx);
    const name = p.slice(slashIdx + 1);
    if (!name) continue;
    if (folder === "channels") channelIds.add(name);
    else if (folder === "codetemplates") templateIds.add(name);
  }
  return { channelIds, templateIds };
}

// ─── Post-channel-save handler ────────────────────────────────────────────────
//
// Called by the channel editor after every successful BridgeLink channel save.
// Writes the channel XML to the git working tree, clears the repo-changes cache
// so the uncommitted indicator updates, then checks auto-commit settings:
//   - Auto-commit disabled → leave in working tree (indicator stays amber)
//   - Auto-commit, no prompt → commit + push silently with the default message
//   - Auto-commit, prompt → signal ChannelCommitOverlay to show the dialog

async function handlePostChannelSave(channelXml: string): Promise<void> {
  // Skip all version-history work (repo write + auto-commit prompt) when the
  // plugin is disabled on the server.
  if (!(await versionHistoryEnabled())) return;

  // Write to git working tree (fire-and-forget — errors don't block the save)
  await writeChannelToRepo(channelXml).catch(() => {});
  clearRepoChangesCache();

  const settings = await getVersionHistoryAutoCommitSettings().catch(() => null);
  if (!settings?.autoCommitEnabled) return;

  const userId = getSession()?.userId ?? 1;
  if (settings.promptEnabled) {
    // Await the dialog so Save & Deploy waits for the user before deploying.
    // Shown for both new and edit saves — for a new channel the editor's
    // post-save navigation also awaits this, so there is no race.
    await setPendingChannelCommit({ channelXml, userId, defaultMessage: settings.defaultMessage });
    clearRepoChangesCache();
  } else {
    // Silent auto-commit (auto-commit enabled, prompt disabled)
    await commitAndPushChannel(channelXml, settings.defaultMessage, userId).catch(() => {});
    clearRepoChangesCache();
  }
}

// ─── Post-code-template-save handler ─────────────────────────────────────────
//
// Called by the Code Templates page after every successful bulk save.
// Writes library XML to the version-history git repo via saveLibraries(), then
// optionally triggers auto-commit if auto-commit is enabled.

async function handlePostCodeTemplateSave(
  savedLibraries: Parameters<typeof saveLibraries>[0]
): Promise<void> {
  if (!(await versionHistoryEnabled())) return;

  const settings = await getVersionHistoryAutoCommitSettings().catch(() => null);
  if (!settings?.autoCommitEnabled) return;

  const userId = getSession()?.userId ?? 1;
  await saveLibraries(savedLibraries, settings.defaultMessage, userId).catch(() => {});
  clearRepoChangesCache();
}

// ─── Save Libraries to Repo handler (toolbar button) ─────────────────────────
//
// Called by the "Save Libraries" toolbar button on the Code Templates page.
// Always commits regardless of auto-commit setting — this is an explicit user action.

async function handleSaveLibrariesToRepo(
  libraries: Parameters<typeof saveLibraries>[0]
): Promise<void> {
  if (!(await versionHistoryEnabled())) return;

  const settings = await getVersionHistoryAutoCommitSettings().catch(() => null);
  const userId = getSession()?.userId ?? 1;
  const message = settings?.defaultMessage || "Save library metadata";
  await saveLibraries(libraries, message, userId);
  clearRepoChangesCache();
}

export default definePlugin({
  id: "version-history",
  // Server plugin name as reported by `GET /extensions/plugins/`. Shared with
  // the settings-tab gate (lib/plugin-settings.ts) and the core render-site
  // gates via lib/version-history.ts. Stamped onto the page and channel-editor
  // tab below for their render-time gating.
  serverPluginName: VERSION_HISTORY_PLUGIN_NAME,

  pages: [
    {
      slug: "version-history",
      label: "Version History",
      icon: GitBranch,
      tooltip: "View Git-based version history for channels and code templates.",
      navGroup: "Build",
      component: VersionHistoryPage,
      permissionKey: "Settings.Version History",
    },
  ],

  channelEditorTabs: [
    {
      key: "version-history",
      label: "Version History",
      component: ChannelHistoryPanel,
    },
  ],

  slots: {
    "code-templates.history-dialog": TemplateHistoryDialog,
    "code-templates.library.history-dialog": LibraryHistoryDialog,
    "global-scripts.history-dialog": GlobalScriptsHistoryDialog,
    "global-scripts.commit-dialog": GlobalScriptsCommitDialog,
    "code-templates.save-libraries-dialog": SaveLibrariesDialog,
    "channels.import-repo-dialog": ImportChannelDialog,
    "code-templates.import-repo-dialog": ImportCodeTemplateDialog,
    "repo-changes.provider": fetchRepoChangesSummary,
    "channels.post-save": handlePostChannelSave,
    // Mounts the commit dialog inside the channel editor's React tree; the
    // dialog is triggered by setPendingChannelCommit() in the post-save handler.
    "channel-editor.overlay": ChannelCommitOverlay,
    "code-templates.post-save": handlePostCodeTemplateSave,
    "code-templates.save-libraries": handleSaveLibrariesToRepo,
  },
});
