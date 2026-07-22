"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Copy, ExternalLink, History } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import type { RepoFile, RepoFolder } from "../api-version-history";
import type { SelectedFile } from "./tab-helpers";

interface FileTreePanelProps {
  folders: RepoFolder[];
  filterLower: string;
  collapsed: Set<string>;
  selectedFile: SelectedFile | null;
  rowPy: string;
  onToggleFolder: (name: string) => void;
  onSelectFile: (file: RepoFile, folderName: string) => void;
  resolveFileName: (fileName: string, folderName: string) => string;
  editorHrefForFile: (file: RepoFile, folderName: string) => string | null;
}

export function FileTreePanel({
  folders,
  filterLower,
  collapsed,
  selectedFile,
  rowPy,
  onToggleFolder,
  onSelectFile,
  resolveFileName,
  editorHrefForFile,
}: FileTreePanelProps) {
  const router = useRouter();

  return (
    <div className="w-[280px] shrink-0 overflow-y-auto border border-border rounded">
      {folders.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-12">
          No files tracked in repository
        </p>
      )}

      {folders.map((folder) => {
        const isOpen = !collapsed.has(folder.name);
        const visibleFiles = filterLower
          ? folder.files.filter((f) => {
              const display = resolveFileName(f.name, folder.name).toLowerCase();
              return display.includes(filterLower) || f.name.toLowerCase().includes(filterLower);
            })
          : folder.files;

        return (
          <div key={folder.name}>
            <button
              onClick={() => onToggleFolder(folder.name)}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-border transition-colors"
            >
              {isOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 shrink-0" />
              )}
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                {folder.name}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                ({folder.fileCount} file{folder.fileCount !== 1 ? "s" : ""})
              </span>
            </button>

            {isOpen &&
              visibleFiles.map((file) => {
                const isSelected =
                  selectedFile?.file.name === file.name && selectedFile?.folderName === folder.name;
                const href = editorHrefForFile(file, folder.name);
                return (
                  <ContextMenu key={file.name}>
                    <ContextMenuTrigger asChild>
                      <button
                        onClick={() => onSelectFile(file, folder.name)}
                        className={cn(
                          "w-full text-left flex items-center gap-2 pl-8 pr-3 border-b border-border transition-colors",
                          rowPy,
                          isSelected
                            ? "bg-blue-100 dark:bg-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                            : "hover:bg-blue-50 dark:hover:bg-blue-900/10"
                        )}
                      >
                        <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                        <span
                          className="text-xs text-gray-800 dark:text-gray-200 flex-1 truncate min-w-0"
                          title={file.name}
                        >
                          {resolveFileName(file.name, folder.name)}
                        </span>
                        <ChevronRight className="w-3 h-3 text-gray-400 dark:text-gray-500 shrink-0" />
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => onSelectFile(file, folder.name)}>
                        <History className="w-4 h-4 mr-2" />
                        View History
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => {
                          void navigator.clipboard.writeText(file.name);
                          toast.success("File name copied");
                        }}
                      >
                        <Copy className="w-4 h-4 mr-2" />
                        Copy File Name
                      </ContextMenuItem>
                      {href && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={() => router.push(href)}>
                            <ExternalLink className="w-4 h-4 mr-2" />
                            Open in Editor
                          </ContextMenuItem>
                        </>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
