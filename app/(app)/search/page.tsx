"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, CaseSensitive, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { useCache, useChannels } from "@/lib/hooks/use-cache";
import { useCompactMode, pagePadding } from "@/lib/hooks/use-compact-mode";
import { buildSearchIndex, executeSearch, type BuildIndexOptions } from "@/lib/search/search-index";
import type {
  IndexProgress,
  SearchResult,
  SearchScope,
  SearchSourceCategory,
} from "@/lib/search/search-types";
import { SearchResultGroup } from "./_components/search-result-group";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { Input } from "@/components/ui/input";

const DEFAULT_SCOPE: SearchScope = {
  channels: true,
  codeTemplates: true,
  globalScripts: true,
  configMap: true,
};

const SCOPE_LABELS: Array<{ key: keyof SearchScope; label: string }> = [
  { key: "channels", label: "Channels" },
  { key: "codeTemplates", label: "Code Templates" },
  { key: "globalScripts", label: "Global Scripts" },
  { key: "configMap", label: "Config Map" },
];

export default function SearchPage() {
  const { viewDensity } = useCompactMode();
  const cache = useCache();
  // Ensure channel data is loaded (user may navigate directly to /search)
  useChannels();

  // Search state
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [scope, setScope] = useState<SearchScope>(DEFAULT_SCOPE);

  // Execution state
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Abort controller for cancellation
  const abortRef = useRef<AbortController | null>(null);

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResult(null);
      return;
    }

    // Cancel any in-progress search
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSearching(true);
    setError(null);
    setProgress(null);

    try {
      // Always rebuild the index — channel XML cache (revision-based) inside
      // buildSearchIndex ensures unchanged channels aren't re-fetched.
      const opts: BuildIndexOptions = {
        channels: cache.channelMap,
        scope,
        signal: controller.signal,
        onProgress: setProgress,
      };
      const indexedSources = await buildSearchIndex(opts);

      if (controller.signal.aborted) return;

      // Execute text search against indexed sources
      const searchResult = executeSearch(indexedSources, {
        query: trimmed,
        caseSensitive,
        scope,
      });
      setResult(searchResult);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      if (!controller.signal.aborted) {
        setSearching(false);
        setProgress(null);
      }
    }
  }, [query, caseSensitive, scope, cache.channelMap]);

  // Cleanup abort on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "Enter") {
      handleSearch();
    }
  }

  function handleScopeChange(key: keyof SearchScope): void {
    setScope((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // Group results by category for display
  const groupedResults: Array<{
    category: SearchSourceCategory;
    sources: NonNullable<SearchResult>["sources"];
  }> = [];
  if (result) {
    const categories: SearchSourceCategory[] = [
      "channel",
      "codeTemplate",
      "globalScript",
      "configMap",
    ];
    for (const cat of categories) {
      const sources = result.sources.filter((s) => s.category === cat);
      if (sources.length > 0) {
        groupedResults.push({ category: cat, sources });
      }
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Config Search"
        subtitle="Search across all channels, code templates, global scripts, and configuration"
      />
      <ApiErrorAlert error={error} />

      {/* Search controls */}
      <div className={`${pagePadding(viewDensity)} border-b border-border space-y-3`}>
        {/* Search input row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search configuration..."
              density={viewDensity}
              className="w-full pl-10 pr-3"
              autoFocus
            />
          </div>
          <button
            onClick={() => setCaseSensitive(!caseSensitive)}
            title={caseSensitive ? "Case sensitive (on)" : "Case sensitive (off)"}
            className={`p-2 rounded-md border transition-colors ${
              caseSensitive
                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                : "border-border text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            }`}
          >
            <CaseSensitive className="w-4 h-4" />
          </button>
          <button
            onClick={handleSearch}
            disabled={searching || !query.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors flex items-center gap-2"
          >
            {searching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            Search
          </button>
        </div>

        {/* Scope filters */}
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500 dark:text-gray-400">Search in:</span>
          {SCOPE_LABELS.map(({ key, label }) => (
            <FormCheckbox
              key={key}
              label={label}
              checked={scope[key]}
              onChange={() => handleScopeChange(key)}
              size="xs"
            />
          ))}
        </div>

        {/* Progress indicator */}
        {searching && progress && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>Indexing {progress.phase === "channels" ? "channels" : progress.phase}...</span>
              {progress.phase === "channels" && (
                <span>
                  {progress.indexed} / {progress.total}
                </span>
              )}
            </div>
            {progress.phase === "channels" && progress.total > 0 && (
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                <div
                  className="bg-blue-600 h-1.5 rounded-full transition-all duration-200"
                  style={{ width: `${(progress.indexed / progress.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Results */}
      <div className={`flex-1 overflow-y-auto ${pagePadding(viewDensity)}`}>
        {/* Empty state before search */}
        {!result && !searching && !error && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 dark:text-gray-500">
            <Search className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-sm">Enter a search term and press Enter or click Search</p>
            <p className="text-xs mt-1">
              Searches channel scripts, connector properties, code templates, global scripts, and
              configuration map
            </p>
          </div>
        )}

        {/* No results */}
        {result && result.totalMatches === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 dark:text-gray-500">
            <Search className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-sm">No matches found for &quot;{result.query}&quot;</p>
            <p className="text-xs mt-1">Try a different search term or expand the search scope</p>
          </div>
        )}

        {/* Results summary */}
        {result && result.totalMatches > 0 && (
          <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            {result.totalMatches} match{result.totalMatches !== 1 ? "es" : ""} across{" "}
            {result.sources.length} source{result.sources.length !== 1 ? "s" : ""}
          </div>
        )}

        {/* Grouped results */}
        {groupedResults.map(({ category, sources }) => (
          <SearchResultGroup
            key={category}
            category={category}
            sources={sources}
            query={result?.query ?? query}
          />
        ))}
      </div>
    </div>
  );
}
