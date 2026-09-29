"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Code2,
  ScrollText,
  Settings,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buildSearchResultHref, targetSupportsLine } from "@/lib/search/search-nav";
import { searchResultKey } from "@/lib/search/search-session";
import type { SearchSourceCategory, SourceResult } from "@/lib/search/search-types";
import { SearchResultItem } from "./search-result-item";

const CATEGORY_CONFIG: Record<
  SearchSourceCategory,
  { label: string; icon: typeof GitBranch; color: string }
> = {
  channel: { label: "Channels", icon: GitBranch, color: "text-blue-600 dark:text-blue-400" },
  codeTemplate: {
    label: "Code Templates",
    icon: Code2,
    color: "text-purple-600 dark:text-purple-400",
  },
  globalScript: {
    label: "Global Scripts",
    icon: ScrollText,
    color: "text-green-600 dark:text-green-400",
  },
  configMap: {
    label: "Configuration Map",
    icon: Settings,
    color: "text-orange-600 dark:text-orange-400",
  },
};

/** Bookkeeping shared by every result row, so returning to /search is useful. */
interface ResultTrackingProps {
  /** Result keys already opened this session — rendered dimmed. */
  visited: Set<string>;
  /** The row to flash once on return from a match. */
  flashKey: string | null;
  /** Called just before navigating, to record what was opened. */
  onOpened: (key: string) => void;
}

interface SearchResultGroupProps extends ResultTrackingProps {
  category: SearchSourceCategory;
  sources: SourceResult[];
  query: string;
}

/**
 * Collapsible group of search results for a single category.
 * Shows the category header with total match count, then each source
 * with its segment-level matches.
 */
export function SearchResultGroup({
  category,
  sources,
  query,
  visited,
  flashKey,
  onOpened,
}: SearchResultGroupProps) {
  const [expanded, setExpanded] = useState(true);
  const config = CATEGORY_CONFIG[category];
  const Icon = config.icon;
  const totalMatches = sources.reduce((sum, s) => sum + s.totalMatches, 0);

  return (
    <div className="mb-4">
      {/* Category header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        )}
        <Icon className={cn("w-4 h-4", config.color)} />
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {config.label}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          ({totalMatches} match{totalMatches !== 1 ? "es" : ""} in {sources.length} source
          {sources.length !== 1 ? "s" : ""})
        </span>
      </button>

      {/* Source results */}
      {expanded && (
        <div className="ml-2 mt-1 space-y-2">
          {sources.map((source) => (
            <SourceResultCard
              key={source.id}
              source={source}
              query={query}
              visited={visited}
              flashKey={flashKey}
              onOpened={onOpened}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceResultCard({
  source,
  query,
  visited,
  flashKey,
  onOpened,
}: { source: SourceResult; query: string } & ResultTrackingProps) {
  const [expanded, setExpanded] = useState(true);
  const router = useRouter();

  /**
   * `line` is omitted when opening the segment as a whole (the ExternalLink) and
   * supplied when opening one matched line. `buildSearchResultHref` decides
   * whether the destination can actually use it.
   */
  function openSegment(segmentIndex: number, line?: number): void {
    const segment = source.segments[segmentIndex]?.segment;
    if (!segment) return;
    onOpened(searchResultKey(source.category, source.id, segmentIndex, line));
    router.push(buildSearchResultHref(segment.navigateTo, line));
  }

  return (
    <div className="border border-border rounded-md bg-white dark:bg-gray-900">
      {/* Source header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-t-md transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
        )}
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
          {source.name}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
          ({source.totalMatches} match{source.totalMatches !== 1 ? "es" : ""})
        </span>
      </button>

      {/* Segment results */}
      {expanded && (
        <div className="px-3 pb-2 space-y-2">
          {source.segments.map((segResult, i) => (
            // The segment-level key is the one recorded when the whole segment is
            // opened via the icon below, so it needs a node to scroll back to on
            // return just as much as the individual line rows do.
            <div key={i} data-result-key={searchResultKey(source.category, source.id, i)}>
              <div className="flex items-start gap-1">
                <SearchResultItem
                  segment={segResult.segment}
                  matches={segResult.matches}
                  query={query}
                  linkable={segResult.segment.lineBasis === "editor"}
                  lineNavigable={targetSupportsLine(segResult.segment.navigateTo)}
                  onOpenLine={(line) => openSegment(i, line)}
                  lineKey={(line) => searchResultKey(source.category, source.id, i, line)}
                  visited={visited}
                  flashKey={flashKey}
                />
                <button
                  onClick={() => openSegment(i)}
                  className="ml-auto shrink-0 p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  title="Open in editor"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
