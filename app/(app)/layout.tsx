"use client";

import "@/plugins";
// Point Monaco at the self-hosted /monaco/<version>/vs assets before any editor
// mounts. Side-effect import — must run at module-eval time.
import "@/lib/monaco-loader";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMounted } from "@/lib/hooks/use-mounted";
import {
  isAuthenticated,
  getSession,
  saveSession,
  updateSession,
  clearSession,
  type SessionInfo,
} from "@/lib/auth";
import { getServerVersion } from "@/lib/api/api-auth";
import { evaluateServerCompatibility, type CompatResult } from "@/lib/version-compat";
import { CompatibilityBanner } from "@/components/compatibility-banner";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { getUsers } from "@/lib/api/api-users";
import { loadRuntimePlugins } from "@/lib/runtime-plugins/loader";
import { Sidebar } from "@/components/sidebar";
import { SidebarToggleButton } from "@/components/sidebar-toggle-button";
import { NavigationGuardProvider } from "@/lib/navigation-guard";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import { GlobalDrawer } from "@/components/global-drawer";
import { NavigationProgress } from "@/components/navigation-progress";
import { NavigatingRouterProvider } from "@/lib/hooks/use-navigating-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIdleLogout } from "@/lib/hooks/use-idle-logout";
import { useBackgroundColor } from "@/lib/hooks/use-background-color";
import { useColorPlacement } from "@/lib/hooks/use-color-placement";
import { useUpdateCheck } from "@/lib/hooks/use-update-check";
import { UpdateBanner } from "@/components/update-banner";
import { UpdateAvailableDialog } from "@/components/update-available-dialog";
import type { WhoamiResponse } from "@/app/api/auth/whoami/route";

