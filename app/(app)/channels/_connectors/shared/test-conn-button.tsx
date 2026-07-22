"use client";

/**
 * TestConnButton — renders a button for test-connection actions and shows the
 * result in a modal dialog (matching the Java client's JOptionPane pattern).
 *
 * Props:
 *   label          — button text, e.g. "Test Connection" or "Send Test Email"
 *   testing        — true while the async call is in-flight
 *   result         — null or { type: "SUCCESS"|"TIME_OUT"|"FAILURE", message: string }
 *   onTest         — called when the button is clicked
 *   onResultClose  — optional callback fired when the result dialog is dismissed.
 *                    If provided (typically `clearResult` from useTestConn), the
 *                    parent owns the result lifecycle and the dialog re-opens
 *                    automatically the next time `result` becomes non-null.
 *                    If omitted, the component manages local dismissal state.
 */

import { useState } from "react";
import type { TestConnResult } from "./use-test-conn";
import { TestConnResultDialog } from "./test-conn-result-dialog";

interface TestConnButtonProps {
  label: string;
  testing: boolean;
  result: TestConnResult | null;
  onTest: () => void;
  onResultClose?: () => void;
  disabled?: boolean;
}

export function TestConnButton({
  label,
  testing,
  result,
  onTest,
  onResultClose,
  disabled,
}: TestConnButtonProps) {
  // Track which result instance the user has dismissed. When a new result
  // arrives (different reference), the dialog re-opens automatically without
  // needing an effect to reset state.
  const [dismissedResult, setDismissedResult] = useState<TestConnResult | null>(null);
  const open = result !== null && result !== dismissedResult;

  function handleClose() {
    if (onResultClose) {
      onResultClose();
    } else {
      setDismissedResult(result);
    }
  }

  return (
    <>
      <button
        onClick={onTest}
        disabled={testing || disabled}
        className="px-3 py-1 text-sm rounded border border-border
          text-gray-700 dark:text-gray-300
          hover:bg-gray-50 dark:hover:bg-gray-700
          hover:border-border
          disabled:opacity-40 disabled:cursor-not-allowed
          transition-colors"
      >
        {testing ? "Testing…" : label}
      </button>
      <TestConnResultDialog open={open} result={result} onClose={handleClose} />
    </>
  );
}
