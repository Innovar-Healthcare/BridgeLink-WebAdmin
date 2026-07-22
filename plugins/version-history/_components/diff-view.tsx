"use client";

/**
 * DiffView — side-by-side (or unified) line diff for two text strings.
 *
 * Shows line-level differences between oldContent and newContent.
 * Removed lines are highlighted red (left side), added lines green (right side).
 * Includes Prev/Next navigation between hunks and a Unified/Split toggle.
 *
 * Split view: two independent scroll panes, synchronized vertically.
 * A draggable handle between the panes lets users adjust the left/right ratio.
 * Both panes scroll horizontally independently, so long XML lines are fully visible.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronUp, ChevronDown, Copy, Check, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HoverTooltip } from "@/components/hover-tooltip";
import { cn } from "@/lib/utils";
import { findRanges } from "./diff-search";

// ─── Diff algorithm (LCS-based, line level) ──────────────────────────────────

type LineType = "unchanged" | "removed" | "added";

interface DiffLine {
  type: LineType;
  content: string;
}

/**
 * Computes a line-level diff using a simple LCS (Myers) approach.
 * Returns a flat list of DiffLine objects.
 */
function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: "unchanged", content: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: "added", content: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: "removed", content: oldLines[i - 1] });
      i--;
    }
  }
  result.reverse();
  return result;
}

// ─── Side-by-side pairing ─────────────────────────────────────────────────────

interface SideBySideRow {
  leftNum?: number;
  leftContent?: string;
  leftType: "unchanged" | "removed" | "empty";
  rightNum?: number;
  rightContent?: string;
  rightType: "unchanged" | "added" | "empty";
}

/**
 * Pairs up diff lines into side-by-side rows.
 * Consecutive removed/added blocks are aligned row-by-row.
 */
function toSideBySide(diff: DiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let leftNum = 0;
  let rightNum = 0;
  let i = 0;

  while (i < diff.length) {
    const line = diff[i];

    if (line.type === "unchanged") {
      leftNum++;
      rightNum++;
      rows.push({
        leftNum,
        leftContent: line.content,
        leftType: "unchanged",
        rightNum,
        rightContent: line.content,
        rightType: "unchanged",
      });
      i++;
    } else {
      // Collect a block of removed then added lines
      const removed: string[] = [];
      const added: string[] = [];
      while (i < diff.length && diff[i].type === "removed") {
        removed.push(diff[i].content);
        i++;
      }
      while (i < diff.length && diff[i].type === "added") {
        added.push(diff[i].content);
        i++;
      }
      const maxLen = Math.max(removed.length, added.length);
      for (let k = 0; k < maxLen; k++) {
        const hasLeft = k < removed.length;
        const hasRight = k < added.length;
        if (hasLeft) leftNum++;
        if (hasRight) rightNum++;
        rows.push({
          leftNum: hasLeft ? leftNum : undefined,
          leftContent: hasLeft ? removed[k] : undefined,
          leftType: hasLeft ? "removed" : "empty",
          rightNum: hasRight ? rightNum : undefined,
          rightContent: hasRight ? added[k] : undefined,
          rightType: hasRight ? "added" : "empty",
        });
      }
    }
  }

  return rows;
}

// ─── Hunk indices (rows with changes) ────────────────────────────────────────

function hunkRowIndices(rows: SideBySideRow[]): number[] {
  const indices: number[] = [];
  let prevWasChange = false;
  for (let i = 0; i < rows.length; i++) {
    const isChange = rows[i].leftType === "removed" || rows[i].rightType === "added";
    if (isChange && !prevWasChange) indices.push(i);
    prevWasChange = isChange;
  }
  return indices;
}

// ─── Unified diff rows ────────────────────────────────────────────────────────

interface UnifiedRow {
  num: string;
  content: string;
  type: "unchanged" | "removed" | "added";
}

