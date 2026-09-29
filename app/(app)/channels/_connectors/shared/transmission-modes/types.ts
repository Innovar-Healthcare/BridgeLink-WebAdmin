import type { ComponentType } from "react";
import type { ValidationError } from "@/app/(app)/channels/_connectors/shared/validate-utils";

/**
 * Props passed to a mode-specific SettingsSection component rendered inside
 * the transmission mode dialog (below the shared SOM/EOM rows). The dialog
 * owns the draft settings and the invalid-field highlight set; the section
 * edits via partial patches (editing a patched field clears its highlight).
 */
export interface TransmissionModeSectionProps {
  settings: TransmissionModeSettings;
  onChange: (patch: Partial<TransmissionModeSettings>) => void;
  /** Field keys currently failing validation (red highlight). */
  invalidFields: ReadonlySet<string>;
}

/**
 * The editable transmission-mode settings shared by the TCP connectors and the
 * transmission-mode settings dialog. Mirrors the union of Java
 * FrameModeProperties (start/end bytes) + MLLPModeProperties (useMLLPv2, ack/nack,
 * maxRetries) fields used by the *ModeSettingsDialog classes. Runtime
 * (manifest-contributed) modes keep their declared fields in `extra` — string
 * values keyed by the field's XML element name.
 */
export interface TransmissionModeSettings {
  transmissionMode: string;
  startOfMessageBytes: string;
  endOfMessageBytes: string;
  useMLLPv2: boolean;
  ackBytes: string;
  nackBytes: string;
  maxRetries: string;
  /** Runtime-mode field values (element name → text). `{}` for built-ins. */
  extra: Record<string, string>;
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
  /**
   * Dialog/host "Sample Frame" label override (Java getSampleLabel()) —
   * defaults to "Sample Frame:". MLLP carries "MLLP Sample Frame:".
   */
  sampleLabel?: string;
  /**
   * Default values for the mode's `extra` fields, keyed by element name.
   * Runtime modes compile this from their declared fields' defaultValue, so
   * mode-switch resets and serialization are complete and deterministic.
   */
  defaultExtra?: Record<string, string>;
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
