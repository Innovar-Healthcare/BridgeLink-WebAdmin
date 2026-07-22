/**
 * Global configuration search index.
 *
 * Fetches and indexes content from channels, code templates, global scripts,
 * and the configuration map. Supports text search with case-sensitivity toggle.
 *
 * Channel XMLs are fetched in parallel with a concurrency limit and cached
 * with revision-based invalidation for efficient re-searches.
 */

import { getChannelXml } from "@/lib/api/api-channels";
import { getCodeTemplates } from "@/lib/api/api-code-templates";
import { getConfigurationMap, getGlobalScripts } from "@/lib/api/api-settings";
import type { Channel } from "@/lib/types";

import { registerCacheTeardown } from "@/lib/logout";
import { segmentChannelXml } from "./channel-segmenter";
import type {
  IndexProgress,
  SearchMatch,
  SearchOptions,
  SearchResult,
  SearchSourceCategory,
  SearchableSegment,
  SegmentResult,
  SourceResult,
} from "./search-types";

// ── Channel XML cache ────────────────────────────────────────────────────────

interface CachedChannelXml {
  xml: string;
  revision: number;
  segments: SearchableSegment[];
}

const channelXmlCache = new Map<string, CachedChannelXml>();

/** Clear the entire channel XML cache (e.g. on logout). */
export function clearSearchCache(): void {
  channelXmlCache.clear();
}

// This cache holds full channel XML (scripts, connector configs) — clear it on
// every session-teardown path so it can't leak to the next user.
registerCacheTeardown(clearSearchCache);

// ── Concurrency-limited parallel fetch ───────────────────────────────────────

async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── Index building ───────────────────────────────────────────────────────────

/** Indexed source: pre-segmented content ready for search. */
interface IndexedSource {
  category: SearchSourceCategory;
  name: string;
  id: string;
  segments: SearchableSegment[];
}

export interface BuildIndexOptions {
  channels: Map<string, Channel>;
  scope: { channels: boolean; codeTemplates: boolean; globalScripts: boolean; configMap: boolean };
  signal?: AbortSignal;
  onProgress?: (progress: IndexProgress) => void;
}

/**
 * Build (or refresh) the search index. Returns an array of indexed sources.
 *
 * - Code templates, global scripts, and config map are fetched in single bulk calls.
 * - Channel XMLs are fetched in parallel (max 10 concurrent) with revision-based cache.
 */
export async function buildSearchIndex(opts: BuildIndexOptions): Promise<IndexedSource[]> {
  const { channels, scope, signal, onProgress } = opts;
  const sources: IndexedSource[] = [];

  // ── Code templates ──
  if (scope.codeTemplates) {
    onProgress?.({ phase: "codeTemplates", indexed: 0, total: 1 });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const templates = await getCodeTemplates();
    for (const t of templates) {
      if (t.code?.trim()) {
        sources.push({
          category: "codeTemplate",
          name: t.name,
          id: t.id,
          segments: [
            {
              label: "Code",
              content: t.code,
              navigateTo: { type: "code-template", templateId: t.id, templateName: t.name },
            },
          ],
        });
      }
    }
    onProgress?.({ phase: "codeTemplates", indexed: 1, total: 1 });
  }

  // ── Global scripts ──
  if (scope.globalScripts) {
    onProgress?.({ phase: "globalScripts", indexed: 0, total: 1 });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const scripts = await getGlobalScripts();
    for (const [key, code] of Object.entries(scripts)) {
      if (
        code?.trim() &&
        code.trim() !== "// This script executes once when all channels are deployed\nreturn;" &&
        code.trim() !== "// This script executes once when all channels are undeployed\nreturn;" &&
        code.trim() !==
          "// This script executes once for every message passing through any channel\nreturn message;" &&
        code.trim() !==
          "// This script executes once after a message has been processed in any channel\nreturn;" &&
        code.trim() !== "return;" &&
        code.trim() !== "return message;"
      ) {
        sources.push({
          category: "globalScript",
          name: key,
          id: key,
          segments: [
            {
              label: key,
              content: code,
              navigateTo: { type: "global-script", scriptKey: key },
            },
          ],
        });
      }
    }
    onProgress?.({ phase: "globalScripts", indexed: 1, total: 1 });
  }

  // ── Configuration map ──
  if (scope.configMap) {
    onProgress?.({ phase: "configMap", indexed: 0, total: 1 });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const entries = await getConfigurationMap();
    for (const entry of entries) {
      const content = `Key: ${entry.key}\nValue: ${entry.value}${entry.comment ? `\nComment: ${entry.comment}` : ""}`;
      sources.push({
        category: "configMap",
        name: entry.key,
        id: entry.key,
        segments: [
          {
            label: entry.key,
            content,
            navigateTo: { type: "config-map", entryKey: entry.key },
          },
        ],
      });
    }
    onProgress?.({ phase: "configMap", indexed: 1, total: 1 });
  }

  // ── Channels ──
  if (scope.channels) {
    const channelEntries = Array.from(channels.entries());
    const total = channelEntries.length;
    let indexed = 0;
    onProgress?.({ phase: "channels", indexed: 0, total });

    await parallelMap(channelEntries, 10, async ([channelId, channel]) => {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

      // Check cache: skip fetch if revision matches
      const cached = channelXmlCache.get(channelId);
      let segments: SearchableSegment[];

      if (cached && cached.revision === channel.revision) {
        segments = cached.segments;
      } else {
        try {
          const xml = await getChannelXml(channelId);
          segments = segmentChannelXml(channelId, xml);
          channelXmlCache.set(channelId, { xml, revision: channel.revision, segments });
        } catch {
          // Skip channels that fail to fetch (permissions, deleted, etc.)
          segments = [];
        }
      }

      if (segments.length > 0) {
        sources.push({
          category: "channel",
          name: channel.name,
          id: channelId,
          segments,
        });
      }

      indexed++;
      onProgress?.({ phase: "channels", indexed, total });
    });
  }

  // Remove channels from cache that no longer exist
  if (scope.channels) {
    for (const cachedId of channelXmlCache.keys()) {
      if (!channels.has(cachedId)) {
        channelXmlCache.delete(cachedId);
      }
    }
  }

  return sources;
}

