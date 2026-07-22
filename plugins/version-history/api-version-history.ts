/**
 * API — Version History Plugin
 *
 * Plugin name (server): "Version History Plugin"
 * Base path: /plugins/version-history
 *
 * Serialization: Plain Jackson JSON (NOT XStream). Responses are camelCase JSON.
 *
 * Mirrors Java's VersionHistoryServletInterface.java + VersionHistoryPluginServlet.java.
 */

import { request, escXml } from "@/lib/api/api-core";
import { getPluginProperties } from "@/lib/api/api-extensions";
import { serializeLibraryForRepo } from "@/lib/api/api-code-templates";
import type { CodeTemplateLibrary } from "@/lib/types";

// ─── Mode constants (from VersionHistoryConstants.java) ──────────────────────

export const MODE_CHANNEL = "MODE_CHANNEL";
export const MODE_CODE_TEMPLATE = "MODE_CODE_TEMPLATE";
export const MODE_CODE_TEMPLATE_LIBRARY = "MODE_CODE_TEMPLATE_LIBRARY";
export const MODE_GLOBAL_SCRIPTS = "MODE_GLOBAL_SCRIPTS";

export type VhMode =
  | typeof MODE_CHANNEL
  | typeof MODE_CODE_TEMPLATE
  | typeof MODE_CODE_TEMPLATE_LIBRARY
  | typeof MODE_GLOBAL_SCRIPTS;

// ─── Data models ─────────────────────────────────────────────────────────────

/** Mirrors com.innovarhealthcare.versionHistory.shared.dto.CommitMetaData */
export interface CommitMetaData {
  /** Full commit SHA */
  hash: string;
  committer: string;
  /** Epoch milliseconds */
  timestamp: number;
  /** Full commit message including JSON metadata footer */
  message: string;
}

/** Mirrors com.innovarhealthcare.versionHistory.shared.dto.RepoChanges */
export interface RepoChanges {
  modifiedFiles: string[];
  deletedFiles: string[];
  untrackedFiles: string[];
}

/**
 * Mirrors com.innovarhealthcare.channelHistory.shared.dto.response.RemoteStatus
 * (added in version-history plugin 3.0.1 / BridgeLink 26.3.1).
 *
 * Returned by GET /plugins/version-history/remoteStatus after a fetch from
 * the remote. `aheadCount` = local commits not yet on remote, `behindCount` =
 * remote commits not yet local.
 */
export interface RemoteStatus {
  aheadCount: number;
  behindCount: number;
}

// ─── Auth type constants (from GitSettings.java) ─────────────────────────────

export const AUTH_TYPE_SSH = "SSH";
export const AUTH_TYPE_HTTPS = "HTTPS";

export type GitAuthType = typeof AUTH_TYPE_SSH | typeof AUTH_TYPE_HTTPS;

/**
 * Mirrors com.innovarhealthcare.channelHistory.shared.model.GitSettings.
 *
 * `authType` is empty/SSH on legacy 26.3.0 servers; HTTPS support arrived in
 * 26.3.1. The HTTPS fields and `sshPrivateKeyPath` are ignored by older
 * servers (XStream silently drops unknown properties) but the WebUI gates the
 * corresponding UI surfaces via `usePluginCapabilities()` so users never see
 * options that would quietly do nothing.
 */
export interface GitSettings {
  remoteRepositoryUrl: string;
  branchName: string;
  sshPrivateKey: string;
  sshPrivateKeyPath: string;
  authType: GitAuthType | "";
  httpsUsername: string;
  httpsPassword: string;
  httpsCredentialsPath: string;
}

/** Mirrors com.innovarhealthcare.versionHistory.shared.dto.RepoFile */
export interface RepoFile {
  name: string;
  sizeBytes: number;
}

/** Mirrors com.innovarhealthcare.versionHistory.shared.dto.RepoFolder */
export interface RepoFolder {
  name: string;
  fileCount: number;
  files: RepoFile[];
}

/** Mirrors com.innovarhealthcare.versionHistory.shared.dto.RepoInfo */
export interface RepoInfo {
  localRepoPath: string;
  remoteUrl: string;
  branch: string;
  totalSizeBytes: number;
  folders: RepoFolder[];
}

