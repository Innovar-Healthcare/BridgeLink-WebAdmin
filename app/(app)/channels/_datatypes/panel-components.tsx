"use client";

/**
 * Shared UI components and utilities used by every data-type PropertiesSection.
 *
 * Extracted here so that plugin files can import ScriptEditorDialog,
 * PropertyLabel, and PropertyCheckbox without pulling in the full set-data-types-dialog.
 */

import { useState, useRef, useEffect } from "react";
import { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { MonacoEditor } from "@/components/monaco-editor";
import {
  MONACO_DIALOG_CENTER_STYLE,
  useMonacoOverflowHost,
} from "@/lib/hooks/use-monaco-overflow-host";
import { getRhinoEditorOptions } from "@/lib/monaco-defaults";
import {
  RHINO_LANG_ID,
  registerRhinoLanguage,
  setEditorContext,
  clearEditorContextIfMatches,
} from "@/lib/monaco-rhino";
import { attachRhinoValidation } from "@/lib/monaco-rhino-validation";
import type { ContextType } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// ── Shared style constants ────────────────────────────────────────────────────

export const selectCls =
  "h-7 px-1.5 text-xs rounded border border-border " +
  "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
  "focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 w-32";

export const inputCls =
  "h-7 px-2 text-xs rounded border border-border " +
  "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
  "focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 " +
  "focus:ring-1 focus:ring-blue-500/30";

// ── XML property helpers ──────────────────────────────────────────────────────

/**
 * Sets the text content of an element addressed by a `parent > child` selector
 * path, **creating any missing elements** along the way (walking from the
 * document root). Mirrors the Java client, which rebuilds the full property set
 * from descriptors on save and therefore never silently drops an edit when the
 * stored XML is missing a field (older/migrated/hand-edited channels).
 *
 * Each path segment is matched/created as a direct child, so the structure of
 * the flat data-type property documents is preserved.
 */
export function setXmlText(doc: Document, selector: string, value: string): void {
  const tags = selector
    .split(">")
    .map((s) => s.trim())
    .filter(Boolean);
  let parent: Element | null = doc.documentElement;
  if (!parent) return;
  for (const tag of tags) {
    let child: Element | null = parent.querySelector(`:scope > ${tag}`);
    if (!child) {
      child = doc.createElementNS(null, tag);
      parent.appendChild(child);
    }
    parent = child;
  }
  parent.textContent = value;
}

/**
 * Parse a stored `propsXml` into a Document, seeding from `defaultXml` when the
 * stored value is null/empty or fails to parse. `DOMParser.parseFromString("")`
 * returns a `parsererror` document whose `documentElement` serializes to garbage
 * that corrupts the channel XML when spliced back in; panels must always start
 * from a valid root before calling {@link setXmlText}.
 */
export function parsePropsOrDefault(
  propsXml: string | null | undefined,
  defaultXml: string
): Document {
  const parse = (s: string) => new DOMParser().parseFromString(s, "application/xml");
  if (propsXml && propsXml.trim()) {
    const doc = parse(propsXml);
    if (!doc.querySelector("parsererror") && doc.documentElement) return doc;
  }
  return parse(defaultXml);
}

// ── Tooltip types ─────────────────────────────────────────────────────────────

export interface TooltipInfo {
  label: string;
  description: string;
}

// ── PropertyRow ───────────────────────────────────────────────────────────────
// Renders two grid children as a Fragment: a plain label span + the form control
// wrapped in a hover tooltip. Designed for use inside grid-cols-[auto_1fr] grids.

export function PropertyRow({
  info,
  label,
  labelClassName,
  children,
}: {
  info: TooltipInfo;
  label: string;
  labelClassName?: string;
  children: React.ReactElement;
}) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={labelClassName}>{label}</span>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4} className="max-w-[260px] z-[60] text-left">
          <p className="font-semibold leading-tight">{info.label}</p>
          <p className="mt-0.5 opacity-90 whitespace-pre-line leading-snug">{info.description}</p>
        </TooltipContent>
      </Tooltip>
      {children}
    </>
  );
}

// ── PropertyCheckbox ──────────────────────────────────────────────────────────
// Checkbox + label with a hover tooltip — replaces the local CB pattern in
// data-type files.

export function PropertyCheckbox({
  info,
  label,
  checked,
  onChange,
}: {
  info: TooltipInfo;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            className="w-3 h-3 accent-blue-600"
          />
          {label}
        </label>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-[260px] z-[60] text-left">
        <p className="font-semibold leading-tight">{info.label}</p>
        <p className="mt-0.5 opacity-90 whitespace-pre-line leading-snug">{info.description}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ── ScriptEditorDialog ────────────────────────────────────────────────────────
// Monaco editor in a dialog for editing JavaScript batch scripts.

export function ScriptEditorDialog({
  open,
  onOpenChange,
  title,
  value,
  onSave,
  isDark,
  channelId,
  contextType,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  value: string;
  onSave: (v: string) => void;
  isDark?: boolean;
  channelId?: string;
  contextType?: ContextType;
}) {
  const [draft, setDraft] = useState(value);
  const monacoRef = useRef<unknown>(null);
  // Monaco inside a Radix modal dialog — host its widgets (context menu, suggest)
  // inside the dialog subtree or clicking them dismisses the dialog.
  const { overflowHost, hostRef } = useMonacoOverflowHost();
  const handleBeforeMount: BeforeMount = (m) => {
    registerRhinoLanguage(m);
    monacoRef.current = m;
  };
  const handleMount: OnMount = (editor, monaco) => {
    // Real-time JS syntax validation (squiggles + hover tooltips) — same markers as the
    // Code Templates editor via the shared acorn parser. Self-cleans on dispose.
    attachRhinoValidation(editor, monaco);
    if (channelId && contextType) {
      const uri = editor.getModel()?.uri.toString();
      if (uri) {
        const ctx = { contextType, channelId };
        setEditorContext(uri, ctx);
        editor.getModel()!.onWillDispose(() => clearEditorContextIfMatches(uri, ctx));
      }
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setDraft(value);
  }, [open, value]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col gap-0 p-0 overflow-hidden sm:max-w-2xl h-[60vh]"
        // This Rhino editor's suggest/hover popups are position:fixed. Radix centers
        // DialogContent with a CSS `translate`, which becomes the containing block for
        // fixed descendants and pushes the popup off this small dialog — so completions
        // (e.g. DateUtil.) never appear. Center transform-free so the popup anchors to
        // the viewport at the cursor, mirrors attachment-handler /.
        // Unconditional: the dialog always has a definite width AND height.
        style={MONACO_DIALOG_CENTER_STYLE}
      >
        <DialogHeader className="px-5 pt-4 pb-3 shrink-0 border-b border-border">
          <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-xs text-gray-500 dark:text-gray-400">
            Edit the JavaScript batch script.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0">
          <MonacoEditor
            language={RHINO_LANG_ID}
            value={draft}
            onChange={(v) => setDraft(v ?? "")}
            theme={isDark ? "mirth-js-dark" : "mirth-js"}
            height="100%"
            beforeMount={handleBeforeMount}
            onMount={handleMount}
            options={getRhinoEditorOptions(
              overflowHost ? { overflowWidgetsDomNode: overflowHost } : undefined
            )}
          />
          <div ref={hostRef} />
        </div>
        <DialogFooter className="px-5 py-3 shrink-0 border-t border-border flex justify-end gap-2">
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 text-xs rounded border border-border text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(draft);
              onOpenChange(false);
            }}
            className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 font-medium"
          >
            OK
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
