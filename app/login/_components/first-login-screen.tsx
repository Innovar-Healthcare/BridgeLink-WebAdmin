"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { FormField } from "@/components/form-field";
import { updateUser, updateUserPassword } from "@/lib/api/api-users";
import { setUserPreference } from "@/lib/api/api-settings";
import { INDUSTRIES, ROLES } from "@/app/(app)/users/_components/user-types";
import type { User } from "@/lib/types";

interface Props {
  user: User;
  /** Non-empty when the login was SUCCESS_GRACE_PERIOD — makes password fields required. */
  gracePeriodMsg: string;
  onSuccess: () => void;
  onLogout: () => void;
}

// First-login screen hard-codes compact density regardless of the global setting:
// the dialog must fit on 1920x1080 without scrolling, and a first-time user has
// no opportunity to adjust the global density before reaching this screen.
const DENSITY = "compact" as const;
const SELECT_CLASS =
  "h-7 w-full rounded-md border border-input bg-background px-2.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring dark:bg-input/30 disabled:opacity-50";

export function FirstLoginScreen({ user, gracePeriodMsg, onSuccess, onLogout }: Props) {
  const passwordRequired = gracePeriodMsg !== "";

  // Profile fields
  const [username, setUsername] = useState(user.username);
  const [firstName, setFirstName] = useState(user.firstName ?? "");
  const [lastName, setLastName] = useState(user.lastName ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [organization, setOrganization] = useState(user.organization ?? "");
  const [phoneNumber, setPhoneNumber] = useState(user.phoneNumber ?? "");
  const [industry, setIndustry] = useState(user.industry ?? "");
  const [country, setCountry] = useState(user.country ?? "");
  const [stateTerritory, setStateTerritory] = useState(user.stateTerritory ?? "");
  const [role, setRole] = useState(user.role ?? "");

  // Password fields
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!username.trim()) {
      setError("Username is required.");
      return;
    }
    if (passwordRequired && !newPassword) {
      setError("You must set a new password before continuing.");
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await updateUser(user.id, {
        id: user.id,
        username: username.trim(),
        firstName,
        lastName,
        email,
        organization,
        description: user.description ?? "",
        phoneNumber,
        industry,
        country,
        stateTerritory,
        role,
        strikeCount: user.strikeCount,
      });

      if (newPassword) {
        const errors = await updateUserPassword(user.id, newPassword);
        if (errors.length > 0) {
          setError(errors.join(" "));
          return;
        }
      }

      await setUserPreference(user.id, "firstlogin", "false");

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col"
      style={{ maxHeight: "calc(100vh - 8rem)" }}
    >
      {/* Compact header */}
      <div className="px-5 py-2.5 border-b border-border shrink-0">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
          Welcome to BridgeLink
        </h2>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {passwordRequired
            ? "Set a new password and review your profile to continue."
            : "Please complete your profile. All fields are optional unless noted."}
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-3">
        {/* Grace-period warning — pinned just under the header so it's always visible */}
        {passwordRequired && (
          <div className="mb-3 rounded border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
            {gracePeriodMsg}
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {/* Username — editable on first login */}
          <div className="col-span-2">
            <FormField label="Username" required density={DENSITY}>
              <Input
                density={DENSITY}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                data-lpignore="true"
                disabled={loading}
                required
              />
            </FormField>
          </div>

          {/* New Password */}
          <FormField label="New Password" required={passwordRequired} density={DENSITY}>
            <SecretInput
              density={DENSITY}
              revealable
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required={passwordRequired}
              placeholder={passwordRequired ? "" : "Leave blank to keep current"}
              disabled={loading}
            />
          </FormField>

          {/* Confirm Password */}
          <FormField label="Confirm Password" required={passwordRequired} density={DENSITY}>
            <SecretInput
              density={DENSITY}
              revealable
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required={passwordRequired}
              placeholder={passwordRequired ? "" : "Leave blank to keep current"}
              disabled={loading}
            />
          </FormField>

          {/* First Name */}
          <FormField label="First Name" density={DENSITY}>
            <Input
              density={DENSITY}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="off"
              data-lpignore="true"
              disabled={loading}
            />
          </FormField>

          {/* Last Name */}
          <FormField label="Last Name" density={DENSITY}>
            <Input
              density={DENSITY}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="off"
              data-lpignore="true"
              disabled={loading}
            />
          </FormField>

          {/* Email — col-span-2 */}
          <div className="col-span-2">
            <FormField label="Email" density={DENSITY}>
              <Input
                density={DENSITY}
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                data-lpignore="true"
                disabled={loading}
              />
            </FormField>
          </div>

          {/* Country */}
          <FormField label="Country" density={DENSITY}>
            <Input
              density={DENSITY}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              autoComplete="off"
              data-lpignore="true"
              disabled={loading}
            />
          </FormField>

          {/* State/Territory */}
          <FormField label="State/Territory" density={DENSITY}>
            <Input
              density={DENSITY}
              value={stateTerritory}
              onChange={(e) => setStateTerritory(e.target.value)}
              autoComplete="off"
              data-lpignore="true"
              disabled={loading}
            />
          </FormField>

          {/* Phone Number */}
          <FormField label="Phone Number" density={DENSITY}>
            <Input
              density={DENSITY}
              type="text"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              autoComplete="off"
              data-lpignore="true"
              disabled={loading}
            />
          </FormField>

          {/* Organization */}
          <FormField label="Organization" density={DENSITY}>
            <Input
              density={DENSITY}
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              autoComplete="off"
              data-lpignore="true"
              disabled={loading}
            />
          </FormField>

          {/* Role */}
          <FormField label="Role" density={DENSITY}>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={SELECT_CLASS}
              disabled={loading}
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
          <FormField label="Business (Industry)" density={DENSITY}>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className={SELECT_CLASS}
              disabled={loading}
            >
              <option value="">— Select —</option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {error && (
          <div className="mt-3 rounded border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/30 px-3 py-1.5 text-xs text-red-700 dark:text-red-400">
            {error}
          </div>
        )}
      </div>

      {/* Sticky footer */}
      <div className="flex items-center justify-between px-5 py-2.5 border-t border-border bg-white dark:bg-gray-800 shrink-0">
        <button
          type="button"
          onClick={onLogout}
          disabled={loading}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-40"
        >
          Log out
        </button>
        <Button
          type="submit"
          disabled={loading}
          data-testid="first-login-submit"
          className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 border border-border px-5"
        >
          {loading ? "Saving…" : "Save & Continue"}
        </Button>
      </div>
    </form>
  );
}
