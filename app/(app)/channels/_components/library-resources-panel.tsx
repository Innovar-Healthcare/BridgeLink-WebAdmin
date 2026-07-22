"use client";

import { useCallback, useRef, useState } from "react";
import {
  LibraryContextTree,
  type LibraryContextSelection,
} from "@/app/(app)/channels/_components/library-context-tree";
import type {
  ResourceContextKey,
  ResourceIdsByContext,
} from "@/app/(app)/channels/_lib/channel-xml";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import type { ResourceProperties } from "@/lib/types";

// ─── Panel-width resize constants ─────────────────────────────────────────────

const TREE_WIDTH_KEY = "bl-library-resources-tree-width";
const DEFAULT_TREE_WIDTH = 220;
const MIN_TREE_WIDTH = 180;
const MAX_TREE_WIDTH = 600;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function contextLabel(
  key: LibraryContextSelection,
  destinations: Array<{ metaDataId: number; name: string }>
): string {
  if (key === "root") return "Channel";
  if (key === "channel") return "Channel Scripts";
  if (key === 0) return "Source Connector";
  const dest = destinations.find((d) => d.metaDataId === key);
  return dest ? dest.name : `Destination ${String(key)}`;
}

function allContextKeys(byContext: ResourceIdsByContext): ResourceContextKey[] {
  return Array.from(byContext.keys());
}

/**
 * Tri-state across all contexts for a given resource id:
 * - all have it → checked=true
 * - none have it → checked=false
 * - mixed → indeterminate=true
 */
function triState(
  resourceId: string,
  byContext: ResourceIdsByContext
): { checked: boolean; indeterminate: boolean } {
  const keys = allContextKeys(byContext);
  if (keys.length === 0) return { checked: false, indeterminate: false };
  const haveCount = keys.filter((k) => (byContext.get(k) ?? []).includes(resourceId)).length;
  if (haveCount === 0) return { checked: false, indeterminate: false };
  if (haveCount === keys.length) return { checked: true, indeterminate: false };
  return { checked: false, indeterminate: true };
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface Destination {
  metaDataId: number;
  name: string;
  transportName: string;
}

export interface LibraryResourcesPanelProps {
  /** All server resources available for selection. */
  resources: ResourceProperties[];
  /** Per-context resource ID selection (controlled by the parent dialog). */
  byContext: ResourceIdsByContext;
  /** Destination connectors from the channel — drives tree node generation. */
  destinations: Destination[];
  /** Called on every toggle with the updated map. Never mutates the input. */
  onChange: (byContext: ResourceIdsByContext) => void;
}

// ─── Panel ────────────────────────────────────────────────────────────────────

/**
 *, finding #46: Java's LibraryResourcesPanel consults each resource's `LibraryClientPlugin`
 * for two extra behaviors — `getUnselectableTransportNames()` (disable the checkbox for connectors of
 * certain transports) and `singleSelectionOnly()` (selecting one resource of a type clears the others
 * of that type). This panel intentionally does not model those hooks: they are plugin extension points,
 * and every shipping BridgeLink resource plugin uses the base defaults (empty unselectable-transport
 * list, `singleSelectionOnly=false`), so there is no observable behavioral difference today. Revisit if
 * a future resource plugin overrides either hook.
 */
export function LibraryResourcesPanel({
  resources,
  byContext,
  destinations,
  onChange,
}: LibraryResourcesPanelProps) {
  const [selectedContext, setSelectedContext] = useState<LibraryContextSelection>("root");

  // ── Tree pane width ────────────────────────────────────────────────────────
  const [treeWidth, setTreeWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_TREE_WIDTH;
    const saved = localStorage.getItem(TREE_WIDTH_KEY);
    return saved
      ? Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, parseInt(saved, 10)))
      : DEFAULT_TREE_WIDTH;
  });
  const treeWidthRef = useRef(treeWidth);
  // eslint-disable-next-line react-hooks/refs
  treeWidthRef.current = treeWidth;

  const handleResizeDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = treeWidthRef.current;
    const onMove = (me: MouseEvent) => {
      const newW = Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, startW + me.clientX - startX));
      setTreeWidth(newW);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      localStorage.setItem(TREE_WIDTH_KEY, String(treeWidthRef.current));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // ── Toggle helpers ─────────────────────────────────────────────────────────

  function toggleForContext(resourceId: string, contextKey: ResourceContextKey, checked: boolean) {
    const next = new Map(byContext);
    const current = next.get(contextKey) ?? [];
    next.set(
      contextKey,
      checked ? [...current, resourceId] : current.filter((id) => id !== resourceId)
    );
    onChange(next);
  }

  function toggleForRoot(resourceId: string, checked: boolean) {
    const next = new Map(byContext);
    for (const key of allContextKeys(next)) {
      const current = next.get(key) ?? [];
      next.set(
        key,
        checked
          ? current.includes(resourceId)
            ? current
            : [...current, resourceId]
          : current.filter((id) => id !== resourceId)
      );
    }
    onChange(next);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const label = contextLabel(selectedContext, destinations);

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Tree pane */}
      <div
        className="shrink-0 flex flex-col border-r border-border bg-white dark:bg-gray-900 relative overflow-hidden"
        style={{ width: treeWidth }}
      >
        <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-border shrink-0 uppercase tracking-wide">
          Library Context
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          <LibraryContextTree
            destinations={destinations}
            selected={selectedContext}
            onSelect={setSelectedContext}
          />
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={handleResizeDragStart}
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors z-10"
          title="Drag to resize panel"
        />
      </div>

      {/* Resources pane */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-border shrink-0 uppercase tracking-wide">
          Resources for {label}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-1">
          {resources.length === 0 ? (
            <p className="text-sm italic text-gray-400 dark:text-gray-500 py-2 px-2">
              No server resources configured.
            </p>
          ) : (
            <div className="space-y-0.5">
              {resources.map((res) => {
                let checked: boolean;
                let indeterminate = false;

                if (selectedContext === "root") {
                  const ts = triState(res.id, byContext);
                  checked = ts.checked;
                  indeterminate = ts.indeterminate;
                } else {
                  checked = (byContext.get(selectedContext) ?? []).includes(res.id);
                }

                return (
                  <FormCheckbox
                    key={res.id}
                    checked={checked}
                    indeterminate={indeterminate}
                    onChange={(c) => {
                      if (selectedContext === "root") {
                        toggleForRoot(res.id, c);
                      } else {
                        toggleForContext(res.id, selectedContext, c);
                      }
                    }}
                    label={
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 leading-snug">
                          {res.name}
                        </div>
                        {res.directory && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                            {res.directory}
                          </div>
                        )}
                        {res.description && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {res.description}
                          </div>
                        )}
                      </div>
                    }
                    className="w-full px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 items-start"
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
