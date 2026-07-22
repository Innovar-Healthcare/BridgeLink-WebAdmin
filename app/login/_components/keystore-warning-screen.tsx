"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormCheckbox } from "@/components/ui/form-checkbox";

interface Props {
  /** True while the keystore regeneration request is in flight. */
  working: boolean;
  /**
   * Called when the user clicks OK. `regenerate` reflects the checkbox: when
   * true the caller regenerates the keystore before entering the app.
   */
  onOk: (regenerate: boolean) => void;
  /** Called when the user clicks "Remind me later" — enters the app, no changes. */
  onRemindLater: () => void;
}

/**
 * Default-keystore-password Security Warning screen — mirrors the Java client's
 * KeystoreWarningDialog shown from LoginPanel.handleSuccess() when the server
 * reports keystoreUsingDefaultPassword. Shown as the last post-login step, once
 * per login, with no persistent "don't show again". The regenerate
 * checkbox defaults checked (recommended); "Remind me later" re-shows next login.
 */
export function KeystoreWarningScreen({ working, onOk, onRemindLater }: Props) {
  const [regenerate, setRegenerate] = useState(true);

  return (
    <div className="p-8 space-y-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-orange-500" />
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Security Warning
          </h2>
          <p className="mt-2 text-sm font-medium text-gray-700 dark:text-gray-200">
            The keystore passwords for this BridgeLink instance are still set to default values.
          </p>
        </div>
      </div>

      <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
        <p>
          The keystore stores the SSL/TLS certificate for the BridgeLink API and Administrator (port
          8443).
        </p>
        <p>
          <span className="font-semibold">Note:</span> Channel message encryption (encryptData=true)
          and encrypted database passwords (encrypt.properties=true) are NOT affected — they use a
          separate AES key that is preserved during regeneration.
        </p>
        <p>
          <span className="font-semibold">Note:</span> BridgeLink must be restarted after
          regenerating the keystore for the new SSL certificate to take effect.
        </p>
      </div>

      <FormCheckbox
        checked={regenerate}
        onChange={setRegenerate}
        disabled={working}
        size="sm"
        label="Generate a new keystore with new passwords (recommended)"
      />

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onRemindLater}
          disabled={working}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-40"
        >
          Remind me later
        </button>
        <Button
          type="button"
          onClick={() => onOk(regenerate)}
          disabled={working}
          className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 border border-border px-5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {working ? "Regenerating…" : "OK"}
        </Button>
      </div>
    </div>
  );
}
