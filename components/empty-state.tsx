import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Primary message shown when no data exists. */
  message: string;
  /** Alternative message shown when filters are active. If omitted, `message` is always used. */
  filterMessage?: string;
  /** Whether any filter is currently active — controls which message to show. */
  hasFilter?: boolean;
  /** Optional icon rendered above the message. */
  icon?: React.ReactNode;
  /** Optional secondary text rendered smaller below the primary message. */
  description?: string;
  /** Layout variant. "table" = py-16; "panel" = p-8. Default: "table" */
  variant?: "table" | "panel";
  className?: string;
}

export function EmptyState({
  message,
  filterMessage,
  hasFilter = false,
  icon,
  description,
  variant = "table",
  className,
}: EmptyStateProps) {
  const displayMessage = hasFilter && filterMessage ? filterMessage : message;

  const paddingClass = variant === "panel" ? "p-8" : "py-16";

  return (
    <div
      className={cn(
        paddingClass,
        "text-gray-400 dark:text-gray-500",
        icon ? "flex flex-col items-center gap-3" : "text-center",
        className
      )}
    >
      {icon}
      <span className="text-sm">{displayMessage}</span>
      {description && <span className="text-xs mt-1">{description}</span>}
    </div>
  );
}
