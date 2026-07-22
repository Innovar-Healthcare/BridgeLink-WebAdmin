import type { DataTypeDefinition } from "./types";
import {
  isBase64DicomLike,
  isDicomXml,
  dicomBase64ToXml,
  dicomXmlToMsgTree,
} from "@/lib/dicom-tag-parser";

export const DICOMDataType: DataTypeDefinition = {
  name: "DICOM",

  defaultPropertiesXml(tagName, version) {
    const base = "com.mirth.connect.plugins.datatypes.dicom";
    return `<${tagName} class="${base}.DICOMDataTypeProperties" version="${version}"/>`;
  },

  /**
   * Normalize the template text for display and tree parsing.
   * When the user pastes a base64-encoded DICOM binary, this converts it to
   * BridgeLink DICOM XML (<dicom><tagXXXXXXXX>value</tagXXXXXXXX>...</dicom>).
   * The reference panel then updates the textarea with the XML so the user can
   * see the message structure — matching the Java UI's getTemplateString() behaviour.
   */
  getTemplateString(rawText: string): string {
    if (isDicomXml(rawText)) {
      // Already in BridgeLink DICOM XML format — no conversion needed.
      return rawText;
    }
    if (isBase64DicomLike(rawText)) {
      // Decode and parse the binary DICOM, emit XML.
      return dicomBase64ToXml(rawText);
    }
    // Unknown format — return unchanged (parseTemplate will throw).
    return rawText;
  },

  /**
   * Parse BridgeLink DICOM XML into a draggable MsgTreeNode tree.
   * Drag expressions match the Java UI's MirthTree.constructPath() output:
   *   msg['tag00100010'].toString()          ← simple tag
   *   msg['tag00081110']['item'][0]['tag00081150'].toString()  ← SQ sequence item
   */
  parseTemplate(text, prefix, suffix) {
    if (!isDicomXml(text)) {
      throw new Error("Not DICOM XML");
    }
    return dicomXmlToMsgTree(text, prefix, suffix);
  },

  // No PropertiesSection — DICOM has no user-configurable serialization properties.
  // The dialog shows "No configurable properties for DICOM." via the default fallback.
};
