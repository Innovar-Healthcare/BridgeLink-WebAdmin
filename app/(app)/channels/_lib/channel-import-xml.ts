/**
 * Shared, framework-free helpers for importing channels and channel groups from
 * BridgeLink XML exports.
 *
 * These were originally private to import-channel-dialog.tsx; they are extracted
 * here so the channel-group import flow (import-group-dialog.tsx) can reuse the
 * exact same parsing/patching logic instead of duplicating it. Everything in this
 * module is a pure function over strings/DOM and is unit-tested directly.
 *
 * The conflict-classification and group-set helpers mirror the Java client's
 * ChannelPanel.importGroup / importChannel behavior (the source of truth for
 * feature parity).
 */

import { parseCodeTemplateLibrariesFromXml } from "@/lib/api/parse-code-template-xml";
import type { ChannelGroup, CodeTemplate, CodeTemplateLibrary } from "@/lib/types";
import type { ChannelDependency } from "@/lib/cache-store";
import { escapeXml } from "./filter-transformer-xml-helpers";

// ─── Single-channel parsing (shared with import-channel-dialog) ────────────────

export interface ParsedChannel {
  id: string;
  /** Original channel ID from the XML — needed to update library channel associations. */
  originalId: string;
  name: string;
  revision: number;
  libraryNames: string[];
}

export interface ParsedLibraryData {
  libraries: CodeTemplateLibrary[];
  templates: CodeTemplate[];
}

/** Parse channel XML client-side to extract id, name, revision, and code template library names. */
export function parseImportXml(xml: string): ParsedChannel | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) return null;
  const channel = doc.querySelector("channel");
  if (!channel) return null;
  const id = channel.querySelector(":scope > id")?.textContent?.trim();
  const name = channel.querySelector(":scope > name")?.textContent?.trim();
  const revText = channel.querySelector(":scope > revision")?.textContent?.trim();
  if (!id || !name) return null;
  const libEls = doc.querySelectorAll("exportData > codeTemplateLibraries > codeTemplateLibrary");
  const libraryNames: string[] = [];
  libEls.forEach((el) => {
    const n = el.querySelector(":scope > name")?.textContent?.trim();
    if (n) libraryNames.push(n);
  });
  return { id, originalId: id, name, revision: parseInt(revText ?? "0", 10), libraryNames };
}

/**
 * Mirrors Java's setIdAndUpdateLibraries: when the channel ID changes during
 * import (rename, overwrite, or ID collision), update enabledChannelIds in
 * the embedded code template libraries so the library→channel association
 * is preserved.
 */
export function updateLibraryChannelIds(
  libData: ParsedLibraryData,
  oldChannelId: string,
  newChannelId: string
): ParsedLibraryData {
  if (oldChannelId === newChannelId) return libData;
  return {
    ...libData,
    libraries: libData.libraries.map((lib) => {
      const enabled = lib.enabledChannelIds ?? [];
      if (!enabled.includes(oldChannelId)) return lib;
      return {
        ...lib,
        enabledChannelIds: enabled.filter((id) => id !== oldChannelId).concat(newChannelId),
      };
    }),
  };
}

/**
 * Extract the <codeTemplateLibraries> section from the channel XML as a standalone
 * <list> document, then parse it using the shared code template XML parser.
 */
export function parseLibrariesFromChannelXml(xml: string): ParsedLibraryData | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const libEls = doc.querySelectorAll("exportData > codeTemplateLibraries > codeTemplateLibrary");
  if (libEls.length === 0) return null;
  // Reconstruct as a <list> document so the shared parser can handle it
  const serializer = new XMLSerializer();
  const innerXml = Array.from(libEls)
    .map((el) => serializer.serializeToString(el))
    .join("\n");
  const listXml = `<list>\n${innerXml}\n</list>`;
  try {
    return parseCodeTemplateLibrariesFromXml(listXml);
  } catch {
    return null;
  }
}

