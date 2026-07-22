"use client";

import { useState } from "react";

interface CommittedNumberInputProps {
  /** The last committed integer value (the source of truth this input mirrors). */
  value: number;
  /** Called with the parsed value on blur when it is valid and differs from `value`. */
  onCommit: (n: number) => void;
  /** Inclusive minimum a value must meet to commit (default 1). */
  min?: number;
  disabled?: boolean;
  className?: string;
  title?: string;
  "data-testid"?: string;
}

/**
 * Integer `<input>` that permits free typing — including clearing the field mid-edit — and only
 * commits on blur when the value parses and is >= `min`. On an empty/invalid blur it reverts to the
 * last committed value. This mirrors the Java client's fields, which free-type and validate on OK
 * rather than snapping back on every keystroke and refusing to be cleared #59).
 */
export function CommittedNumberInput({
  value,
  onCommit,
  min = 1,
  disabled,
  className,
  title,
  "data-testid": testId,
}: CommittedNumberInputProps) {
  const [text, setText] = useState(String(value));
  const [committed, setCommitted] = useState(value);

  // Resync the editable text when the committed value changes externally (adjust state during
  // render — the pattern used elsewhere in this editor for derived-from-prop state).
  if (value !== committed) {
    setCommitted(value);
    setText(String(value));
  }

  function commit() {
    const n = parseInt(text, 10);
    if (!isNaN(n) && n >= min) {
      if (n !== value) onCommit(n);
      setText(String(n));
    } else {
      setText(String(value));
    }
  }

  return (
    <input
      type="number"
      min={min}
      value={text}
      disabled={disabled}
      title={title}
      data-testid={testId}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      className={className}
    />
  );
}
