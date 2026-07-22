"use client";

/**
 * NavigatingRouterProvider + useNavigatingRouter
 *
 * Wraps Next.js router.push() in React's startTransition so that isPending
 * stays true for the entire duration of the route transition (including
 * Next.js dev-mode compilation). This is the correct App Router approach
 * for tracking in-progress navigations.
 *
 * Usage:
 *   // 1. Mount provider in layout (wraps the whole app)
 *   <NavigatingRouterProvider>...</NavigatingRouterProvider>
 *
 *   // 2. In any client component that needs to navigate:
 *   const { push } = useNavigatingRouter();
 *   push("/messages?channelId=...");
 *
 *   // 3. NavigationProgress reads isPending from the same context.
 */

import { createContext, useCallback, useContext, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

interface NavigatingRouterContextValue {
  isPending: boolean;
  push: (url: string) => void;
}

const NavigatingRouterContext = createContext<NavigatingRouterContextValue>({
  isPending: false,
  push: () => {},
});

export function NavigatingRouterProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const push = useCallback(
    (url: string) => {
      startTransition(() => {
        router.push(url);
      });
    },
    [router, startTransition]
  );

  return (
    <NavigatingRouterContext.Provider value={{ isPending, push }}>
      {children}
    </NavigatingRouterContext.Provider>
  );
}

export function useNavigatingRouter() {
  return useContext(NavigatingRouterContext);
}

export function useIsNavigating() {
  return useContext(NavigatingRouterContext).isPending;
}
