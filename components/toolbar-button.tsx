import type { ReactNode } from "react";
import { HoverTooltip } from "@/components/hover-tooltip";

const TBTN_VARIANTS = {
  default:
    "bg-white dark:bg-gray-800 border border-border hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300",
  primary: "bg-blue-600 border border-blue-600 hover:bg-blue-700 text-white",
  destructive:
    "bg-white dark:bg-gray-800 border border-red-300 dark:border-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400",
  accent:
    "bg-white dark:bg-gray-800 border border-blue-300 dark:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600 dark:text-blue-400",
  orange:
    "bg-white dark:bg-gray-800 border border-orange-300 dark:border-orange-700 hover:bg-orange-50 dark:hover:bg-orange-900/20 text-orange-600 dark:text-orange-400",
};

export type TBtnVariant = keyof typeof TBTN_VARIANTS;

/** Compact toolbar button used in table action bars. */
export function TBtn({
  onClick,
  disabled,
  title,
  icon,
  label,
  variant = "default",
  className: extraCls,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: ReactNode;
  icon?: ReactNode;
  label: string;
  variant?: TBtnVariant;
  className?: string;
}) {
  return (
    <HoverTooltip content={title ?? label}>
      {/* Call onClick() with no args so the DOM MouseEvent is never forwarded. onClick is typed
          () => void, but a handler that happens to take an optional positional param would otherwise
          capture the event in that slot — the toolbar-Resend bug. Wrapping here fixes the
          whole class for every AdaptiveBtn/TBtn/VBtn consumer. */}
      <button
        onClick={() => onClick()}
        disabled={disabled}
        className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap ${TBTN_VARIANTS[variant]}${extraCls ? ` ${extraCls}` : ""}`}
      >
        {icon}
        {label}
      </button>
    </HoverTooltip>
  );
}

/** Thin vertical divider for toolbar button groups. */
export function TDivider() {
  return <span className="w-px h-5 bg-border mx-0.5 shrink-0" />;
}

// Variant styles for the vertical side-panel buttons — slightly elevated against dark:bg-gray-900
const VBTN_VARIANTS: Record<TBtnVariant, string> = {
  default:
    "bg-gray-50 dark:bg-gray-700 border border-border hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200",
  primary: "bg-blue-600 border border-blue-600 hover:bg-blue-700 text-white",
  destructive:
    "bg-gray-50 dark:bg-gray-700 border border-red-300 dark:border-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400",
  accent:
    "bg-gray-50 dark:bg-gray-700 border border-blue-300 dark:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400",
  orange:
    "bg-gray-50 dark:bg-gray-700 border border-orange-300 dark:border-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/30 text-orange-600 dark:text-orange-400",
};

/** Compact vertical toolbar button for side-panel action strips. */
export function VBtn({
  onClick,
  disabled,
  title,
  icon,
  label,
  variant = "default",
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: ReactNode;
  icon?: ReactNode;
  label: string;
  variant?: TBtnVariant;
}) {
  return (
    <HoverTooltip content={title ?? label} side="right">
      {/* Call onClick() with no args so the DOM MouseEvent is never forwarded (see TBtn /. */}
      <button
        onClick={() => onClick()}
        disabled={disabled}
        className={`flex flex-col items-center gap-0.5 w-full px-1 py-1.5 text-[10px] leading-tight rounded disabled:opacity-40 disabled:cursor-not-allowed ${VBTN_VARIANTS[variant]}`}
      >
        {icon}
        <span>{label}</span>
      </button>
    </HoverTooltip>
  );
}

/** Returns the raw CSS class string for a TBtn variant (for custom button elements). */
export function tBtnVariantClass(variant: TBtnVariant = "default"): string {
  return `flex items-center gap-1 px-2.5 py-1.5 text-xs rounded disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap ${TBTN_VARIANTS[variant]}`;
}

/** Renders VBtn (vertical) or TBtn (horizontal) based on orientation. */
export function AdaptiveBtn(props: {
  onClick: () => void;
  disabled?: boolean;
  title?: ReactNode;
  icon?: ReactNode;
  label: string;
  variant?: TBtnVariant;
  orientation: "vertical" | "horizontal";
}) {
  const { orientation, ...rest } = props;
  return orientation === "vertical" ? <VBtn {...rest} /> : <TBtn {...rest} />;
}

/** Separator that adapts to toolbar orientation. */
export function AdaptiveSeparator({ orientation }: { orientation: "vertical" | "horizontal" }) {
  return orientation === "vertical" ? (
    <span className="w-full h-px bg-border my-0.5" />
  ) : (
    <TDivider />
  );
}
