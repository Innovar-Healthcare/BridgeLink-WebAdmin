/**
 * Attachment-list row grouping for the Message Browser, Finding 21).
 *
 * Mirrors the Java client's MessageBrowser.updateAttachmentList(): attachments of
 * a "multi-capable" viewer type (only DICOM in the stock client) collapse into a
 * single row showing a number range and comma-joined ids; every other type gets
 * one row per attachment. The numbering — including the quirk where `count` is
 * left at the group's end value and is not advanced before the next type — is
 * replicated exactly so the displayed "#" column matches the Swing client.
 */

import type { Attachment } from "@/lib/types";
import { isMultiAttachmentType } from "./attachment-viewer-types";

/** A single rendered row of the attachment list — one attachment, or a collapsed group. */
export interface AttachmentDisplayRow {
  /** Stable rowKey + representative attachment id (the group's first). */
  key: string;
  /** "#" column: a single number ("1") or a range ("1 - 3"). */
  numLabel: string;
  /** Content type shared by every attachment in this row. */
  type: string;
  /** "Attachment Id" column: one id, or "id1, id2, id3" for a group. */
  idLabel: string;
  /** Underlying attachments — length 1 for a normal row, N for a collapsed group. */
  attachments: Attachment[];
  /** True when this row collapses multiple attachments (a multi-capable type). */
  isGroup: boolean;
  /** Emission order, used as the "#"-column sort key. */
  sortIndex: number;
}

/**
 * Build the attachment-list rows, grouping multi-capable types into one row each.
 * Faithful port of MessageBrowser.updateAttachmentList (lines 1501-1567).
 */
export function buildAttachmentRows(attachments: Attachment[]): AttachmentDisplayRow[] {
  const rows: AttachmentDisplayRow[] = [];
  let count = 1;

  // Distinct types in first-encounter order (Java builds the same `types` list).
  const types: string[] = [];
  for (const att of attachments) {
    if (!types.includes(att.type)) types.push(att.type);
  }

  for (const type of types) {
    const ofType = attachments.filter((a) => a.type === type);

    if (isMultiAttachmentType(type)) {
      // One collapsed row for the whole type.
      const start = count;
      // Java advances `count` once per attachment after the first.
      for (let i = 1; i < ofType.length; i++) count++;
      const numLabel = start === count ? `${start}` : `${start} - ${count}`;
      rows.push({
        key: ofType[0].id,
        numLabel,
        type,
        idLabel: ofType.map((a) => a.id).join(", "),
        attachments: ofType,
        isGroup: true,
        sortIndex: rows.length,
      });
      // Note: Java does NOT increment `count` after the group, so a following
      // type reuses the group's end number. Replicated for parity (degenerate
      // edge — DICOM messages are homogeneous in practice).
    } else {
      for (const att of ofType) {
        rows.push({
          key: att.id,
          numLabel: `${count}`,
          type,
          idLabel: att.id,
          attachments: [att],
          isGroup: false,
          sortIndex: rows.length,
        });
        count++;
      }
    }
  }

  return rows;
}
