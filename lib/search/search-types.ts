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
 * Location of one element (rule / step) inside a filter or transformer element
 * tree, used to deep-link a search hit to the exact element it was found in.
 *
 * `path` is an index path with the same semantics as the editor's own selection
 * (`flattenElements` / `getElementAtPath` in
 * `app/(app)/channels/_lib/filter-transformer-xml.ts`): `[2]` is the 3rd
 * top-level element, `[2, 0]` the 1st child of an Iterator at index 2. The
 * segmenter walks the XML in document order, which is the order both parsers
 * build `elements` in — that correspondence is pinned by a cross-check test in
 * `__tests__/unit/channel-segmenter.test.ts`.
 */
export interface FtElementRef {
  /** Index path from the container root. */
  path: number[];
  /** The element's <name>, for the result label. */
  name: string;
}

/** Where to navigate when clicking a search result. */
export type NavigationTarget =
  | { type: "channel-summary"; channelId: string }
  | { type: "channel-scripts"; channelId: string; script: string }
  | {
      type: "channel-source";
      channelId: string;
      sub: "filter" | "transformer" | "properties";
      /** Present for filter/transformer element segments; absent for properties. */
      element?: FtElementRef;
    }
  | {
      type: "channel-destination";
      channelId: string;
      destIndex: number;
      destName: string;
      sub: "filter" | "transformer" | "responseTransformer" | "properties";
      /** Present for filter/transformer element segments; absent for properties. */
      element?: FtElementRef;
    }
  | { type: "channel-attachment"; channelId: string }
  | { type: "code-template"; templateId: string; templateName: string }
  | { type: "global-script"; scriptKey: string }
  | { type: "config-map"; entryKey: string };

/**
 * Whether a 1-based line number within a segment's `content` is also a 1-based
 * line number in the editor buffer the segment's target opens.
 *
 * - `"editor"` — `content` is a verbatim editor buffer (a JavaScript step/rule
 *   script, a channel script, a code template, a global script). A
 *   `SearchMatch.lineNumber` can be deep-linked straight into Monaco.
 * - `"synthetic"` — `content` is text this module built (connector properties,
 *   the non-script fields of a Mapper/Rule Builder/XSLT step, a config map
 *   entry). A line number is meaningless to any editor.
 */
export type SegmentLineBasis = "editor" | "synthetic";

/**
 * A labeled segment of searchable text extracted from a channel XML,
 * code template, global script, or config map entry.
 */
export interface SearchableSegment {
  /** Human-readable location label, e.g. "Source > Transformer > [0] 'Map PID'" */
  label: string;
  /** The text content of this segment. */
  content: string;
  /** Navigation hint for click-to-open behavior. */
  navigateTo: NavigationTarget;
  /**
   * Whether `content`'s line numbers are editor line numbers. Required rather
   * than optional so that TypeScript enumerates every construction site: a
   * segment that silently defaulted to "editor" would deep-link to a wrong line.
   */
  lineBasis: SegmentLineBasis;
}

/** A single line match within a segment. */
export interface SearchMatch {
  /**
   * 1-based line number within the segment content. When the segment's
   * `lineBasis` is `"editor"` this is also the line number in the editor the
   * segment's target opens, and is what gets deep-linked.
   */
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
