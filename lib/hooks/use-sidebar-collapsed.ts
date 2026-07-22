"use client";

import { useEffect, useState } from "react";

const KEY = "bl-sidebar-collapsed";
const SIDEBAR_EVENT = "bl-sidebar-change";

export function useSidebarCollapsed() {
  const [collapsed, setCollapsedState] = useState(
    // Read saved preference immediately (lazy init avoids a setState-in-effect)
    () => typeof window !== "undefined" && localStorage.getItem(KEY) === "true"
  );

  // Stay in sync when any other useSidebarCollapsed() instance changes the value
  useEffect(() => {
    const handler = (e: Event) => {
      setCollapsedState((e as CustomEvent<boolean>).detail);
    };
    window.addEventListener(SIDEBAR_EVENT, handler);
    return () => window.removeEventListener(SIDEBAR_EVENT, handler);
  }, []);

  function setCollapsed(next: boolean) {
    setCollapsedState(next);
    localStorage.setItem(KEY, String(next));
    window.dispatchEvent(new CustomEvent<boolean>(SIDEBAR_EVENT, { detail: next }));
  }

  function toggleCollapsed() {
    setCollapsed(!collapsed);
  }

  return { collapsed, setCollapsed, toggleCollapsed };
}
