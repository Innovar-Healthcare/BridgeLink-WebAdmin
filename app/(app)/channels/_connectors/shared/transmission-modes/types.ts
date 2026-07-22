import type { ComponentType } from "react";
import type { ValidationError } from "@/app/(app)/channels/_connectors/shared/validate-utils";

/**
 * Props passed to a mode-specific SettingsSection component rendered inside
 * the transmission mode dialog.
 *
 * Intentionally minimal in v1. The shape will be finalized when a custom mode
 * (e.g. Sectra's Syslog mode) provides a real SettingsSection implementation.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TransmissionModeSectionProps {
  // Reserved — extend when a concrete SettingsSection implementation is needed.
}

/**
 * The editable transmission-mode settings shared by the TCP connectors and the
 * transmission-mode settings dialog. Mirrors the union of Java
 * FrameModeProperties (start/end bytes) + MLLPModeProperties (useMLLPv2, ack/nack,
 * maxRetries) fields used by the *ModeSettingsDialog classes.
 */
export interface TransmissionModeSettings {
  transmissionMode: string;
  startOfMessageBytes: string;
  endOfMessageBytes: string;
  useMLLPv2: boolean;
  ackBytes: string;
  nackBytes: string;
  maxRetries: string;
}

/**
 * Definition of a transmission mode that can be registered via
 * registerTransmissionMode().
 *
 * Mirrors Java's TransmissionModeClientProvider contract:
 *   - name / displayName  → getDefaultProperties() / toString()
 *   - defaultStartBytes   → getDefaultStartOfMessageBytes()
 *   - defaultEndBytes     → getDefaultEndOfMessageBytes()
 *   - buildSampleFrame    → getSampleValue()
 *   - validate            → checkProperties()
 *   - SettingsSection     → getSettingsComponent()
 *   - propertiesClass / serialize / parse → the mode's TransmissionModeProperties XStream shape
 */
export interface TransmissionModeDefinition {
  /** Mode identifier matching <transmissionModeName> in channel XML (e.g. "MLLP", "Basic"). */
  name: string;
  /** Human-readable label shown in the mode dropdown (e.g. "MLLP", "Basic TCP"). */
  displayName: string;
  /**
   * Server plugin name (must match `GET /extensions/plugins/`) used for
   * server-enablement gating. When set, this mode is hidden from the
   * transmission-mode dropdown unless that plugin is installed AND enabled on
   * the connected server. Stamped from the definition's `serverPluginName` by
   * `registerPlugin()`. Lookup-by-name is never gated, so a channel already
   * using this mode still renders and round-trips (the dropdown pins the
   * current value as an "(unavailable)" option). Omit for built-in modes.
   */
  pluginName?: string;
  /** Default hex start-of-message bytes populated when this mode is selected (e.g. "0B"). */
  defaultStartBytes: string;
  /** Default hex end-of-message bytes populated when this mode is selected (e.g. "1C0D"). */
  defaultEndBytes: string;
  /**
   * Fully-qualified XStream class of this mode's `TransmissionModeProperties` subclass, written as
   * the `class` attribute of the `<transmissionModeProperties>` element (e.g. Basic →
   * "com.mirth.connect.model.transmission.framemode.FrameModeProperties"). Required so channel-xml
   * serialization is registry-driven rather than hardcoding "MLLP else Basic".
   */
  propertiesClass: string;
  /** Optional React section rendered inside the dialog for mode-specific settings. */
  SettingsSection?: ComponentType<TransmissionModeSectionProps>;
  /** Returns the framed sample preview string for the given payload. */
  buildSampleFrame?: (payload: string) => string;
  /** Optional client-side validation; return empty array when valid. */
  validate?: (props: unknown) => ValidationError[];
  /**
   * Serialize this mode's fields *beyond* pluginPointName/SOM/EOM (which the shared writer emits) into
   * the `<transmissionModeProperties>` element. MLLP uses this for useMLLPv2/ackBytes/nackBytes/maxRetries.
   */
  serialize?: (settings: TransmissionModeSettings, el: Element, doc: Document) => void;
  /** Parse this mode's extra fields back out of the element. Inverse of `serialize`. */
  parse?: (el: Element) => Partial<TransmissionModeSettings>;
}
