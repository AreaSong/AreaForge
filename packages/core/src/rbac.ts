export const WORKSPACE_ROLES = ["OWNER", "ADMIN", "COACH", "MEMBER", "VIEWER"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const WORKSPACE_CAPABILITIES = [
  "workspace:read",
  "workspace:manage",
  "member:read-all",
  "member:invite",
  "member:remove",
  "member:role",
  "owner:transfer",
  "share:manage-self",
  "audit:read",
  "coach:suggest",
] as const;
export type WorkspaceCapability = (typeof WORKSPACE_CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<WorkspaceRole, ReadonlySet<WorkspaceCapability>> = {
  // Owner may act as a Coach only when a member explicitly grants COACH
  // access to that member-owned resource; ownership alone never bypasses the
  // object-level grant check in the policy service.
  OWNER: new Set(WORKSPACE_CAPABILITIES),
  ADMIN: new Set([
    "workspace:read",
    "workspace:manage",
    "member:read-all",
    "member:invite",
    "member:remove",
    "share:manage-self",
    "audit:read",
  ]),
  COACH: new Set(["workspace:read", "member:read-all", "share:manage-self", "coach:suggest"]),
  MEMBER: new Set(["workspace:read", "share:manage-self"]),
  VIEWER: new Set(["workspace:read", "share:manage-self"]),
};

export function hasWorkspaceCapability(role: WorkspaceRole, capability: WorkspaceCapability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

export function listWorkspaceCapabilities(role: WorkspaceRole): WorkspaceCapability[] {
  return WORKSPACE_CAPABILITIES.filter((capability) => hasWorkspaceCapability(role, capability));
}

export type WorkspaceShareGrantScope = "USER" | "ROLE" | "WORKSPACE";
export type WorkspaceShareGrantAccess = "VIEW" | "COACH";

export interface WorkspaceShareGrantTarget {
  scope: WorkspaceShareGrantScope;
  granteeUserId?: string | null;
  granteeRole?: WorkspaceRole | null;
  access: WorkspaceShareGrantAccess;
}

export function validateWorkspaceShareGrantTarget(target: WorkspaceShareGrantTarget): WorkspaceShareGrantTarget {
  const hasUser = Boolean(target.granteeUserId?.trim());
  const hasRole = Boolean(target.granteeRole);
  const valid =
    (target.scope === "USER" && hasUser && !hasRole) ||
    (target.scope === "ROLE" && !hasUser && target.granteeRole === "COACH") ||
    (target.scope === "WORKSPACE" && !hasUser && !hasRole);
  if (!valid) throw new Error("WORKSPACE_SHARE_GRANT_TARGET_INVALID");
  if (target.access === "COACH" && target.scope === "WORKSPACE") {
    throw new Error("WORKSPACE_SHARE_GRANT_COACH_SCOPE_INVALID");
  }
  return {
    scope: target.scope,
    granteeUserId: hasUser ? target.granteeUserId?.trim() : null,
    granteeRole: hasRole ? target.granteeRole : null,
    access: target.access,
  };
}

export type CoachSuggestionStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "REVOKED";
export type CoachSuggestionAction = "accept" | "reject" | "revoke";

export function nextCoachSuggestionStatus(
  status: CoachSuggestionStatus,
  action: CoachSuggestionAction,
): CoachSuggestionStatus {
  if (status !== "PENDING") throw new Error("COACH_SUGGESTION_STATE_CONFLICT");
  if (action === "accept") return "ACCEPTED";
  if (action === "reject") return "REJECTED";
  return "REVOKED";
}

export const COACH_SUGGESTION_REQUIRES_RECIPIENT_CONFIRMATION = true;
export const COACH_SUGGESTION_CAN_AUTO_APPLY = false;
