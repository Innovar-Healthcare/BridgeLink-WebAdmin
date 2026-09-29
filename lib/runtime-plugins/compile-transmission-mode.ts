/**
 * Compiles a declared transmission mode (manifest v2) into the host's
 * TransmissionModeDefinition contract — everything except the
 * React SettingsSection, which the loader composes from
 * components/schema-form/runtime-transmission-mode-section.tsx so this module
 * stays JSX-free (mirrors the compile-validate / runtime-connector-section
 * split for connector panels).
 *
 * Wire model (PLAN-RuntimeTransmissionModes-BusinessLogic.md): the shared
 * writer in transmission-modes/xml.ts owns the `class` attribute
 * (propertiesClass), `<pluginPointName>`, and the SOM/EOM elements; the
 * compiled `serialize`/`parse` own the declared fields as text children —
 * exactly how the built-in MLLP definition handles useMLLPv2/ackBytes/etc.
 * Every declared key is always written (from the settings' `extra` bag,
 * falling back to the compiled defaults), mirroring how XStream always
 * serializes all fields of the Java class.
 */

import {
  appendTextChild,
  readDirectChildText,
} from "@/app/(app)/channels/_connectors/shared/transmission-modes/dom";
import { validateTransmissionMode } from "@/app/(app)/channels/_connectors/shared/transmission-modes/validate";
import type {
  TransmissionModeDefinition,
  TransmissionModeSettings,
} from "@/app/(app)/channels/_connectors/shared/transmission-modes/types";
import { validateFieldValues } from "./compile-validate";
import type { FieldDescriptor, TransmissionModeContribution } from "./manifest-types";

/**
 * Compile a validated transmission-mode contribution. The returned definition
 * registers through the same first-wins sink as compiled-in plugin modes;
 * `pluginName` is stamped by registerPlugin from the definition's
 * serverPluginName, so server-enablement gating applies unchanged.
 */
export function compileTransmissionMode(
  mode: TransmissionModeContribution
): Omit<TransmissionModeDefinition, "SettingsSection"> {
  const fields = mode.fields ?? [];
  const defaultExtra: Record<string, string> = {};
  for (const field of fields) defaultExtra[field.key] = field.defaultValue ?? "";

  /*
   * The two host-owned byte elements can carry rules too (v3). They are not
   * declared fields — their keys are reserved — so we run them through the same
   * compiled validator against synthetic descriptors whose keys are the real
   * settings keys, which is what puts the errors on the right rows in the
   * dialog's invalid-field highlighting.
   */
  const byteFields: FieldDescriptor[] = [];
  if (mode.startBytesValidation) {
    byteFields.push({
      key: "startOfMessageBytes",
      type: "text",
      label: "Start of Message Bytes",
      validation: mode.startBytesValidation,
    });
  }
  if (mode.endBytesValidation) {
    byteFields.push({
      key: "endOfMessageBytes",
      type: "text",
      label: "End of Message Bytes",
      validation: mode.endBytesValidation,
    });
  }

  return {
    name: mode.name,
    displayName: mode.displayName,
    propertiesClass: mode.propertiesClass,
    defaultStartBytes: mode.defaultStartBytes,
    defaultEndBytes: mode.defaultEndBytes,
    defaultExtra,
    validate: (props) => {
      const settings = props as TransmissionModeSettings;
      // Frame-mode rules on SOM/EOM (hex-only, blanks allowed — the shared
      // validator's non-MLLP branch), then any stricter byte rules the mode
      // declared, then the declared per-field rules. The shared rule always
      // runs, so a value that fails both reports twice — both messages are
      // true, and suppressing one would mean special-casing shared behavior.
      // visibleWhen-hidden fields are skipped by validateFieldValues, so a
      // hidden required field never blocks OK.
      return [
        ...validateTransmissionMode(settings),
        ...validateFieldValues(byteFields, {
          startOfMessageBytes: settings.startOfMessageBytes,
          endOfMessageBytes: settings.endOfMessageBytes,
        }),
        ...validateFieldValues(fields, settings.extra ?? {}),
      ];
    },
    serialize: (settings, el, doc) => {
      for (const field of fields) {
        appendTextChild(el, field.key, settings.extra[field.key] ?? defaultExtra[field.key], doc);
      }
    },
    parse: (el) => {
      const extra: Record<string, string> = {};
      for (const field of fields) {
        // readDirectChildText, not readChildText: field keys may contain dots
        // (CSS-hostile in querySelector) and values must round-trip untrimmed.
        extra[field.key] = readDirectChildText(el, field.key) ?? defaultExtra[field.key];
      }
      return { extra };
    },
  };
}