/**
 * Patch the first occurrence of an XML element's text content.
 *
 * `value` is XML-escaped here so callers pass the raw (unescaped) text: a name
 * containing `&`/`<`/`>` would otherwise produce malformed XML the server rejects.
 * The replacement is a function so `String.prototype.replace` does NOT interpret
 * `$`-patterns (`$&`, `` $` ``, `$'`, `$1`) in the value — a name containing `$&`
 * would otherwise inject the matched substring. #27)
 */
export function patchXmlElement(xml: string, tag: string, value: string): string {
  const re = new RegExp(`<${tag}>[^<]*</${tag}>`);
  return xml.replace(re, () => `<${tag}>${escapeXml(value)}</${tag}>`);
}

// ─── Channel-group parsing ─────────────────────────────────────────────────────

/** One channel embedded inside a channel-group export, with its full XML preserved. */
export interface ImportChannelEntry {
  /** Original channel ID from the XML. */
  id: string;
  name: string;
  revision: number;
  /** Full `<channel>…</channel>` XML, ready to POST/PUT to /channels. */
  xml: string;
}

/** One channel group parsed from a group export file. */
export interface ImportGroupEntry {
  id: string;
  name: string;
  revision: number;
  channels: ImportChannelEntry[];
}

/**
 * Parse a channel-group export file into structured groups, capturing each
 * embedded channel's full XML (so it can be created on the server individually —
 * this is the piece the old import was missing,.
 *
 * Throws "Invalid XML file" when the document does not parse. Returns an empty
 * array when the XML is valid but contains no <channelGroup> elements.
 */
export function extractGroupsFromXml(text: string): ImportGroupEntry[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid XML file");
  }
  const serializer = new XMLSerializer();
  const groups: ImportGroupEntry[] = [];
  doc.querySelectorAll("channelGroup").forEach((groupEl) => {
    const channels: ImportChannelEntry[] = [];
    groupEl.querySelectorAll(":scope > channels > channel").forEach((chEl) => {
      const cid = chEl.querySelector(":scope > id")?.textContent?.trim();
      const cname = chEl.querySelector(":scope > name")?.textContent?.trim();
      if (!cid || !cname) return;
      const crev = chEl.querySelector(":scope > revision")?.textContent?.trim();
      channels.push({
        id: cid,
        name: cname,
        revision: parseInt(crev ?? "0", 10),
        xml: serializer.serializeToString(chEl),
      });
    });
    const rev = groupEl.querySelector(":scope > revision")?.textContent?.trim();
    groups.push({
      id: groupEl.querySelector(":scope > id")?.textContent?.trim() ?? "",
      name: groupEl.querySelector(":scope > name")?.textContent?.trim() ?? "",
      revision: parseInt(rev ?? "0", 10),
      channels,
    });
  });
  return groups;
}

// ─── Conflict classification (mirrors ChannelPanel name/id checks) ─────────────

/** How an imported channel or group should be handled relative to server state. */
export type ImportResolutionKind = "as-is" | "new-id" | "conflict";

/** Existing-channel lookups used for conflict detection. Names are case-insensitive. */
export interface ExistingChannelInfo {
  /** lowercase channel name → { id, revision } of the existing channel. */
  byName: Map<string, { id: string; revision: number }>;
  /** All existing channel IDs. */
  ids: Set<string>;
}

/** Existing-group lookups used for conflict detection. Names are case-insensitive. */
export interface ExistingGroupInfo {
  /** lowercase group name → { id, revision } of the existing group. */
  byName: Map<string, { id: string; revision: number }>;
  /** All existing group IDs (excluding the synthesized Default Group). */
  ids: Set<string>;
}

/**
 * Classify how an imported channel collides with server state, mirroring Java:
 *  - name already exists            → "conflict" (prompt overwrite vs create-new)
 *  - name is unique but id exists    → "new-id"   (auto-assign a fresh id, no prompt)
 *  - otherwise                       → "as-is"
 */
export function classifyChannelImport(
  channel: { id: string; name: string },
  existing: ExistingChannelInfo
): ImportResolutionKind {
  if (existing.byName.has(channel.name.toLowerCase())) return "conflict";
  if (existing.ids.has(channel.id)) return "new-id";
  return "as-is";
}

