"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SecretInput } from "@/components/ui/secret-input";
import { updateUserPassword } from "@/lib/api/api-users";
import type { User } from "@/lib/types";

interface Props {
  user: User;
  gracePeriodMsg: string;
  onSuccess: () => void;
  onLogout: () => void;
}

export function ChangePasswordScreen({ user, gracePeriodMsg, onSuccess, onLogout }: Props) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const errors = await updateUserPassword(user.id, newPassword);
      if (errors.length > 0) {
        setError(errors.join(" "));
        return;
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-8 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Password Expired</h2>
        {gracePeriodMsg && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded px-3 py-2">
            {gracePeriodMsg}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label
          htmlFor="cp-new-password"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          New Password
        </Label>
        <SecretInput
          id="cp-new-password"
          revealable
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>

      <div className="space-y-1">
        <Label
          htmlFor="cp-confirm-password"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Confirm New Password
        </Label>
        <SecretInput
          id="cp-confirm-password"
          revealable
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>

      {error && (
        <div className="rounded bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onLogout}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          Log out
        </button>
        <Button
          type="submit"
          disabled={loading || !newPassword || !confirmPassword}
          className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 border border-border px-5"
        >
          {loading ? "Saving…" : "Change Password"}
        </Button>
      </div>
    </form>
  );
}