function toUnified(diff: DiffLine[]): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  let leftNum = 0;
  let rightNum = 0;
  for (const line of diff) {
    if (line.type === "unchanged") {
      leftNum++;
      rightNum++;
      rows.push({ num: String(leftNum), content: line.content, type: "unchanged" });
    } else if (line.type === "removed") {
      leftNum++;
      rows.push({ num: String(leftNum), content: "- " + line.content, type: "removed" });
    } else {
      rightNum++;
      rows.push({ num: String(rightNum), content: "+ " + line.content, type: "added" });
    }
  }
  return rows;
}

// ─── Search-in-diff matching ──────────────────────────────────────────────────

/** One match occurrence, in document (render) order. */
interface DiffMatch {
  row: number;
  side: "left" | "right" | "unified";
  start: number;
  end: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface DiffViewProps {
  oldContent: string;
  newContent: string;
  oldLabel: string;
  newLabel: string;
  /** When provided, shows a Copy button in the toolbar that copies this content. */
  copyContent?: string;
}

export function DiffView({
  oldContent,
  newContent,
  oldLabel,
  newLabel,
  copyContent,
}: DiffViewProps) {
  const [unified, setUnified] = useState(false);
  // Content-keyed hunk index: stores { contentKey, idx } so the index
  // automatically reads as 0 whenever oldContent/newContent changes without
  // needing a useEffect to reset it.
  const contentKey = `${oldContent}::${newContent}`;
  const [hunkState, setHunkState] = useState<{ key: string; idx: number }>({
    key: contentKey,
    idx: 0,
  });
  const hunkIndex = hunkState.key === contentKey ? hunkState.idx : 0;

  const [copied, setCopied] = useState(false);

  // Find-in-diff. The current-match index is content+query+view keyed so it
  // resets to 0 whenever the diff, query, or view mode changes (same trick as
  // the hunk index above — no reset effect needed).
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Split view: left pane also serves as the unified view scroll container.
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  // Draggable split ratio between left and right panes, persisted to localStorage.
  const [splitPct, setSplitPct] = useState<number>(() => {
    if (typeof window === "undefined") return 0.5;
    const stored = localStorage.getItem("bl-vh-diff-split-pct");
    const parsed = stored ? parseFloat(stored) : NaN;
    return Number.isNaN(parsed) ? 0.5 : Math.max(0.15, Math.min(0.85, parsed));
  });

  const diff = useMemo(() => diffLines(oldContent, newContent), [oldContent, newContent]);
  const sideBySide = useMemo(() => toSideBySide(diff), [diff]);
  const unifiedRows = useMemo(() => toUnified(diff), [diff]);
  const hunks = useMemo(() => hunkRowIndices(sideBySide), [sideBySide]);

  const changeCount = hunks.length;

  // All search matches in render order, plus a per-cell lookup for highlighting.
  const matches = useMemo<DiffMatch[]>(() => {
    if (!query) return [];
    const out: DiffMatch[] = [];
    if (unified) {
      unifiedRows.forEach((r, row) => {
        for (const [start, end] of findRanges(r.content, query)) {
          out.push({ row, side: "unified", start, end });
        }
      });
    } else {
      sideBySide.forEach((r, row) => {
        for (const [start, end] of findRanges(r.leftContent ?? "", query)) {
          out.push({ row, side: "left", start, end });
        }
        for (const [start, end] of findRanges(r.rightContent ?? "", query)) {
          out.push({ row, side: "right", start, end });
        }
      });
    }
    return out;
  }, [query, unified, sideBySide, unifiedRows]);

  // `${row}:${side}` → ranges with their global match index, for highlight rendering.
  const matchMap = useMemo(() => {
    const map = new Map<string, Array<{ start: number; end: number; gi: number }>>();
    matches.forEach((m, gi) => {
      const key = `${m.row}:${m.side}`;
      const arr = map.get(key);
      if (arr) arr.push({ start: m.start, end: m.end, gi });
      else map.set(key, [{ start: m.start, end: m.end, gi }]);
    });
    return map;
  }, [matches]);

  const matchKey = `${contentKey}::${unified}::${query}`;
  const [matchState, setMatchState] = useState<{ key: string; idx: number }>({
    key: matchKey,
    idx: 0,
  });
  const currentMatch =
    matchState.key === matchKey && matchState.idx < matches.length ? matchState.idx : 0;

  // Synchronize vertical and horizontal scroll between the two split panes.
  // Double-RAF: set scroll in frame 1, release the guard in frame 2 so that any
  // scroll event Safari fires synchronously from the programmatic assignment is
  // still swallowed before the guard drops (preventing ping-pong jitter).
  const syncScroll = useCallback((source: "left" | "right") => {
    if (syncing.current) return;
    syncing.current = true;
    requestAnimationFrame(() => {
      const from = source === "left" ? leftScrollRef.current : rightScrollRef.current;
      const to = source === "left" ? rightScrollRef.current : leftScrollRef.current;
      if (from && to) {
        to.scrollTop = from.scrollTop;
        to.scrollLeft = from.scrollLeft;
      }
      requestAnimationFrame(() => {
        syncing.current = false;
      });
    });
  }, []);

  // Center a given side-by-side/unified row in the diff's own viewport. Both the
  // hunk navigation and the find widget scroll through this.
  const scrollToRow = useCallback((rowIdx: number) => {
    const container = leftScrollRef.current;
    if (!container) return;
    const rowEl = container.querySelector<HTMLElement>(`[data-row="${rowIdx}"]`);
    const target = (rowEl?.firstElementChild as HTMLElement | null) ?? rowEl;
    if (!target) return;
    // Compute scroll offset relative to the diff's own viewport so we don't
    // pull any scrollable ancestor along (which would hide the toolbar).
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const offset =
      targetRect.top -
      containerRect.top +
      container.scrollTop -
      container.clientHeight / 2 +
      target.clientHeight / 2;
    const top = Math.max(0, offset);
    container.scrollTo({ top, behavior: "smooth" });
    rightScrollRef.current?.scrollTo({ top, behavior: "smooth" });
  }, []);

  const scrollToHunk = useCallback(
    (idx: number) => {
      if (hunks.length === 0) return;
      scrollToRow(hunks[idx]);
    },
    [hunks, scrollToRow]
  );

  function handlePrev() {
    const next = (hunkIndex - 1 + hunks.length) % hunks.length;
    setHunkState({ key: contentKey, idx: next });
    scrollToHunk(next);
  }

  function handleNext() {
    const next = (hunkIndex + 1) % hunks.length;
    setHunkState({ key: contentKey, idx: next });
    scrollToHunk(next);
  }

  const gotoMatch = useCallback(
    (idx: number) => {
      if (matches.length === 0) return;
      const next = ((idx % matches.length) + matches.length) % matches.length;
      setMatchState({ key: matchKey, idx: next });
      scrollToRow(matches[next].row);
    },
    [matches, matchKey, scrollToRow]
  );

  function nextMatch() {
    gotoMatch(currentMatch + 1);
  }

  function prevMatch() {
    gotoMatch(currentMatch - 1);
  }

  function openSearch() {
    setSearchOpen(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
  }

  // When the query changes (or the matched view rebuilds), reveal the first hit.
  useEffect(() => {
    if (searchOpen && query && matches.length > 0) {
      scrollToRow(matches[0].row);
    }
  }, [query, searchOpen, matches, scrollToRow]);

  function handleRootKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
      e.preventDefault();
      openSearch();
    } else if (e.key === "Escape" && searchOpen) {
      e.preventDefault();
      closeSearch();
    }
  }

