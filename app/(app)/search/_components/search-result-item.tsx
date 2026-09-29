"use client";

import { cn } from "@/lib/utils";
import type { SearchMatch, SearchableSegment } from "@/lib/search/search-types";

interface SearchResultItemProps {
  segment: SearchableSegment;
  matches: SearchMatch[];
  query: string;
  /** Max number of match lines to show before truncating. */
  maxLines?: number;
  /**
   * Whether a line number in this segment is also a line number in the editor
   * the segment opens (`segment.lineBasis === "editor"`). Only then does a row
   * become a click target — offering one for a synthetic listing would promise a
   * jump the destination cannot make.
   */
  linkable?: boolean;
  /** Open the editor at this specific matched line. */
  onOpenLine?: (lineNumber: number) => void;
  /**
   * Whether the destination actually honors a line number. False for segments
   * that are real editor buffers but open somewhere that ignores `line` (code
   * templates, global scripts) — the row stays clickable, but must not claim to
   * land on a line it will not land on.
   */
  lineNavigable?: boolean;
  /** Stable key per matched line, for visited bookkeeping and scroll-back. */
  lineKey?: (lineNumber: number) => string;
  /** Keys already opened this session — dimmed so you can see what is left. */
  visited?: Set<string>;
  /** The row to flash on return from a match, if it is in this segment. */
  flashKey?: string | null;
}

/**
 * Renders a single segment's matches with highlighted snippets.
 * Shows the segment label and up to `maxLines` matching lines.
 */
export function SearchResultItem({
  segment,
  matches,
  query,
  maxLines = 5,
  linkable = false,
  onOpenLine,
  lineNavigable = false,
  lineKey,
  visited,
  flashKey,
}: SearchResultItemProps) {
  // De-duplicate matches by line number (show each line once with all highlights)
  const lineMap = new Map<number, SearchMatch[]>();
  for (const m of matches) {
    const existing = lineMap.get(m.lineNumber) ?? [];
    existing.push(m);
    lineMap.set(m.lineNumber, existing);
  }
  const lines = Array.from(lineMap.entries()).slice(0, maxLines);
  const truncated = lineMap.size > maxLines;
  const clickable = linkable && !!onOpenLine;

  return (
    <div className="ml-4 mb-1 min-w-0">
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">
        {segment.label}
      </div>
      <div className="space-y-0.5">
        {lines.map(([lineNum, lineMatches]) => {
          const key = lineKey?.(lineNum);
          const isVisited = key ? (visited?.has(key) ?? false) : false;
          const body = (
            <>
              <span className="text-gray-400 dark:text-gray-500 select-none shrink-0 w-8 text-right">
                {lineNum}
              </span>
              <span className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">
                <HighlightedLine
                  line={lineMatches[0].lineText}
                  matches={lineMatches}
                  query={query}
                />
              </span>
            </>
          );
          const shared = cn(
            "flex items-start gap-2 text-xs font-mono w-full rounded-sm px-1 -mx-1",
            isVisited && "opacity-55",
            key && key === flashKey && "bl-search-flash"
          );

          if (!clickable) {
            return (
              <div key={lineNum} data-result-key={key} className={shared}>
                {body}
              </div>
            );
          }
          return (
            <button
              key={lineNum}
              type="button"
              data-result-key={key}
              onClick={() => onOpenLine?.(lineNum)}
              title={lineNavigable ? `Open in editor at line ${lineNum}` : "Open in editor"}
              className={cn(
                shared,
                "text-left cursor-pointer transition-colors",
                "hover:bg-gray-100 dark:hover:bg-gray-800",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
              )}
            >
              {body}
            </button>
          );
        })}
        {truncated && (
          <div className="text-xs text-gray-400 dark:text-gray-500 ml-10">
            ... and {lineMap.size - maxLines} more matching line
            {lineMap.size - maxLines > 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
}

/** Renders a line of text with match highlights. */
function HighlightedLine({
  line,
  matches,
  query,
}: {
  line: string;
  matches: SearchMatch[];
  query: string;
}) {
  // Trim context: show ±60 chars around first match
  const firstMatch = matches[0];
  const contextStart = Math.max(0, firstMatch.matchStart - 60);
  const contextEnd = Math.min(line.length, firstMatch.matchStart + query.length + 60);
  const snippet = line.slice(contextStart, contextEnd);
  const prefix = contextStart > 0 ? "..." : "";
  const suffix = contextEnd < line.length ? "..." : "";

  // Re-calculate match positions within the snippet
  const parts: Array<{ text: string; highlight: boolean }> = [];
  let lastEnd = 0;
  const offsetMatches = matches
    .map((m) => ({
      start: m.matchStart - contextStart,
      length: m.matchLength,
    }))
    .filter((m) => m.start >= 0 && m.start < snippet.length)
    .sort((a, b) => a.start - b.start);

  for (const m of offsetMatches) {
    if (m.start > lastEnd) {
      parts.push({ text: snippet.slice(lastEnd, m.start), highlight: false });
    }
    parts.push({
      text: snippet.slice(m.start, Math.min(m.start + m.length, snippet.length)),
      highlight: true,
    });
    lastEnd = m.start + m.length;
  }
  if (lastEnd < snippet.length) {
    parts.push({ text: snippet.slice(lastEnd), highlight: false });
  }

  return (
    <>
      {prefix}
      {parts.map((part, i) =>
        part.highlight ? (
          <mark
            key={i}
            className="bg-yellow-200 dark:bg-yellow-700/50 text-inherit rounded-sm px-0.5"
          >
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
      {suffix}
    </>
  );
}
