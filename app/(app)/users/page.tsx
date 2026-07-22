"use client";

/**
 * Users page — mirrors Java's UserPanel.java + UserDialog.java + UserEditPanel.java
 *
 * Columns (exact match to Java UserPanel.updateUserTable() column order):
 *   Username | First Name | Last Name | Email | Country | State/Territory |
 *   Phone Number | Organization | Role | Business | Last Login | Description
 *
 * API:
 *   GET    /users                   → list all users
 *   POST   /users                   → create user (body: {"user": {...}})
 *   PUT    /users/{id}              → update user (body: {"user": {...}})
 *   DELETE /users/{id}              → delete user
 *   POST   /users/password          → validate password (text/plain) → string[] errors
 *   PUT    /users/{id}/password     → validate + set password (text/plain) → string[] errors
 *
 * Business logic:
 *   - New user: password required; check policy → create → re-fetch id → set password
 *   - Edit user: password optional; check policy (if provided) → update → set password (if provided)
 *   - Delete: confirm → blocked if only 1 user; server also blocks self-delete
 *   - Client-side: username required + unique, email format, passwords match
 *
 * Date format: "yyyy-MM-dd HH:mm:ss"  (matches Java SimpleDateFormat)
 */

import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { RefreshCw } from "lucide-react";
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  checkUserPassword,
  updateUserPassword,
} from "@/lib/api-client";
import { getSession, updateSession } from "@/lib/auth";
import { useColumnConfig } from "@/lib/hooks/use-column-config";
import { useSortable } from "@/lib/hooks/use-sortable";
import { useCompactMode, pagePadding } from "@/lib/hooks/use-compact-mode";
import { useMounted } from "@/lib/hooks/use-mounted";
import { ColumnPicker } from "@/components/column-picker";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { PageHeader } from "@/components/page-header";
import { DockableToolbar } from "@/components/dockable-toolbar";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useToolbarPosition } from "@/lib/hooks/use-toolbar-position";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { USER_COLS, checkSelfRename, type UserCol, type UserForm } from "./_components/user-types";
import { UsersActionPanel } from "./_components/users-action-panel";
import { UserDialog } from "./_components/user-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";

function formatLastLogin(isoStr?: string): string {
  if (!isoStr) return "—";
  try {
    return format(new Date(isoStr), "yyyy-MM-dd HH:mm:ss");
  } catch {
    return isoStr;
  }
}

