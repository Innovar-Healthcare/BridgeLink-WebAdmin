"use client";

/**
 * Collapsible read-only "Live properties XML" echo shared by the XML-backed
 * previews (connector panel, connector section, data type). Shows the same
 * propertiesXml the form reads and writes, so an author can watch edits
 * round-trip and confirm elements the schema doesn't model are preserved.
 * Collapsed by default so the form stays the focus.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MonacoEditor } from "@/components/monaco-editor";
import { prettyPrintXml } from "../_lib/pretty-xml";

const READONLY_XML_OPTIONS = {
  readOnly: true,
  minimap: { enabled: false },
  automaticLayout: true,
  scrollBeyondLastLine: false,
  fontSize: 12,
} as const;

export function LiveXmlDisclosure({
  xml,
  path,
  label = "Live properties XML — updates as you edit the form",
}: {
  xml: string;
  /** Unique Monaco model path for this editor instance. */
  path: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  // Pretty-print for DISPLAY ONLY. The caller's `xml` (the round-tripped
  // propertiesXml the form reads/writes) stays byte-exact — this reformatting
  // never flows back into state. prettyPrintXml is text-preserving (a
  // whitespace-significant value shows verbatim) and returns the input
  // unchanged if it can't parse, so a mid-edit fragment is shown as-is.
  const pretty = useMemo(() => prettyPrintXml(xml), [xml]);
  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {label}
      </button>
      {open && (
        <div className="h-48 border-t border-border">
          <MonacoEditor language="xml" path={path} value={pretty} options={READONLY_XML_OPTIONS} />
        </div>
      )}
    </div>
  );
}
