"use client";

/**
 * Message tree visualizer for the filter/transformer Reference panel.
 *
 * Exports:
 *   MessageTreesTab — tab content rendered by ReferencePanel
 *
 * Internal: buildMessageTree, tree geometry constants, TreeNodeRow, TreeSection.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useVerticalSplitResize } from "@/lib/hooks/use-vertical-split-resize";
import { ensureDcmjs } from "@/lib/dicom-tag-parser";
import { DATA_TYPE_REGISTRY } from "../../_datatypes/index";
import type { MsgTreeNode, ParseResult } from "../../_datatypes/types";
import { splitLabel } from "@/lib/reference-data";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

// ─── Drag MIME type ──────────────────────────────────────────────────────────
// Structured data carried alongside text/plain so drop targets can identify
// which tree the node came from and act accordingly (auto-create steps).

export const TREE_NODE_MIME = "application/x-bridgelink-tree-node";

export interface TreeNodeDragData {
  source: "inbound" | "outbound";
  dragExpr: string;
  /** Label of the dragged node (e.g. "MSH.7.1 (Time of Message)") */
  nodeLabel: string;
  /** Labels of non-root ancestors, root-most first (e.g. ["MSH ...", "MSH.7 ..."]) */
  ancestorLabels: string[];
}

// ─── Context menu action types ───────────────────────────────────────────────

export interface TreeContextAction {
  source: "inbound" | "outbound";
  dragExpr: string;
  action: "createRuleBuilder" | "createMapper" | "createMessageBuilder";
  /** Label of the right-clicked node (e.g. "MSH.7.1 (Time of Message)") */
  nodeLabel: string;
  /** Labels of non-root ancestors, root-most first (e.g. ["MSH ...", "MSH.7 ..."]) */
  ancestorLabels: string[];
}

// ─── Main parse dispatcher ──────────────────────────────────────────────
// All parsing logic lives in individual _datatypes/ plugin files.
// This function dispatches to the appropriate plugin via DATA_TYPE_REGISTRY.
// Returns `normalizedText` when the plugin's getTemplateString() converted the
// input (e.g. base64 DICOM → XML).  The caller should update the stored
// template text so the textarea reflects the normalized form.

function buildMessageTree(
  text: string | null | undefined,
  dataType: string,
  prefix: string,
  suffix: string,
  propsXml?: string | null
): { result: ParseResult | null; normalizedText?: string } {
  if (!text?.trim()) return { result: null };
  const plugin = DATA_TYPE_REGISTRY.get(dataType);
  if (!plugin?.parseTemplate) {
    if (plugin?.isBinary) {
      return {
        result: {
          error: `${dataType} requires server-side parsing — paste to store the template; tree view is not available client-side.`,
        },
      };
    }
    return { result: { error: `Tree view not available for ${dataType}.` } };
  }

  // Normalize the template text (e.g. base64 DICOM binary → DICOM XML).
  // Only fires when the plugin provides getTemplateString().
  let effectiveText = text.trim();
  let normalizedText: string | undefined;
  if (plugin.getTemplateString) {
    try {
      const normalized = plugin.getTemplateString(effectiveText);
      if (normalized !== effectiveText) {
        normalizedText = normalized;
        effectiveText = normalized;
      }
    } catch {
      // Normalization failed — proceed with original text unchanged.
    }
  }

  try {
    return {
      result: { tree: plugin.parseTemplate(effectiveText, prefix, suffix, propsXml) },
      normalizedText,
    };
  } catch {
    return { result: { error: `Template is not valid ${dataType || "message"}.` }, normalizedText };
  }
}

// ─── Tree node color by depth ──────────────────────────────────────────────────
// Depth-based coloring helps distinguish segments, fields, and components.
// When a search filter is active and the node matches, highlight color takes priority.

