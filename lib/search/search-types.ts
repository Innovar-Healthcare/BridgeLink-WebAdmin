/**
 * Types for the global configuration search feature.
 *
 * Searches across channel XML (scripts, connectors, properties),
 * code templates, global scripts, and configuration map entries.
 */

/** Which category of content a search result belongs to. */
export type SearchSourceCategory = "channel" | "codeTemplate" | "globalScript" | "configMap";

/** Scoping options for a search query. */
export interface SearchScope {
  channels: boolean;
  codeTemplates: boolean;
  globalScripts: boolean;
  configMap: boolean;
}

/** Options passed to the search engine. */
export interface SearchOptions {
  query: string;
  caseSensitive: boolean;
  scope: SearchScope;
}

/**
 * A labeled segment of searchable text extracted from a channel XML,
 * code template, global script, or config map entry.
 */
export interface SearchableSegment {
  /** Human-readable location label, e.g. "Source Transformer", "Dest 1 'HL7 Out' > Filter" */
  label: string;
  /** The text content of this segment. */
  content: string;
  /** Navigation hint for click-to-open behavior. */
  navigateTo: NavigationTarget;
}

/** Where to navigate when clicking a search result. */
export type NavigationTarget =
  | { type: "channel-summary"; channelId: string }
  | { type: "channel-scripts"; channelId: string; script: string }
  | { type: "channel-source"; channelId: string; sub: "filter" | "transformer" | "properties" }
  | {
      type: "channel-destination";
      channelId: string;
      destIndex: number;
      destName: string;
      sub: "filter" | "transformer" | "responseTransformer" | "properties";
    }
  | { type: "channel-attachment"; channelId: string }
  | { type: "code-template"; templateId: string; templateName: string }
  | { type: "global-script"; scriptKey: string }
  | { type: "config-map"; entryKey: string };

/** A single line match within a segment. */
export interface SearchMatch {
  /** 1-based line number within the segment content. */
  lineNumber: number;
  /** The full text of the matching line. */
  lineText: string;
  /** Character offset within lineText where the match starts. */
  matchStart: number;
  /** Length of the matching substring. */
  matchLength: number;
}

/** All matches within a single segment. */
export interface SegmentResult {
  segment: SearchableSegment;
  matches: SearchMatch[];
}

/** All matches within a single source entity (channel, template, etc.). */
export interface SourceResult {
  category: SearchSourceCategory;
  /** Display name: channel name, template name, script key, or config key. */
  name: string;
  /** Unique identifier for grouping (channelId, templateId, scriptKey, configKey). */
  id: string;
  segments: SegmentResult[];
  /** Total match count across all segments. */
  totalMatches: number;
}

/** The complete result of a search query. */
export interface SearchResult {
  query: string;
  caseSensitive: boolean;
  sources: SourceResult[];
  totalMatches: number;
  /** How many sources were indexed (for progress reporting). */
  indexedCount: number;
  /** Total sources to index. */
  totalCount: number;
}

/** Progress callback during index building. */
export interface IndexProgress {
  phase: "codeTemplates" | "globalScripts" | "configMap" | "channels";
  indexed: number;
  total: number;
}