  // Build highlighted content nodes for one cell, marking the active match.
  function renderCellContent(text: string, side: "left" | "right" | "unified", row: number) {
    const ranges = query ? matchMap.get(`${row}:${side}`) : undefined;
    if (!ranges || ranges.length === 0) return text;
    const nodes: ReactNode[] = [];
    let pos = 0;
    ranges.forEach(({ start, end, gi }, i) => {
      if (start > pos) nodes.push(text.slice(pos, start));
      nodes.push(
        <mark
          key={i}
          data-match={gi}
          className={cn(
            "rounded-sm",
            gi === currentMatch
              ? "bg-orange-400 text-black dark:bg-orange-500"
              : "bg-yellow-200 text-black dark:bg-yellow-600 dark:text-white"
          )}
        >
          {text.slice(start, end)}
        </mark>
      );
      pos = end;
    });
    if (pos < text.length) nodes.push(text.slice(pos));
    return nodes;
  }

  async function handleCopy() {
    if (!copyContent) return;
    try {
      await navigator.clipboard.writeText(copyContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied — silently ignore
    }
  }

  function handleSplitMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const containerEl = (e.currentTarget as HTMLElement).parentElement;
    if (!containerEl) return;
    const startX = e.clientX;
    const startPct = splitPct;
    const totalW = containerEl.getBoundingClientRect().width;
    let currentPct = startPct;

    function onMove(me: MouseEvent) {
      currentPct = Math.max(0.15, Math.min(0.85, startPct + (me.clientX - startX) / totalW));
      setSplitPct(currentPct);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("bl-vh-diff-split-pct", String(currentPct));
    }
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  const lineNumCls =
    "text-right pr-2 text-gray-400 dark:text-gray-500 select-none font-mono text-[11px] leading-5";
  const contentCls = "pl-2 font-mono text-xs leading-5 whitespace-pre";

  return (
    <div
      ref={rootRef}
      onKeyDown={handleRootKeyDown}
      className="flex flex-col h-full min-h-0 border border-border rounded overflow-hidden"
    >
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-gray-50 dark:bg-gray-800 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={handlePrev}
          disabled={changeCount === 0}
        >
          <ChevronUp className="w-3 h-3 mr-0.5" />
          Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={handleNext}
          disabled={changeCount === 0}
        >
          <ChevronDown className="w-3 h-3 mr-0.5" />
          Next
        </Button>
        <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
          {changeCount} change{changeCount !== 1 ? "s" : ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <HoverTooltip content="Find in diff (Ctrl/Cmd+F)">
            <Button
              variant={searchOpen ? "secondary" : "outline"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => (searchOpen ? closeSearch() : openSearch())}
            >
              <Search className="w-3 h-3" />
            </Button>
          </HoverTooltip>
          <Button
            variant={unified ? "secondary" : "outline"}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setUnified((u) => !u)}
          >
            {unified ? "Split" : "Unified"}
          </Button>
          {copyContent && (
            <>
              <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-0.5" />
              <HoverTooltip content="Copy file content to clipboard">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => void handleCopy()}
                >
                  {copied ? (
                    <Check className="w-3 h-3 mr-1 text-green-600" />
                  ) : (
                    <Copy className="w-3 h-3 mr-1" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </HoverTooltip>
            </>
          )}
        </div>
      </div>

      {/* Find bar */}
      {searchOpen && (
        <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border bg-gray-50 dark:bg-gray-800 shrink-0">
          <Search className="w-3 h-3 text-gray-400 shrink-0" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) prevMatch();
                else nextMatch();
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
              }
            }}
            placeholder="Find in diff…"
            className="h-6 flex-1 min-w-0 max-w-xs rounded border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums shrink-0 min-w-[3.5rem] text-center">
            {query ? (matches.length === 0 ? "0/0" : `${currentMatch + 1}/${matches.length}`) : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={prevMatch}
            disabled={matches.length === 0}
            aria-label="Previous match"
          >
            <ChevronUp className="w-3 h-3" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={nextMatch}
            disabled={matches.length === 0}
            aria-label="Next match"
          >
            <ChevronDown className="w-3 h-3" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={closeSearch}
            aria-label="Close find"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}

      {unified ? (
        /* ── Unified view ── */
        <div ref={leftScrollRef} tabIndex={0} className="flex-1 overflow-auto outline-none">
          <div className="min-w-max grid grid-cols-[48px_auto] text-xs font-mono">
            {unifiedRows.map((row, idx) => (
              <div
                key={idx}
                data-row={idx}
                className={cn(
                  "contents",
                  row.type === "removed" && "[&>div]:bg-red-50 dark:[&>div]:bg-red-950/30",
                  row.type === "added" && "[&>div]:bg-green-50 dark:[&>div]:bg-green-950/30"
                )}
              >
                <div className={lineNumCls}>{row.num}</div>
                <div
                  className={cn(
                    contentCls,
                    row.type === "removed" && "text-red-700 dark:text-red-400",
                    row.type === "added" && "text-green-700 dark:text-green-400"
                  )}
                >
                  {renderCellContent(row.content, "unified", idx)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ── Side-by-side view: two independently scrolling panes ── */
        <div className="flex-1 flex min-h-0">
          {/* Left pane — old content */}
          <div
            ref={leftScrollRef}
            tabIndex={0}
            style={{ width: `${splitPct * 100}%` }}
            className="flex flex-col min-w-0 overflow-auto border-r border-border outline-none"
            onScroll={() => syncScroll("left")}
          >
            <div className="sticky top-0 left-0 z-10 flex border-b border-border bg-gray-100 dark:bg-gray-800 shrink-0">
              <div className="w-10 shrink-0 border-r border-border" />
              <div className="px-3 py-0.5 text-xs text-gray-500 dark:text-gray-400 font-mono whitespace-nowrap">
                {oldLabel}
              </div>
            </div>
            <div className="min-w-max">
              {sideBySide.map((row, idx) => (
                <div
                  key={idx}
                  data-row={idx}
                  className={cn(
                    "flex border-b border-border",
                    row.leftType === "removed" && "bg-red-50 dark:bg-red-950/30",
                    row.leftType === "empty" && "bg-gray-50 dark:bg-gray-800/40"
                  )}
                >
                  <div
                    className={cn(
                      lineNumCls,
                      "w-10 shrink-0 border-r border-border sticky left-0 z-[2]",
                      row.leftType === "removed"
                        ? "bg-red-50 dark:bg-red-950/30"
                        : row.leftType === "empty"
                          ? "bg-gray-50 dark:bg-gray-800/40"
                          : "bg-background"
                    )}
                  >
                    {row.leftNum}
                  </div>
                  <div
                    className={cn(
                      contentCls,
                      row.leftType === "removed" && "text-red-700 dark:text-red-400"
                    )}
                  >
                    {renderCellContent(row.leftContent ?? "", "left", idx)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Drag handle — resize the left/right split */}
          <div
            className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-blue-400 dark:hover:bg-blue-600 transition-colors"
            onMouseDown={handleSplitMouseDown}
          />

          {/* Right pane — new content */}
          <div
            ref={rightScrollRef}
            tabIndex={0}
            style={{ width: `${(1 - splitPct) * 100}%` }}
            className="flex flex-col min-w-0 overflow-auto outline-none"
            onScroll={() => syncScroll("right")}
          >
            <div className="sticky top-0 left-0 z-10 flex border-b border-border bg-gray-100 dark:bg-gray-800 shrink-0">
              <div className="w-10 shrink-0 border-r border-border" />
              <div className="px-3 py-0.5 text-xs text-gray-500 dark:text-gray-400 font-mono whitespace-nowrap">
                {newLabel}
              </div>
            </div>
            <div className="min-w-max">
              {sideBySide.map((row, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex border-b border-border",
                    row.rightType === "added" && "bg-green-50 dark:bg-green-950/30",
                    row.rightType === "empty" && "bg-gray-50 dark:bg-gray-800/40"
                  )}
                >
                  <div
                    className={cn(
                      lineNumCls,
                      "w-10 shrink-0 border-r border-border sticky left-0 z-[2]",
                      row.rightType === "added"
                        ? "bg-green-50 dark:bg-green-950/30"
                        : row.rightType === "empty"
                          ? "bg-gray-50 dark:bg-gray-800/40"
                          : "bg-background"
                    )}
                  >
                    {row.rightNum}
                  </div>
                  <div
                    className={cn(
                      contentCls,
                      row.rightType === "added" && "text-green-700 dark:text-green-400"
                    )}
                  >
                    {renderCellContent(row.rightContent ?? "", "right", idx)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
