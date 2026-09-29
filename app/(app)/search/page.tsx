"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search, CaseSensitive, Loader2, RotateCw, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { useCache, useChannels } from "@/lib/hooks/use-cache";
import { useCompactMode, pagePadding } from "@/lib/hooks/use-compact-mode";
import { buildSearchIndex, executeSearch, type BuildIndexOptions } from "@/lib/search/search-index";
import {
  clearSearchSession,
  getSearchSession,
  markSearchResultOpened,
  saveSearchSession,
} from "@/lib/search/search-session";
import {
  computeSearchStaleness,
  describeStaleness,
  scopesEqual,
  snapshotChannelRevisions,
} from "@/lib/search/search-staleness";
import type {
  IndexProgress,
  SearchResult,
  SearchScope,
  SearchSourceCategory,
} from "@/lib/search/search-types";
import { SearchResultGroup } from "./_components/search-result-group";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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

/** What the last search was run against, for provenance and drift detection. */
interface SearchProvenance {
  ranAt: number;
  scope: SearchScope;
  channelRevisions: Map<string, number>;
}

export default function SearchPage() {
  const { viewDensity } = useCompactMode();
  const cache = useCache();
  // Ensure channel data is loaded (user may navigate directly to /search).
  // This also refreshes revisions on mount, which is what makes the staleness
  // notice below appear on its own after returning from an edit.
  useChannels();

  // Last committed search, restored from the module-level session store so that
  // opening a match and coming back does not discard the results.
  // Read in lazy initializers, never in an effect — `react-hooks/set-state-in-effect`
  // is an error in this repo.
  const [restored] = useState(() => getSearchSession());

  // Search state
  const [query, setQuery] = useState(() => restored?.result.query ?? "");
  const [caseSensitive, setCaseSensitive] = useState(() => restored?.result.caseSensitive ?? false);
  const [scope, setScope] = useState<SearchScope>(() => restored?.scope ?? DEFAULT_SCOPE);

  // Execution state
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [result, setResult] = useState<SearchResult | null>(() => restored?.result ?? null);
  const [error, setError] = useState<string | null>(null);

  // Return-to-results bookkeeping
  const [provenance, setProvenance] = useState<SearchProvenance | null>(() =>
    restored
      ? {
          ranAt: restored.ranAt,
          scope: restored.scope,
          channelRevisions: restored.channelRevisions,
        }
      : null
  );
  const [visited, setVisited] = useState<Set<string>>(() => new Set(restored?.visited ?? []));
  const [flashKey, setFlashKey] = useState<string | null>(() => restored?.lastOpenedKey ?? null);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

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

      // Remember it so navigating to a match and back restores this page.
      // Visited/flash bookkeeping belongs to one query, so it resets here.
      const next: SearchProvenance = {
        ranAt: Date.now(),
        scope,
        channelRevisions: snapshotChannelRevisions(cache.channelMap),
      };
      saveSearchSession({ result: searchResult, ...next });
      setProvenance(next);
      setVisited(new Set());
      setFlashKey(null);
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

  // On a restored search, put the caret in the box with the query selected so
  // typing replaces it, and bring the match the user last opened back into view.
  useLayoutEffect(() => {
    if (!restored) return;
    inputRef.current?.select();
    if (!restored.lastOpenedKey) return;
    const row = resultsRef.current?.querySelector(
      `[data-result-key="${CSS.escape(restored.lastOpenedKey)}"]`
    );
    row?.scrollIntoView({ block: "center" });
    // Runs once for the session that was restored at mount; `restored` is state
    // seeded from a lazy initializer, so its identity never changes.
  }, [restored]);

  function handleClear(): void {
    abortRef.current?.abort();
    clearSearchSession();
    setQuery("");
    setResult(null);
    setError(null);
    setScope(DEFAULT_SCOPE);
    setCaseSensitive(false);
    setProvenance(null);
    setVisited(new Set());
    setFlashKey(null);
    inputRef.current?.focus();
  }

  const handleOpened = useCallback((key: string) => {
    markSearchResultOpened(key);
    setVisited((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "Enter") {
      handleSearch();
    }
  }

  function handleScopeChange(key: keyof SearchScope): void {
    setScope((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // Drift: has anything changed since these results were produced? Channel
  // revisions catch the common case (you opened a match, edited it, came back).
  // A scope change is the same "not what you asked for" condition, for free.
  const staleness = useMemo(
    () =>
      provenance
        ? computeSearchStaleness(provenance.channelRevisions, cache.channelMap, provenance.scope)
        : null,
    [provenance, cache.channelMap]
  );
  const scopeDrifted = provenance ? !scopesEqual(scope, provenance.scope) : false;
  const showStale = !!result && !searching && (staleness?.stale || scopeDrifted);

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
      <TooltipProvider>
        <div className={`${pagePadding(viewDensity)} border-b border-border space-y-3`}>
          {/* Search input row */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                ref={inputRef}
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
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setCaseSensitive(!caseSensitive)}
                  aria-pressed={caseSensitive}
                  aria-label={caseSensitive ? "Case sensitive (on)" : "Case sensitive (off)"}
                  className={`p-2 rounded-md border transition-colors ${
                    caseSensitive
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                      : "border-border text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  }`}
                >
                  <CaseSensitive className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {caseSensitive ? "Case sensitive (on)" : "Case sensitive (off)"}
              </TooltipContent>
            </Tooltip>
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
            {(result || query) && !searching && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleClear}
                    aria-label="Clear search and results"
                    className="p-2 rounded-md border border-border text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Clear search and results</TooltipContent>
              </Tooltip>
            )}
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
                <span>
                  Indexing {progress.phase === "channels" ? "channels" : progress.phase}...
                </span>
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
      </TooltipProvider>

      {/* Results */}
      <div ref={resultsRef} className={`flex-1 overflow-y-auto ${pagePadding(viewDensity)}`}>
        {/* Empty state before search */}
        {!result && !searching && !error && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 dark:text-gray-500">
            <Search className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-sm">Enter a search term and press Enter or click Search</p>
            <p className="text-xs mt-1">
              Searches channel scripts, transformer steps, connector properties, code templates,
              global scripts, and configuration map
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

        {/* Stale-results notice */}
        {showStale && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <span>
              {scopeDrifted
                ? "The search scope changed since these results were produced."
                : `${describeStaleness(staleness!)} since this search ran.`}
            </span>
            <button
              onClick={handleSearch}
              className="ml-auto shrink-0 inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:no-underline"
            >
              <RotateCw className="w-3 h-3" />
              Re-run search
            </button>
          </div>
        )}

        {/* Results summary */}
        {result && result.totalMatches > 0 && (
          <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            {result.totalMatches} match{result.totalMatches !== 1 ? "es" : ""} across{" "}
            {result.sources.length} source{result.sources.length !== 1 ? "s" : ""}
            {provenance && (
              <span className="text-xs text-gray-500 dark:text-gray-500">
                {" · "}searched {new Date(provenance.ranAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        )}

        {/* Grouped results */}
        {groupedResults.map(({ category, sources }) => (
          <SearchResultGroup
            key={category}
            category={category}
            sources={sources}
            query={result?.query ?? query}
            visited={visited}
            flashKey={flashKey}
            onOpened={handleOpened}
          />
        ))}
      </div>
    </div>
  );
}
