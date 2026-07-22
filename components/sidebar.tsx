"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Cable,
  MessageSquare,
  Bell,
  ClipboardList,
  Users,
  Settings,
  Puzzle,
  LogOut,
  ChevronRight,
  Code2,
  Moon,
  Sun,
  Rows2,
  Rows3,
  Rows4,
  ScrollText,
  Database,
  Search,
  BookOpen,
  FileCode,
  ExternalLink,
  Info,
  Bug,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { logout } from "@/lib/api-client";
import { getSession } from "@/lib/auth";
import { clearClientCaches } from "@/lib/logout";
import { pluginRegistry } from "@/lib/plugin-registry";
import { usePluginSurfaceEnabled } from "@/lib/plugin-gating";
import { useDrawer } from "@/lib/hooks/use-drawer";
import { useMounted } from "@/lib/hooks/use-mounted";
import { useTheme } from "@/lib/hooks/use-theme";
import { useCompactMode } from "@/lib/hooks/use-compact-mode";
import { useServerInfo } from "@/lib/hooks/use-server-info";
import { useNavigationGuard } from "@/lib/navigation-guard";
import { useSidebarCollapsed } from "@/lib/hooks/use-sidebar-collapsed";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AboutDialog } from "@/components/about-dialog";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  tooltip: string;
  /** When true, href is a server-relative path opened in a new tab */
  external?: boolean;
  /**
   * RBAC permission key(s).
   * - string: item hidden when that key is "No Permission".
   * - string[]: item hidden when ALL keys are "No Permission" (shown if any is accessible).
   * Omit to always show.
   */
  permissionKey?: string | string[];
  /** When "drawer": clicking opens the slide-out drawer instead of navigating. */
  openAs?: "page" | "drawer";
  /** Slug used to open/identify the drawer (same as href slug). */
  slug?: string;
}

// Permission keys for the static built-in settings tabs (always present, no plugin dependency).
// Settings nav item is hidden when every one of these is "No Permission".
// Plugin-specific tab keys (Data Pruner, Message Trends, etc.) are intentionally excluded:
// if a plugin is not installed its key won't be in the permissions map and would default to
// "Editor", producing a false positive that keeps Settings visible when it should be hidden.
const SETTINGS_SUB_PERMISSION_KEYS: string[] = [
  "Settings.Server",
  "Settings.Administrator",
  "Settings.Tags",
  "Settings.Configuration Map",
  "Settings.Resources",
  "Settings.Access Control",
];

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        tooltip: "Contains information about your currently deployed channels.",
        permissionKey: "Dashboard",
      },
      {
        label: "Messages",
        href: "/messages",
        icon: MessageSquare,
        tooltip: "Browse and search messages across deployed channels.",
        permissionKey: "Messages",
      },
    ],
  },
  {
    label: "Build",
    items: [
      {
        label: "Channels",
        href: "/channels",
        icon: Cable,
        tooltip: "Contains various operations to perform on your channels.",
        permissionKey: "Channels",
      },
      {
        label: "Code Templates",
        href: "/code-templates",
        icon: Code2,
        tooltip: "Manage reusable code templates shared across channels.",
        permissionKey: "Channels",
      },
      {
        label: "Global Scripts",
        href: "/global-scripts",
        icon: ScrollText,
        tooltip: "Edit scripts that run globally across all channels.",
        permissionKey: "Channels",
      },
      {
        label: "Lookup Manager",
        href: "/lookups",
        icon: Database,
        tooltip: "Manage lookup tables used by channels.",
        permissionKey: "Lookup Manager",
      },
      {
        label: "Config Search",
        href: "/search",
        icon: Search,
        tooltip: "Search across channels, messages, and events.",
        permissionKey: "Channels",
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        label: "Events",
        href: "/events",
        icon: ClipboardList,
        tooltip: "Show the event logs for the system.",
        permissionKey: "Events",
      },
      {
        label: "Alerts",
        href: "/alerts",
        icon: Bell,
        tooltip: "Contains alert settings.",
        permissionKey: "Alerts",
      },
      {
        label: "Users",
        href: "/users",
        icon: Users,
        tooltip: "Contains information on users.",
        permissionKey: "Users",
      },
      {
        label: "Settings",
        href: "/settings",
        icon: Settings,
        tooltip: "Contains local and system settings.",
        permissionKey: SETTINGS_SUB_PERMISSION_KEYS,
      },
      {
        label: "Extensions",
        href: "/extensions",
        icon: Puzzle,
        tooltip: "View and manage BridgeLink extensions.",
        permissionKey: "Extensions",
      },
    ],
  },
  {
    label: "Help",
    items: [
      {
        label: "User API",
        href: "/javadocs/user-api/",
        icon: BookOpen,
        tooltip: "View documentation for the BridgeLink User API.",
        external: true,
      },
      {
        label: "Client API",
        href: "/api/",
        icon: FileCode,
        tooltip: "View documentation for the BridgeLink Client API.",
        external: true,
      },
      {
        label: "Report an Issue",
        href: "https://github.com/Innovar-Healthcare/BridgeLink-WebAdmin/issues",
        icon: Bug,
        tooltip: "Report a bug or suggest an improvement on GitHub.",
        external: true,
      },
    ],
  },
];

