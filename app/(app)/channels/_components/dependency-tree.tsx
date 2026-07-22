"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Search, X } from "lucide-react";
import { useExpandState } from "@/lib/hooks/use-expand-state";
import type { DepTreeNode } from "@/lib/dependency-graph";

// ─── Picker (used to add a new direct dependency) ─────────────────────────────

interface PickerProps {
  search: string;
  onSearchChange: (v: string) => void;
  availableChannels: Array<{ id: string; name: string }>;
  onSelect: (id: string) => void;
  placeholder?: string;
}

function ChannelPicker({
  search,
  onSearchChange,
  availableChannels,
  onSelect,
  placeholder = "Search channels…",
}: PickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const shown = availableChannels.slice(0, 8);

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex items-center gap-1.5 h-8 px-2.5 rounded border border-border
        bg-white dark:bg-gray-800 focus-within:border-blue-500 dark:focus-within:border-blue-400
        focus-within:ring-1 focus-within:ring-blue-500/30"
      >
        <Search className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            onSearchChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="flex-1 text-sm bg-transparent outline-none text-gray-900 dark:text-gray-100
            placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
        {search && (
          <button
            onClick={() => {
              onSearchChange("");
              inputRef.current?.focus();
            }}
            className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border border-border bg-white dark:bg-gray-800 shadow-lg overflow-hidden">
          {availableChannels.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500 italic">
              {search ? "No channels found." : "All channels already added."}
            </div>
          ) : (
            <>
              {shown.map((ch) => (
                <button
                  key={ch.id}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onSelect(ch.id);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm text-gray-800 dark:text-gray-200
                    hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                >
                  {ch.name}
                </button>
              ))}
              {availableChannels.length > 8 && (
                <div className="px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 border-t border-border">
                  {availableChannels.length - 8} more — type to filter
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tree row ─────────────────────────────────────────────────────────────────

interface RowProps {
  node: DepTreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (key: string) => void;
  onRemoveDirect?: (channelId: string) => void;
}

function TreeRow({ node, depth, expanded, toggle, onRemoveDirect }: RowProps) {
  const isDirect = depth === 0;
  const hasChildren = node.children.length > 0;
  const rowKey = keyForNode(node, depth);
  const isExpanded = expanded.has(rowKey);

  return (
    <>
      <div className="flex items-center gap-1 py-1 text-sm" style={{ paddingLeft: depth * 16 }}>
        {/* Disclosure */}
        {hasChildren ? (
          <button
            onClick={() => toggle(rowKey)}
            className="shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            <ChevronRight
              className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform ${
                isExpanded ? "rotate-90" : ""
              }`}
            />
          </button>
        ) : (
          <span className="inline-block w-[18px]" />
        )}

        {/* Name — direct rows render as a removable chip; transitive rows render plain & muted. */}
        {isDirect ? (
          <span
            className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full
              bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700
              text-blue-800 dark:text-blue-200 max-w-full"
          >
            <span className="truncate">{node.channelName}</span>
            {onRemoveDirect && (
              <button
                onClick={() => onRemoveDirect(node.channelId)}
                title="Remove"
                className="shrink-0 rounded-full p-0.5 hover:bg-blue-200 dark:hover:bg-blue-700 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ) : (
          <span className="truncate text-muted-foreground italic">{node.channelName}</span>
        )}
      </div>

      {/* Children */}
      {hasChildren &&
        isExpanded &&
        node.children.map((child, idx) => (
          <TreeRow
            key={`${child.channelId}-${idx}`}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            onRemoveDirect={undefined}
          />
        ))}
    </>
  );
}

function keyForNode(node: DepTreeNode, depth: number): string {
  return `${depth}:${node.channelId}`;
}

function collectAllKeys(nodes: DepTreeNode[], depth = 0, out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.children.length > 0) {
      out.push(keyForNode(n, depth));
      collectAllKeys(n.children, depth + 1, out);
    }
  }
  return out;
}

// ─── Section ──────────────────────────────────────────────────────────────────

interface DependencyTreeSectionProps {
  title: string;
  description: string;
  rootChildren: DepTreeNode[];
  onRemoveDirect: (channelId: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  availableChannels: Array<{ id: string; name: string }>;
  onAdd: (id: string) => void;
  /** Unique storage key suffix per section (e.g. channelId + direction). */
  storageKey: string;
}

export function DependencyTreeSection({
  title,
  description,
  rootChildren,
  onRemoveDirect,
  search,
  onSearchChange,
  availableChannels,
  onAdd,
  storageKey,
}: DependencyTreeSectionProps) {
  const allKeys = useMemo(() => collectAllKeys(rootChildren), [rootChildren]);
  const [expanded, toggle, setAll, collapseAll] = useExpandState(`bl-dep-tree-${storageKey}`, () =>
    collectAllKeys(rootChildren)
  );
  const hasExpandable = allKeys.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
        </div>
        {hasExpandable && (
          <div className="flex items-center gap-2 text-xs shrink-0">
            <button
              onClick={() => setAll(allKeys)}
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Expand All
            </button>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <button
              onClick={collapseAll}
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Collapse All
            </button>
          </div>
        )}
      </div>

      <div className="min-h-[2rem] rounded border border-border bg-white dark:bg-gray-900 px-1 py-1">
        {rootChildren.length === 0 ? (
          <div className="px-2 py-1 text-sm italic text-gray-400 dark:text-gray-500">None</div>
        ) : (
          rootChildren.map((node, idx) => (
            <TreeRow
              key={`${node.channelId}-${idx}`}
              node={node}
              depth={0}
              expanded={expanded}
              toggle={toggle}
              onRemoveDirect={onRemoveDirect}
            />
          ))
        )}
      </div>

      <ChannelPicker
        search={search}
        onSearchChange={onSearchChange}
        availableChannels={availableChannels}
        onSelect={onAdd}
      />
    </div>
  );
}
