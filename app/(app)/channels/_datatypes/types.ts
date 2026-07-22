/**
 * Shared types for the data type plugin registry.
 *
 * Kept in a thin module so that plugin files, reference-panel.tsx,
 * and channel-xml.ts can all import from here without circular dependencies.
 */

import type { ComponentType } from "react";
import type { Attachment } from "@/lib/types";

// ── Attachment type alias ─────────────────────────────────────────────────────

/**
 * A message attachment as returned by the message browser API.
 * Alias of the shared Attachment interface from lib/types.
 */
export type MessageAttachment = Attachment;

// ── Monaco token provider ─────────────────────────────────────────────────────

/**
 * Monarch tokenizer definition contributed by a data type plugin.
 * Registers a custom Monaco language for syntax-highlighting the
 * data type's native format in script editors and template panels.
 *
 * Mirrors Java's CTokenMarker extension point.
 */
export interface MonacoTokenProvider {
  /** Monaco language identifier (e.g. "dimse-xml"). Must be unique across plugins. */
  languageId: string;
  /**
   * Monarch tokenizer rules. Matches the shape of
   * monaco.languages.IMonarchLanguage.tokenizer — an object keyed by
   * state name whose values are arrays of Monarch rule tuples.
   * Typed loosely to avoid pulling the full monaco-editor types into this
   * module; the wiring code casts appropriately.
   */
  tokenizer: Record<string, unknown[]>;
}

// ── Code template contributions ───────────────────────────────────────────────

/**
 * A code snippet contributed to the filter/transformer Reference panel
 * when this data type is active as the inbound type.
 *
 * Mirrors Java's DataTypeCodeTemplatePlugin extension point.
 */
export interface CodeTemplateContribution {
  /** Display name shown in the reference list. */
  name: string;
  /** Tooltip description shown on hover. */
  description?: string;
  /** The code inserted when the item is dragged into the editor. */
  code: string;
  /**
   * Optional category label. Contributions sharing the same category are
   * grouped together in the Reference panel's category selector.
   * Defaults to "Data Type Functions" when omitted.
   */
  category?: string;
}

// ── Message tree types ────────────────────────────────────────────────────────

/** A node in the parsed message tree, displayed in the Msg Trees panel. */
export interface MsgTreeNode {
  id: string;
  /** Human-readable label shown in the tree. */
  label: string;
  /** The expression dropped into the script editor when this node is dragged. */
  dragExpr: string;
  children: MsgTreeNode[];
  /** Leaf value shown alongside the label (for terminal nodes). */
  value?: string;
}

export type ParseResult = { tree: MsgTreeNode } | { error: string };

// ── Properties section contract ───────────────────────────────────────────────

/** Props passed to a data type's PropertiesSection component. */
export interface DataTypePropertiesSectionProps {
  /** Current raw properties XML; null when the type has no stored properties yet. */
  propsXml: string | null;
  /** Which side of the transformer this dialog is for. */
  side: "inbound" | "outbound";
  /**
   * Transformer context of the host row. Gates which inbound property groups are
   * shown, mirroring Java's DataTypePropertiesTableModel: Batch and Response
   * Generation only for "source"; Response Validation only for "response".
   */
  transformerType: "source" | "destination" | "response";
  /** Called with a full updated XML string on every internal state change. */
  onChange: (newXml: string) => void;
  /** Whether the host is in dark mode — forwarded to Monaco editor inside ScriptEditorDialog. */
  isDark?: boolean;
  /**
   * Channel ID, forwarded to the embedded ScriptEditorDialog so the Monaco
   * code-template completion provider can filter by channel-library assignment.
   * Optional because some hosts (set-data-types-dialog when invoked without a
   * channel context) don't have one.
   */
  channelId?: string;
  /**
   * Server/channel version, stamped onto seeded default property XML when the
   * stored `propsXml` is null/empty (mirrors the version the host uses when it
   * first materializes defaults). Optional — falls back to an empty string.
   */
  version?: string;
}

