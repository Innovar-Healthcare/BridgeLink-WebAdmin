import type { BeforeMount } from "@monaco-editor/react";

let hl7v2Registered = false;

/**
 * Monaco BeforeMount hook that registers the hl7v2 custom language once per page
 * load. Safe to pass to multiple <Editor> instances — subsequent calls are no-ops.
 *
 * The `hl7-*` colors live in `lib/monaco-theme.ts`, not here: Monaco themes are
 * global per instance, so the app defines exactly one. Keep the token
 * names below in step with that module's HL7V2 rules.
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
};
