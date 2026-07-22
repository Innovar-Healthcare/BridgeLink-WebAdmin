import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

// React Compiler / Hooks rules shipped by eslint-config-next@16 (the react-hooks/* family:
// setState in useEffect, component creation in render, ref access in render, etc.).
// These were temporarily downgraded to warnings while the pre-existing violations were
// cleared under. Both the core repo and the plugins overlay are now clean, so they
// are enforced as errors — combined with `--max-warnings 0` on the lint script, any
// regression (including warn-level rules like react-hooks/exhaustive-deps) fails CI instead
// of silently accumulating.
const COMPILER_RULES = [
  "react-hooks/set-state-in-effect",
  "react-hooks/purity",
  "react-hooks/refs",
  "react-hooks/set-state-in-render",
  "react-hooks/static-components",
  "react-hooks/preserve-manual-memoization",
];

const vitalsPatched = nextVitals.map((cfg) => {
  if (!cfg.rules) return cfg;
  const overrides = {};
  for (const rule of COMPILER_RULES) {
    if (cfg.rules[rule]) overrides[rule] = "error";
  }
  if (Object.keys(overrides).length === 0) return cfg;
  return { ...cfg, rules: { ...cfg.rules, ...overrides } };
});

const eslintConfig = defineConfig([
  ...vitalsPatched,
  ...nextTs,
  // Disable ESLint rules that conflict with Prettier formatting
  prettier,
  // Allow underscore-prefixed identifiers as intentionally unused, following the
  // TypeScript convention (e.g. `_group`, `_s`, `for await (const _ of ...)`).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Monaco editors must render through the MonacoEditor wrapper, which applies the
  // per-editor registrations every editor needs (working context-menu Paste —
  ///. Only the default export (the raw Editor component) is
  // restricted; type/named imports (OnMount, BeforeMount, loader) stay allowed.
  {
    ignores: ["components/monaco-editor.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@monaco-editor/react",
              importNames: ["default"],
              message:
                "Render <MonacoEditor> from @/components/monaco-editor instead — it applies the app-wide per-editor registrations (e.g. the working context-menu Paste,/.",
            },
          ],
          // ajv codegens validators with the Function() constructor, which the
          // app CSP (`script-src 'self'`, no 'unsafe-eval') forbids — it would
          // trip CSP on every page if it reached a client chunk. It is Node-only
          // tooling: the JSON-Schema lockstep test and the CLI validator. The
          // __tests__/scripts override below re-permits it there.
          patterns: [
            {
              group: ["ajv", "ajv/*"],
              message:
                "ajv is Node-only (eval-based codegen breaks the app CSP). Import it only from __tests__/ or scripts/; the runtime uses the hand-rolled validator in lib/runtime-plugins/manifest-validator.ts.",
            },
          ],
        },
      ],
    },
  },
  // Node-side tooling (tests, CLI scripts) may use ajv — the eval-based codegen
  // never enters a browser bundle there. The Monaco restriction still applies.
  {
    files: ["__tests__/**", "scripts/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@monaco-editor/react",
              importNames: ["default"],
              message:
                "Render <MonacoEditor> from @/components/monaco-editor instead — it applies the app-wide per-editor registrations (e.g. the working context-menu Paste,/.",
            },
          ],
        },
      ],
    },
  },
  // Enforce a maximum file length for .tsx files to keep pages focused.
  // Files over 1000 lines must have sub-components extracted into _components/.
  {
    files: ["**/*.tsx"],
    ignores: [
      // Static data files — large by nature, not decomposable into smaller pieces
      "**/_datatypes/**",
      // TODO: split these large connector/viewer components in a dedicated ticket
      "**/filter-transformer/filter-transformer-editor.tsx", // 1071 logical lines
      "**/channels/_connectors/plugins/ssl-settings.tsx", // 1579 logical lines
      "**/messages/content-viewer.tsx", // 1326 logical lines
    ],
    rules: {
      "max-lines": ["error", { max: 1000, skipBlankLines: true, skipComments: true }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Compiled server entry-point — generated by tsc from server.ts, not hand-written
    "server.js",
    // Isolated git worktrees created by Claude Code agents — not production code
    ".claude/worktrees/**",
    // Vendored Monaco editor assets (generated by scripts/copy-monaco.mjs) — minified
    // third-party JS; ESLint flat config does not read .gitignore.
    "public/monaco/**",
  ]),
]);

export default eslintConfig;
