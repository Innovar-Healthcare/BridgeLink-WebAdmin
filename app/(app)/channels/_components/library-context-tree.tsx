"use client";

import { useState, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResourceContextKey } from "@/app/(app)/channels/_lib/channel-xml";

export type LibraryContextSelection = ResourceContextKey | "root";

interface Destination {
  metaDataId: number;
  name: string;
  transportName: string;
}

interface LibraryContextTreeProps {
  destinations: Destination[];
  selected: LibraryContextSelection;
  onSelect: (key: LibraryContextSelection) => void;
}

const CHANNEL_SCRIPT_LEAVES = [
  "Deploy Script",
  "Undeploy Script",
  "Preprocessor Script",
  "Postprocessor Script",
  "Attachment Handler",
  "Batch Script",
];
const SOURCE_LEAVES = ["Receiver", "Filter/Transformer"];
const DEST_LEAVES = ["Filter/Transformer", "Dispatcher", "Response Transformer"];

// ─── Row primitives ───────────────────────────────────────────────────────────

interface ExpandButtonProps {
  expandKey: string;
  expanded: Set<string>;
  toggle: (k: string) => void;
}

function ExpandButton({ expandKey, expanded, toggle }: ExpandButtonProps) {
  return (
    <button
      onClick={() => toggle(expandKey)}
      className="shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      aria-label={expanded.has(expandKey) ? "Collapse" : "Expand"}
    >
      <ChevronRight
        className={cn(
          "w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform",
          expanded.has(expandKey) && "rotate-90"
        )}
      />
    </button>
  );
}

interface SelectableRowProps {
  label: string;
  depth: number;
  expandKey?: string;
  expanded?: Set<string>;
  toggle?: (k: string) => void;
  selectionKey: LibraryContextSelection;
  selected: LibraryContextSelection;
  onSelect: (k: LibraryContextSelection) => void;
}

function SelectableRow({
  label,
  depth,
  expandKey,
  expanded,
  toggle,
  selectionKey,
  selected,
  onSelect,
}: SelectableRowProps) {
  const isSelected = selected === selectionKey;
  const hasChildren = !!expandKey && !!expanded && !!toggle;
  const isExpanded = hasChildren && expanded!.has(expandKey!);

  return (
    <>
      <div
        role="treeitem"
        aria-selected={isSelected}
        onClick={() => onSelect(selectionKey)}
        className={cn(
          "flex items-center gap-0.5 py-0.5 cursor-pointer rounded select-none text-sm",
          isSelected
            ? "bg-blue-100 dark:bg-blue-900/40 text-blue-900 dark:text-blue-100"
            : "hover:bg-gray-100 dark:hover:bg-gray-700/50 text-gray-800 dark:text-gray-200"
        )}
        style={{ paddingLeft: depth * 14 + 2 }}
      >
        {hasChildren ? (
          <span onClick={(e) => e.stopPropagation()}>
            <ExpandButton expandKey={expandKey!} expanded={expanded!} toggle={toggle!} />
          </span>
        ) : (
          <span className="inline-block w-[18px] shrink-0" />
        )}
        <span className="truncate">{label}</span>
      </div>

      {hasChildren &&
        isExpanded &&
        (selectionKey === "root"
          ? []
          : selectionKey === "channel"
            ? CHANNEL_SCRIPT_LEAVES
            : selectionKey === 0
              ? SOURCE_LEAVES
              : DEST_LEAVES
        ).map((leaf) => <LeafRow key={leaf} label={leaf} depth={depth + 1} />)}
    </>
  );
}

interface LeafRowProps {
  label: string;
  depth: number;
}

function LeafRow({ label, depth }: LeafRowProps) {
  return (
    <div
      className="flex items-center gap-0.5 py-0.5 text-xs text-gray-400 dark:text-gray-500 select-none cursor-default opacity-60"
      style={{ paddingLeft: depth * 14 + 2 + 18 }}
    >
      <span className="truncate">{label}</span>
    </div>
  );
}

// ─── Main tree ────────────────────────────────────────────────────────────────

export function LibraryContextTree({ destinations, selected, onSelect }: LibraryContextTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["root"]));
  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <div role="tree" className="text-sm select-none px-1 py-1 overflow-y-auto min-h-0">
      {/* Root: Channel */}
      <SelectableRow
        label="Channel"
        depth={0}
        expandKey="root"
        expanded={expanded}
        toggle={toggle}
        selectionKey="root"
        selected={selected}
        onSelect={onSelect}
      />

      {expanded.has("root") && (
        <>
          {/* Channel Scripts */}
          <SelectableRow
            label="Channel Scripts"
            depth={1}
            expandKey="channel"
            expanded={expanded}
            toggle={toggle}
            selectionKey="channel"
            selected={selected}
            onSelect={onSelect}
          />

          {/* Source Connector */}
          <SelectableRow
            label="Source Connector"
            depth={1}
            expandKey="source"
            expanded={expanded}
            toggle={toggle}
            selectionKey={0}
            selected={selected}
            onSelect={onSelect}
          />

          {/* Destinations */}
          {destinations.map((dest) => (
            <SelectableRow
              key={dest.metaDataId}
              label={`${dest.name} (${dest.transportName})`}
              depth={1}
              expandKey={`dest-${dest.metaDataId}`}
              expanded={expanded}
              toggle={toggle}
              selectionKey={dest.metaDataId}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
    </div>
  );
}
