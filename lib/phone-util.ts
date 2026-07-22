/**
 * Phone number and country/state helpers matching Java's UserEditPanel logic.
 *
 * Country display names come from Intl.DisplayNames (English), mirroring
 * Java's Locale("", code).getDisplayCountry(). Country is stored as the
 * display name (e.g. "United States"), not the ISO code.
 *
 * Phone validation and formatting mirror UserEditPanel.validatePhoneNumber()
 * and UserEditPanel.formatPhoneNumber() using libphonenumber-js.
 */

import { getCountries, parsePhoneNumberFromString } from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";

// ─── Country options ──────────────────────────────────────────────────────────

export interface CountryOption {
  code: CountryCode;
  name: string;
}

let _countryOptions: CountryOption[] | null = null;

/** Sorted alphabetical list of countries matching Java's PhoneNumberUtil.getSupportedRegions(). */
export function getCountryOptions(): CountryOption[] {
  if (_countryOptions) return _countryOptions;

  const names = new Intl.DisplayNames(["en"], { type: "region" });
  _countryOptions = getCountries()
    .map((code) => ({ code, name: names.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return _countryOptions;
}

/** Convert a country display name (as stored on the User model) to its ISO code. */
export function countryNameToCode(displayName: string): CountryCode | null {
  const match = getCountryOptions().find((o) => o.name === displayName);
  return match?.code ?? null;
}

// ─── US state / territory codes ──────────────────────────────────────────────

/** Exact list from UserEditPanel.java:48–50, including territories. */
export const US_STATE_TERRITORY_CODES: readonly string[] = [
  "AL",
  "AK",
  "AS",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "GU",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MP",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "PR",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "VI",
  "WA",
  "WV",
  "WI",
  "WY",
];

// ─── Phone validation + formatting ───────────────────────────────────────────

/**
 * Returns true if the phone number is valid for the given ISO country code.
 * Empty/blank input always returns true (phone is optional).
 * Mirrors UserEditPanel.validatePhoneNumber().
 */
export function validatePhoneNumber(raw: string, countryCode: CountryCode): boolean {
  if (!raw.trim()) return true;
  try {
    const parsed = parsePhoneNumberFromString(raw, countryCode);
    return parsed?.isValid() ?? false;
  } catch {
    return false;
  }
}

/**
 * Normalizes a phone number to INTERNATIONAL format (e.g. "+1 202 555 0100").
 * Returns the original input unchanged if parsing fails.
 * Mirrors UserEditPanel.formatPhoneNumber().
 */
export function formatPhoneNumber(raw: string, countryCode: CountryCode): string {
  if (!raw.trim()) return raw;
  try {
    const parsed = parsePhoneNumberFromString(raw, countryCode);
    if (parsed?.isValid()) return parsed.formatInternational();
    return raw;
  } catch {
    return raw;
  }
}
