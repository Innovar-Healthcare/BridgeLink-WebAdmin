/**
 * Typed named plugin slots.
 *
 * A slot is a single mount point in the core UI that exactly one plugin fills:
 * a toolbar button, a controlled dialog, a post-save handler, an editor
 * overlay. Slots replace the old pattern of adding a nullable single-purpose
 * field to `lib/plugin-registry.ts` for every new plugin surface — the
 * registry's shape stays fixed while new mount points only add a row to
 * `SlotTypeMap` here.
 *
 * ── Contract ──────────────────────────────────────────────────────────────────
 *
 *  - `SlotTypeMap` is the single source of truth: slot name → stored type.
 *    Values are React components OR plain (async) functions.
 *  - Slots are filled declaratively via `definePlugin({ slots: {...} })`
 *    (see lib/plugin-manifest.ts); core read sites call `getSlot(name)` at
 *    render/call time and handle `null` (plugin absent).
 *  - Duplicate semantics: FIRST-WINS. Filling an already-filled slot is a
 *    no-op with a dev-only warning.
 *  - Adding a slot is a safe, additive change to the plugin wire contract.
 *    Renaming or removing one is a breaking change — treat slot names with
 *    the same care as REST paths.
 *
 * Naming convention: `<page-or-surface>.<mount-point>` in kebab-case, e.g.
 * `"code-templates.history-dialog"`, `"channels.post-save"`.
 */

import type { ComponentType } from "react";
import type { CodeTemplate, CodeTemplateLibrary } from "@/lib/types";
import type { GlobalScriptKey } from "@/lib/api/api-settings";
import type { EditorOverlayProps, RepoChangesSummary } from "@/lib/plugin-registry";
import { logWarn } from "@/lib/dev-logger";

// ── Slot prop interfaces ───────────────────────────────────────────────────────
// Named (not inline) so plugin components can import and implement them.

/** Props for the controlled code-template history dialog. */
export interface CodeTemplateHistoryDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  templateId: string;
  templateName: string;
  currentTemplate?: CodeTemplate;
  onReverted?: () => void;
}

/** Props for the controlled code-template-library history dialog. */
export interface CodeTemplateLibraryHistoryDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  libraryId: string;
  libraryName: string;
  currentLibrary?: CodeTemplateLibrary;
}

/** Props for the controlled global-scripts history dialog. */
export interface GlobalScriptsHistoryDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentScripts?: Record<GlobalScriptKey, string> | null;
  onReverted?: (scripts: Record<GlobalScriptKey, string>) => void;
}

/** Props for the controlled global-scripts commit-and-push component. */
export interface GlobalScriptsCommitDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentScripts?: Record<GlobalScriptKey, string> | null;
  onCommitted?: () => void;
}

/** Props for the controlled "Save Libraries to Repo" commit component. */
export interface SaveLibrariesDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  libraries: CodeTemplateLibrary[];
  onCommitted?: () => void;
}

/** Props for simple controlled dialogs that only need open state. */
export interface OpenCloseDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

/**
 * Props for the per-pane actions component on the Message Templates tab
 *. Rendered in each template pane's header button row — once for
 * the inbound pane and once for the outbound pane (transformers only).
 */
export interface MessageTemplateActionsProps {
  /** Which template pane this instance belongs to. */
  side: "inbound" | "outbound";
  /** The pane's data type, e.g. "HL7V2" | "XML" | "JSON" | "RAW" | "DICOM". */
  dataType: string;
  /** Current template text. */
  text: string;
  /** Replaces the template text through the lifted-state pipeline. */
  setText: (v: string) => void;
}

/**
 * Props for the AI action mounted next to the Channel Description field on the
 * channel editor's Summary & Settings tab. The plugin renders an
 * orb launcher that generates or improves the description from the channel's
 * context. Unlike `editor.overlay`, this is not Monaco-coupled: it reads and
 * writes the field through plain value/callback props, mirroring
 * `MessageTemplateActionsProps`. The plugin assembles the channel digest from
 * `channelXml` itself via `buildChannelDescriptionAiContext` in
 * lib/channel-description-ai-context.
 */
