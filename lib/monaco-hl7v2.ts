import type { BeforeMount } from "@monaco-editor/react";

let hl7v2Registered = false;

/**
 * Monaco BeforeMount hook that registers the hl7v2 custom language and
 * light/dark themes once per page load. Safe to pass to multiple <Editor>
 * instances — subsequent calls are no-ops.
 */
export const registerHl7v2Language: BeforeMount = (monaco) => {
  if (hl7v2Registered) return;
  hl7v2Registered = true;

  monaco.languages.register({ id: "hl7v2" });

  monaco.languages.setMonarchTokensProvider("hl7v2", {
    tokenizer: {
      root: [
        // Segment name at start of line: 3 uppercase letters (MSH, PID, OBX, etc.)
        [/^[A-Z][A-Z0-9]{2}(?=\|)/, "hl7-segment"],
        // Field separator
        [/\|/, "hl7-pipe"],
        // Component separator
        [/\^/, "hl7-caret"],
        // Repetition separator
        [/~/, "hl7-tilde"],
        // Subcomponent separator
        [/&/, "hl7-amp"],
        // Escape sequence (e.g. \F\, \S\, \T\, \R\, \E\, \.br\)
        [/\\[^\\]*\\/, "hl7-escape"],
        // Field values — everything else until the next separator
        [/[^|^~&\\]+/, "hl7-value"],
      ],
    },
  });

  monaco.editor.defineTheme("hl7v2-theme", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "hl7-segment", foreground: "0000FF", fontStyle: "bold" },
      { token: "hl7-pipe", foreground: "999999" },
      { token: "hl7-caret", foreground: "CC7700" },
      { token: "hl7-tilde", foreground: "CC00CC" },
      { token: "hl7-amp", foreground: "009999" },
      { token: "hl7-escape", foreground: "AA0000", fontStyle: "italic" },
      { token: "hl7-value", foreground: "333333" },
    ],
    colors: {},
  });

  monaco.editor.defineTheme("hl7v2-dark-theme", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "hl7-segment", foreground: "79B8FF", fontStyle: "bold" },
      { token: "hl7-pipe", foreground: "6A737D" },
      { token: "hl7-caret", foreground: "E6A445" },
      { token: "hl7-tilde", foreground: "FF79C6" },
      { token: "hl7-amp", foreground: "56C8C8" },
      { token: "hl7-escape", foreground: "F97070", fontStyle: "italic" },
      { token: "hl7-value", foreground: "CDD5DE" },
    ],
    colors: {},
  });
};

/** Returns the correct Monaco theme name for HL7v2 content. */
export function hl7v2Theme(isDark: boolean): string {
  return isDark ? "hl7v2-dark-theme" : "hl7v2-theme";
}