/** Classify how an imported group collides with server state. Same rules as channels. */
export function classifyGroupImport(
  group: { id: string; name: string },
  existing: ExistingGroupInfo
): ImportResolutionKind {
  if (existing.byName.has(group.name.toLowerCase())) return "conflict";
  if (existing.ids.has(group.id)) return "new-id";
  return "as-is";
}

// ─── Full group-set construction (mirrors ChannelPanel group merge + dedupe) ───

/**
 * Build the COMPLETE set of channel groups to submit to
 * POST /channelgroups/_bulkUpdate.
 *
 * The server treats the submitted set as authoritative: any existing group NOT
 * present is deleted (DefaultChannelController.updateChannelGroups). So we must
 * start from all existing non-default groups and fold the imported group in,
 * then enforce the server's "a channel belongs to only one group" rule by
 * removing the imported channel ids from every other group.
 *
 * @param existingGroups  All groups the client currently knows about (may include
 *                         the synthesized Default Group, which is filtered out).
 * @param imported        The resolved imported group: final id/name/revision plus
 *                         the final ids of its channels (post conflict-resolution).
 * @param mode            "overwrite" merges into the existing group with imported.id;
 *                         "new" appends imported as a brand-new group.
 * @param defaultGroupId  The synthesized Default Group id to exclude from the set.
 */
export function buildImportedGroupSet(
  existingGroups: ChannelGroup[],
  imported: { id: string; name: string; revision: number; channelIds: string[] },
  mode: "new" | "overwrite",
  defaultGroupId: string
): ChannelGroup[] {
  const importedIds = new Set(imported.channelIds);

  // Existing non-default groups, with freshly-copied channel id lists so we never
  // mutate the caller's cached objects.
  const set: ChannelGroup[] = existingGroups
    .filter((g) => g.id !== defaultGroupId)
    .map((g) => ({ ...g, channels: (g.channels ?? []).map((c) => ({ id: c.id })) }));

  if (mode === "overwrite") {
    const target = set.find((g) => g.id === imported.id);
    if (target) {
      // Union the existing group's channels with the imported channels.
      const union = new Set<string>([
        ...(target.channels ?? []).map((c) => c.id),
        ...imported.channelIds,
      ]);
      target.name = imported.name;
      target.revision = imported.revision;
      target.channels = [...union].map((id) => ({ id }));
    } else {
      // Overwrite target not found locally — treat as new.
      set.push({
        id: imported.id,
        name: imported.name,
        revision: imported.revision,
        channels: imported.channelIds.map((id) => ({ id })),
      });
    }
  } else {
    set.push({
      id: imported.id,
      name: imported.name,
      revision: imported.revision,
      channels: imported.channelIds.map((id) => ({ id })),
    });
  }

  // A channel may belong to only one group — strip imported channels from others.
  for (const g of set) {
    if (g.id === imported.id) continue;
    g.channels = (g.channels ?? []).filter((c) => !importedIds.has(c.id));
  }

  return set;
}

// ─── Code-template-library consolidation (mirrors ChannelPanel.importGroup) ────

/**
 * Consolidate the code-template libraries embedded across every channel in a group
 * into a single set, mirroring the Java client:
 *  - libraries are deduped by id; their codeTemplateIds and enabled/disabled
 *    channel-id lists are unioned across channels;
 *  - templates are deduped by id;
 *  - each channel's FINAL id is added to enabledChannelIds (and removed from
 *    disabledChannelIds) for every library it ships with.
 *
 * Callers should remap each channel's libData from its original id to its final id
 * (via updateLibraryChannelIds) BEFORE passing it in, so the enabled lists already
 * reference final ids; the explicit add here is the same belt-and-suspenders the
 * single-channel importer uses.
 */
