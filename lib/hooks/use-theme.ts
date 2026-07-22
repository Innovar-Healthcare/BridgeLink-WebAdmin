"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "bl-theme";
// Custom event name — dispatched on window so every useTheme() instance on the
// page stays in sync when any one of them calls toggle().
const THEME_EVENT = "bl-theme-change";

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    // Read saved preference immediately (lazy init avoids a setState-in-effect)
    if (typeof window === "undefined") return "light";
    const saved = (localStorage.getItem(KEY) as Theme) ?? "light";
    applyTheme(saved);
    return saved;
  });

  // Stay in sync when any other useTheme() instance calls toggle()
  useEffect(() => {
    const handler = (e: Event) => {
      setTheme((e as CustomEvent<Theme>).detail);
    };
    window.addEventListener(THEME_EVENT, handler);
    return () => window.removeEventListener(THEME_EVENT, handler);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem(KEY, next);
    applyTheme(next);
    // Notify every other useTheme() instance on this page
    window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: next }));
  }

  return { theme, isDark: theme === "dark", toggle };
}