export interface ChannelDescriptionActionsProps {
  /** Current description text. */
  value: string;
  /** Replaces the description through the editor's summary onChange pipeline. */
  setValue: (v: string) => void;
  /** Channel display name, when known (for prompt context and labelling). */
  channelName?: string;
  /** The channel's current (live) serialized XML — the full context source. */
  channelXml: string;
}

/**
 * Props for the AI overlay mounted in the message browser when the viewed
 * connector message has errors. Rendered at the content-viewer
 * scope, gated on the presence of errors, so the launcher appears for any
 * failed message — not only while the Errors sub-tab is active. The plugin
 * component assembles the full channel context (failing connector's scripts +
 * depended-on code templates) and the editor deep link itself from these
 * identifiers via `buildMessageErrorAiContext` in lib/message-error-ai-context.
 */
export interface MessageErrorOverlayProps {
  /** Channel the failed message belongs to. */
  channelId: string;
  /** Display name of the channel, when known (for prompt context). */
  channelName?: string;
  /** Failing connector's metaDataId — 0 = source, >0 = a destination. */
  metaDataId: number;
  /** Failing connector's display name. */
  connectorName: string;
  /** Which error slot is currently in view. */
  errorType: "processingError" | "postProcessorError" | "responseError";
  /** The error / stack-trace text for that slot. */
  errorText: string;
  /**
   * The failing connector's inbound (raw) message content, when available and
   * not encrypted. The plugin treats this as PHI: it is sent to the AI service
   * only when the user explicitly opts in per use — never by default.
   */
  messageContent?: string;
}

// ── Slot map ───────────────────────────────────────────────────────────────────

/**
 * Slot name → stored type. THE definitive list of single-fill plugin mount
 * points. Component slots render in the core UI at the named location;
 * function slots are invoked by core flows at the named event.
 */
export interface SlotTypeMap {
  /** Controlled dialog for code template version history (toolbar + context menu). */
  "code-templates.history-dialog": ComponentType<CodeTemplateHistoryDialogProps>;
  /** Controlled dialog for code template library version history. */
  "code-templates.library.history-dialog": ComponentType<CodeTemplateLibraryHistoryDialogProps>;
  /** Dialog for importing code templates from the version-history repo. */
  "code-templates.import-repo-dialog": ComponentType<OpenCloseDialogProps>;
  /** Controlled commit-and-push component for "Save Libraries to Repo". */
  "code-templates.save-libraries-dialog": ComponentType<SaveLibrariesDialogProps>;
  /**
   * Called after every successful bulk code template save with the full saved
   * library list. Errors are swallowed by the caller — must not block saves.
   */
  "code-templates.post-save": (savedLibraries: CodeTemplateLibrary[]) => Promise<void>;
  /** Writes and commits all current library XML to the version-history repo. */
  "code-templates.save-libraries": (libraries: CodeTemplateLibrary[]) => Promise<void>;
  /** Controlled dialog for global scripts version history. */
  "global-scripts.history-dialog": ComponentType<GlobalScriptsHistoryDialogProps>;
  /** Controlled commit-and-push component for global scripts. */
  "global-scripts.commit-dialog": ComponentType<GlobalScriptsCommitDialogProps>;
  /** Dialog for importing a channel from the version-history repo. */
  "channels.import-repo-dialog": ComponentType<OpenCloseDialogProps>;
  /**
   * Called after every successful channel save with the final saved XML and
   * the editor mode. Errors are swallowed by the caller — must not block saves.
   */
  "channels.post-save": (channelXml: string, mode: "edit" | "new") => Promise<void>;
  /**
   * Overlay mounted at the bottom of the channel editor's tree. Receives no
   * props — communicates with `channels.post-save` via module-level pub-sub.
   */
  "channel-editor.overlay": ComponentType;
  /** Returns entities with uncommitted version-history repo changes. */
  "repo-changes.provider": () => Promise<RepoChangesSummary>;
  /** Overlay mounted inside the Monaco editor container (JavaScriptPanel). */
  "editor.overlay": ComponentType<EditorOverlayProps>;
  /** Per-pane actions in the Message Templates tab's header button row. */
  "message-template.actions": ComponentType<MessageTemplateActionsProps>;
  /** AI launcher overlay shown in the message browser for a failed message. */
  "message-browser.errors.overlay": ComponentType<MessageErrorOverlayProps>;
  /** AI action next to the Channel Description field on the Summary & Settings tab. */
  "channel-summary.description.actions": ComponentType<ChannelDescriptionActionsProps>;
}

