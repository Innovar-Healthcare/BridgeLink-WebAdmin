"use client";

import { useEffect, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";

/**
 * Shared "relative vs. exact" date preference for the Version History commit lists.
 *
 *: the revision lists default to vague relative times ("about 1 month
 * ago"). This hook lets the user toggle to actual dates. The preference is
 * persisted to localStorage and broadcast across instances so every commit list
 * (Commits tab, channel history, entity history dialogs) stays in sync.
 */
export type CommitDateMode = "relative" | "absolute";

const KEY = "bl-vh-date-mode";
const MODE_EVENT = "bl-vh-date-mode-change";
const ABSOLUTE_FORMAT = "MMM d, yyyy HH:mm";

/** Exact date string, e.g. "Jan 15, 2026 14:32". */
export function absoluteCommitTime(timestamp: number): string {
  return format(new Date(timestamp), ABSOLUTE_FORMAT);
}

/** Relative date string, e.g. "about 1 month ago". */
export function relativeCommitTime(timestamp: number): string {
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
}

/** Format a commit timestamp according to the active date mode. */
export function formatCommitTime(timestamp: number, mode: CommitDateMode): string {
  return mode === "absolute" ? absoluteCommitTime(timestamp) : relativeCommitTime(timestamp);
}

export function useCommitDateMode() {
  const [mode, setMode] = useState<CommitDateMode>(() => {
    if (typeof window === "undefined") return "relative";
    const saved = localStorage.getItem(KEY);
    return saved === "absolute" || saved === "relative" ? saved : "relative";
  });

  // Stay in sync when any other useCommitDateMode() instance changes the value.
  useEffect(() => {
    const handler = (e: Event) => setMode((e as CustomEvent<CommitDateMode>).detail);
    window.addEventListener(MODE_EVENT, handler);
    return () => window.removeEventListener(MODE_EVENT, handler);
  }, []);

  function setDateMode(next: CommitDateMode) {
    setMode(next);
    localStorage.setItem(KEY, next);
    window.dispatchEvent(new CustomEvent<CommitDateMode>(MODE_EVENT, { detail: next }));
  }

  function toggleDateMode() {
    setDateMode(mode === "relative" ? "absolute" : "relative");
  }

  return { dateMode: mode, setDateMode, toggleDateMode };
}
