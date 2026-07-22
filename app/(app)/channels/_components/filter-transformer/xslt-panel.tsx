"use client";

import { useRef } from "react";
import { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { MonacoEditor } from "@/components/monaco-editor";
import { MONACO_BASE_OPTIONS } from "@/lib/monaco-defaults";
import type { XsltStep } from "../../_lib/filter-transformer-xml";
import { useCompactMode, densityHeight } from "@/lib/hooks/use-compact-mode";

const inputErrorCls =
  "!border-red-500 dark:!border-red-400 focus:!border-red-500 focus:!ring-red-500/30";

const labelCls = "text-sm text-gray-600 dark:text-gray-400 w-36 shrink-0 text-right";

interface Props {
  step: XsltStep;
  onChange: (step: XsltStep) => void;
  isDark: boolean;
  showErrors?: boolean;
}

/** Returns true when the string is empty or not well-formed XML. */
function isXmlInvalid(xml: string | undefined): boolean {
  if (!xml?.trim()) return true;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return doc.querySelector("parsererror") !== null;
}

/** Returns onDragOver + onDrop props for a text <input> element. */
function inputDropProps(
  getValue: () => string,
  setValue: (v: string) => void
): Pick<React.InputHTMLAttributes<HTMLInputElement>, "onDragOver" | "onDrop"> {
  return {
    onDragOver: (e) => e.preventDefault(),
    onDrop: (e) => {
      e.preventDefault();
      const text = e.dataTransfer.getData("text/plain");
      if (!text) return;
      const input = e.currentTarget as HTMLInputElement;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      const cur = getValue();
      setValue(cur.slice(0, start) + text + cur.slice(end));
    },
  };
}

export function XsltPanel({ step, onChange, isDark, showErrors }: Props) {
  const { viewDensity } = useCompactMode();
  const inputCls =
    `${densityHeight(viewDensity)} px-3 text-sm rounded border border-border ` +
    "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 " +
    "focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 flex-1";
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const editorRef = useRef<import("monaco-editor").editor.IStandaloneCodeEditor | null>(null);

  const handleBeforeMount: BeforeMount = (m) => {
    monacoRef.current = m;
  };

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;

    const domNode = editor.getDomNode();
    if (!domNode) return;

    domNode.addEventListener(
      "dragover",
      (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      },
      true
    );

    domNode.addEventListener(
      "drop",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = e.dataTransfer?.getData("text/plain");
        if (!text || !editorRef.current) return;

        const ed = editorRef.current;
        const target = ed.getTargetAtClientPoint(e.clientX, e.clientY);
        const pos = target?.position ?? ed.getPosition();
        if (!pos) return;

        ed.executeEdits("ref-drop", [
          {
            range: {
              startLineNumber: pos.lineNumber,
              startColumn: pos.column,
              endLineNumber: pos.lineNumber,
              endColumn: pos.column,
            },
            text,
            forceMoveMarkers: true,
          },
        ]);
        ed.focus();
      },
      true
    );
  };

  function set<K extends keyof XsltStep>(key: K, val: XsltStep[K]) {
    onChange({ ...step, [key]: val });
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className={labelCls}>Source XML:</span>
        <input
          value={step.sourceXml}
          onChange={(e) => set("sourceXml", e.target.value)}
          className={`${inputCls} ${showErrors && !step.sourceXml?.trim() ? inputErrorCls : ""}`}
          placeholder="JavaScript expression returning XML string"
          {...inputDropProps(
            () => step.sourceXml,
            (v) => set("sourceXml", v)
          )}
        />
      </div>

      <div className="flex items-center gap-3">
        <span className={labelCls}>Result:</span>
        <input
          value={step.resultVariable}
          onChange={(e) => set("resultVariable", e.target.value)}
          className={`${inputCls} ${showErrors && !step.resultVariable?.trim() ? inputErrorCls : ""}`}
          placeholder="channelMap variable name"
          {...inputDropProps(
            () => step.resultVariable,
            (v) => set("resultVariable", v)
          )}
        />
      </div>

      <div className="flex items-start gap-3">
        <span className={labelCls + " pt-1"}>Transformer Factory:</span>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              checked={!step.useCustomFactory}
              onChange={() => set("useCustomFactory", false)}
            />
            Default
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              checked={step.useCustomFactory}
              onChange={() => set("useCustomFactory", true)}
            />
            Custom
          </label>
          {step.useCustomFactory && (
            <input
              value={step.customFactory}
              onChange={(e) => set("customFactory", e.target.value)}
              className={inputCls}
              placeholder="javax.xml.transform.TransformerFactory class"
              {...inputDropProps(
                () => step.customFactory,
                (v) => set("customFactory", v)
              )}
            />
          )}
        </div>
      </div>

      <div className="flex items-start gap-3">
        <span className={labelCls + " pt-1"}>XSLT Template:</span>
        <div
          className={`flex-1 border rounded overflow-hidden${showErrors && isXmlInvalid(step.template) ? " !border-red-500 dark:!border-red-400" : ""}`}
          style={{ minHeight: 200 }}
        >
          <MonacoEditor
            height="200px"
            language="xml"
            theme={isDark ? "vs-dark" : "vs"}
            defaultValue={step.template ?? ""}
            beforeMount={handleBeforeMount}
            onMount={handleMount}
            onChange={(v) => set("template", v ?? "")}
            options={{
              ...MONACO_BASE_OPTIONS,
              fontSize: 12,
            }}
          />
        </div>
      </div>
    </div>
  );
}
