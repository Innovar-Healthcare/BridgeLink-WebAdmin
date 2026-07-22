"use client";

import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { useBackgroundColor } from "@/lib/hooks/use-background-color";
import { useColorPlacement } from "@/lib/hooks/use-color-placement";
import { readableForegroundFor } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  const { viewDensity } = useCompactMode();
  const bgColor = useBackgroundColor();
  const { colorPlacement } = useColorPlacement();

  const px = viewDensity === "comfortable" ? "px-6" : viewDensity === "compact" ? "px-2" : "px-4";
  const py = viewDensity === "comfortable" ? "py-4" : viewDensity === "compact" ? "py-2" : "py-3";
  const titleSize =
    viewDensity === "comfortable" ? "text-lg" : viewDensity === "compact" ? "text-sm" : "text-base";
  const subtitleSize = viewDensity === "compact" ? "text-xs" : "text-sm";

  const isTinted = colorPlacement === "page-header" && !!bgColor;
  const fg = isTinted && bgColor ? readableForegroundFor(bgColor) : null;

  const containerStyle = isTinted && bgColor ? { backgroundColor: bgColor } : undefined;
  const titleColor =
    fg === "white" ? "text-white" : fg === "black" ? "text-gray-900" : "text-brand-title";
  const subtitleColor =
    fg === "white" ? "text-white/70" : fg === "black" ? "text-gray-600" : "text-gray-600";

  return (
    <div
      className={`flex items-center justify-between ${px} ${py} border-b ${isTinted ? "border-transparent" : "border-brand-header-border bg-brand-header-bg"}`}
      style={containerStyle}
    >
      <div>
        <h1 className={`${titleSize} font-bold ${titleColor}`}>{title}</h1>
        {/* suppressHydrationWarning: subtitle may contain client-only timestamps */}
        {subtitle && (
          <p className={`${subtitleSize} ${subtitleColor} mt-0.5`} suppressHydrationWarning>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
