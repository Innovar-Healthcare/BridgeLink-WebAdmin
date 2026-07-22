"use client";

import type { ReactNode } from "react";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";

interface FormFieldProps {
  label: string;
  required?: boolean;
  children: ReactNode;
  /** View density — affects gap between label and input, and label font size. */
  density?: ViewDensity;
}

/**
 * Labelled form field wrapper shared across pages that render user-facing forms.
 * Defined as a top-level export so React preserves component identity across renders.
 */
export function FormField({ label, required, children, density }: FormFieldProps) {
  const gap = density === "comfortable" ? "gap-1.5" : density === "compact" ? "gap-0.5" : "gap-1";
  const labelSize = density === "comfortable" ? "text-sm" : "text-xs";
  return (
    <div className={`flex flex-col ${gap}`}>
      <label className={`${labelSize} font-medium text-gray-600 dark:text-gray-400`}>
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
