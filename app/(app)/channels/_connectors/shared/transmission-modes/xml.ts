/**
 * Registry-driven serialization of the `<transmissionModeProperties>` element shared by the TCP
 * Listener and TCP Sender connectors.
 *
 * The element is polymorphic in BridgeLink: each transmission mode has its own
 * `TransmissionModeProperties` XStream subclass (Basic → FrameModeProperties, MLLP →
 * MLLPModeProperties, and any future plugin mode → its own class). Rather than hardcoding
 * "MLLP else Basic" (which silently rewrote every non-MLLP mode to Basic and dropped its class +
 * extra fields), these helpers look the mode up in TRANSMISSION_MODE_REGISTRY and use the
 * definition's `propertiesClass` / `serialize` / `parse` hooks. Mirrors the Java client, where the
 * connector keeps the mode's own provider when its plugin is loaded and only downgrades to Basic
 * when the provider is absent (TcpListener.setProperties / transmissionModeComboBoxActionPerformed).
 */

import { MLLP_DEFAULTS, TRANSMISSION_MODE_REGISTRY } from "./index";
import { appendTextChild, readChildText } from "./dom";
import type { TransmissionModeSettings } from "./types";

/**
 * Read a `<transmissionModeProperties>` element into transmission-mode settings.
 *
 * - `el` null (element absent): Basic mode with **empty** frame bytes — matches Java, where a null
 *   TransmissionModeProperties resolves to Basic/FrameModeProperties() (empty SOM/EOM), NOT the MLLP
 *   0B/1C0D defaults.
 * - element present: `pluginPointName` is the mode; SOM/EOM come from the element (falling back to the
 *   registered mode's defaults when a child is missing); mode-specific fields via `def.parse`.
 */
export function readTransmissionModeProperties(el: Element | null): TransmissionModeSettings {
  const base: TransmissionModeSettings = {
    transmissionMode: "Basic",
    startOfMessageBytes: "",
    endOfMessageBytes: "",
    useMLLPv2: MLLP_DEFAULTS.useMLLPv2,
    ackBytes: MLLP_DEFAULTS.ackBytes,
    nackBytes: MLLP_DEFAULTS.nackBytes,
    maxRetries: MLLP_DEFAULTS.maxRetries,
  };
  if (!el) return base;

  const mode = readChildText(el, "pluginPointName") ?? "Basic";
  const def = TRANSMISSION_MODE_REGISTRY.find((m) => m.name === mode);

  return {
    ...base,
    transmissionMode: mode,
    startOfMessageBytes: readChildText(el, "startOfMessageBytes") ?? def?.defaultStartBytes ?? "",
    endOfMessageBytes: readChildText(el, "endOfMessageBytes") ?? def?.defaultEndBytes ?? "",
    ...(def?.parse?.(el) ?? {}),
  };
}

/**
 * Rebuild the `<transmissionModeProperties>` element under `root` from transmission-mode settings.
 *
 * The mode's registered definition supplies the `class` attribute (`propertiesClass`), the
 * `pluginPointName` (the mode's own `name`, never a hardcoded "Basic"), and any extra fields via
 * `serialize`. When the mode is **not** registered (an unknown / not-loaded plugin mode) the existing
 * element is left untouched so its class and fields survive the round-trip instead of being silently
 * rewritten to Basic.
 */
export function writeTransmissionModeProperties(
  root: Element,
  settings: TransmissionModeSettings,
  doc: Document
): void {
  const def = TRANSMISSION_MODE_REGISTRY.find((m) => m.name === settings.transmissionMode);
  // Unknown/plugin mode: preserve whatever is already there rather than dropping it to Basic.
  if (!def) return;

  const oldTm = root.querySelector(":scope > transmissionModeProperties");
  if (oldTm) root.removeChild(oldTm);

  const tm = doc.createElementNS(null, "transmissionModeProperties");
  tm.setAttribute("class", def.propertiesClass);
  appendTextChild(tm, "pluginPointName", def.name, doc);
  appendTextChild(tm, "startOfMessageBytes", settings.startOfMessageBytes, doc);
  appendTextChild(tm, "endOfMessageBytes", settings.endOfMessageBytes, doc);
  def.serialize?.(settings, tm, doc);
  root.appendChild(tm);
}
