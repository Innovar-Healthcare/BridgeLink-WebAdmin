#!/usr/bin/env node
/**
 * Vendors the programming fonts offered by the "Code Editor Preferences > Font"
 * setting into `public/fonts/` so the editors can actually render them.
 *
 * Why: the Font drop-down has always offered JetBrains Mono / Fira Code /
 * Cascadia Code, but none of them were ever shipped — the CSS stacks fell through
 * to Menlo/Consolas, so all four options looked identical to anyone who didn't
 * happen to have the faces installed locally. app/globals.css declares @font-face
 * rules pointing at the copies produced here.
 *
 * Only the latin subset at weights 400 and 700 is vendored — that is everything a
 * code editor renders, and it keeps the payload to ~160 KB across all three
 * families. The browser fetches a face only when a glyph needs it, so these cost
 * nothing until an editor (or the font drop-down) is first rendered.
 *
 * The output is gitignored and regenerated on every predev / prebuild (wired in
 * package.json), mirroring scripts/copy-monaco.mjs and how `.next/static` is treated.
 */

import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

/**
 * The families to vendor. `id` is both the @fontsource package name and the
 * output directory; `family` is the CSS name app/globals.css declares, which must
 * stay in lockstep with EDITOR_FONT_OPTIONS in components/settings/admin-tab.tsx.
 *
 * `copyright` is transcribed from each project's upstream LICENSE, NOT from the
 * @fontsource copy: OFL 1.1 condition 2 requires the correct copyright notice to
 * travel with the redistributed font, and @fontsource's own LICENSE files are not
 * reliable for that (its cascadia-code LICENSE, for one, credits "Google Inc.").
 *
 * Before adding a family, read the copyright line of its upstream LICENSE for
 * "with Reserved Font Name". OFL treats a subset or webfont conversion as a
 * Modified Version, which may not carry a reserved name — that is why Cascadia
 * Code is absent (see app/globals.css). Grepping for the phrase proves nothing:
 * it appears in the standard OFL body of every OFL font.
 */
const FAMILIES = [
  {
    id: "jetbrains-mono",
    family: "JetBrains Mono",
    copyright:
      "Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)",
    upstream: "https://github.com/JetBrains/JetBrainsMono",
  },
  {
    id: "fira-code",
    family: "Fira Code",
    copyright:
      "Copyright 2014-2020 The Fira Code Project Authors (https://github.com/tonsky/FiraCode)",
    upstream: "https://github.com/tonsky/FiraCode",
  },
];

const WEIGHTS = [400, 700];

const fontsRoot = join(repoRoot, "public", "fonts");

// rm-then-copy so a dropped family or weight never leaves an orphaned file behind.
rmSync(fontsRoot, { recursive: true, force: true });
mkdirSync(fontsRoot, { recursive: true });

let copied = 0;
for (const { id } of FAMILIES) {
  const pkgRoot = join(repoRoot, "node_modules", "@fontsource", id);
  const pkgFiles = join(pkgRoot, "files");
  if (!existsSync(pkgFiles)) {
    console.error(
      `[copy-fonts] ${pkgFiles} not found — is @fontsource/${id} installed? Run npm install.`
    );
    process.exit(1);
  }

  const destDir = join(fontsRoot, id);
  mkdirSync(destDir, { recursive: true });

  for (const weight of WEIGHTS) {
    const name = `${id}-latin-${weight}-normal.woff2`;
    const src = join(pkgFiles, name);
    if (!existsSync(src)) {
      console.error(`[copy-fonts] ${src} not found — @fontsource layout changed?`);
      process.exit(1);
    }
    copyFileSync(src, join(destDir, name));
    copied++;
  }

  // OFL 1.1 condition 2: every redistributed copy must carry the license text.
  copyFileSync(join(pkgRoot, "LICENSE"), join(destDir, "LICENSE.txt"));
}

// Aggregate notice, served at /fonts/NOTICE.txt, so the attribution ships inside
// every artifact (public/ is copied wholesale by the Docker and package scripts).
const notice = [
  "Third-party fonts bundled with BridgeLink Web Admin",
  "=====================================================",
  "",
  "The code editors render these typefaces (Settings > Administrator >",
  "Code Editor Preferences > Font). Each is licensed under the SIL Open Font",
  "License, Version 1.1, whose full text accompanies it in this directory.",
  "",
  ...FAMILIES.flatMap(({ family, copyright, upstream, id }) => [
    `${family}`,
    `  ${copyright}`,
    `  Upstream:   ${upstream}`,
    `  License:    SIL OFL 1.1 — see ./${id}/LICENSE.txt`,
    `  Modification: latin subset, weights 400 and 700, converted to woff2.`,
    "",
  ]),
].join("\n");
writeFileSync(join(fontsRoot, "NOTICE.txt"), notice);

console.log(
  `[copy-fonts] vendored ${copied} woff2 files for ${FAMILIES.length} families -> ${fontsRoot}`
);
