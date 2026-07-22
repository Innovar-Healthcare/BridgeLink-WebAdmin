/**
 * Transmission-mode validation + default-comparison helpers.
 *
 * Mirrors the BridgeLink Java client's transmission-mode behavior so the WebUI
 * blocks the same invalid input and prompts on the same "lose settings?" changes:
 *
 *   - MLLPModeSettingsDialog.checkProperties()  (plugins/mllpmode)
 *   - BasicModeSettingsDialog.checkProperties()  (client/.../editors)
 *   - TcpUtil.isValidHexString()                 (server/.../util)
 *   - MLLPModeProperties / FrameModeProperties.equals()
 */

import type { ValidationError } from "../validate-utils";
import type { TransmissionModeDefinition, TransmissionModeSettings } from "./types";

/**
 * Default MLLP transmission properties. Mirrors the Java MLLPModeProperties
 * constructor (server/.../plugins/mllpmode/MLLPModeProperties.java).
 */
export const MLLP_DEFAULTS = {
  useMLLPv2: false,
  ackBytes: "06", // <ACK>
  nackBytes: "15", // <NAK>
  maxRetries: "2",
} as const;

/**
 * True when `str` contains only uppercase hex characters (empty allowed).
 * Mirrors Java `TcpUtil.isValidHexString`: `str.matches("^[0-9A-F]*$")`.
 * Byte-field inputs are uppercased on entry, so lowercase never reaches here.
 * Note: there is intentionally NO even-length / byte-pair requirement (parity).
 */
export function isValidHexString(str: string): boolean {
  return /^[0-9A-F]*$/.test(str);
}

/** Java `validBytes()`: non-blank AND valid hex. */
function isNonBlankHex(str: string): boolean {
  return str.trim().length > 0 && isValidHexString(str);
}

/**
 * Validates MLLP/Basic transmission-mode byte settings. Mirrors the Java
 * checkProperties() in MLLPModeSettingsDialog / BasicModeSettingsDialog:
 *
 * - Basic (and other frame-only modes): start/end must be valid hex; empty allowed.
 * - MLLP: start/end must be non-blank AND valid hex. When useMLLPv2 is enabled,
 *   ack/nack bytes must be non-blank + hex and maxRetries must be non-empty.
 *
 * Returns an empty array when valid. Error messages match the Java strings.
 */
export function validateTransmissionMode(props: TransmissionModeSettings): ValidationError[] {
  const errors: ValidationError[] = [];

  if (props.transmissionMode === "MLLP") {
    if (!isNonBlankHex(props.startOfMessageBytes))
      errors.push({ field: "startOfMessageBytes", message: "Invalid start of message bytes." });
    if (!isNonBlankHex(props.endOfMessageBytes))
      errors.push({ field: "endOfMessageBytes", message: "Invalid end of message bytes." });

    if (props.useMLLPv2) {
      if (!isNonBlankHex(props.ackBytes))
        errors.push({
          field: "ackBytes",
          message: "Invalid affirmative commit acknowledgement bytes.",
        });
      if (!isNonBlankHex(props.nackBytes))
        errors.push({
          field: "nackBytes",
          message: "Invalid negative commit acknowledgement bytes.",
        });
      if (props.maxRetries.trim().length === 0)
        errors.push({ field: "maxRetries", message: "Invalid maximum retry count." });
    }
  } else {
    // Basic / frame-only: hex-only, empty allowed.
    if (!isValidHexString(props.startOfMessageBytes))
      errors.push({ field: "startOfMessageBytes", message: "Invalid start of message bytes." });
    if (!isValidHexString(props.endOfMessageBytes))
      errors.push({ field: "endOfMessageBytes", message: "Invalid end of message bytes." });
  }

  return errors;
}

/**
 * Save-time (connector-level) transmission-mode validation. Mirrors the Java connector save path,
 * which calls `transmissionModeProvider.checkProperties()` — and since `MLLPModeClientProvider`
 * does NOT override it, that resolves to `FrameTransmissionModeClientProvider.checkProperties()` for
 * BOTH Basic and MLLP: hex-validity only on SOM/EOM, with **blanks allowed** and no MLLPv2
 * (ack/nack/maxRetries) checks. The strict non-blank + MLLPv2 rules in `validateTransmissionMode`
 * gate only the transmission-mode dialog's OK button (`MLLPModeSettingsDialog.checkProperties`), so a
 * Java-legal channel with blank MLLP frame bytes must still be re-saveable here.
 */
export function validateTransmissionModeForSave(
  props: TransmissionModeSettings
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!isValidHexString(props.startOfMessageBytes))
    errors.push({ field: "startOfMessageBytes", message: "Invalid start of message bytes." });
  if (!isValidHexString(props.endOfMessageBytes))
    errors.push({ field: "endOfMessageBytes", message: "Invalid end of message bytes." });
  return errors;
}

/**
 * True when the transmission settings differ from the mode's defaults. Mirrors
 * Java `!provider.getDefaultProperties().equals(provider.getProperties())`:
 * FrameModeProperties.equals compares start/end bytes, and MLLPModeProperties.equals
 * additionally compares useMLLPv2/ackBytes/nackBytes/maxRetries.
 */
export function isTransmissionModeNonDefault(
  s: TransmissionModeSettings,
  def: TransmissionModeDefinition
): boolean {
  if (
    s.startOfMessageBytes !== def.defaultStartBytes ||
    s.endOfMessageBytes !== def.defaultEndBytes
  )
    return true;

  if (s.transmissionMode === "MLLP") {
    return (
      s.useMLLPv2 !== MLLP_DEFAULTS.useMLLPv2 ||
      s.ackBytes !== MLLP_DEFAULTS.ackBytes ||
      s.nackBytes !== MLLP_DEFAULTS.nackBytes ||
      s.maxRetries !== MLLP_DEFAULTS.maxRetries
    );
  }
  return false;
}

/**
 * The full transmission settings for a freshly-selected mode: the mode's default
 * frame bytes plus the standard MLLP defaults. Mirrors Java creating a new provider
 * with default properties on mode change (so stale MLLPv2 fields are reset, not kept).
 */
export function defaultSettingsForMode(def: TransmissionModeDefinition): TransmissionModeSettings {
  return {
    transmissionMode: def.name,
    startOfMessageBytes: def.defaultStartBytes,
    endOfMessageBytes: def.defaultEndBytes,
    useMLLPv2: MLLP_DEFAULTS.useMLLPv2,
    ackBytes: MLLP_DEFAULTS.ackBytes,
    nackBytes: MLLP_DEFAULTS.nackBytes,
    maxRetries: MLLP_DEFAULTS.maxRetries,
  };
}