// ── Plugin definition ─────────────────────────────────────────────────────────

export interface DataTypeDefinition {
  /** Canonical name matching the channel XML value, e.g. "HL7V2", "NCPDP". */
  name: string;

  /** Optional friendlier display label for dropdowns. Defaults to `name`. */
  displayName?: string;

  /**
   * Server plugin name (must match `GET /extensions/plugins/`) used for
   * server-enablement gating. When set, this data type is hidden
   * from the inbound/outbound data-type dropdowns unless that plugin is
   * installed AND enabled on the connected server. Stamped from the
   * definition's `serverPluginName` by `registerPlugin()`. Lookup-by-name is
   * never gated, so a channel already using this type still renders and
   * round-trips; the dropdown pins the current value when it is gated off.
   * Omit for built-in data types (always shown).
   */
  pluginName?: string;

  /**
   * Whether this is a binary/opaque format that cannot be displayed as text.
   * Binary types show an info note in the Msg Trees tab instead of a tree.
   */
  isBinary?: boolean;

  /**
   * Returns default <inboundProperties> or <outboundProperties> XML
   * when the user first selects this data type.
   */
  defaultPropertiesXml(
    tagName: "inboundProperties" | "outboundProperties",
    version: string
  ): string;

  /**
   * Normalize raw template text before it is displayed or parsed.
   * Called by the Msg Trees tab before `parseTemplate`.
   * If the return value differs from the input, the reference panel
   * also updates the stored template textarea (e.g. base64 DICOM → DICOM XML).
   * Throw to leave the text unchanged.
   */
  getTemplateString?(rawText: string): string;

  /**
   * Parse a raw sample message string into a tree of MsgTreeNodes.
   * Throw on invalid input.
   * If absent, the Msg Trees tab shows: "Tree view not available for {name}."
   */
  parseTemplate?: (
    text: string,
    prefix: string,
    suffix: string,
    propsXml?: string | null
  ) => MsgTreeNode;

  /**
   * React component rendered inside the Properties dialog.
   * Receives current propsXml + side + onChange callback.
   * If absent, the dialog shows "No configurable properties for {name}."
   */
  PropertiesSection?: ComponentType<DataTypePropertiesSectionProps>;

  // ── Plugin extension hooks ────────────────────────────────────────────────

  /**
   * Returns the fully-qualified attachment handler provider class name to
   * pre-select in the channel Summary tab when this data type is chosen as
   * the source inbound type.
   *
   * Return null (or omit) to leave the current attachment handler selection
   * untouched. Return a known class name (from ATTACHMENT_HANDLER_CLASS_NAMES)
   * to pre-select the matching built-in type.
   *
   * Addresses Sectra's explicit pain point: auto-filling the attachment
   * handler when their DIMSE data type is selected.
   */
  getDefaultAttachmentHandler?(): string | null;

  /**
   * Monaco Monarch tokenizer to register when this data type is active
   * in the filter/transformer reference panel.
   *
   * Registration is idempotent — the language is only registered once per
   * languageId per session (guarded via globalThis).
   *
   * Mirrors Java's CTokenMarker extension point.
   */
  tokenMarker?: MonacoTokenProvider;

  /**
   * Code snippets contributed to the filter/transformer Reference panel
   * when this data type is active as the inbound type.
   *
   * Displayed in a dedicated category above the static reference items.
   * Mirrors Java's DataTypeCodeTemplatePlugin extension point.
   */
  codeTemplateContributions?: CodeTemplateContribution[];

  /**
   * Optional React component for rendering message attachments produced by
   * this data type in the message browser attachment preview pane.
   *
   * Rendered by AttachmentViewerHost (components/messages/attachment-viewers/)
   * when att.type contains this data type's name. Takes precedence over any
   * matching entry in the ATTACHMENT_VIEWER_REGISTRY.
   *
   * Mirrors Java's AttachmentViewer plugin extension point.
   */
  AttachmentViewer?: ComponentType<{ attachment: MessageAttachment }>;
}
