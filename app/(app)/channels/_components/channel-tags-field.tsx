"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import {
  TAG_COLOR_PALETTE,
  hexToXStreamColor,
  tagColorToCss,
  tagForegroundColor,
} from "@/components/tag-chip";
import type { ChannelTag } from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";

// ─── Tag name validation (mirrors ChannelTag.java) ────────────────────────────

const MAX_TAG_NAME_LENGTH = 24;
const INVALID_CHARS = /[^a-zA-Z_0-9\-\s]/g;

function sanitizeTagName(name: string): string {
  return name.replace(INVALID_CHARS, "").slice(0, MAX_TAG_NAME_LENGTH);
}

// ─── ChannelTagsField ─────────────────────────────────────────────────────────

interface ChannelTagsFieldProps {
  channelId: string;
  allTags: ChannelTag[];
  onAllTagsChange: (updated: ChannelTag[]) => void;
  loading?: boolean;
}

export function ChannelTagsField({
  channelId,
  allTags,
  onAllTagsChange,
  loading,
}: ChannelTagsFieldProps) {
  const { viewDensity } = useCompactMode();
  const controlH = densityHeight(viewDensity);
  const [query, setQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Click-outside closes dropdown ─────────────────────────────────────────

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  // ── Derived state ──────────────────────────────────────────────────────────

  const channelTags = allTags.filter((t) => t.channelIds.includes(channelId));
  const available = allTags.filter((t) => !t.channelIds.includes(channelId));

  const trimmedQuery = sanitizeTagName(query.trim());

  const filtered = available.filter(
    (t) => query.trim() === "" || t.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  const canCreate =
    trimmedQuery.length > 0 &&
    !allTags.some((t) => t.name.toLowerCase() === trimmedQuery.toLowerCase());

  // ── Mutation helpers ───────────────────────────────────────────────────────

  function addTag(tag: ChannelTag) {
    const updated = allTags.map((t) =>
      t.id === tag.id ? { ...t, channelIds: [...t.channelIds, channelId] } : t
    );
    setQuery("");
    setDropdownOpen(false);
    onAllTagsChange(updated);
  }

  function removeTag(tagId: string) {
    const updated = allTags.map((t) =>
      t.id === tagId ? { ...t, channelIds: t.channelIds.filter((id) => id !== channelId) } : t
    );
    onAllTagsChange(updated);
  }

  function createTag() {
    if (!canCreate) return;
    const hex = TAG_COLOR_PALETTE[allTags.length % TAG_COLOR_PALETTE.length];
    const newTag: ChannelTag = {
      id: generateUUID(),
      name: trimmedQuery,
      channelIds: [channelId],
      backgroundColor: hexToXStreamColor(hex),
    };
    setQuery("");
    setDropdownOpen(false);
    onAllTagsChange([...allTags, newTag]);
  }

  // ── Keyboard navigation ────────────────────────────────────────────────────

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered.length === 1) {
        addTag(filtered[0]);
      } else if (canCreate) {
        createTag();
      }
    } else if (e.key === "Escape") {
      setDropdownOpen(false);
      setQuery("");
    } else if (e.key === "Backspace" && query === "" && channelTags.length > 0) {
      removeTag(channelTags[channelTags.length - 1].id);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading…
      </span>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      {/* ── Tag chips + input box ───────────────────────────────── */}
      <div
        onClick={() => {
          inputRef.current?.focus();
          setDropdownOpen(true);
        }}
        className={`flex flex-wrap items-center gap-1.5 ${controlH} min-h-0 px-2 py-1 rounded border
          border-border bg-white dark:bg-gray-800 cursor-text
          focus-within:border-blue-500 dark:focus-within:border-blue-400
          focus-within:ring-1 focus-within:ring-blue-500/30`}
      >
        {/* Existing chips */}
        {channelTags.map((tag) => {
          const bg = tagColorToCss(tag.backgroundColor);
          const fg = tagForegroundColor(tag.backgroundColor);
          return (
            <span
              key={tag.id}
              style={{ backgroundColor: bg, color: fg }}
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded text-xs font-medium shrink-0"
            >
              {tag.name}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tag.id);
                }}
                title={`Remove "${tag.name}"`}
                className="flex items-center justify-center w-3.5 h-3.5 rounded-full
                  opacity-70 hover:opacity-100 hover:bg-black/20 transition-opacity"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          );
        })}

        {/* Text input */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={channelTags.length === 0 ? "Enter channel tag" : ""}
          className="flex-1 min-w-[8rem] h-6 bg-transparent text-sm focus:outline-none
            text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
      </div>

      {/* ── Dropdown ───────────────────────────────────────────── */}
      {dropdownOpen && (filtered.length > 0 || canCreate) && (
        <div
          className="absolute top-full left-0 z-50 mt-1 w-64 rounded-md border
          border-border bg-white dark:bg-gray-800
          shadow-lg overflow-hidden"
        >
          {filtered.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                addTag(tag);
              }}
              className="flex items-center gap-2.5 w-full px-3 py-1.5 text-sm text-left
                text-gray-800 dark:text-gray-200
                hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <span
                style={{ backgroundColor: tagColorToCss(tag.backgroundColor) }}
                className="w-2.5 h-2.5 rounded-full shrink-0"
              />
              {tag.name}
            </button>
          ))}

          {canCreate && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                createTag();
              }}
              className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left
                text-blue-600 dark:text-blue-400
                hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors
                ${filtered.length > 0 ? "border-t border-border" : ""}`}
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              Create &ldquo;{trimmedQuery}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
