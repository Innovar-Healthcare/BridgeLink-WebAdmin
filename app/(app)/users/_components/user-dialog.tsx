"use client";

/**
 * Add/Edit user modal dialog.
 * Mirrors Java's UserDialog.java + UserEditPanel.java.
 *
 * New user:  password required; all other fields optional (matching Java behavior)
 * Edit user: password optional; leave both password fields empty to keep existing password
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";
import { X } from "lucide-react";
import { FormField } from "@/components/form-field";
import { SecretInput } from "@/components/ui/secret-input";
import { Combobox } from "@/components/ui/combobox";
import type { User } from "@/lib/types";
import {
  getCountryOptions,
  countryNameToCode,
  US_STATE_TERRITORY_CODES,
  validatePhoneNumber,
  formatPhoneNumber,
} from "@/lib/phone-util";
import {
  type UserForm,
  emptyForm,
  userToForm,
  normalizeFormCountry,
  EMAIL_RE,
  INDUSTRIES,
  ROLES,
} from "./user-types";

export type { UserForm };

const SELECT_H: Record<ViewDensity, string> = {
  comfortable: "h-9",
  default: "h-8",
  compact: "h-7",
};

interface UserDialogProps {
  mode: "new" | "edit";
  initialUser: User | null;
  existingUsers: User[];
  onSubmit: (form: UserForm) => Promise<void>;
  onClose: () => void;
}

export function UserDialog({
  mode,
  initialUser,
  existingUsers,
  onSubmit,
  onClose,
}: UserDialogProps) {
  const { viewDensity } = useCompactMode();
  const countryOptions = useMemo(
    () => getCountryOptions().map((o) => ({ value: o.name, label: o.name })),
    []
  );
  const [form, setForm] = useState<UserForm>(() => {
    const initial = mode === "edit" && initialUser ? userToForm(initialUser) : emptyForm();
    // Resolve country/state to canonical values. Matches Java's JComboBox: the country
    // model has no empty option and is preselected to "United States", so a blank or
    // unrecognized country falls back to "United States" (setSelectedItem of an invalid
    // value is a no-op) and state is only meaningful for the US.
    return normalizeFormCountry(initial);
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Focus username field on open
  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  function set(field: keyof UserForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  /** Client-side validation. Returns error string or null. */
  function validate(): string | null {
    if (!form.username.trim()) return "Username is required.";

    // Username uniqueness — exclude current user on edit
    const lowerName = form.username.trim().toLowerCase();
    const duplicate = existingUsers.find(
      (u) => u.username.toLowerCase() === lowerName && (mode === "new" || u.id !== initialUser?.id)
    );
    if (duplicate) return `Username "${form.username.trim()}" is already taken.`;

    // Password required for new users
    if (mode === "new" && !form.password) return "Password is required for new users.";

    // Password match
    if (form.password && form.password !== form.confirmPassword) {
      return "Passwords do not match.";
    }

    // Email format (if provided)
    if (form.email && !EMAIL_RE.test(form.email)) {
      return "Please enter a valid email address.";
    }

    // Phone validation (mirrors UserEditPanel.validateUser())
    if (form.phoneNumber.trim()) {
      if (!form.country) {
        return "Country field is required to validate phone number.";
      }
      const isoCode = countryNameToCode(form.country);
      if (!isoCode || !validatePhoneNumber(form.phoneNumber, isoCode)) {
        return "The phone number is invalid for the given Country and/or State/Territory.";
      }
    }

    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    // Normalize phone to INTERNATIONAL format before saving (mirrors formatPhoneNumber())
    let submittedForm = form;
    if (form.phoneNumber.trim() && form.country) {
      const isoCode = countryNameToCode(form.country);
      if (isoCode) {
        submittedForm = { ...form, phoneNumber: formatPhoneNumber(form.phoneNumber, isoCode) };
      }
    }

    setSaving(true);
    try {
      await onSubmit(submittedForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const isNew = mode === "new";
  const title = isNew ? "New User" : "Edit User";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">{title}</h2>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {/* Username — full width */}
            <div className="col-span-2">
              <FormField label="Username" required>
                <Input
                  ref={firstFieldRef}
                  density={viewDensity}
                  value={form.username}
                  onChange={(e) => set("username", e.target.value)}
                  autoComplete="off"
                  data-lpignore="true"
                  data-testid="user-username"
                  disabled={saving}
                />
              </FormField>
            </div>

            {/* Password */}
            <FormField label="New Password" required={isNew}>
              <SecretInput
                density={viewDensity}
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                placeholder={isNew ? "" : "Leave blank to keep current"}
                data-testid="user-password"
                disabled={saving}
              />
            </FormField>

            {/* Confirm Password */}
            <FormField label="Confirm New Password" required={isNew}>
              <SecretInput
                density={viewDensity}
                value={form.confirmPassword}
                onChange={(e) => set("confirmPassword", e.target.value)}
                placeholder={isNew ? "" : "Leave blank to keep current"}
                data-testid="user-confirm-password"
                disabled={saving}
              />
            </FormField>

            {/* First Name */}
            <FormField label="First Name">
              <Input
                type="text"
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                density={viewDensity}
                autoComplete="off"
                data-lpignore="true"
                disabled={saving}
              />
            </FormField>

            {/* Last Name */}
            <FormField label="Last Name">
              <Input
                type="text"
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
                density={viewDensity}
                autoComplete="off"
                data-lpignore="true"
                disabled={saving}
              />
            </FormField>

            {/* Email — full width */}
            <div className="col-span-2">
              <FormField label="Email">
                <Input
                  density={viewDensity}
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  autoComplete="off"
                  data-lpignore="true"
                  disabled={saving}
                />
              </FormField>
            </div>

            {/* Organization */}
            <FormField label="Organization">
              <Input
                type="text"
                value={form.organization}
                onChange={(e) => set("organization", e.target.value)}
                density={viewDensity}
                autoComplete="off"
                data-lpignore="true"
                disabled={saving}
              />
            </FormField>

            {/* Phone Number */}
            <FormField label="Phone Number">
              <Input
                type="tel"
                value={form.phoneNumber}
                onChange={(e) => {
                  // Reformat live as the user types (mirrors Java UserEditPanel.phoneKeyReleased).
                  // formatPhoneNumber no-ops on unparseable/partial input, so typing isn't blocked.
                  const raw = e.target.value;
                  const code = form.country ? countryNameToCode(form.country) : null;
                  set("phoneNumber", code ? formatPhoneNumber(raw, code) : raw);
                }}
                density={viewDensity}
                autoComplete="off"
                data-lpignore="true"
                disabled={saving}
              />
            </FormField>

            {/* Country — searchable dropdown matching Java's PhoneNumberUtil.getSupportedRegions() */}
            <FormField label="Country">
              <Combobox
                options={countryOptions}
                value={form.country}
                onChange={(v) => {
                  set("country", v);
                  // Clear state when switching away from United States (mirrors Java behavior)
                  if (v !== "United States") set("stateTerritory", "");
                  // Reformat the phone for the newly selected country (mirrors Java
                  // UserEditPanel.countryActionPerformed → formatPhoneNumber).
                  if (form.phoneNumber) {
                    const code = countryNameToCode(v);
                    if (code) set("phoneNumber", formatPhoneNumber(form.phoneNumber, code));
                  }
                }}
                // No empty placeholder: country is always a real value (defaults to
                // "United States"), matching Java's country combobox which has no empty option.
                placeholder=""
                disabled={saving}
                density={viewDensity}
              />
            </FormField>

            {/* State/Territory — dropdown enabled only when country is United States */}
            <FormField label="State/Territory">
              <select
                value={form.stateTerritory}
                onChange={(e) => set("stateTerritory", e.target.value)}
                disabled={saving || form.country !== "United States"}
                className={`${SELECT_H[viewDensity]} w-full rounded-md border border-input bg-background px-2.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring dark:bg-input/30 disabled:opacity-50`}
              >
                <option value="">— Select —</option>
                {US_STATE_TERRITORY_CODES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FormField>

            {/* Role */}
            <FormField label="Role">
              <select
                value={form.role}
                onChange={(e) => set("role", e.target.value)}
                className={`${SELECT_H[viewDensity]} w-full rounded-md border border-input bg-background px-2.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring dark:bg-input/30 disabled:opacity-50`}
                disabled={saving}
              >
                <option value="">— Select —</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </FormField>

            {/* Industry */}
            <FormField label="Business">
              <select
                value={form.industry}
                onChange={(e) => set("industry", e.target.value)}
                className={`${SELECT_H[viewDensity]} w-full rounded-md border border-input bg-background px-2.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring dark:bg-input/30 disabled:opacity-50`}
                disabled={saving}
              >
                <option value="">— Select —</option>
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </FormField>

            {/* Description — full width */}
            <div className="col-span-2">
              <FormField label="Description">
                <Textarea
                  density={viewDensity}
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  rows={2}
                  className="resize-none"
                  disabled={saving}
                />
              </FormField>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="mt-3 px-3 py-2 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded whitespace-pre-wrap">
              {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-1.5 text-sm bg-white dark:bg-gray-800 border border-border rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form=""
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : isNew ? "Create User" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
