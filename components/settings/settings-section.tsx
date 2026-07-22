"use client";

/**
 * SettingsSection — reusable titled bordered panel matching Java's TitledBorder pattern.
 * Used consistently across all Settings tabs and Edit Channel for grouping related fields.
 * Always collapsible (expanded by default). Uses a div+header pattern (not fieldset/legend)
 * so the top border is always fully visible.
 */

import { createContext, useContext, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { useSessionState } from "@/lib/hooks/use-session-state";
import { useCompactMode, type ViewDensity } from "@/lib/hooks/use-compact-mode";
import { HoverTooltip } from "@/components/hover-tooltip";

/** Context that lets SettingsSection inject a label width for all child FieldRows. */
const LabelWidthContext = createContext("w-[220px]");

/** Named export so plugins can wrap their own panels in a custom label width. */
export function LabelWidthProvider({
  width,
  children,
}: {
  width: string;
  children: React.ReactNode;
}) {
  return <LabelWidthContext.Provider value={width}>{children}</LabelWidthContext.Provider>;
}

/** Context that propagates view density to all child FieldRows. */
const CompactContext = createContext<ViewDensity>("default");

interface SettingsSectionProps {
  title: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
  /** Initial expanded state. Defaults to true. */
  defaultExpanded?: boolean;
  /** Persist collapse state to sessionStorage under this key. */
  storageKey?: string;
  /** ReactNode shown in the header when the section is collapsed. */
  summary?: React.ReactNode;
  /** ReactNode rendered inline after the title (e.g. an info/help icon button). */
  info?: React.ReactNode;
  /**
   * Tailwind width class for the label column in child FieldRows.
   * Defaults to w-[220px] (suitable for channel connector labels).
   * Pass w-[340px] for settings pages that have longer labels.
   */
  labelWidth?: string;
  /** Called when the section transitions from collapsed → expanded. */
  onExpand?: () => void;
}

export function SettingsSection({
  title,
  icon: Icon,
  children,
  className = "",
  defaultExpanded = true,
  storageKey,
  summary,
  info,
  labelWidth = "w-[220px]",
  onExpand,
}: SettingsSectionProps) {
  const { viewDensity } = useCompactMode();
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  const [sessionExpanded, setSessionExpanded] = useSessionState(
    storageKey ?? "__unused__",
    defaultExpanded
  );

  const expanded = storageKey ? sessionExpanded : localExpanded;
  const setExpanded = storageKey ? setSessionExpanded : setLocalExpanded;

  const px = viewDensity === "comfortable" ? "px-4" : viewDensity === "compact" ? "px-2" : "px-3";
  const headerPy =
    viewDensity === "comfortable" ? "py-1.5" : viewDensity === "compact" ? "py-1" : "py-1";
  const contentPb =
    viewDensity === "comfortable" ? "pb-4" : viewDensity === "compact" ? "pb-2" : "pb-3";
  const contentPt =
    viewDensity === "comfortable" ? "pt-2" : viewDensity === "compact" ? "pt-1" : "pt-1.5";
  const innerGap =
    viewDensity === "comfortable"
      ? "space-y-1.5"
      : viewDensity === "compact"
        ? "space-y-0.5"
        : "space-y-1";

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) onExpand?.();
  };

  return (
    <div className={`border-2 border-border rounded-lg bg-muted ${className}`}>
      {/* role="button" rather than a real <button> so an interactive `info` node
          (e.g. a help-icon button) isn't nested inside a button — that is invalid
          HTML and causes a hydration error. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        className={`flex items-center gap-1.5 w-full text-left cursor-pointer select-none ${px} ${headerPy}`}
      >
        {Icon && <Icon size={16} className="text-gray-400 dark:text-gray-500 shrink-0" />}
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</span>
        {info && (
          <span onClick={(e) => e.stopPropagation()} className="flex items-center">
            {info}
          </span>
        )}
        {!expanded && summary && (
          <span className="flex items-center gap-1.5 ml-2 font-normal text-sm">{summary}</span>
        )}
        <ChevronDown
          size={14}
          className={`ml-auto text-gray-400 dark:text-gray-500 transition-transform duration-150 ${expanded ? "" : "-rotate-90"}`}
        />
      </div>
      {expanded && (
        <div className={`${px} ${contentPb} ${contentPt} ${innerGap}`}>
          <CompactContext.Provider value={viewDensity}>
            <LabelWidthContext.Provider value={labelWidth}>{children}</LabelWidthContext.Provider>
          </CompactContext.Provider>
        </div>
      )}
    </div>
  );
}

/**
 * SummaryChip — tiny badge shown in a collapsed SettingsSection header.
 * Displays a label:value pair (or just a value) at a glance.
 */
interface SummaryChipProps {
  label?: string;
  value: string;
}

export function SummaryChip({ label, value }: SummaryChipProps) {
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-white dark:bg-gray-700 border border-border rounded px-1.5 py-0.5 text-gray-500 dark:text-gray-400">
      {label && <span className="text-gray-400 dark:text-gray-500">{label}:</span>}
      <span className="font-medium text-gray-600 dark:text-gray-300">{value}</span>
    </span>
  );
}

/**
 * FullWidthField — label above + content spanning full panel width.
 * Use for large text areas (templates, SQL, SOAP envelopes, message bodies)
 * where the side-label layout wastes too much horizontal space.
 */
interface FullWidthFieldProps {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Optional help text shown as a HoverTooltip when the user hovers the control. */
  tooltip?: string;
}

export function FullWidthField({ label, children, className = "", tooltip }: FullWidthFieldProps) {
  return (
    <div className={`flex flex-col gap-1 pt-1 ${className}`}>
      <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
      {/*
       * Hover the control to show the help tooltip — matches the rest of the app's
       * HoverTooltip-on-control pattern, no inline help icon. The trigger is a
       * block-level span so the tooltip anchors over the full-width content.
       */}
      {tooltip ? (
        <HoverTooltip content={tooltip}>
          <span className="block">{children}</span>
        </HoverTooltip>
      ) : (
        children
      )}
    </div>
  );
}

/**
 * FieldRow — single label + control row within a SettingsSection.
 * Label is right-aligned (matching Java MigLayout "right" pattern).
 */
interface FieldRowProps {
  label: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
  /** Tailwind width class for the label column. Defaults to w-[220px]. */
  labelWidth?: string;
  /** Optional help text shown as a HoverTooltip when the user hovers the control. */
  tooltip?: string;
}

export function FieldRow({
  label,
  htmlFor,
  children,
  className = "",
  labelWidth,
  tooltip,
}: FieldRowProps) {
  const contextWidth = useContext(LabelWidthContext);
  const density = useContext(CompactContext);
  const width = labelWidth ?? contextWidth;
  const minH =
    density === "comfortable"
      ? "min-h-[32px]"
      : density === "compact"
        ? "min-h-[24px]"
        : "min-h-[28px]";
  const gap = density === "comfortable" ? "gap-3" : density === "compact" ? "gap-1.5" : "gap-2";
  return (
    <div className={`flex items-center ${gap} ${minH} ${className}`}>
      <label
        htmlFor={htmlFor}
        className={`text-sm text-gray-600 dark:text-gray-400 text-right shrink-0 ${width}`}
      >
        {label}
      </label>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {/*
         * Hover the control (the field itself) to show the help tooltip — matches
         * the rest of the app's HoverTooltip-on-control pattern, no inline help icon.
         * The trigger is a content-width inline-flex span hugging the control, so the
         * tooltip anchors over the field instead of centering across the full-width row.
         */}
        {tooltip ? (
          <HoverTooltip content={tooltip}>
            <span className="inline-flex items-center gap-2">{children}</span>
          </HoverTooltip>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/**
 * RadioField — Yes/No (or Yes/No/Ask) inline radio group.
 * Extracted pattern from the many radio fields across all Settings tabs.
 */
interface RadioOption {
  value: string;
  label: string;
}

interface RadioFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options?: RadioOption[];
  disabled?: boolean;
  name: string;
  /** Optional help text shown as a HoverTooltip when the user hovers the control. */
  tooltip?: string;
}

const YES_NO: RadioOption[] = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

export function RadioField({
  label,
  value,
  onChange,
  options = YES_NO,
  disabled = false,
  name,
  tooltip,
}: RadioFieldProps) {
  return (
    <FieldRow label={label} tooltip={tooltip}>
      <div className="flex items-center gap-4">
        {options.map((opt) => (
          <label
            key={opt.value}
            className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              disabled={disabled}
              className="accent-blue-600"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </FieldRow>
  );
}
