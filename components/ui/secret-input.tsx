"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { HoverTooltip } from "@/components/hover-tooltip";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";

interface SecretInputProps extends Omit<React.ComponentProps<"input">, "type"> {
  /** Show a reveal/hide toggle button. Default false. */
  revealable?: boolean;
  /** View density — passed through to the inner Input. */
  density?: ViewDensity;
  /** Optional help text shown as a HoverTooltip when the user hovers the field. */
  tooltip?: string;
}

function SecretInput({
  revealable = false,
  className,
  density,
  tooltip,
  ...props
}: SecretInputProps) {
  const [revealed, setRevealed] = React.useState(false);
  const field = (
    <div className="relative">
      <Input
        type="text"
        density={density}
        autoComplete="off"
        className={cn(
          !revealed && "[-webkit-text-security:disc] [text-security:disc]",
          revealable && "pr-9",
          className
        )}
        {...props}
      />
      {revealable && (
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground"
          tabIndex={-1}
          aria-label={revealed ? "Hide" : "Show"}
        >
          {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      )}
    </div>
  );

  // Hover the field to show the help text — no inline help icon.
  return tooltip ? <HoverTooltip content={tooltip}>{field}</HoverTooltip> : field;
}

export { SecretInput };