/** Mirrors com.innovarhealthcare.versionHistory.shared.dto.RepoItemChange */
export interface RepoItemChange {
  path: string;
  changeType: string; // "MODIFIED" | "ADDED" | "DELETED"
}

/** Mirrors com.innovarhealthcare.versionHistory.shared.dto.RepoItemMetadata */
export interface RepoItemMetadata {
  id: string;
  name: string;
  path: string;
  lastCommitId: string;
}

/** Mirrors com.innovarhealthcare.channelHistory.shared.dto.response.LibraryMetadata */
export interface LibraryMetadata {
  id: string;
  name: string;
  codeTemplateIds: string[];
}

/** Mirrors com.innovarhealthcare.channelHistory.shared.dto.response.LibrariesAndTemplatesResponse */
export interface LibrariesAndTemplatesResponse {
  libraries: LibraryMetadata[];
  templates: RepoItemMetadata[];
}

// ─── Commit message parsing helpers ──────────────────────────────────────────

/** Returns first 8 chars of a commit hash (short hash). */
export function getShortHash(hash: string): string {
  return hash.substring(0, 8);
}

/**
 * Extracts the user-visible subject line from a commit message.
 * New format: subject on first line, JSON footer after blank line.
 * Legacy format: "Channel name: X. Message: Y. Server Name: Z. Server Id: W."
 */
export function getMessageContent(message: string): string {
  if (!message) return "";
  const lines = message.split("\n");
  const subject = lines[0].trim();
  return subject;
}

/** Parses the JSON metadata footer appended to commit messages. */
function parseMessageFooter(message: string): Record<string, string> {
  try {
    const match = message.match(/\{[^{}]+\}$/m);
    if (match) {
      return JSON.parse(match[0]) as Record<string, string>;
    }
  } catch {
    // ignore parse errors — legacy format
  }
  return {};
}

/** Extracts the entity type from a commit message footer (e.g. "Channel"). */
export function getEntityType(message: string): string {
  const footer = parseMessageFooter(message);
  return footer["type"] ?? "";
}

/** Extracts the entity name from a commit message footer. */
export function getEntityName(message: string): string {
  const footer = parseMessageFooter(message);
  return footer["name"] ?? "";
}

/** Extracts the server name from a commit message footer. */
export function getServerName(message: string): string {
  const footer = parseMessageFooter(message);
  return footer["serverName"] ?? "";
}

/**
 * Resolves a repo-relative path like `channels/<uuid>` or `codetemplates/<uuid>`
 * to a human-readable label using the provided name maps.
 * Falls back to the raw path when the ID is not found.
 */
export function resolvePathDisplay(
  path: string,
  channelNames: Map<string, string> | null | undefined,
  templateNames?: Map<string, string> | null
): string {
  const slashIdx = path.indexOf("/");
  if (slashIdx === -1) return path;
  const folder = path.slice(0, slashIdx);
  const id = path.slice(slashIdx + 1);
  if (folder === "channels" && channelNames) {
    const name = channelNames.get(id);
    if (name) return `channels/${name}`;
  }
  if (folder === "codetemplates" && templateNames) {
    const name = templateNames.get(id);
    if (name) return `codetemplates/${name}`;
  }
  return path;
}

// ─── Error message helpers ───────────────────────────────────────────────────

const NO_REPO_MESSAGE =
  "Git repository not configured. Please configure a Git repository in Settings.";

/**
 * Normalizes errors thrown by the Version History API into a user-facing string.
 *
 * When the BridgeLink server has no Git repository configured, every Version
 * History endpoint returns an error like "Git repository is not connected" /
 * "not configured" / "not initialized" / "no remote". We replace those with a
 * single canonical message that points the user to Settings.
 *
 * Pass the fallback message you'd otherwise show (e.g. "Failed to load
 * repository log") and we'll use it for any unrelated error.
 */
export function friendlyRepoError(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : "";
  const msg = raw.toLowerCase();
  const looksLikeNoRepo =
    msg.includes("not connected") ||
    msg.includes("not configured") ||
    msg.includes("not initialized") ||
    msg.includes("no repository") ||
    msg.includes("no git repository") ||
    msg.includes("no remote") ||
    (msg.includes("repository") && msg.includes("missing")) ||
    (msg.includes("git") && msg.includes("not set"));
  if (looksLikeNoRepo) return NO_REPO_MESSAGE;
  return raw || fallback;
}

