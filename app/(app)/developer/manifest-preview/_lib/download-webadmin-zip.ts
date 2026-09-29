/**
 * Builds and downloads the `webadmin/` folder of an extension zip for the
 * Manifest Preview page.
 *
 * The real extension zip layout adds exactly ONE file for the declarative UI —
 * `webadmin/webadmin.json` (docs/customer/plugins/DECLARATIVE-PLUGINS.md "Packaging"). The
 * connector defaults XML is engine-served at runtime, never packaged, so it is
 * deliberately not included here. fflate is dynamically imported to keep it out
 * of the page's initial-load bundle (CLAUDE.md bundle rule; fflate has no
 * eval-class init, unlike jszip).
 */

import { downloadBlob } from "@/lib/download";

/** Zips `webadmin/webadmin.json` and returns the raw bytes. */
export async function buildWebadminZip(manifestText: string) {
  const { zipSync, strToU8 } = await import("fflate");
  return zipSync({ "webadmin/webadmin.json": strToU8(manifestText) });
}

/** Downloads the `webadmin/` folder zip, named from the extension path. */
export async function downloadWebadminZip(
  manifestText: string,
  envelopePath: string
): Promise<void> {
  const bytes = await buildWebadminZip(manifestText);
  const blob = new Blob([bytes], { type: "application/zip" });
  downloadBlob(blob, `${envelopePath || "extension"}-webadmin.zip`);
}
