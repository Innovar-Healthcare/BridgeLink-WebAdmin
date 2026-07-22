"use client";

/**
 * Version History Page — /p/version-history
 *
 * Four tabs matching Java's plugin panels:
 *   Commits       → full repo commit log (repoLog)
 *   Local Changes → working-tree changes (repoChanges)
 *   Files         → channels & code templates tracked in repo (repoInfo)
 *   Status        → repo info (repoInfo)
 *
 * Each tab loads its data lazily on first activation.
 * The Local Changes tab shows a live count badge fetched on mount so the user
 * knows there are pending changes without having to click into the tab first.
 */

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useCompactMode, pagePadding } from "@/lib/hooks/use-compact-mode";

import { getRepoChanges } from "./api-version-history";
import { RepoLogTab } from "./_components/repo-log-tab";
import { ChangesTab } from "./_components/changes-tab";
import { FilesTab } from "./_components/channels-tab";
import { StatusTab } from "./_components/status-tab";

type VhTab = "commits" | "changes" | "files" | "status";

export function VersionHistoryPage() {
  const { viewDensity } = useCompactMode();
  // Track which tabs have been activated so we lazy-load data
  const [activated, setActivated] = useState<Set<VhTab>>(new Set(["commits"]));
  const [activeTab, setActiveTab] = useState<VhTab>("commits");

  // Live change count for the Local Changes tab badge.
  // Fetched on mount so the badge is visible before the user clicks the tab.
  const [localChangesCount, setLocalChangesCount] = useState<number | null>(null);

  useEffect(() => {
    getRepoChanges()
      .then((data) => {
        setLocalChangesCount(
          data.modifiedFiles.length + data.deletedFiles.length + data.untrackedFiles.length
        );
      })
      .catch(() => {
        // Silently ignore — badge simply won't show if the fetch fails
      });
  }, []);

  function handleTabChange(value: string) {
    const tab = value as VhTab;
    setActiveTab(tab);
    setActivated((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header runs full-bleed; PageHeader provides its own internal padding. */}
      <div className="shrink-0">
        <PageHeader
          title="Version History"
          subtitle="Git-based version tracking for channels and code templates"
        />
      </div>

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className={`flex flex-col flex-1 min-h-0 ${pagePadding(viewDensity)}`}
      >
        <TabsList>
          <TabsTrigger value="commits">Commits</TabsTrigger>
          <TabsTrigger value="changes">
            Local Changes
            {localChangesCount !== null && localChangesCount > 0 && (
              <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-[10px] font-semibold px-1.5 min-w-[18px] leading-[18px]">
                {localChangesCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="status">Status</TabsTrigger>
        </TabsList>

        <TabsContent value="commits" className="flex-1 min-h-0 mt-3">
          {activated.has("commits") && <RepoLogTab />}
        </TabsContent>

        <TabsContent value="changes" className="flex-1 min-h-0 mt-3">
          {activated.has("changes") && <ChangesTab onCountChange={setLocalChangesCount} />}
        </TabsContent>

        <TabsContent value="files" className="flex-1 min-h-0 mt-3">
          {activated.has("files") && <FilesTab />}
        </TabsContent>

        <TabsContent value="status" className="flex-1 min-h-0 mt-3">
          {activated.has("status") && <StatusTab />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