// ─── API calls ───────────────────────────────────────────────────────────────

/**
 * GET /plugins/version-history/repoLog?maxCount=N
 * Mirrors Java's HistoryTabPanel → getRepoLog().
 * Returns the full repository commit log (most recent first).
 */
export async function getRepoLog(maxCount = 1000): Promise<CommitMetaData[]> {
  const raw = await request<unknown>(`/plugins/version-history/repoLog?maxCount=${maxCount}`, {
    skipNormalize: true,
  });
  return Array.isArray(raw) ? (raw as CommitMetaData[]) : [];
}

/**
 * GET /plugins/version-history/repoChanges
 * Mirrors Java's ChangesTabPanel → getRepoChanges().
 * Returns the current working-tree changes (modified, deleted, untracked files).
 */
export async function getRepoChanges(): Promise<RepoChanges> {
  const raw = await request<unknown>("/plugins/version-history/repoChanges", {
    skipNormalize: true,
  });
  const r = raw as RepoChanges;
  return {
    modifiedFiles: r?.modifiedFiles ?? [],
    deletedFiles: r?.deletedFiles ?? [],
    untrackedFiles: r?.untrackedFiles ?? [],
  };
}

/**
 * GET /plugins/version-history/repoInfo
 * Mirrors Java's GitStatusTabPanel → getRepoInfo().
 * Returns local repo path, remote URL, branch, size, and folder structure.
 */
export async function getRepoInfo(): Promise<RepoInfo> {
  const raw = await request<RepoInfo>("/plugins/version-history/repoInfo", {
    skipNormalize: true,
  });
  return raw;
}

/**
 * GET /plugins/version-history/channel_on_repo
 * Mirrors Java's FilesTabPanel → getChannelsOnRepo().
 * Returns metadata for all channels tracked in the repository.
 */
export async function getChannelsOnRepo(): Promise<RepoItemMetadata[]> {
  const raw = await request<unknown>("/plugins/version-history/channel_on_repo", {
    skipNormalize: true,
  });
  return Array.isArray(raw) ? (raw as RepoItemMetadata[]) : [];
}

/**
 * GET /plugins/version-history/code_template_on_repo
 * Returns metadata for all code templates tracked in the repository.
 */
export async function getCodeTemplatesOnRepo(): Promise<RepoItemMetadata[]> {
  const raw = await request<unknown>("/plugins/version-history/code_template_on_repo", {
    skipNormalize: true,
  });
  return Array.isArray(raw) ? (raw as RepoItemMetadata[]) : [];
}

/**
 * GET /plugins/version-history/history?fileName=<id>&mode=<mode>[&limit=<n>]
 * Mirrors Java's ChannelHistoryTabPanel → loadHistory().
 * Returns commits for a single entity (channel, code template, etc.), newest first.
 *
 * `limit` truncates the list to the newest N commits and is ALWAYS applied
 * client-side when positive, so the control works against every server version.
 * `sendLimitToServer` separately controls whether `limit` is also put on the
 * query string — callers pass the `hasHistoryLimitParam` capability here so only
 * 26.6.0+ servers (which honor it) get the param and can truncate server-side to
 * save payload. The capability check stays outside this otherwise-pure function.
 */
export async function getEntityHistory(
  id: string,
  mode: VhMode,
  opts?: { limit?: number; sendLimitToServer?: boolean }
): Promise<CommitMetaData[]> {
  const limit = opts?.limit;
  const params = new URLSearchParams({ fileName: id, mode });
  if (opts?.sendLimitToServer && limit != null && limit > 0) {
    params.set("limit", String(limit));
  }
  const raw = await request<unknown>(`/plugins/version-history/history?${params}`, {
    skipNormalize: true,
  });
  const list = Array.isArray(raw) ? (raw as CommitMetaData[]) : [];
  return limit != null && limit > 0 ? list.slice(0, limit) : list;
}

/**
 * GET /plugins/version-history/content?id=<id>&revision=<sha>&mode=<mode>
 * Returns the raw XML of an entity at a specific commit revision.
 * @param revision  Commit SHA or "HEAD" for latest.
 */