interface SidebarProps {
  updateAvailable?: boolean;
  onUpdateClick?: () => void;
}

export function Sidebar({ updateAvailable = false, onUpdateClick }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const mounted = useMounted();
  const { guard, guardedNavigate } = useNavigationGuard();
  const { isDark, toggle } = useTheme();
  const { viewDensity, cycleDensity } = useCompactMode();
  const { serverName, environmentName } = useServerInfo();
  const { collapsed } = useSidebarCollapsed();
  const { hasPermission } = usePermissions();
  const { activeSlug, openDrawer } = useDrawer();
  const surfaceEnabled = usePluginSurfaceEnabled();
  const [aboutOpen, setAboutOpen] = useState(false);

  // Only read sessionStorage after mount to avoid SSR/hydration mismatch
  const session = mounted ? getSession() : null;

  // Derive hostname fallback from session serverUrl
  const hostname = session?.serverUrl
    ? (() => {
        try {
          return new URL(session.serverUrl).hostname;
        } catch {
          return "";
        }
      })()
    : "";

  const displayTitle = serverName || "BridgeLink";
  const displaySubtitle = environmentName || hostname;

  // Merge registered plugin pages into nav groups
  const navGroups: NavGroup[] = NAV_GROUPS.map((group) => {
    const pluginItems: NavItem[] = pluginRegistry.pages
      .filter((p) => (p.navGroup ?? "Operations") === group.label && surfaceEnabled(p))
      .map((p) => ({
        label: p.label,
        href: `/p/${p.slug}`,
        icon: p.icon,
        tooltip: p.tooltip,
        permissionKey: p.permissionKey,
        openAs: p.openAs,
        slug: p.slug,
      }));
    return pluginItems.length > 0 ? { ...group, items: [...group.items, ...pluginItems] } : group;
  });

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // ignore — clear session regardless
    }
    clearClientCaches();
    router.replace("/login");
  }

  return (
    <TooltipProvider delayDuration={600}>
      <aside
        data-testid="app-sidebar"
        className={cn(
          "flex flex-col bg-[#1B3D6D] text-gray-100 h-screen sticky top-0 shrink-0 transition-[width] duration-200 ease-in-out overflow-hidden",
          collapsed ? "w-14" : "w-52 min-w-[13rem]"
        )}
      >
        {/* Logo / branding */}
        <div className="border-b border-[#2a4a7a]">
          {collapsed ? (
            <div className="flex flex-col items-center pt-4 pb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/bridgelink-alternative-art-white.svg"
                alt="BridgeLink"
                className="w-8 h-8"
              />
            </div>
          ) : (
            <div className="px-4 pt-5 pb-4">
              <div className="mb-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/bridgelink-alt-logo-white.svg"
                  alt="BridgeLink"
                  className="w-full h-auto"
                />
              </div>
              {mounted && (
                <div className="space-y-0.5">
                  <div className="text-xs font-medium text-white truncate" title={displayTitle}>
                    {displayTitle}
                  </div>
                  {displaySubtitle && (
                    <div className="text-[10px] text-[#8099c8] truncate" title={displaySubtitle}>
                      {displaySubtitle}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2">
          {navGroups.map(({ label, items }, groupIdx) => {
            const visibleItems = items.filter((item) => {
              if (!item.permissionKey) return true;
              if (Array.isArray(item.permissionKey)) {
                return item.permissionKey.some((k) => hasPermission(k));
              }
              return hasPermission(item.permissionKey);
            });
            if (visibleItems.length === 0) return null;
            return (
              <div
                key={label}
                className={groupIdx > 0 ? "mt-1 border-t border-[#2a4a7a]/60 pt-1" : ""}
              >
                {!collapsed && (
                  <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[#6a8ab8] select-none">
                    {label}
                  </div>
                )}
                {collapsed && groupIdx > 0 && <div className="pt-1" />}
                {visibleItems.map(
                  ({ label: itemLabel, href, icon: Icon, tooltip, external, openAs, slug }) => {
                    if (external) {
                      const serverBase = session?.serverUrl?.replace(/\/$/, "") ?? "";
                      const fullUrl = href.startsWith("http")
                        ? href
                        : serverBase
                          ? `${serverBase}${href}`
                          : href;
                      const linkContent = (
                        <a
                          key={href}
                          href={fullUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            "flex items-center text-sm transition-colors group text-gray-300 hover:bg-[#2a4a7a] hover:text-white",
                            collapsed ? "justify-center py-2.5 px-0" : "gap-2.5 px-4 py-2"
                          )}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          {!collapsed && (
                            <>
                              <span className="flex-1 truncate">{itemLabel}</span>
                              <ExternalLink className="w-3 h-3 opacity-40 group-hover:opacity-60" />
                            </>
                          )}
                        </a>
                      );
                      return (
                        <Tooltip key={href}>
                          <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                          <TooltipContent side="right" sideOffset={8}>
                            {collapsed ? (
                              <>
                                <p className="font-semibold">{itemLabel}</p>
                                <p className="text-xs opacity-80">{tooltip}</p>
                              </>
                            ) : (
                              tooltip
                            )}
                          </TooltipContent>
                        </Tooltip>
                      );
                    }

                    if (openAs === "drawer" && slug) {
                      const drawerActive = activeSlug === slug;
                      const drawerBtn = (
                        <button
                          key={href}
                          onClick={() => openDrawer(slug)}
                          className={cn(
                            "flex items-center text-sm transition-colors group w-full",
                            collapsed ? "justify-center py-2.5 px-0" : "gap-2.5 px-4 py-2",
                            drawerActive
                              ? "bg-[#F78D2D] text-white"
                              : "text-gray-300 hover:bg-[#2a4a7a] hover:text-white"
                          )}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          {!collapsed && (
                            <>
                              <span className="flex-1 truncate text-left">{itemLabel}</span>
                              {drawerActive && <ChevronRight className="w-3 h-3 opacity-60" />}
                            </>
                          )}
                        </button>
                      );
                      return (
                        <Tooltip key={href}>
                          <TooltipTrigger asChild>{drawerBtn}</TooltipTrigger>
                          <TooltipContent side="right" sideOffset={8}>
                            {collapsed ? (
                              <>
                                <p className="font-semibold">{itemLabel}</p>
                                <p className="text-xs opacity-80">{tooltip}</p>
                              </>
                            ) : (
                              tooltip
                            )}
                          </TooltipContent>
                        </Tooltip>
                      );
                    }

                    const active = pathname === href || pathname.startsWith(href + "/");
                    const linkContent = (
                      <Link
                        key={href}
                        href={href}
                        onClick={
                          guard
                            ? (e) => {
                                e.preventDefault();
                                guardedNavigate(href);
                              }
                            : undefined
                        }
                        className={cn(
                          "flex items-center text-sm transition-colors group",
                          collapsed ? "justify-center py-2.5 px-0" : "gap-2.5 px-4 py-2",
                          active
                            ? "bg-[#F78D2D] text-white"
                            : "text-gray-300 hover:bg-[#2a4a7a] hover:text-white"
                        )}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        {!collapsed && (
                          <>
                            <span className="flex-1 truncate">{itemLabel}</span>
                            {active && <ChevronRight className="w-3 h-3 opacity-60" />}
                          </>
                        )}
                      </Link>
                    );
                    return (
                      <Tooltip key={href}>
                        <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                        <TooltipContent side="right" sideOffset={8}>
                          {collapsed ? (
                            <>
                              <p className="font-semibold">{itemLabel}</p>
                              <p className="text-xs opacity-80">{tooltip}</p>
                            </>
                          ) : (
                            tooltip
                          )}
                        </TooltipContent>
                      </Tooltip>
                    );
                  }
                )}
                {label === "Help" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => {
                          if (updateAvailable && onUpdateClick) {
                            onUpdateClick();
                          } else {
                            setAboutOpen(true);
                          }
                        }}
                        className={cn(
                          "flex items-center text-sm transition-colors group text-gray-300 hover:bg-[#2a4a7a] hover:text-white w-full",
                          collapsed ? "justify-center py-2.5 px-0" : "gap-2.5 px-4 py-2"
                        )}
                      >
                        <span className="relative shrink-0">
                          <Info className="w-4 h-4" />
                          {updateAvailable && (
                            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-orange-500" />
                            </span>
                          )}
                        </span>
                        {!collapsed && (
                          <span className="flex-1 truncate text-left">About BridgeLink</span>
                        )}
                        {!collapsed && updateAvailable && (
                          <span className="text-[10px] font-medium text-orange-400 shrink-0">
                            Update
                          </span>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {collapsed ? (
                        <>
                          <p className="font-semibold">
                            {updateAvailable ? "Update Available" : "About BridgeLink"}
                          </p>
                          <p className="text-xs opacity-80">
                            {updateAvailable
                              ? "A new version of WebAdmin is available."
                              : "View server version, build date, and server ID."}
                          </p>
                        </>
                      ) : updateAvailable ? (
                        "A new version of WebAdmin is available."
                      ) : (
                        "View server version, build date, and server ID."
                      )}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer: user + theme toggle + logout */}
        <div className="border-t border-[#2a4a7a] px-2 py-3">
          {!collapsed && mounted && session && (
            <div className="text-xs text-[#8099c8] truncate mb-2 px-2">{session.username}</div>
          )}
          <div
            className={cn("flex items-center", collapsed ? "flex-col gap-1" : "justify-between")}
          >
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleLogout}
                    className="p-1.5 text-gray-300 hover:text-white transition-colors rounded"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Logout
                </TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors px-2"
                  >
                    <LogOut className="w-4 h-4" />
                    Logout
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Logout
                </TooltipContent>
              </Tooltip>
            )}
            <div className={cn("flex items-center gap-1", collapsed && "flex-col")}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={cycleDensity}
                    className="p-1 text-gray-400 hover:text-white transition-colors rounded"
                  >
                    {viewDensity === "comfortable" ? (
                      <Rows2 className="w-4 h-4" />
                    ) : viewDensity === "compact" ? (
                      <Rows4 className="w-4 h-4" />
                    ) : (
                      <Rows3 className="w-4 h-4" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {viewDensity === "comfortable"
                    ? "Comfortable density"
                    : viewDensity === "compact"
                      ? "Compact density"
                      : "Default density"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggle}
                    className="p-1 text-gray-400 hover:text-white transition-colors rounded"
                  >
                    {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {isDark ? "Light mode" : "Dark mode"}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </aside>
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </TooltipProvider>
  );
}