/** All known slot names. */
export type SlotName = keyof SlotTypeMap;

// ── Store ──────────────────────────────────────────────────────────────────────

const slots = new Map<SlotName, SlotTypeMap[SlotName]>();
const slotOwners = new Map<SlotName, string>();

/**
 * Fill a slot. First-wins: if the slot is already filled the call is a no-op
 * (dev-only warning) and returns false. Called by `registerPlugin()`'s
 * fan-out (which reports the outcome, and by the deprecated
 * single-purpose `register*()` shims in lib/plugin-registry.ts.
 */
export function setSlot<K extends SlotName>(
  name: K,
  value: SlotTypeMap[K],
  pluginId?: string
): boolean {
  if (slots.has(name)) {
    logWarn(
      "plugin-slots",
      `slot "${name}" is already filled by "${slotOwners.get(name) ?? "unknown"}" — ignoring duplicate${pluginId ? ` from "${pluginId}"` : ""}`
    );
    return false;
  }
  slots.set(name, value);
  if (pluginId) slotOwners.set(name, pluginId);
  return true;
}

/**
 * Read a slot at render/call time. Returns null when no plugin filled it —
 * core read sites must treat null as "feature absent" and render nothing.
 */
export function getSlot<K extends SlotName>(name: K): SlotTypeMap[K] | null {
  // Single narrowing cast: the map is only ever written through setSlot's
  // K-typed signature, so the stored value matches its key's declared type.
  return (slots.get(name) as SlotTypeMap[K] | undefined) ?? null;
}

// Runtime name list, exhaustiveness-checked against SlotTypeMap (missing or
// extra keys fail to compile). Powers the property-access view below.
const SLOT_NAME_SET: Record<SlotName, true> = {
  "code-templates.history-dialog": true,
  "code-templates.library.history-dialog": true,
  "code-templates.import-repo-dialog": true,
  "code-templates.save-libraries-dialog": true,
  "code-templates.post-save": true,
  "code-templates.save-libraries": true,
  "global-scripts.history-dialog": true,
  "global-scripts.commit-dialog": true,
  "channels.import-repo-dialog": true,
  "channels.post-save": true,
  "channel-editor.overlay": true,
  "repo-changes.provider": true,
  "editor.overlay": true,
  "message-template.actions": true,
  "message-browser.errors.overlay": true,
  "channel-summary.description.actions": true,
};

/**
 * Read-only property-access view over the slot store. Use this (not
 * `getSlot()`) when the slot value is rendered as JSX — a member read like
 * `pluginSlots["editor.overlay"]` keeps the component reference outside the
 * render function for the React Compiler's static-components rule (which
 * rejects call-expression-derived element types, mirroring how the old
 * `pluginRegistry.<field>` reads worked). Slots are filled once at
 * plugin-registration time, before first render, so reads are stable.
 * For non-render reads (event handlers, providers) `getSlot()` is fine.
 */
export const pluginSlots: { readonly [K in SlotName]: SlotTypeMap[K] | null } = (() => {
  const view = {} as { [K in SlotName]: SlotTypeMap[K] | null };
  for (const name of Object.keys(SLOT_NAME_SET) as SlotName[]) {
    Object.defineProperty(view, name, {
      enumerable: true,
      get: () => getSlot(name),
    });
  }
  return view;
})();

/** Which plugin filled a slot (from definePlugin's id), if recorded. */
export function getSlotOwner(name: SlotName): string | undefined {
  return slotOwners.get(name);
}

/** List the currently filled slot names (introspection/debugging). */
export function getFilledSlotNames(): SlotName[] {
  return [...slots.keys()];
}

/** Test-only helpers. Mirrors the `__testing` convention of lib/installed-plugins.ts. */
export const __testingSlots = {
  reset(): void {
    slots.clear();
    slotOwners.clear();
  },
};
