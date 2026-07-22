/**
 * Transmission mode registry.
 *
 * ─── Adding a built-in mode ────────────────────────────────────────────────────
 *   1. Call registerTransmissionMode() below with the mode definition.
 *   — The mode appears in the TCP Listener / TCP Sender dropdown automatically.
 *
 * ─── Adding a commercial plugin mode ──────────────────────────────────────────
 *   1. Create `plugins/<name>/index.ts` with the TransmissionModeDefinition.
 *   2. Call registerTransmissionMode() from that index.ts (imported by plugins/index.ts).
 *   — The mode will appear in dropdowns on next registry read.
 *
 * Modes appear in the dropdown in registration order. The built-in MLLP and
 * Basic modes are registered first so they always sort before plugin modes.
 */

export type {
  TransmissionModeDefinition,
  TransmissionModeSectionProps,
  TransmissionModeSettings,
} from "./types";
import { connectContributionSink, warnDuplicateContribution } from "@/lib/plugin-manifest";
import type { TransmissionModeDefinition, TransmissionModeSettings } from "./types";
import { MLLP_DEFAULTS, validateTransmissionMode } from "./validate";
import { appendTextChild, readChildText } from "./dom";

export {
  validateTransmissionMode,
  validateTransmissionModeForSave,
  isTransmissionModeNonDefault,
  defaultSettingsForMode,
  isValidHexString,
  MLLP_DEFAULTS,
} from "./validate";

/** Mutable transmission mode registry. Commercial plugins self-register here. */
export let TRANSMISSION_MODE_REGISTRY: TransmissionModeDefinition[] = [];

/**
 * Register a transmission mode. Called by built-ins at module init and by
 * commercial plugins from their plugins/index.ts entry point.
 *
 * Modes appear in the dropdown in registration order. Re-registering the same
 * name appends a second entry — do not register the same name twice.
 */
export function registerTransmissionMode(def: TransmissionModeDefinition): void {
  TRANSMISSION_MODE_REGISTRY = [...TRANSMISSION_MODE_REGISTRY, def];
}

// ─── Built-in modes ─────────────────────────────────────────────────────────
// Registered via the public API so the contract is validated against real usage.

// The validate hook routes through the shared validator, which self-branches on
// the mode name (MLLP rules vs Basic/frame-only rules). The `unknown` param of the
// generic hook is narrowed to TransmissionModeSettings at this registration boundary.
const validate = (props: unknown) => validateTransmissionMode(props as TransmissionModeSettings);

registerTransmissionMode({
  name: "MLLP",
  displayName: "MLLP",
  defaultStartBytes: "0B",
  defaultEndBytes: "1C0D",
  // MLLP mode uses MLLPModeProperties, which carries the extra MLLP v2 fields.
  propertiesClass: "com.mirth.connect.plugins.mllpmode.MLLPModeProperties",
  validate,
  serialize: (s, el, doc) => {
    appendTextChild(el, "useMLLPv2", String(s.useMLLPv2), doc);
    appendTextChild(el, "ackBytes", s.ackBytes, doc);
    appendTextChild(el, "nackBytes", s.nackBytes, doc);
    appendTextChild(el, "maxRetries", s.maxRetries, doc);
  },
  parse: (el) => {
    const useMLLPv2Raw = readChildText(el, "useMLLPv2");
    return {
      useMLLPv2: useMLLPv2Raw === undefined ? MLLP_DEFAULTS.useMLLPv2 : useMLLPv2Raw === "true",
      ackBytes: readChildText(el, "ackBytes") ?? MLLP_DEFAULTS.ackBytes,
      nackBytes: readChildText(el, "nackBytes") ?? MLLP_DEFAULTS.nackBytes,
      maxRetries: readChildText(el, "maxRetries") ?? MLLP_DEFAULTS.maxRetries,
    };
  },
});

registerTransmissionMode({
  name: "Basic",
  displayName: "Basic TCP",
  defaultStartBytes: "",
  defaultEndBytes: "",
  // Basic TCP uses FrameModeProperties with pluginPointName="Basic"; no extra fields beyond SOM/EOM.
  propertiesClass: "com.mirth.connect.model.transmission.framemode.FrameModeProperties",
  validate,
});

// Receive definePlugin() manifest contributions (first-wins by name). Connected
// after the built-ins above so the duplicate check sees MLLP/Basic.
connectContributionSink("transmissionModes", (def, pluginId) => {
  if (TRANSMISSION_MODE_REGISTRY.some((m) => m.name === def.name)) {
    warnDuplicateContribution(pluginId, "transmission mode", def.name);
    return false;
  }
  registerTransmissionMode(def);
  return true;
});
