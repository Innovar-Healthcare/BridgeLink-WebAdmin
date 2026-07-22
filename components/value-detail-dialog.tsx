"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogMaximizeButton,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { MONACO_BASE_OPTIONS } from "@/lib/monaco-defaults";
import { registerHl7v2Language, hl7v2Theme } from "@/lib/monaco-hl7v2";
import { useDialogDragResize } from "@/lib/hooks/use-dialog-drag-resize";
import { useTheme } from "@/lib/hooks/use-theme";
import { cn } from "@/lib/utils";
import { detectLanguage, LARGE_VALUE_CHARS, prettyPrintValue } from "@/lib/value-format";

const Editor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="p-4 text-sm text-gray-400 dark:text-gray-500">Loading editor…</div>
  ),
});

interface ValueDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog title — e.g. the variable or attribute name. */
  title: string;
  /** Optional muted suffix shown after the title, e.g. a mapping scope. */
  subtitle?: string;
  /** Raw value; pretty-printed and language-detected for display. */
  value: string;
  /** Word-wrap the editor content. Defaults to true. */
  wordWrap?: boolean;
}

/**
 * Read-only dialog for viewing a single string value in a Monaco editor with
 * syntax highlighting, pretty-printing, and a Copy Value button. Shared by the
 * message-browser mappings table and the events attribute table.
 */
export function ValueDetailDialog({
  open,
  onOpenChange,
  title,
  subtitle,
  value,
  wordWrap = true,
}: ValueDetailDialogProps) {
  const { isDark } = useTheme();
  const [copied, setCopied] = useState(false);
  const { contentProps, handleProps, maximize, enabled } = useDialogDragResize({
    open,
    defaultWidth: 800,
    minHeight: 240,
  });

  // Very large values (e.g. a CCD clinical document) open as plain text: skip
  // pretty-print and force the plaintext language so Monaco doesn't synchronously
  // tokenize the whole document, which beachballs WebKit.
  const isLarge = value.length > LARGE_VALUE_CHARS;
  const dialogValue = useMemo(() => (isLarge ? value : prettyPrintValue(value)), [value, isLarge]);
  const dialogLanguage = useMemo(
    () => (isLarge ? "plaintext" : detectLanguage(dialogValue)),
    [dialogValue, isLarge]
  );

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — silently ignore.
    }
  }, []);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setCopied(false);
        onOpenChange(next);
      }}
    >
      <DialogContent {...contentProps}>
        <DialogHeader {...handleProps}>
          <DialogTitle className="text-sm font-semibold">
            {title}
            {subtitle ? (
              <span className="ml-2 text-xs font-normal text-gray-400">{subtitle}</span>
            ) : null}
          </DialogTitle>
          <DialogDescription className="sr-only">Full value</DialogDescription>
        </DialogHeader>
        {maximize.available ? (
          <DialogMaximizeButton maximized={maximize.isMaximized} onToggle={maximize.toggle} />
        ) : null}
        <div
          className={cn(
            "border border-border rounded overflow-hidden",
            // When drag/resize is active the dialog is a flex column and the editor
            // fills the remaining height; otherwise (small viewports) fall back to a
            // fixed height so Monaco still has a box to render into.
            enabled ? "flex-1 min-h-0" : "h-[50vh]"
          )}
        >
          <Editor
            value={dialogValue}
            language={dialogLanguage}
            height="100%"
            theme={dialogLanguage === "hl7v2" ? hl7v2Theme(isDark) : isDark ? "vs-dark" : "vs"}
            beforeMount={registerHl7v2Language}
            options={{
              ...MONACO_BASE_OPTIONS,
              readOnly: true,
              fontSize: 12,
              lineNumbers: isLarge || dialogValue.split("\n").length > 5 ? "on" : "off",
              wordWrap: wordWrap ? "on" : "off",
              wrappingIndent: "same",
              renderLineHighlight: "none",
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              overviewRulerBorder: false,
              scrollbar: {
                vertical: "auto",
                horizontal: "auto",
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
              },
              padding: { top: 8, bottom: 8 },
              folding: true,
              lineDecorationsWidth: 0,
              lineNumbersMinChars: 3,
              glyphMargin: false,
              domReadOnly: true,
            }}
            loading={<div className="p-4 text-xs text-gray-400">Loading…</div>}
          />
        </div>
        <div className="flex justify-end pt-1 shrink-0">
          <button
            onClick={() => handleCopy(dialogValue)}
            className="px-3 py-1.5 text-xs rounded-md bg-blue-100 text-blue-800 hover:bg-blue-200 transition-colors"
          >
            {copied ? "Copied!" : "Copy Value"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
