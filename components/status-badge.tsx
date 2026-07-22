import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { ViewDensity } from "@/lib/hooks/use-compact-mode";

type StatusVariant = "channel" | "message" | "eventLevel" | "eventOutcome";

interface StatusBadgeProps {
  status: string;
  variant?: StatusVariant;
  className?: string;
  density?: ViewDensity;
  /**
   * Optional override used for color lookup only; the displayed label/tooltip
   * still uses `status`. Lets callers render a state in a different color than
   * its default — e.g. a STARTED channel whose child connector isn't started is
   * shown with the orange (STARTING) color while still reading "STARTED",
   * mirroring Java's DashboardTableNode. Defaults to `status`.
   */
  colorStatus?: string;
}

const CHANNEL_DOT_COLORS: Record<string, string> = {
  STARTED: "bg-green-500",
  STARTING: "bg-orange-500",
  PAUSED: "bg-yellow-500",
  PAUSING: "bg-orange-500",
  STOPPED: "bg-red-500",
  STOPPING: "bg-orange-500",
  DEPLOYING: "bg-blue-500",
  UNDEPLOYING: "bg-purple-500",
  SYNCING: "bg-gray-400",
};

const CHANNEL_COLORS: Record<string, string> = {
  STARTED:
    "bg-green-100  text-green-800  border-green-300  dark:bg-green-900/30  dark:text-green-300  dark:border-green-700",
  STARTING:
    "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700",
  PAUSED:
    "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700",
  PAUSING:
    "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700",
  STOPPED:
    "bg-red-100    text-red-800    border-red-300    dark:bg-red-900/30    dark:text-red-300    dark:border-red-700",
  STOPPING:
    "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700",
  DEPLOYING:
    "bg-blue-100   text-blue-800   border-blue-300   dark:bg-blue-900/30   dark:text-blue-300   dark:border-blue-700",
  UNDEPLOYING:
    "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700",
  SYNCING: "bg-gray-100   text-gray-700   border-border   dark:bg-gray-700      dark:text-gray-300",
};

const MESSAGE_COLORS: Record<string, string> = {
  SENT: "bg-green-100  text-green-800  border-green-300  dark:bg-green-900/30  dark:text-green-300  dark:border-green-700",
  TRANSFORMED:
    "bg-blue-100   text-blue-800   border-blue-300   dark:bg-blue-900/30   dark:text-blue-300   dark:border-blue-700",
  RECEIVED:
    "bg-cyan-100   text-cyan-800   border-cyan-300   dark:bg-cyan-900/30   dark:text-cyan-300   dark:border-cyan-700",
  FILTERED:
    "bg-gray-100   text-gray-700   border-border   dark:bg-gray-700      dark:text-gray-300",
  QUEUED:
    "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700",
  ERROR:
    "bg-red-100    text-red-800    border-red-300    dark:bg-red-900/30    dark:text-red-300    dark:border-red-700",
  PENDING:
    "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700",
};

const EVENT_LEVEL_COLORS: Record<string, string> = {
  INFORMATION:
    "bg-blue-100   text-blue-800   border-blue-300   dark:bg-blue-900/30   dark:text-blue-300   dark:border-blue-700",
  WARNING:
    "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700",
  ERROR:
    "bg-red-100    text-red-800    border-red-300    dark:bg-red-900/30    dark:text-red-300    dark:border-red-700",
};

const EVENT_OUTCOME_COLORS: Record<string, string> = {
  SUCCESS:
    "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700",
  FAILURE:
    "bg-red-100   text-red-800   border-red-300   dark:bg-red-900/30   dark:text-red-300   dark:border-red-700",
  UNKNOWN: "bg-gray-100  text-gray-700  border-border  dark:bg-gray-700     dark:text-gray-300",
};

function getColor(status: string, variant?: StatusVariant): string {
  const map =
    variant === "message"
      ? MESSAGE_COLORS
      : variant === "eventLevel"
        ? EVENT_LEVEL_COLORS
        : variant === "eventOutcome"
          ? EVENT_OUTCOME_COLORS
          : CHANNEL_COLORS;
  return (
    map[status] ?? "bg-gray-100 text-gray-700 border-border dark:bg-gray-700 dark:text-gray-300"
  );
}

export function StatusBadge({
  status,
  variant,
  className,
  density,
  colorStatus,
}: StatusBadgeProps) {
  const colorKey = colorStatus ?? status;
  if (density !== "comfortable" && density !== undefined && variant === "channel") {
    const dotColor = CHANNEL_DOT_COLORS[colorKey] ?? "bg-gray-400";
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex items-center justify-center", className)}>
            <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", dotColor)} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{status}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border overflow-hidden",
        getColor(colorKey, variant),
        className
      )}
    >
      {status}
    </span>
  );
}