// Result of the new-tab rehydration attempt (sessionStorage empty but a valid
// per-server cookie may exist):
//   pending     — whoami in flight (or not yet started)
//   rehydrated  — whoami succeeded, session written to sessionStorage
//   redirecting — no valid session, navigation to /login in flight
type Rehydration = "pending" | "rehydrated" | "redirecting";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  useIdleLogout();
  const bgColor = useBackgroundColor();
  const { colorPlacement } = useColorPlacement();
  const mounted = useMounted();
  const {
    result: updateResult,
    isDismissed,
    isBannerDismissed,
    dismiss,
    dismissBanner,
  } = useUpdateCheck();
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  // No extra `mounted` guard needed: showUpdate* are only read in the authed
  // render below, which is gated on `authReady` (and thus `mounted`).
  const showUpdateBadge = updateResult?.updateAvailable === true && !isDismissed;
  const showUpdateBanner = updateResult?.updateAvailable === true && !isBannerDismissed;

  // sessionStorage is unavailable during SSR, so the server can't know the
  // auth state — it always renders the loading skeleton. We gate the authed
  // layout on `mounted`, so the first client render also produces the skeleton
  // and hydration matches; only after mount do we read sessionStorage. Reading
  // it in a lazy useState initializer instead would make the first client
  // render disagree with the server and trigger a hydration mismatch.
  const [rehydration, setRehydration] = useState<Rehydration>("pending");

  // Runtime plugin manifests: true once loadRuntimePlugins() has
  // settled (success or fail-soft). Gates children alongside authReady so
  // runtime-declared contributions are registered before anything renders.
  const [runtimePluginsReady, setRuntimePluginsReady] = useState(false);

  // Version-compatibility result for the connected Core server.
  // null while unresolved. `block` swaps the app for a full-screen gate;
  // `warn-newer` shows a dismissible banner.
  const [compat, setCompat] = useState<CompatResult | null>(null);
  // Per-version banner-dismissal flag. Lazy initializer reads localStorage once
  // (SSR-guarded), mirroring use-update-check — avoids a set-state-in-effect.
  const [compatDismissed, setCompatDismissed] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem("bl-compat-banner-dismissed");
    } catch {
      return null;
    }
  });

  useEffect(() => {
    // Client-only auth bootstrap. Runs once we've mounted.
    if (!mounted) return;
    // Common case (reload / existing tab): sessionStorage already has a
    // session. `authReady` picks this up directly — nothing to do here.
    if (isAuthenticated()) return;

    // sessionStorage is empty — try to rehydrate from the per-server HttpOnly
    // cookies set by the proxy at login. Pass the last-used server URL so the
    // whoami route can locate the matching bl_sess_<hash> cookie.
    // This is the new-tab scenario: cookies exist but sessionStorage is blank.
    let cancelled = false;
    (async () => {
      try {
        const lastServer = localStorage.getItem("bl_last_server");
        const whoamiHeaders: Record<string, string> = {};
        if (lastServer) whoamiHeaders["x-bl-server"] = lastServer;
        const res = await fetch("/api/auth/whoami", { headers: whoamiHeaders });
        if (cancelled) return;
        if (!res.ok) {
          router.replace("/login");
          setRehydration("redirecting");
          return;
        }
        const data = (await res.json()) as WhoamiResponse;
        saveSession({ username: data.username, serverUrl: data.serverUrl, userId: data.userId });
        setRehydration("rehydrated");
      } catch {
        if (cancelled) return;
        router.replace("/login");
        setRehydration("redirecting");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted, router]);

  // The server and first client render (mounted === false) both produce the
  // skeleton, so hydration matches. Once mounted, an existing session (the
  // common reload case) or a successful cookie rehydration unlocks the layout.
  const authReady = mounted && (isAuthenticated() || rehydration === "rehydrated");

  // Background: fill in session metadata (serverVersion, userId) that the
  // login page skipped for faster navigation to the dashboard.
  useEffect(() => {
    if (!authReady) return;
    const session = getSession();
    if (!session) return;
    const needsVersion = !session.serverVersion;
    const needsUserId = session.userId === undefined;

    (async () => {
      const [version, users] = await Promise.all([
        needsVersion ? getServerVersion(session.serverUrl).catch(() => undefined) : undefined,
        needsUserId ? getUsers().catch(() => []) : [],
      ]);
      const patch: Partial<SessionInfo> = {};
      if (version) patch.serverVersion = version;
      if (needsUserId && Array.isArray(users)) {
        patch.userId = users.find((u) => u.username === session.username)?.id;
      }
      if (Object.keys(patch).length > 0) updateSession(patch);

      // Evaluate compatibility from whichever version we now have.
      // The login page already blocks incompatible servers before navigating
      // here; this covers the new-tab rehydration and direct-load paths that
      // bypass the login page.
      setCompat(evaluateServerCompatibility(version ?? session.serverVersion));
    })();
  }, [authReady]);

  // Runtime plugin manifests: fetched and registered during the
  // bootstrap so declared contributions (connector types, settings tabs) exist
  // before any child component enumerates a registry. loadRuntimePlugins() is
  // strictly fail-soft (an unreachable/older Core yields zero runtime plugins),
  // so the gate always releases.
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    void loadRuntimePlugins().finally(() => {
      if (!cancelled) setRuntimePluginsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [authReady]);

  const dismissCompatBanner = () => {
    if (!compat) return;
    try {
      localStorage.setItem("bl-compat-banner-dismissed", compat.serverVersion);
    } catch {
      // non-fatal
    }
    setCompatDismissed(compat.serverVersion);
  };

  const showCompatBanner =
    compat?.level === "warn-newer" && compatDismissed !== compat.serverVersion;

  // Hold the app behind the skeleton only when we're still fetching the server
  // version for a fresh tab (session had none). Reload/login already carry the
  // version in sessionStorage, so those render immediately — and login already
  // guaranteed non-block — while a brand-new tab waits so children never mount
  // against a server we may be about to block.
  const awaitingVersionCheck = authReady && compat === null && !getSession()?.serverVersion;

  // Before mount, while checking (new-tab rehydration in flight), while
  // redirecting, while the fresh-tab version check is in flight, or while
  // runtime plugin manifests are still registering, don't render children —
  // prevents child useEffects from firing API calls before sessionStorage is
  // populated (502s) or against a server we may block, and prevents registry
  // reads before runtime contributions exist.
  if (!authReady || awaitingVersionCheck || !runtimePluginsReady) {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
        {bgColor && colorPlacement === "top-strip" && (
          <div className="h-1 w-full shrink-0" style={{ backgroundColor: bgColor }} />
        )}
      </div>
    );
  }

  // Hard version-incompatibility gate: the connected Core is older
  // than this Web Admin build supports. Render a full-screen block instead of
  // the app — children never mount, so no API calls run against it.
  if (compat?.level === "block") {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
        {bgColor && colorPlacement === "top-strip" && (
          <div className="h-1 w-full shrink-0" style={{ backgroundColor: bgColor }} />
        )}
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md w-full rounded-lg border border-red-200 dark:border-red-900/60 bg-white dark:bg-gray-800 shadow-lg p-6 space-y-4">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h1 className="text-base font-semibold">{compat.title}</h1>
            </div>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{compat.message}</p>
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  clearSession();
                  router.replace("/login");
                }}
              >
                Return to login
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <NavigatingRouterProvider>
      <NavigationGuardProvider>
        <TooltipProvider>
          <NavigationProgress />
          <div className="flex flex-col h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
            {bgColor && colorPlacement === "top-strip" && (
              <div className="h-1 w-full shrink-0" style={{ backgroundColor: bgColor }} />
            )}
            <div className="flex flex-1 overflow-hidden">
              <div className="relative shrink-0">
                <Sidebar
                  updateAvailable={showUpdateBadge}
                  onUpdateClick={() => setUpdateDialogOpen(true)}
                />
                <SidebarToggleButton />
              </div>
              <div className="flex flex-col flex-1 overflow-hidden">
                {showCompatBanner && compat && (
                  <CompatibilityBanner compat={compat} onDismiss={dismissCompatBanner} />
                )}
                {showUpdateBanner && (
                  <UpdateBanner
                    result={updateResult}
                    onViewUpdate={() => setUpdateDialogOpen(true)}
                    onDismiss={dismissBanner}
                  />
                )}
                <main className="flex-1 overflow-y-auto">{children}</main>
              </div>
            </div>
          </div>
          <UnsavedChangesDialog />
          <GlobalDrawer />
          {mounted && updateResult && (
            <UpdateAvailableDialog
              open={updateDialogOpen}
              onOpenChange={setUpdateDialogOpen}
              result={updateResult}
              onDismiss={dismiss}
            />
          )}
        </TooltipProvider>
      </NavigationGuardProvider>
    </NavigatingRouterProvider>
  );
}