// Cycling depth palette — 6 hues with sufficient separation.
// Depth 0 (root) is always gray/semibold. Depths 1+ cycle through the palette.
const DEPTH_CODE_PALETTE: readonly { light: string; dark: string }[] = [
  { light: "text-blue-700", dark: "text-blue-300" }, // depth 1: segments
  { light: "text-emerald-700", dark: "text-emerald-400" }, // depth 2: fields
  { light: "text-violet-700", dark: "text-violet-400" }, // depth 3: components
  { light: "text-amber-700", dark: "text-amber-400" }, // depth 4+
  { light: "text-cyan-700", dark: "text-cyan-400" }, // depth 5+
  { light: "text-rose-700", dark: "text-rose-400" }, // depth 6+
];

function nodeCodeColorClass(depth: number): string {
  if (depth === 0) return "text-gray-800 dark:text-gray-200";
  const entry = DEPTH_CODE_PALETTE[(depth - 1) % DEPTH_CODE_PALETTE.length];
  return `${entry.light} dark:${entry.dark}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Collect all descendant node IDs for "Expand All" */
function collectNodeIds(node: MsgTreeNode): string[] {
  const ids: string[] = [node.id];
  for (const child of node.children) {
    ids.push(...collectNodeIds(child));
  }
  return ids;
}

/**
 * Default expanded node IDs for a freshly built tree.
 *
 * Mirrors the Java client (`TreePanel.java`), which expands only the root by
 * default: the root message is open so its direct children (HL7 segments,
 * XML/JSON top-level nodes, etc.) are visible, but those children stay collapsed
 * — deeper levels (e.g. HL7 fields MSH.1/MSH.2) are hidden until the user
 * expands a node. When a filter is active every node is expanded so matches are
 * visible, matching Java's `expandAll()`-on-filter behavior.
 */
export function computeDefaultExpandedIds(root: MsgTreeNode, hasFilter: boolean): Set<string> {
  const ids = new Set<string>();
  function walk(node: MsgTreeNode, d: number) {
    if (d < 1 || hasFilter) ids.add(node.id);
    for (const child of node.children) walk(child, d + 1);
  }
  walk(root, 0);
  return ids;
}

// ─── Tree node row ─────────────────────────────────────────────────────────────
// Tree with connector lines: each children container adds exactly INDENT px of
// indentation via paddingLeft (NOT marginLeft, which would compound with row
// paddingLeft and cause exponentially wider trees at deeper levels).
// Vertical line sits at VLINE_X within each container's padding area.
// Horizontal stubs reach from the vertical line to the row content.

const INDENT = 12; // px added per depth level (each children container's paddingLeft)
const VLINE_X = 5; // px from container left edge where vertical guide line is drawn
const H_STUB = INDENT - VLINE_X; // = 7 — horizontal connector width
const LINE_CLS = "border-border";

interface TreeNodeRowProps {
  node: MsgTreeNode;
  depth: number;
  filter: string;
  exact: boolean;
  isLast?: boolean;
  /** Which tree this node belongs to — used for drag data and context menu actions */
  treeSource: "inbound" | "outbound";
  /** Whether this node can accept drops (outbound nodes in transformer mode) */
  isDropTarget?: boolean;
  /** Called when an inbound node is dropped onto this outbound node */
  onDropCreate?: (
    messageSegment: string,
    mapping: string,
    inboundNodeLabel?: string,
    inboundAncestorLabels?: string[]
  ) => void;
  /** Context menu actions available for this tree context */
  contextActions?: ("createRuleBuilder" | "createMapper" | "createMessageBuilder")[];
  /** Called when a context menu action is selected */
  onContextAction?: (action: TreeContextAction) => void;
  /** Labels of non-root ancestors of this node, root-most first */
  ancestorLabels: string[];
  /** Set of expanded node IDs — used for controlled expand state */
  expandedIds: Set<string>;
  /** Toggle a single node's expand state */
  onToggleExpand: (id: string) => void;
  /** Expand all descendants of a node */
  onExpandAll: (ids: string[]) => void;
}

function TreeNodeRow({
  node,
  depth,
  filter,
  exact,
  treeSource,
  isDropTarget = false,
  onDropCreate,
  contextActions,
  onContextAction,
  ancestorLabels,
  expandedIds,
  onToggleExpand,
  onExpandAll,
}: TreeNodeRowProps) {
  const [dragOver, setDragOver] = useState(false);
  const expanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;

  // Filter matching
  const filterLower = filter.toLowerCase();

  function selfMatches(n: MsgTreeNode): boolean {
    if (!filter) return true;
    const text = (n.label + " " + (n.value ?? "")).toLowerCase();
    return exact ? text === filterLower : text.includes(filterLower);
  }

  function anyMatch(n: MsgTreeNode): boolean {
    return selfMatches(n) || n.children.some(anyMatch);
  }

  if (filter && !anyMatch(node)) return null;

  const highlight = selfMatches(node);
  const isRoot = depth === 0;

  // Drop handlers for outbound tree nodes
  const dropHandlers = isDropTarget
    ? {
        onDragOver: (e: React.DragEvent) => {
          // Only accept inbound tree nodes
          if (e.dataTransfer.types.includes(TREE_NODE_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDragOver(true);
          }
        },
        onDragLeave: () => setDragOver(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setDragOver(false);
          const raw = e.dataTransfer.getData(TREE_NODE_MIME);
          if (!raw) return;
          try {
            const data = JSON.parse(raw) as TreeNodeDragData;
            if (data.source === "inbound" && onDropCreate) {
              onDropCreate(node.dragExpr, data.dragExpr, data.nodeLabel, data.ancestorLabels);
            }
          } catch {
            // Invalid drag data — ignore
          }
        },
      }
    : {};

  const rowContent = (
    <div className="relative">
      {/* Node row */}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", node.dragExpr);
          e.dataTransfer.setData(
            TREE_NODE_MIME,
            JSON.stringify({
              source: treeSource,
              dragExpr: node.dragExpr,
              nodeLabel: node.label,
              ancestorLabels,
            } satisfies TreeNodeDragData)
          );
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => hasChildren && onToggleExpand(node.id)}
        {...dropHandlers}
        className={
          "flex items-center rounded py-[3px] select-none " +
          "cursor-grab active:cursor-grabbing " +
          (dragOver
            ? "bg-blue-100 dark:bg-blue-900/40 ring-1 ring-blue-400 dark:ring-blue-500"
            : highlight && filter
              ? "bg-blue-50/60 hover:bg-blue-50 dark:bg-blue-900/10 dark:hover:bg-blue-900/20"
              : "hover:bg-gray-100 dark:hover:bg-gray-800")
        }
        style={{ paddingLeft: isRoot ? 4 : 2 }}
        title={node.label + (node.value !== undefined ? ` = ${node.value}` : "")}
      >
        {/* Horizontal connector: reaches left from row to parent's vertical line.
            Positioned relative to the nearest positioned ancestor (the outer wrapper div).
            The wrapper sits at INDENT from the children container's left, so
            left: -H_STUB lands exactly at VLINE_X from the container. */}
        {!isRoot && (
          <span
            className={`absolute ${LINE_CLS} border-t border-dashed`}
            style={{
              left: `-${H_STUB}px`,
              width: `${H_STUB}px`,
              top: "12px",
            }}
          />
        )}

        {/* Expand / collapse indicator */}
        {hasChildren ? (
          <span
            className={
              "w-3.5 h-3.5 shrink-0 flex items-center justify-center text-[8px] leading-none " +
              "transition-transform duration-100 " +
              (expanded ? "" : "-rotate-90 ")
            }
          >
            <svg viewBox="0 0 10 10" className="w-2 h-2 fill-gray-400 dark:fill-gray-500">
              <polygon points="0,0 10,5 0,10" />
            </svg>
          </span>
        ) : (
          <span className="w-3.5 h-3.5 shrink-0 flex items-center justify-center">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
          </span>
        )}

        {/* Label — split into code + description for visual hierarchy */}
        {(() => {
          const [code, desc] = splitLabel(node.label);
          const hl = highlight && filter;
          return (
            <>
              <span
                className={
                  "text-xs font-mono ml-1 shrink-0 font-semibold " +
                  (hl ? "text-blue-700 dark:text-blue-300" : nodeCodeColorClass(depth))
                }
              >
                {code}
              </span>
              {desc && (
                <span
                  className={
                    "text-xs font-mono truncate ml-1 shrink min-w-0 " +
                    (hl
                      ? "text-blue-400 dark:text-blue-400/70"
                      : "text-gray-400 dark:text-gray-500")
                  }
                >
                  {desc}
                </span>
              )}
            </>
          );
        })()}

        {/* Leaf value */}
        {node.value !== undefined && (
          <span className="text-xs font-mono text-gray-700 dark:text-gray-200 truncate ml-1.5 shrink min-w-0">
            = {node.value}
          </span>
        )}
      </div>

      {/* Children with vertical connector line.
          paddingLeft: INDENT pushes child wrappers right by exactly one level.
          Each nested container contributes only INDENT px — no compounding.
          The vertical line span sits at VLINE_X within the padding area. */}
      {hasChildren && expanded && (
        <div className="relative" style={{ paddingLeft: `${INDENT}px` }}>
          {/* Vertical guide line — drawn at VLINE_X within this container's
              padding area, connecting this node down through all its children */}
          <span
            className={`absolute top-0 bottom-0 ${LINE_CLS} border-l border-dashed`}
            style={{ left: `${VLINE_X}px` }}
          />
          {node.children.map((child, ci) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              filter={filter}
              exact={exact}
              isLast={ci === node.children.length - 1}
              treeSource={treeSource}
              isDropTarget={isDropTarget}
              onDropCreate={onDropCreate}
              contextActions={contextActions}
              onContextAction={onContextAction}
              ancestorLabels={depth === 0 ? [] : [...ancestorLabels, node.label]}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onExpandAll={onExpandAll}
            />
          ))}
        </div>
      )}
    </div>
  );

  // Wrap with context menu if actions are available
  if (contextActions && contextActions.length > 0 && onContextAction) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
        <ContextMenuContent>
          {hasChildren && (
            <>
              <ContextMenuItem
                onClick={() => {
                  if (!expanded) onToggleExpand(node.id);
                }}
              >
                Expand
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  const allIds = collectNodeIds(node);
                  onExpandAll(allIds);
                }}
              >
                Expand All
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  if (expanded) onToggleExpand(node.id);
                }}
              >
                Collapse
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          {contextActions.includes("createRuleBuilder") && (
            <ContextMenuItem
              onClick={() =>
                onContextAction({
                  source: treeSource,
                  dragExpr: node.dragExpr,
                  action: "createRuleBuilder",
                  nodeLabel: node.label,
                  ancestorLabels,
                })
              }
            >
              Create Rule Builder
            </ContextMenuItem>
          )}
          {contextActions.includes("createMapper") && (
            <ContextMenuItem
              onClick={() =>
                onContextAction({
                  source: treeSource,
                  dragExpr: node.dragExpr,
                  action: "createMapper",
                  nodeLabel: node.label,
                  ancestorLabels,
                })
              }
            >
              Create Mapper
            </ContextMenuItem>
          )}
          {contextActions.includes("createMessageBuilder") && (
            <ContextMenuItem
              onClick={() =>
                onContextAction({
                  source: treeSource,
                  dragExpr: node.dragExpr,
                  action: "createMessageBuilder",
                  nodeLabel: node.label,
                  ancestorLabels,
                })
              }
            >
              Create Message Builder
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return rowContent;
}

// ─── Tree section (Filter + Tree) ─────────────────────────────────────────────

function TreeSection({
  title,
  dataType,
  template,
  propsXml,
  prefix,
  suffix,
  onNormalize,
  treeSource,
  isDropTarget,
  onDropCreate,
  contextActions,
  onContextAction,
}: {
  title: string;
  dataType: string;
  template?: string | null;
  propsXml?: string | null;
  prefix: string;
  suffix: string;
  /** Called when the plugin normalizes the template text (e.g. base64 DICOM → XML). */
  onNormalize?: (v: string) => void;
  /** Which tree this section represents */
  treeSource: "inbound" | "outbound";
  /** Whether nodes in this tree can accept drops */
  isDropTarget?: boolean;
  /** Called when an inbound node is dropped onto an outbound node */
  onDropCreate?: (
    messageSegment: string,
    mapping: string,
    inboundNodeLabel?: string,
    inboundAncestorLabels?: string[]
  ) => void;
  /** Context menu actions available for nodes in this tree */
  contextActions?: ("createRuleBuilder" | "createMapper" | "createMessageBuilder")[];
  /** Called when a context menu action is selected */
  onContextAction?: (action: TreeContextAction) => void;
}) {
  const [filter, setFilter] = useState("");
  const [exact, setExact] = useState(false);

  // DICOM parsing depends on dcmjs (~11MB), which is loaded lazily as its own
  // chunk via ensureDcmjs(). The parse functions are synchronous, so we preload
  // dcmjs here before building the tree: while it loads we show a loading line,
  // and bumping dcmjsReady re-runs the memo once the module is available.
  const needsDcmjs = dataType === "DICOM";
  const [dcmjsReady, setDcmjsReady] = useState(false);
  const [dcmjsFailed, setDcmjsFailed] = useState(false);
  useEffect(() => {
    if (!needsDcmjs || dcmjsReady) return;
    let cancelled = false;
    ensureDcmjs().then(
      () => {
        if (!cancelled) setDcmjsReady(true);
      },
      () => {
        // Chunk failed to load — stop waiting and let buildMessageTree run, which
        // surfaces a normal parse error instead of hanging on the loading line.
        if (!cancelled) setDcmjsFailed(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [needsDcmjs, dcmjsReady]);

  const dicomLoading = needsDcmjs && !dcmjsReady && !dcmjsFailed && !!template?.trim();

  const { result, normalizedText } = useMemo(
    () =>
      dicomLoading
        ? { result: null }
        : buildMessageTree(template, dataType, prefix, suffix, propsXml),
    [template, dataType, prefix, suffix, propsXml, dicomLoading]
  );

  // Controlled expand state — allows context menu Expand/Expand All/Collapse
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Compute default expanded IDs when tree or filter changes
  const defaultExpandedIds = useMemo(() => {
    if (!result || "error" in result) return new Set<string>();
    return computeDefaultExpandedIds(result.tree, filter.length > 0);
  }, [result, filter]);

  // Reset expand state when tree structure or filter changes, and initialize
  // on first render (lastTreeKey starts as null so the guard fires immediately).
  const treeKey = `${template}-${dataType}-${prefix}-${suffix}-${propsXml}-${filter ? "f" : "u"}`;
  const [lastTreeKey, setLastTreeKey] = useState<string | null>(null);
  if (treeKey !== lastTreeKey) {
    setLastTreeKey(treeKey);
    setExpandedIds(defaultExpandedIds);
  }

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleExpandAll = useCallback((ids: string[]) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  // When the plugin normalizes the template text (e.g. base64 DICOM → DICOM XML),
  // propagate the updated text so the template textarea reflects the change.
  const stableOnNormalize = useCallback((v: string) => onNormalize?.(v), [onNormalize]);
  useEffect(() => {
    if (normalizedText !== undefined) {
      stableOnNormalize(normalizedText);
    }
  }, [normalizedText, stableOnNormalize]);

  const inputCls =
    "flex-1 h-5 px-1.5 text-xs rounded border border-border " +
    "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
    "focus:outline-none focus:border-blue-500";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Section header */}
      <div className="px-2 py-1 bg-gray-100 dark:bg-gray-800 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">{title}</span>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border shrink-0">
        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Filter:</span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className={inputCls}
        />
        <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={exact}
            onChange={(e) => setExact(e.target.checked)}
            className="w-3 h-3"
          />
          <span className="whitespace-nowrap">Match Exact</span>
        </label>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto p-1 min-h-[60px]">
        {!template?.trim() ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-3">
            No template defined.
          </p>
        ) : dicomLoading ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-3">
            Loading DICOM support…
          </p>
        ) : result === null ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-3">
            Empty template.
          </p>
        ) : "error" in result ? (
          <p className="text-xs text-red-500 dark:text-red-400 italic px-2 py-2">{result.error}</p>
        ) : (
          <TreeNodeRow
            node={result.tree}
            depth={0}
            filter={filter}
            exact={exact}
            treeSource={treeSource}
            isDropTarget={isDropTarget}
            onDropCreate={onDropCreate}
            contextActions={contextActions}
            onContextAction={onContextAction}
            ancestorLabels={[]}
            expandedIds={expandedIds}
            onToggleExpand={handleToggleExpand}
            onExpandAll={handleExpandAll}
          />
        )}
      </div>
    </div>
  );
}

// ─── Message Trees tab ────────────────────────────────────────────────────────

export interface MessageTreesTabProps {
  inboundDataType: string;
  inboundText: string;
  inboundPropsXml: string | null;
  outboundDataType: string;
  outboundText: string;
  outboundPropsXml: string | null;
  isTransformer: boolean;
  /** Called when the inbound template text is auto-normalized (e.g. base64 → XML). */
  onInboundNormalize?: (v: string) => void;
  /** Called when the outbound template text is auto-normalized. */
  onOutboundNormalize?: (v: string) => void;
  /** Whether this is a filter context (affects context menu actions) */
  isFilter?: boolean;
  /** Called when a context menu or drop action should create a new step/rule */
  onCreateFromTree?: (action: TreeContextAction) => void;
  /** Called when an inbound node is dropped onto an outbound node (creates Message Builder) */
  onCreateMessageBuilder?: (
    messageSegment: string,
    mapping: string,
    inboundNodeLabel?: string,
    inboundAncestorLabels?: string[]
  ) => void;
}

export function MessageTreesTab({
  inboundDataType,
  inboundText,
  inboundPropsXml,
  outboundDataType,
  outboundText,
  outboundPropsXml,
  isTransformer,
  onInboundNormalize,
  onOutboundNormalize,
  isFilter = false,
  onCreateFromTree,
  onCreateMessageBuilder,
}: MessageTreesTabProps) {
  const { topRatio, containerRef, onDragMouseDown } = useVerticalSplitResize({
    storageKey: "bl-ft-trees-split",
    defaultRatio: 0.5,
    minPx: 80,
  });

  // Context actions for inbound tree nodes
  const inboundContextActions = useMemo<
    ("createRuleBuilder" | "createMapper" | "createMessageBuilder")[]
  >(() => {
    if (!onCreateFromTree) return [];
    if (isFilter) return ["createRuleBuilder"];
    // transformer mode
    return ["createMapper", "createMessageBuilder"];
  }, [isFilter, onCreateFromTree]);

  // Context actions for outbound tree nodes
  const outboundContextActions = useMemo<
    ("createRuleBuilder" | "createMapper" | "createMessageBuilder")[]
  >(() => {
    if (!onCreateFromTree) return [];
    return ["createMessageBuilder"];
  }, [onCreateFromTree]);

  return (
    <div className="flex flex-col h-full" ref={containerRef}>
      <div
        className={"flex flex-col min-h-0 overflow-hidden " + (isTransformer ? "" : "flex-1")}
        style={isTransformer ? { height: `${topRatio * 100}%` } : undefined}
      >
        <TreeSection
          title="Inbound Message Template Tree"
          dataType={inboundDataType}
          template={inboundText}
          propsXml={inboundPropsXml}
          prefix="msg"
          suffix=".toString()"
          onNormalize={onInboundNormalize}
          treeSource="inbound"
          contextActions={inboundContextActions}
          onContextAction={onCreateFromTree}
        />
      </div>
      {isTransformer && (
        <>
          <div
            onMouseDown={onDragMouseDown}
            className="h-1 shrink-0 cursor-row-resize select-none bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors"
            title="Drag to resize"
          />
          <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
            <TreeSection
              title="Outbound Message Template Tree"
              dataType={outboundDataType}
              template={outboundText}
              propsXml={outboundPropsXml}
              prefix="tmp"
              suffix=""
              onNormalize={onOutboundNormalize}
              treeSource="outbound"
              isDropTarget={!!onCreateMessageBuilder}
              onDropCreate={onCreateMessageBuilder}
              contextActions={outboundContextActions}
              onContextAction={onCreateFromTree}
            />
          </div>
        </>
      )}
    </div>
  );
}
