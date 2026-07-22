/**
 * Types for the transformer step plugin registry.
 *
 * Every built-in transformer step (Mapper, Message Builder, JavaScript, XSLT,
 * External Script, Destination Set Filter, Iterator) and commercial plugin
 * step self-registers via registerTransformerStep().  Consumers dispatch
 * through the registry helpers (parseStep / serializeStep / emitStepJs /
 * validateStep / resolveStep) instead of switching on step.type.
 *
 * Mirrors the plugin pattern used by the data type and transmission mode
 * registries in _datatypes/ and _connectors/shared/transmission-modes/.
 */

import type { ComponentType } from "react";
import type { ContextType } from "@/lib/types";
import type { EditorContext } from "@/lib/plugin-registry";
import type { Rule, Step } from "../filter-transformer-xml";

// ─── Destination info (for Destination Set Filter step) ──────────────────────

/**
 * Subset of destination connector info passed to step editor panels that
 * need to display a list of destinations (e.g. Destination Set Filter).
 */
export interface TransformerStepDestInfo {
  metaDataId: number;
  name: string;
}

// ─── Iterator phase context ──────────────────────────────────────────────────

/**
 * One enclosing Iterator's loop context, passed down to a child step's
 * iteration-script emitter. Ancestors are ordered outermost-first, mirroring
 * Java's `LinkedList<IteratorProperties>` threaded through `getIterationScript`.
 * Message Builder uses the index variables to build its E4X segment-creation
 * prologue.
 */
export interface IteratorAncestor {
  indexVariable: string;
  target: string;
}

// ─── Base shape every step shares ────────────────────────────────────────────

/**
 * Common fields every transformer step carries, regardless of type.
 * Step-specific fields extend this base interface.
 */
export interface TransformerStepBase {
  /** Step type discriminator (e.g. "Mapper", "JavaScript", "Iterator"). */
  type: string;
  /** Human-readable name shown in the step list table. */
  name: string;
  /** Hierarchical sequence number (e.g. "2", "2-0-1"). */
  sequenceNumber: string;
  /** Whether the step runs at channel execution time. */
  enabled: boolean;
}

// ─── Editor panel contract ───────────────────────────────────────────────────

/**
 * Props passed to a step-specific EditorPanel component rendered in the
 * detail pane of the transformer editor.
 *
 * `destinations` is supplied only when the editor is for a source-connector
 * transformer; it is used by Destination Set Filter to render a checkbox
 * list of destination names. Panels that don't need it should ignore it.
 */
export interface TransformerStepEditorProps<
  TStep extends TransformerStepBase = TransformerStepBase,
> {
  step: TStep;
  onChange: (step: TStep) => void;
  isDark?: boolean;
  showErrors?: boolean;
  destinations?: TransformerStepDestInfo[];
  contextType?: ContextType;
  channelId?: string;
  /** Full editor context forwarded to step panels that need it (e.g. for the AI overlay). */
  context?: EditorContext;
  /** Full element tree — used by expression fields to apply ancestor iterator index substitutions on tree-node drops. */
  elements?: (Rule | Step)[];
  /** Path of this step in the element tree — used alongside `elements` to detect iterator ancestry. */
  selectedPath?: number[] | null;
}

// ─── Registry entry ──────────────────────────────────────────────────────────

/**
 * Definition of a transformer step that can be registered via
 * registerTransformerStep().
 *
 * Mirrors Java's TransformerStepPlugin contract:
 *   - type             → getPluginPointName()
 *   - xmlTag           → FQN of the Step class (e.g. MapperStep.class.getName())
 *   - defaults()       → getDefaults()
 *   - parse(el)        → reads the <FQN>...</FQN> element from channel XML
 *   - serialize(step)  → writes the step's inner XML (body between <FQN> tags)
 *   - emitScript(step) → mirrors Step.getScript(false)
 *   - validate(step)   → mirrors panel.checkProperties()
 *   - EditorPanel      → panel.getPanel()
 *   - visitChildren    → container steps (Iterator) return children for recursion
 */
export interface TransformerStepDefinition<
  TStep extends TransformerStepBase = TransformerStepBase,