// ── Search execution ─────────────────────────────────────────────────────────

/**
 * Search across indexed sources for a text query.
 * Returns grouped results with line-level match information.
 */
export function executeSearch(
  indexedSources: IndexedSource[],
  options: SearchOptions
): SearchResult {
  const { query, caseSensitive } = options;
  const sources: SourceResult[] = [];
  let totalMatches = 0;

  if (!query.trim()) {
    return {
      query,
      caseSensitive,
      sources: [],
      totalMatches: 0,
      indexedCount: indexedSources.length,
      totalCount: indexedSources.length,
    };
  }

  const searchQuery = caseSensitive ? query : query.toLowerCase();

  for (const source of indexedSources) {
    // Filter by scope
    const segmentResults: SegmentResult[] = [];
    let sourceMatchCount = 0;

    for (const segment of source.segments) {
      const matches = findMatches(segment.content, searchQuery, caseSensitive);
      if (matches.length > 0) {
        segmentResults.push({ segment, matches });
        sourceMatchCount += matches.length;
      }
    }

    if (segmentResults.length > 0) {
      sources.push({
        category: source.category,
        name: source.name,
        id: source.id,
        segments: segmentResults,
        totalMatches: sourceMatchCount,
      });
      totalMatches += sourceMatchCount;
    }
  }

  // Sort: channels first, then templates, then global scripts, then config map.
  // Within each category, sort by match count descending.
  const categoryOrder: Record<SearchSourceCategory, number> = {
    channel: 0,
    codeTemplate: 1,
    globalScript: 2,
    configMap: 3,
  };
  sources.sort(
    (a, b) =>
      categoryOrder[a.category] - categoryOrder[b.category] || b.totalMatches - a.totalMatches
  );

  return {
    query,
    caseSensitive,
    sources,
    totalMatches,
    indexedCount: indexedSources.length,
    totalCount: indexedSources.length,
  };
}

/** Find all occurrences of `query` in `content`, returning line-level match info. */
function findMatches(content: string, query: string, caseSensitive: boolean): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const lines = content.split("\n");
  const queryLen = query.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const searchLine = caseSensitive ? line : line.toLowerCase();
    let offset = 0;

    while (offset < searchLine.length) {
      const idx = searchLine.indexOf(query, offset);
      if (idx === -1) break;

      matches.push({
        lineNumber: i + 1,
        lineText: line,
        matchStart: idx,
        matchLength: queryLen,
      });
      offset = idx + queryLen;
    }
  }

  return matches;
}
