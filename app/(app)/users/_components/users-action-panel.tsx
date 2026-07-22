"use client";

import { Pencil, Trash2, UserPlus } from "lucide-react";
import { AdaptiveBtn, AdaptiveSeparator } from "@/components/toolbar-button";
import type { ToolbarPosition } from "@/lib/hooks/use-toolbar-position";

interface UsersActionPanelProps {
  position: ToolbarPosition;
  selectedUserId: number | null;
  /** When true, all write actions are disabled (View-only RBAC). */
  viewOnly?: boolean;
  onNewUser: () => void;
  onEditUser: () => void;
  onDeleteUser: () => void;
}

export function UsersActionPanel({
  position,
  selectedUserId,
  onNewUser,
  onEditUser,
  onDeleteUser,
  viewOnly = false,
}: UsersActionPanelProps) {
  const orientation: "vertical" | "horizontal" =
    position === "left" || position === "right" ? "vertical" : "horizontal";
  const ro = viewOnly;

  return (
    <>
      {/* New / Edit */}
      <AdaptiveBtn
        orientation={orientation}
        onClick={onNewUser}
        disabled={ro}
        icon={<UserPlus className="w-4 h-4" />}
        label="New User"
        title="Create a new user"
      />
      <AdaptiveBtn
        orientation={orientation}
        onClick={onEditUser}
        disabled={selectedUserId === null || ro}
        icon={<Pencil className="w-4 h-4" />}
        label="Edit User"
        title="Edit selected user"
      />
      <AdaptiveSeparator orientation={orientation} />
      {/* Delete */}
      <AdaptiveBtn
        orientation={orientation}
        variant="destructive"
        onClick={onDeleteUser}
        disabled={selectedUserId === null || ro}
        icon={<Trash2 className="w-4 h-4" />}
        label="Delete"
        title="Delete selected user"
      />
    </>
  );
}
