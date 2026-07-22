"use client";

import { useEffect, useState } from "react";
import {
  subscribe,
  getDrawerState,
  openDrawer,
  closeDrawer,
  setDrawerSubtitle,
} from "@/lib/drawer-store";

export function useDrawer() {
  const [state, setState] = useState(getDrawerState);

  useEffect(() => subscribe(() => setState(getDrawerState())), []);

  return {
    activeSlug: state.activeSlug,
    subtitle: state.subtitle,
    openDrawer,
    closeDrawer,
    setDrawerSubtitle,
  };
}