export async function getEntityContentAtRevision(
  id: string,
  revision: string,
  mode: VhMode
): Promise<string> {
  const params = new URLSearchParams({ id, revision, mode });
  return request<string>(`/plugins/version-history/content?${params}`, {
    rawText: true,
    headers: { Accept: "text/plain, */*" },
  });
}

/**
 * GET /plugins/version-history/commitChanges?commitHash=<hash>
 * Returns the list of files changed in a specific commit as RepoItemChange objects.
 */
export async function getCommitChanges(commitHash: string): Promise<RepoItemChange[]> {
  const params = new URLSearchParams({ commitHash });
  const raw = await request<unknown>(`/plugins/version-history/commitChanges?${params}`, {
    skipNormalize: true,
  });
  return Array.isArray(raw) ? (raw as RepoItemChange[]) : [];
}

/**
 * GET /plugins/version-history/libraries_and_templates
 * Returns all code template libraries and their associated template metadata from the repo.
 * Mirrors Java's ImportCodeTemplateDialog → loadLibrariesAndTemplateMetadata().
 */
export async function getLibrariesAndTemplates(): Promise<LibrariesAndTemplatesResponse> {
  const raw = await request<unknown>("/plugins/version-history/libraries_and_templates", {
    skipNormalize: true,
  });
  const r = raw as LibrariesAndTemplatesResponse;
  return {
    libraries: Array.isArray(r?.libraries) ? r.libraries : [],
    templates: Array.isArray(r?.templates) ? r.templates : [],
  };
}

/**
 * POST /plugins/version-history/writeChannel
 * Writes the channel XML to the git working tree after a channel save, so it appears
 * in the "Local Changes" tab and triggers the uncommitted-changes indicator on the
 * Channels page.
 *
 * Mirrors Java's VersionHistoryServiceClient.writeChannel() called from the Swing
 * ChannelPlugin.save() when auto-commit is disabled.
 *
 * TODO: When auto-commit is enabled, the Java client also calls doCommitAndPushCurrentChannel()
 * after writeChannel(). The Web UI will need to:
 *  1. Fetch version history settings to check isEnableAutoCommit / isEnableAutoCommitPrompt
 *  2. If auto-commit + prompt: show a commit message dialog, then call the commit endpoint
 *  3. If auto-commit, no prompt: call the commit endpoint with the default commit message
 * This is intentionally deferred — implement once the commit endpoint details are confirmed.
 */
export async function writeChannelToRepo(channelXml: string): Promise<void> {
  await request<void>("/plugins/version-history/writeChannel", {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: channelXml,
    skipNormalize: true,
  });
}

/**
 * GET /plugins/version-history/fileContentAtRevision?filePath=<path>&commitHash=<hash>
 * Returns the raw content of a file at a specific commit (raw XML / plain text).
 * Uses rawText: true because the server returns XML, not JSON.
 * @param filePath   Repo-relative file path (e.g. "channels/<id>")
 * @param commitHash Full commit SHA
 */
export async function getFileContentAtRevision(
  filePath: string,
  commitHash: string
): Promise<string> {
  const params = new URLSearchParams({ filePath, commitHash });
  return request<string>(`/plugins/version-history/fileContentAtRevision?${params}`, {
    rawText: true,
    headers: { Accept: "text/plain, */*" },
  });
}

// ─── Auto-commit settings ─────────────────────────────────────────────────────

/** Auto-commit settings for the Version History plugin. */
export interface VhAutoCommitSettings {
  autoCommitEnabled: boolean;
  /** When true, user is prompted to enter a commit message before committing. */
  promptEnabled: boolean;
  /** Default commit message used when prompt is disabled. */
  defaultMessage: string;
}

/**
 * Fetches the auto-commit settings from the Version History plugin properties.
 * Returns safe defaults (all disabled) if the fetch fails.
 */
export async function getVersionHistoryAutoCommitSettings(): Promise<VhAutoCommitSettings> {
  try {
    const props = await getPluginProperties("Version History Plugin");
    return {
      autoCommitEnabled: props["versionHistory.auto.commit.enable"] === "true",
      promptEnabled: props["versionHistory.auto.commit.prompt"] === "true",
      defaultMessage: props["versionHistory.auto.commit.message"] ?? "",
    };
  } catch {
    return { autoCommitEnabled: false, promptEnabled: false, defaultMessage: "" };
  }
}