> {
  /** Step type discriminator. Becomes the registry key. */
  type: string;

  /**
   * Fully-qualified Java class tag name used in channel XML, e.g.
   * "com.mirth.connect.plugins.mapper.MapperStep".
   */
  xmlTag: string;

  /**
   * Server plugin name (must match `GET /extensions/plugins/`) used for
   * server-enablement gating. When set, this step type is hidden
   * from the "Add" dropdown unless that plugin is installed AND enabled on the
   * connected server. Stamped from the definition's `serverPluginName` by
   * `registerPlugin()`. Parse/serialize is never gated, so an existing step of
   * this type in a channel still parses, renders its editor, and round-trips.
   * Omit for built-in steps (always shown).
   */
  pluginName?: string;

  /**
   * Contexts in which this step appears in the "Add" dropdown.
   * "source"      → source transformer
   * "destination" → destination transformer / response transformer
   * Plugin steps may choose to appear in one or both contexts.
   */
  contexts: readonly ("source" | "destination")[];

  /** Factory that returns a fresh step with sensible defaults. */
  defaults(): TStep;

  /**
   * Parse the step element from channel XML into a typed step.
   * Receives the `<FQN version="...">...</FQN>` element; name / sequenceNumber
   * / enabled are parsed by the registry before `parse` is called and should
   * be read from the passed element using helpers from
   * filter-transformer-xml-helpers.ts.
   */
  parse(el: Element): TStep;

  /**
   * Serialize the step's inner XML body (the children between the outer
   * `<FQN version="...">` and `</FQN>` tags). The name / sequenceNumber /
   * enabled fields are emitted by the registry; this callback emits only
   * step-specific fields. The `version` argument is threaded through so
   * container steps (Iterator) can recursively serialize their children
   * using the same channel XML version.
   */
  serialize(step: TStep, version: string): string;

  /**
   * Generate the JavaScript source that mirrors the Java client's
   * `step.getScript(false)` output. Shown in the "Generated Script" tab.
   */
  emitScript(step: TStep): string;

  /**
   * Iterator phase emitters — mirror the Java `FilterTransformerIterable`
   * interface (`getPreScript` / `getIterationScript` / `getPostScript`). When a
   * step appears as a child of an Iterator, the Iterator composes its script in
   * three phases instead of calling `emitScript`:
   *
   *   1. pre        — declare per-child accumulators (`var _x = Lists.list();`)
   *   2. iteration  — the body emitted once per loop turn (`_x.add(...)`)
   *   3. post       — store the accumulated array (`channelMap.put('x', _x.toArray());`)
   *
   * A step is treated as "iterable" iff it implements `emitIterationScript`
   * (see `isStepIterable`). Steps that don't implement these contribute nothing
   * to the pre/post phases and fall back to `emitScript` inside the loop —
   * matching Java's `instanceof FilterTransformerIterable` check. Implement
   * only the phases that apply: Message Builder, for example, has no pre/post
   * (Java returns null) but does emit an iteration-specific E4X prologue.
   *
   * `ancestors` lists the enclosing Iterators outermost-first, so an iteration
   * emitter can reconstruct index-variable context (used by Message Builder).
   */
  emitPreScript?(step: TStep): string;
  emitIterationScript?(step: TStep, ancestors: IteratorAncestor[]): string;
  emitPostScript?(step: TStep): string;

  /**
   * Validate the step's properties. Returns null when valid, or a
   * human-readable error message (mirrors Java panel.checkProperties()).
   */
  validate(step: TStep): string | null;

  /** React component rendered in the detail pane when this step is selected. */
  EditorPanel: ComponentType<TransformerStepEditorProps<TStep>>;

  /**
   * Return the step's child steps for recursive traversal. Only container
   * steps (e.g. Iterator) implement this. Leave undefined for leaf steps.
   */
  visitChildren?(step: TStep): TransformerStepBase[];

  /**
   * Return a copy of the step with its children replaced. Paired with
   * visitChildren; required for container steps.
   */
  withChildren?(step: TStep, children: TransformerStepBase[]): TStep;
}
