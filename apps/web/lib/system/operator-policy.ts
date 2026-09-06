import { normalizeEmail, type CurrentUser } from "@/lib/auth/session";
import { requireRecentReauthentication } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/responses";
import { getAuthEnv } from "@/lib/auth/env";

/**
 * Platform Operator is a platform identity, not a Workspace role.  The
 * bootstrap email is intentionally the only source for this first version;
 * it can later be replaced by a dedicated operator table without changing
 * route call sites.
 */
export function isPlatformOperatorEmail(email: string, configuredEmail?: string): boolean {
  if (!configuredEmail) return false;
  return normalizeEmail(email) === normalizeEmail(configuredEmail);
}

export async function requirePlatformOperator(
  actor: CurrentUser,
  options: { fresh?: boolean } = {},
): Promise<void> {
  const configuredEmail = getAuthEnv().AUTH_ADMIN_EMAIL;
  if (!isPlatformOperatorEmail(actor.email, configuredEmail)) {
    // Keep operator existence and workspace membership private.
    throw new ApiError("PLATFORM_OPERATOR_NOT_FOUND", 404);
  }
  if (options.fresh) await requireRecentReauthentication(actor);
}
