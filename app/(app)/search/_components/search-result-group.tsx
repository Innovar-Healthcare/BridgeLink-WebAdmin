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
import type {
  NavigationTarget,
  SearchSourceCategory,
  SourceResult,
} from "@/lib/search/search-types";
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

interface SearchResultGroupProps {
  category: SearchSourceCategory;
  sources: SourceResult[];
  query: string;
}

/**
 * Collapsible group of search results for a single category.
 * Shows the category header with total match count, then each source
 * with its segment-level matches.
 */
export function SearchResultGroup({ category, sources, query }: SearchResultGroupProps) {
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
            <SourceResultCard key={source.id} source={source} query={query} />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceResultCard({ source, query }: { source: SourceResult; query: string }) {
  const [expanded, setExpanded] = useState(true);
  const router = useRouter();

  function handleNavigate(target: NavigationTarget): void {
    switch (target.type) {
      case "channel-summary":
        router.push(`/channels/${target.channelId}/edit`);
        break;
      case "channel-scripts":
        router.push(`/channels/${target.channelId}/edit?tab=scripts&script=${target.script}`);
        break;
      case "channel-source":
        router.push(`/channels/${target.channelId}/edit?tab=source&sub=${target.sub}`);
        break;
      case "channel-destination":
        router.push(
          `/channels/${target.channelId}/edit?tab=destination&dest=${target.destIndex}&sub=${target.sub}`
        );
        break;
      case "channel-attachment":
        router.push(`/channels/${target.channelId}/edit?tab=summary`);
        break;
      case "code-template":
        router.push(`/code-templates?templateId=${target.templateId}`);
        break;
      case "global-script":
        router.push(`/global-scripts?tab=${target.scriptKey}`);
        break;
      case "config-map":
        router.push(`/settings?tab=configuration-map`);
        break;
    }
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
            <div key={i}>
              <div className="flex items-center gap-1">
                <SearchResultItem
                  segment={segResult.segment}
                  matches={segResult.matches}
                  query={query}
                />
                <button
                  onClick={() => handleNavigate(segResult.segment.navigateTo)}
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