export default function UsersPage() {
  const mounted = useMounted();
  const { viewDensity: globalDensity } = useCompactMode();
  const { position: toolbarPos, setToolbarPosition } = useToolbarPosition();
  const { isViewOnly } = usePermissions();
  const usersViewOnly = isViewOnly("Users");
  const [users, setUsers] = useState<import("@/lib/types").User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  // Selection
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  // Dialog state
  const [dialogMode, setDialogMode] = useState<"new" | "edit" | null>(null);
  const [pendingDeleteUser, setPendingDeleteUser] = useState(false);

  const colConfig = useColumnConfig(USER_COLS, "users-cols-v1");
  const { orderedCols, colState, setVisible, moveCol, resetToDefaults } = colConfig;

  const sortState = useSortable<UserCol>("username");
  const { sort, sorted } = sortState;

  // ── Data fetch ─────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getUsers();
      setUsers(data);
      setRefreshedAt(new Date());
      // Clear selection if the selected user was deleted externally
      if (data.length > 0 && selectedUserId !== null) {
        if (!data.some((u) => u.id === selectedUserId)) {
          setSelectedUserId(null);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedUserId]);

  useEffect(() => {
    startTransition(() => {
      refresh();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sort ───────────────────────────────────────────────────────────────────

  const sortedUsers = useMemo(() => {
    if (!sort.key) return users;
    const key = sort.key;
    return sorted(users, (u) => {
      switch (key) {
        case "username":
          return u.username ?? "";
        case "firstName":
          return u.firstName ?? "";
        case "lastName":
          return u.lastName ?? "";
        case "email":
          return u.email ?? "";
        case "country":
          return u.country ?? "";
        case "stateTerritory":
          return u.stateTerritory ?? "";
        case "phoneNumber":
          return u.phoneNumber ?? "";
        case "organization":
          return u.organization ?? "";
        case "role":
          return u.role ?? "";
        case "industry":
          return u.industry ?? "";
        case "lastLogin":
          return u.lastLogin ?? "";
        case "description":
          return u.description ?? "";
        default:
          return "";
      }
    });
  }, [users, sort, sorted]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const selectedUser = useMemo(
    () => (selectedUserId !== null ? (users.find((u) => u.id === selectedUserId) ?? null) : null),
    [users, selectedUserId]
  );

  // ── Actions ────────────────────────────────────────────────────────────────

  function handleOpenNew() {
    setDialogMode("new");
    setError(null);
  }

  function handleOpenEdit() {
    if (!selectedUser) return;
    setDialogMode("edit");
    setError(null);
  }

  function handleDelete() {
    if (!selectedUser) return;
    if (users.length === 1) {
      setError("You must have at least one user account.");
      return;
    }
    setPendingDeleteUser(true);
  }

  async function executeDeleteUser() {
    if (!selectedUser) return;
    try {
      await deleteUser(selectedUser.id);
      setSelectedUserId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDialogSubmit(form: UserForm) {
    if (dialogMode === "new") {
      // 1. Validate password against server policy (check only, no update yet)
      const pwErrors = await checkUserPassword(form.password);
      if (pwErrors.length > 0) {
        throw new Error("Password policy:\n" + pwErrors.join("\n"));
      }
      // 2. Create user (no password field — separate call)
      await createUser({
        username: form.username,
        email: form.email,
        firstName: form.firstName,
        lastName: form.lastName,
        organization: form.organization || undefined,
        description: form.description || undefined,
        phoneNumber: form.phoneNumber || undefined,
        country: form.country || undefined,
        stateTerritory: form.stateTerritory || undefined,
        role: form.role || undefined,
        industry: form.industry || undefined,
      });
      // 3. Fetch updated list to find the new user's server-assigned id
      const refreshed = await getUsers();
      const newUser = refreshed.find(
        (u) => u.username.toLowerCase() === form.username.toLowerCase()
      );
      // 4. Set password using the real id
      if (newUser) {
        await updateUserPassword(newUser.id, form.password);
      }
      setUsers(refreshed);
      setRefreshedAt(new Date());
    } else {
      // Edit mode
      if (!selectedUser) return;

      // Self-rename guard — mirrors Java Frame.updateCurrentUser: if you are editing
      // your OWN account and changing the username, you must also set a new password.
      const { isSelf, usernameChanged, blocked } = checkSelfRename(
        getSession(),
        selectedUser,
        form
      );
      if (blocked) {
        throw new Error("If you are changing your username, you must also update your password.");
      }

      // 1. If password provided, validate first
      if (form.password) {
        const pwErrors = await checkUserPassword(form.password);
        if (pwErrors.length > 0) {
          throw new Error("Password policy:\n" + pwErrors.join("\n"));
        }
      }
      // 2. Update user fields — only send id + form-managed fields. Calendar fields
      //    (lastLogin, gracePeriodStart, lastStrikeTime) are normalized from XStream
      //    Calendar format to ISO strings by normalizeXStream; sending ISO strings back
      //    causes XStream deserialization failure → 500. id MUST be included: the server
      //    uses user.getId() from the body (not the URL) for its uniqueness check.
      await updateUser(selectedUser.id, {
        id: selectedUser.id,
        username: form.username,
        email: form.email,
        firstName: form.firstName,
        lastName: form.lastName,
        organization: form.organization || undefined,
        description: form.description || undefined,
        phoneNumber: form.phoneNumber || undefined,
        country: form.country || undefined,
        stateTerritory: form.stateTerritory || undefined,
        role: form.role || undefined,
        industry: form.industry || undefined,
      });
      // 3. Update password if provided
      if (form.password) {
        await updateUserPassword(selectedUser.id, form.password);
      }
      // 4. After a successful self-rename, refresh the cached session identity so the
      //    live session stays in sync. WebUI analog of Java setting PlatformUI.USER_NAME
      //    (Frame.java:1908) — the server session cookie remains valid through a
      //    self-initiated username change, so no logout/re-login is needed.
      if (isSelf && usernameChanged) {
        updateSession({ username: form.username.trim() });
      }
      await refresh();
    }
    setDialogMode(null);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Users"
        subtitle={
          mounted && refreshedAt
            ? `${users.length} user${users.length !== 1 ? "s" : ""} · Updated ${format(refreshedAt, "HH:mm:ss")}`
            : `${users.length} user${users.length !== 1 ? "s" : ""}`
        }
        actions={
          <div className="flex items-center gap-2">
            <ColumnPicker
              cols={orderedCols}
              colState={colState}
              onToggle={(key) => setVisible(key, !(colState[key]?.visible ?? true))}
              onReset={resetToDefaults}
              onMove={moveCol}
            />
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      <ApiErrorAlert error={error} />

      {/* Toolbar + Table */}
      <div
        className={`flex flex-1 min-h-0 ${toolbarPos === "top" || toolbarPos === "bottom" ? "flex-col" : "flex-row"}`}
      >
        {(toolbarPos === "left" || toolbarPos === "top") && (
          <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
            <UsersActionPanel
              position={toolbarPos}
              selectedUserId={selectedUserId}
              viewOnly={usersViewOnly}
              onNewUser={handleOpenNew}
              onEditUser={handleOpenEdit}
              onDeleteUser={handleDelete}
            />
          </DockableToolbar>
        )}

        <div className={`flex-1 overflow-auto ${pagePadding(globalDensity)}`}>
          <DataTable<import("@/lib/types").User, UserCol>
            variant="sortable"
            cols={USER_COLS}
            rows={sortedUsers}
            colConfig={colConfig}
            sortState={sortState}
            rowKey={(u) => u.id}
            selectedRowId={selectedUserId}
            onRowClick={(u) => setSelectedUserId(u.id)}
            onRowDoubleClick={(u) => {
              setSelectedUserId(u.id);
              setDialogMode("edit");
              setError(null);
            }}
            loading={loading}
            empty="No users found."
            renderCell={(user, col) => {
              if (col === "username")
                return (
                  <span className="flex items-center gap-1.5">
                    <svg
                      className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 1114 0H3z" />
                    </svg>
                    {user.username}
                  </span>
                );
              if (col === "firstName") return user.firstName || "—";
              if (col === "lastName") return user.lastName || "—";
              if (col === "email") return user.email || "—";
              if (col === "country") return user.country || "";
              if (col === "stateTerritory") return user.stateTerritory || "";
              if (col === "phoneNumber") return user.phoneNumber || "";
              if (col === "organization") return user.organization || "";
              if (col === "role") return user.role || "";
              if (col === "industry") return user.industry || "";
              if (col === "lastLogin")
                return (
                  <span suppressHydrationWarning>
                    {mounted ? formatLastLogin(user.lastLogin) : ""}
                  </span>
                );
              return user.description || "";
            }}
            rowWrapper={(user, rendered) => (
              <ContextMenu key={user.id}>
                <ContextMenuTrigger asChild>{rendered}</ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() => {
                      setSelectedUserId(user.id);
                      setDialogMode("edit");
                      setError(null);
                    }}
                  >
                    Edit User
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="text-red-600 focus:text-red-600"
                    onSelect={() => {
                      setSelectedUserId(user.id);
                      if (users.length === 1) {
                        setError("You must have at least one user account.");
                        return;
                      }
                      setPendingDeleteUser(true);
                    }}
                  >
                    Delete User
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )}
          />
        </div>

        {(toolbarPos === "right" || toolbarPos === "bottom") && (
          <DockableToolbar position={toolbarPos} onPositionChange={setToolbarPosition}>
            <UsersActionPanel
              position={toolbarPos}
              selectedUserId={selectedUserId}
              viewOnly={usersViewOnly}
              onNewUser={handleOpenNew}
              onEditUser={handleOpenEdit}
              onDeleteUser={handleDelete}
            />
          </DockableToolbar>
        )}
      </div>

      {pendingDeleteUser && selectedUser && (
        <ConfirmDialog
          title="Delete User"
          description={`Delete user "${selectedUser.username}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => {
            setPendingDeleteUser(false);
            void executeDeleteUser();
          }}
          onCancel={() => setPendingDeleteUser(false)}
        />
      )}

      {/* Add/Edit Dialog */}
      {dialogMode !== null && (
        <UserDialog
          mode={dialogMode}
          initialUser={dialogMode === "edit" ? selectedUser : null}
          existingUsers={users}
          onSubmit={handleDialogSubmit}
          onClose={() => setDialogMode(null)}
        />
      )}
    </div>
  );
}
