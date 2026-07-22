"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { HoverTooltip } from "@/components/hover-tooltip";
import { InfoTooltip } from "@/components/info-tooltip";
import { cn } from "@/lib/utils";
import { getShortHash, type CommitMetaData } from "../api-version-history";
import { DiffView } from "./diff-view";
import type { DiffMode } from "./tab-helpers";

interface DiffPanelProps {
  compareMode: boolean;
  compareFrom: CommitMetaData | null;
  compareTo: CommitMetaData | null;
  selectedHistoryCommit: CommitMetaData | null;
  history: CommitMetaData[];
  diffMode: DiffMode;
  diffLoading: boolean;
  diffError: string | null;
  oldContent: string | null;
  newContent: string | null;
  onDiffModeChange: (mode: DiffMode) => void;
}

export function DiffPanel({
  compareMode,
  compareFrom,
  compareTo,
  selectedHistoryCommit,
  history,
  diffMode,
  diffLoading,
  diffError,
  oldContent,
  newContent,
  onDiffModeChange,
}: DiffPanelProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {!compareMode && selectedHistoryCommit && (
        <div className="flex items-center gap-2 mb-1.5 shrink-0">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Compare:</span>
          <div className="inline-flex rounded border border-border overflow-hidden">
            {[
              {
                key: "parent" as DiffMode,
                label: "Parent → Commit",
                tip: "Shows what changed in this commit compared to the previous commit",
              },
              {
                key: "working-tree" as DiffMode,
                label: "Current → Commit",
                tip: "Compares the current file as it exists now (including unsaved edits) against this commit",
              },
              ...(history.length === 0 || history[0].hash !== selectedHistoryCommit?.hash
                ? [
                    {
                      key: "head" as DiffMode,
                      label: "Last Saved → Commit",
                      tip: "Compares the most recently committed version of this file against this commit",
                    },
                  ]
                : []),
            ].map(({ key, label, tip }) => (
              <HoverTooltip key={key} content={tip}>
                <button
                  onClick={() => onDiffModeChange(key)}
                  className={cn(
                    "px-2 py-0.5 text-[11px] font-medium transition-colors border-r last:border-r-0 border-border",
                    diffMode === key
                      ? "bg-blue-600 text-white"
                      : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                  )}
                >
                  {label}
                </button>
              </HoverTooltip>
            ))}
          </div>
          <InfoTooltip
            text="Current = the file as it exists now (may include unsaved edits). Last Saved = the most recently committed version. Parent = the commit before the selected one."
            side="bottom"
            iconSize="w-3 h-3"
          />
        </div>
      )}

      <div className="flex-1 min-h-0">
        {compareMode &&
          compareFrom &&
          compareTo &&
          compareFrom.hash === compareTo.hash &&
          !diffLoading && (
            <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
              Same revision selected — no changes to display
            </div>
          )}
        {!compareMode && !selectedHistoryCommit && !diffLoading && (
          <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
            Select a commit to view diff
          </div>
        )}
        {compareMode && !(compareFrom && compareTo) && !diffLoading && (
          <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500 border border-dashed border-border rounded">
            Select two commits to compare
          </div>
        )}
        {diffLoading && (
          <div className="space-y-2 pt-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        )}
        {diffError && <ApiErrorAlert error={diffError} />}
        {!diffLoading &&
          !diffError &&
          oldContent !== null &&
          newContent !== null &&
          (compareMode
            ? compareFrom && compareTo && compareFrom.hash !== compareTo.hash
            : selectedHistoryCommit) && (
            <DiffView
              oldContent={oldContent}
              newContent={newContent}
              oldLabel={
                compareMode && compareFrom
                  ? getShortHash(compareFrom.hash)
                  : diffMode === "working-tree"
                    ? "Current"
                    : diffMode === "head"
                      ? "Last Saved"
                      : selectedHistoryCommit
                        ? `before ${getShortHash(selectedHistoryCommit.hash)}`
                        : ""
              }
              newLabel={
                compareMode && compareTo
                  ? getShortHash(compareTo.hash)
                  : selectedHistoryCommit
                    ? getShortHash(selectedHistoryCommit.hash)
                    : ""
              }
              copyContent={newContent}
            />
          )}
      </div>
    </div>
  );
}