export function consolidateChannelLibraries(
  channels: Array<{ finalId: string; libData: ParsedLibraryData | null }>
): ParsedLibraryData {
  const libById = new Map<string, CodeTemplateLibrary>();
  const templateById = new Map<string, CodeTemplate>();

  for (const ch of channels) {
    if (!ch.libData) continue;

    for (const t of ch.libData.templates) {
      if (!templateById.has(t.id)) templateById.set(t.id, t);
    }

    for (const lib of ch.libData.libraries) {
      let target = libById.get(lib.id);
      if (!target) {
        // Clone so we never mutate the caller's parsed data.
        target = {
          ...lib,
          codeTemplateIds: [...(lib.codeTemplateIds ?? [])],
          enabledChannelIds: [...(lib.enabledChannelIds ?? [])],
          disabledChannelIds: [...(lib.disabledChannelIds ?? [])],
        };
        libById.set(lib.id, target);
      } else {
        target.codeTemplateIds = unionIds(target.codeTemplateIds, lib.codeTemplateIds);
        target.enabledChannelIds = unionIds(target.enabledChannelIds, lib.enabledChannelIds);
        target.disabledChannelIds = unionIds(target.disabledChannelIds, lib.disabledChannelIds);
      }

      // This channel ships with the library, so it must be enabled in it.
      target.enabledChannelIds = unionIds(target.enabledChannelIds, [ch.finalId]);
      target.disabledChannelIds = (target.disabledChannelIds ?? []).filter(
        (id) => id !== ch.finalId
      );
    }
  }

  return { libraries: [...libById.values()], templates: [...templateById.values()] };
}

function unionIds(a: string[] | undefined, b: string[] | undefined): string[] {
  const out = new Set<string>(a ?? []);
  for (const id of b ?? []) out.add(id);
  return [...out];
}

// ─── Channel dependencies (mirrors ChannelPanel.importChannel dependency block) ─

/** The dependent/dependency channel-id lists declared in a channel's exportData. */
export interface ChannelDependencyIds {
  /** Channels that depend on this channel. */
  dependentIds: string[];
  /** Channels this channel depends on. */
  dependencyIds: string[];
}

/** Parse `<exportData><dependentIds>`/`<dependencyIds>` (sets of `<string>`) from channel XML. */
export function parseChannelDependencyIds(xml: string): ChannelDependencyIds {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const read = (tag: string): string[] => {
    const out: string[] = [];
    doc.querySelectorAll(`exportData > ${tag} > string`).forEach((el) => {
      const v = el.textContent?.trim();
      if (v) out.push(v);
    });
    return out;
  };
  return { dependentIds: read("dependentIds"), dependencyIds: read("dependencyIds") };
}

/**
 * Build the ChannelDependency entries contributed by one imported channel,
 * mirroring the Java client:
 *  - each dependentId → "that channel depends on THIS channel"
 *  - each dependencyId → "THIS channel depends on that channel"
 * Blank ids and self-references are skipped; referenced ids are remapped through
 * `remap` so dependencies on other channels in the same import follow their new ids.
 */
export function buildDependencyAdditions(
  finalId: string,
  deps: ChannelDependencyIds,
  remap: (id: string) => string
): ChannelDependency[] {
  const out: ChannelDependency[] = [];
  for (const raw of deps.dependentIds) {
    const dependentId = remap(raw);
    if (dependentId && dependentId !== finalId) out.push({ dependentId, dependencyId: finalId });
  }
  for (const raw of deps.dependencyIds) {
    const dependencyId = remap(raw);
    if (dependencyId && dependencyId !== finalId) out.push({ dependentId: finalId, dependencyId });
  }
  return out;
}

/**
 * Union new dependency entries into the existing global set, deduping by the
 * (dependentId, dependencyId) pair. Returns the merged list and whether anything
 * was actually added (so the caller can skip the PUT when nothing changed).
 */
export function mergeChannelDependencies(
  existing: ChannelDependency[],
  additions: ChannelDependency[]
): { merged: ChannelDependency[]; changed: boolean } {
  const key = (d: ChannelDependency) => `${d.dependentId} ${d.dependencyId}`;
  const seen = new Set(existing.map(key));
  const merged = [...existing];
  let changed = false;
  for (const dep of additions) {
    if (!seen.has(key(dep))) {
      seen.add(key(dep));
      merged.push(dep);
      changed = true;
    }
  }
  return { merged, changed };
}
