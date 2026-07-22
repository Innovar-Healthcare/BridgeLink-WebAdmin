// Shared charset/encoding dropdown options for connector panels.
//
// Replaces the per-connector hard-coded charset lists. The list of supported
// charsets comes from the server (GET /server/charsets via useCharsetEncodings),
// matching the Java client, which fills every "Encoding" combo box from the same
// server-provided set. "DEFAULT_ENCODING" is CharsetUtils.DEFAULT_ENCODING on the
// server — it tells the server to use the JVM's default platform charset.

export interface CharsetOption {
  label: string;
  value: string;
}

/** The "use server default" option. Always the first entry in the dropdown. */
export const DEFAULT_ENCODING_OPTION: CharsetOption = {
  label: "Default",
  value: "DEFAULT_ENCODING",
};

/**
 * Build the option list for a connector "Encoding" dropdown from the server-provided
 * charset list. Prepends the "Default" option and, if the channel's currently-saved
 * charset isn't in the server list (a legacy or exotic value), appends it so the saved
 * value still round-trips instead of silently resetting.
 */
export function buildCharsetOptions(serverCharsets: string[], current?: string): CharsetOption[] {
  const options: CharsetOption[] = [
    DEFAULT_ENCODING_OPTION,
    ...serverCharsets.map((c) => ({ label: c, value: c })),
  ];
  if (current && current !== DEFAULT_ENCODING_OPTION.value && !serverCharsets.includes(current)) {
    options.push({ label: current, value: current });
  }
  return options;
}