// ─── Commit & push endpoints ──────────────────────────────────────────────────

/**
 * POST /plugins/version-history/commitAndPushChannel
 * Commits the full channel XML to git and pushes to remote.
 *
 * Mirrors Java's VersionHistoryServiceClient.doCommitAndPushCurrentChannel().
 * Called after writeChannelToRepo() when auto-commit is enabled.
 *
 * @param channelXml  Full channel XML (same payload used in writeChannelToRepo)
 * @param message     Commit message
 * @param userId      Numeric ID of the committing user (from getSession())
 * @param overwrite   When true (default), pull with overwrite on remote conflicts
 */
export async function commitAndPushChannel(
  channelXml: string,
  message: string,
  userId: number,
  overwrite = true
): Promise<void> {
  const params = new URLSearchParams({
    message,
    userId: String(userId),
    overwrite: String(overwrite),
  });
  await request<void>(`/plugins/version-history/commitAndPushChannel?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: channelXml,
    rawText: true,
  });
}

/**
 * POST /plugins/version-history/commitAndPushGlobalScripts
 * Commits all four global scripts (Deploy / Undeploy / Preprocessor / Postprocessor)
 * as a single commit and pushes to remote.
 *
 * Mirrors Java's VersionHistoryServiceClient.commitAndPushGlobalScripts(). The
 * server reads the body as a `Map<String,String>` via XStream, so the body must
 * be the XStream `<map>` envelope (NOT a plain JSON object). Permission is
 * enforced server-side (GLOBAL_SCRIPTS_EDIT).
 *
 * @param scripts  Map of script type → content. Keys must be the BridgeLink
 *                 global-script names: "Deploy", "Undeploy", "Preprocessor",
 *                 "Postprocessor".
 * @param message  Commit message
 * @param userId   Numeric ID of the committing user (from getSession())
 */
export async function commitAndPushGlobalScripts(
  scripts: Record<string, string>,
  message: string,
  userId: number
): Promise<void> {
  const params = new URLSearchParams({ message, userId: String(userId) });
  const entries = Object.entries(scripts)
    .map(
      ([key, value]) =>
        `  <entry>\n    <string>${escXml(key)}</string>\n    <string>${escXml(value ?? "")}</string>\n  </entry>`
    )
    .join("\n");
  const xml = `<map>\n${entries}\n</map>`;
  await request<void>(`/plugins/version-history/commitAndPushGlobalScripts?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: xml,
    rawText: true,
  });
}

/**
 * POST /plugins/version-history/commitAndPushFiles
 * Commits and pushes a selected set of working-tree files to the remote.
 *
 * Used by the Local Changes tab "Commit & Push" action when the user selects
 * specific files to include in the commit.
 *
 * @param filePaths  Repo-relative paths of files to commit (e.g. "channels/abc-123")
 * @param message    Commit message
 * @param userId     Numeric ID of the committing user (from getSession())
 */
export async function commitAndPushFiles(
  filePaths: string[],
  message: string,
  userId: number
): Promise<void> {
  await request<void>("/plugins/version-history/commitAndPushFiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filePaths, message, userId }),
    rawText: true,
  });
}

/**
 * GET /plugins/version-history/fileContent?filePath=<path>
 * Returns the current working-tree content of a file (CURRENT state).
 * Used in the Local Changes diff view to show the right-hand (new) side.
 *
 * @param filePath  Repo-relative file path (e.g. "channels/abc-123")
 */
export async function getFileContent(filePath: string): Promise<string> {
  const params = new URLSearchParams({ filePath });
  return request<string>(`/plugins/version-history/fileContent?${params}`, {
    rawText: true,
    headers: { Accept: "text/plain, */*" },
  });
}

/**
 * GET /plugins/version-history/fileContentAtHead?filePath=<path>
 * Returns the last-committed (HEAD) content of a file.
 * Used in the Local Changes diff view to show the left-hand (old) side.
 *
 * @param filePath  Repo-relative file path (e.g. "channels/abc-123")
 */
export async function getFileContentAtHead(filePath: string): Promise<string> {
  const params = new URLSearchParams({ filePath });
  return request<string>(`/plugins/version-history/fileContentAtHead?${params}`, {
    rawText: true,
    headers: { Accept: "text/plain, */*" },
  });
}

