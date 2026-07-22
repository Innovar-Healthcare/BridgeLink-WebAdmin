/**
 * Shared types, constants, and helpers for the Users page and its sub-components.
 */

import type { ColDef } from "@/lib/hooks/use-column-config";
import type { User } from "@/lib/types";
import type { SessionInfo } from "@/lib/auth";
import { getCountryOptions, US_STATE_TERRITORY_CODES } from "@/lib/phone-util";

// ─── Column type (matches Java UserPanel column order exactly) ────────────────

export type UserCol =
  | "username"
  | "firstName"
  | "lastName"
  | "email"
  | "country"
  | "stateTerritory"
  | "phoneNumber"
  | "organization"
  | "role"
  | "industry"
  | "lastLogin"
  | "description";

export const USER_COLS: ColDef<UserCol>[] = [
  {
    key: "username",
    label: "Username",
    defaultWidth: 140,
    minWidth: 80,
    defaultVisible: true,
    canHide: false,
  },
  {
    key: "firstName",
    label: "First Name",
    defaultWidth: 120,
    minWidth: 80,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "lastName",
    label: "Last Name",
    defaultWidth: 120,
    minWidth: 80,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "email",
    label: "Email",
    defaultWidth: 220,
    minWidth: 150,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "country",
    label: "Country",
    defaultWidth: 140,
    minWidth: 100,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "stateTerritory",
    label: "State/Territory",
    defaultWidth: 130,
    minWidth: 100,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "phoneNumber",
    label: "Phone Number",
    defaultWidth: 130,
    minWidth: 100,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "organization",
    label: "Organization",
    defaultWidth: 150,
    minWidth: 100,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "role",
    label: "Role",
    defaultWidth: 160,
    minWidth: 100,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "industry",
    label: "Business",
    defaultWidth: 130,
    minWidth: 100,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "lastLogin",
    label: "Last Login",
    defaultWidth: 160,
    minWidth: 120,
    defaultVisible: true,
    canHide: true,
  },
  {
    key: "description",
    label: "Description",
    defaultWidth: 200,
    minWidth: 80,
    defaultVisible: false,
    canHide: true,
  },
];

// ─── Form state ───────────────────────────────────────────────────────────────

export interface UserForm {
  username: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  email: string;
  organization: string;
  description: string;
  phoneNumber: string;
  country: string;
  stateTerritory: string;
  role: string;
  industry: string;
}

export function emptyForm(): UserForm {
  return {
    username: "",
    password: "",
    confirmPassword: "",
    firstName: "",
    lastName: "",
    email: "",
    organization: "",
    description: "",
    phoneNumber: "",
    // Java UserEditPanel.java:395 preselects "United States" for every new user
    // and its country combobox has no empty option, so a saved user always has a
    // country. Default to match (state stays empty — only meaningful for the US).
    country: "United States",
    stateTerritory: "",
    role: "",
    industry: "",
  };
}

export function userToForm(u: User): UserForm {
  return {
    username: u.username ?? "",
    password: "",
    confirmPassword: "",
    firstName: u.firstName ?? "",
    lastName: u.lastName ?? "",
    email: u.email ?? "",
    organization: u.organization ?? "",
    description: u.description ?? "",
    phoneNumber: u.phoneNumber ?? "",
    country: u.country ?? "",
    stateTerritory: u.stateTerritory ?? "",
    role: u.role ?? "",
    industry: u.industry ?? "",
  };
}

/**
 * Resolve a form's country/state to canonical values, mirroring Java's
 * UserEditPanel: the country JComboBox is preselected to "United States" and
 * `setSelectedItem(invalidValue)` is a no-op, so a blank or unrecognized country
 * always falls back to "United States" and can never be empty. State/Territory is
 * only meaningful when the country is United States, and is otherwise cleared
 * (also dropping any code not in the canonical US list).
 */
export function normalizeFormCountry(form: UserForm): UserForm {
  const canonicalCountries = new Set(getCountryOptions().map((o) => o.name));
  let country = form.country;
  if (!country || !canonicalCountries.has(country)) country = "United States";

  let stateTerritory = form.stateTerritory;
  if (country !== "United States") {
    stateTerritory = "";
  } else if (stateTerritory && !US_STATE_TERRITORY_CODES.includes(stateTerritory)) {
    stateTerritory = "";
  }

  return { ...form, country, stateTerritory };
}

// ─── Self-rename guard ─────────────────────────────────────────────────────────

export interface SelfRenameCheck {
  /** True when the edited account is the currently-logged-in user. */
  isSelf: boolean;
  /** True when the submitted username differs from the stored one. */
  usernameChanged: boolean;
  /** True when the save must be blocked: self-rename with no new password. */
  blocked: boolean;
}

/**
 * Decide how a user edit interacts with the current session, mirroring Java's
 * Frame.updateCurrentUser. "Self" is detected by the live session identity
 * (username matches Java's PlatformUI.USER_NAME comparison; userId is a robustness
 * fallback). A self-rename with no new password is blocked — Java warns
 * "If you are changing your username, you must also update your password." and aborts.
 */
export function checkSelfRename(
  session: SessionInfo | null,
  selectedUser: Pick<User, "id" | "username">,
  form: Pick<UserForm, "username" | "password">
): SelfRenameCheck {
  const isSelf =
    session != null &&
    (session.userId === selectedUser.id || session.username === selectedUser.username);
  const usernameChanged = form.username.trim() !== selectedUser.username;
  return { isSelf, usernameChanged, blocked: isSelf && usernameChanged && !form.password };
}

/** Client-side email validation. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Dropdown options (match Java UserEditPanel dropdowns exactly) ─────────────

/** Industry options — matches Java UserEditPanel dropdown exactly. */
export const INDUSTRIES = [
  "ACO",
  "CHC/FQHC",
  "Clinic",
  "HIE",
  "HIT Consulting",
  "HIT Software",
  "Hospital",
  "Lab",
  "Network",
  "Other",
  "Payer",
  "Physicians Group",
  "Private Practice",
  "Public Health Agency",
  "Radiology Center",
  "University",
];

/** Role options — matches Java UserEditPanel dropdown exactly (UserEditPanel.java:69–79). */
export const ROLES = [
  "C-Suite",
  "Consultant - Advisor",
  "Consultant - Engineer",
  "Consultant - Implementer",
  "Employee - Engineer",
  "Employee - Manager",
  "Employee - Director",
  "Employee - VP",
  "Independent Contractor",
  "Other",
];
