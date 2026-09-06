import { ApiError } from "@/lib/api/responses";
import { getAuthEnv } from "@/lib/auth/env";

/**
 * Multi-user and RBAC capabilities are deliberately server-side gates.  A
 * hidden navigation item is not a security boundary, so every route/service
 * that belongs to these capabilities must call this helper before touching
 * workspace-scoped state.
 */
export function requireMultiUserFeature(): void {
  if (!getAuthEnv().AUTH_MULTI_USER_ENABLED) {
    throw new ApiError("MULTI_USER_DISABLED", 404);
  }
}

export function requireRbacFeature(): void {
  const env = getAuthEnv();
  if (!env.AUTH_MULTI_USER_ENABLED || !env.AUTH_RBAC_ENABLED) {
    throw new ApiError("RBAC_DISABLED", 404);
  }
}