/**
 * POST /plugins/version-history/restoreFiles
 * Restores file content in the working tree (no commit).
 * Used to discard local changes on modified or deleted files by writing back
 * their HEAD content.
 *
 * @param files  Map of repo-relative path → content to restore
 */
export async function restoreFiles(files: Record<string, string>): Promise<void> {
  await request<void>("/plugins/version-history/restoreFiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(files),
    rawText: true,
  });
}

/**
 * POST /plugins/version-history/commitAndPushCodeTemplate
 * Commits a code template (fetched server-side by ID) and pushes to remote.
 *
 * Note: unlike commitAndPushChannel, no request body is needed — the server
 * fetches the template from its own store using codeTemplateId.
 *
 * @param codeTemplateId  UUID of the code template
 * @param message         Commit message
 * @param userId          Numeric ID of the committing user
 * @param overwrite       When true (default), pull with overwrite on remote conflicts
 */
export async function commitAndPushCodeTemplate(
  codeTemplateId: string,
  message: string,
  userId: number,
  overwrite = true
): Promise<void> {
  const params = new URLSearchParams({
    codeTemplateId,
    message,
    userId: String(userId),
    overwrite: String(overwrite),
  });
  await request<void>(`/plugins/version-history/commitAndPushCodeTemplate?${params}`, {
    method: "POST",
    rawText: true,
  });
}

/**
 * POST /plugins/version-history/saveLibraries
 * Writes all provided libraries to the git working tree, commits, and pushes.
 * Mirrors Java's CodeTemplateOperations.saveLibraries().
 *
 * @param libraries  All current CodeTemplateLibrary objects to commit
 * @param message    Commit message
 * @param userId     Numeric ID of the committing user
 */
export async function saveLibraries(
  libraries: CodeTemplateLibrary[],
  message: string,
  userId: number
): Promise<void> {
  const params = new URLSearchParams({ message, userId: String(userId) });
  // The server expects a multipart "libraries" field containing a <list> of
  // <codeTemplateLibrary> XML elements (same format as _bulkUpdate stubs).
  const xml = `<list>\n${libraries.map((lib) => `  ${serializeLibraryForRepo(lib).replace(/\n/g, "\n  ")}`).join("\n")}\n</list>`;
  const fd = new FormData();
  fd.append("libraries", new Blob([xml], { type: "application/xml" }), "libraries.xml");
  await request<void>(`/plugins/version-history/saveLibraries?${params}`, {
    method: "POST",
    body: fd,
    rawText: true,
  });
}

// ─── Remote actions (version-history 3.0.1 / BridgeLink 26.3.1+) ──────────────

/**
 * GET /plugins/version-history/remoteStatus
 *
 * Fetches from origin and returns the ahead/behind commit counts for the
 * tracked branch. Powers the Status tab's Reload button. Throws on older
 * servers (404) — callers must gate via `usePluginCapabilities()`.
 */
export async function getRemoteStatus(): Promise<RemoteStatus> {
  const raw = await request<unknown>("/plugins/version-history/remoteStatus", {
    skipNormalize: true,
  });
  const r = raw as Partial<RemoteStatus> | null;
  return {
    aheadCount: typeof r?.aheadCount === "number" ? r.aheadCount : 0,
    behindCount: typeof r?.behindCount === "number" ? r.behindCount : 0,
  };
}

/**
 * POST /plugins/version-history/pull
 *
 * Pulls from remote with a normal merge; conflicts are auto-resolved by
 * taking the remote version. Local unpushed commits are preserved. Throws on
 * older servers (404) — callers must gate via `usePluginCapabilities()`.
 */
export async function pullRemote(): Promise<void> {
  await request<void>("/plugins/version-history/pull", {
    method: "POST",
    rawText: true,
  });
}

/**
 * POST /plugins/version-history/push
 *
 * Pushes already-committed local work to remote (internally fetch + rebase +
 * push). Returns JSON `"OK"` on success. On rebase conflict the server
 * returns 409 with a GIT_CONFLICT ErrorResponse body — surfaced as a thrown
 * Error by `request()`. Throws on older servers (404) — callers must gate via
 * `usePluginCapabilities()`.
 */
export async function pushRemote(): Promise<void> {
  await request<void>("/plugins/version-history/push", {
    method: "POST",
    rawText: true,
  });
}
