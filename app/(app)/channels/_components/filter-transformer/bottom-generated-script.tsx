"use client";

import { useState } from "react";
import { type BeforeMount } from "@monaco-editor/react";
import { MonacoEditor } from "@/components/monaco-editor";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { MONACO_BASE_OPTIONS } from "@/lib/monaco-defaults";
import { RHINO_LANG_ID, registerRhinoLanguage } from "@/lib/monaco-rhino";

interface Props {
  script: string;
  elementLabel: string;
  isDark: boolean;
}

export function BottomGeneratedScript({ script, elementLabel, isDark }: Props) {
  const [copied, setCopied] = useState(false);
  const { viewDensity } = useCompactMode();
  const barPy =
    viewDensity === "comfortable" ? "py-2" : viewDensity === "compact" ? "py-1" : "py-1.5";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API not available
    }
  };

  const handleBeforeMount: BeforeMount = (m) => {
    registerRhinoLanguage(m);
  };

  return (
    <div
      className="flex flex-col flex-1 min-h-0 overflow-hidden"
      data-testid="generated-script"
      // Mirror the full generated script into an attribute so E2E can assert its
      // content deterministically — the Monaco editor below virtualizes off-screen
      // lines, so its rendered text is not reliable to read across browsers.
      data-generated-script={script}
    >
      <div
        className={`px-3 ${barPy} flex items-center justify-between border-b border-border shrink-0 bg-gray-50 dark:bg-gray-800`}
      >
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{elementLabel}</span>
        <button
          onClick={handleCopy}
          className="px-2 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
          title="Copy generated script to clipboard"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <MonacoEditor
          height="100%"
          language={RHINO_LANG_ID}
          theme={isDark ? "mirth-js-dark" : "mirth-js"}
          value={script || "// No script generated"}
          beforeMount={handleBeforeMount}
          options={{
            ...MONACO_BASE_OPTIONS,
            readOnly: true,
            domReadOnly: true,
            folding: true,
            lineNumbers: "on",
            wordWrap: "off",
            renderLineHighlight: "none",
            fontSize: 12,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            glyphMargin: false,
            padding: { top: 8, bottom: 8 },
          }}
        />
      </div>
    </div>
  );
}
