import {
  MODE_CHANNEL,
  MODE_CODE_TEMPLATE,
  MODE_CODE_TEMPLATE_LIBRARY,
  MODE_GLOBAL_SCRIPTS,
  type VhMode,
  type RepoFile,
} from "../api-version-history";

export interface SelectedFile {
  file: RepoFile;
  folderName: string;
  mode: VhMode;
}

export function folderMode(folderName: string): VhMode {
  const lower = folderName.toLowerCase();
  if (lower === "channels") return MODE_CHANNEL;
  if (lower === "codetemplates") return MODE_CODE_TEMPLATE;
  if (lower === "libraries") return MODE_CODE_TEMPLATE_LIBRARY;
  if (lower === "globalscripts") return MODE_GLOBAL_SCRIPTS;
  return MODE_CHANNEL;
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type DiffMode = "parent" | "working-tree" | "head";
