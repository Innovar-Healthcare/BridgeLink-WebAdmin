import * as React from "react";

import { cn } from "@/lib/utils";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";

/** Height + horizontal padding per density level. */
const DENSITY_CLASSES: Record<ViewDensity, string> = {
  comfortable: "h-9 px-3",
  default: "h-8 px-2.5",
  compact: "h-7 px-2",
};

interface InputProps extends React.ComponentProps<"input"> {
  /**
   * View density override. When provided the input height and horizontal padding adjust:
   * - comfortable: h-9 px-3  (same as default shadcn size)
   * - default:     h-8 px-2.5
   * - compact:     h-7 px-2
   *
   * When omitted the original shadcn default (h-9 px-3 py-1) is used.
   */
  density?: ViewDensity;
}

function Input({ className, type, density, onWheel, ...props }: InputProps) {
  function handleWheel(e: React.WheelEvent<HTMLInputElement>) {
    onWheel?.(e);
    if (type === "number" && !e.defaultPrevented) {
      e.currentTarget.blur();
    }
  }

  return (
    <input
      type={type}
      data-slot="input"
      onWheel={handleWheel}
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input w-full min-w-0 rounded-md border bg-background text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        density ? DENSITY_CLASSES[density] : "h-9 px-3 py-1",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );
}

export { Input };
export type { InputProps };
