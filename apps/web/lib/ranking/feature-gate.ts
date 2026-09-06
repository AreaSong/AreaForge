import { requireRbacFeature } from "@/lib/auth/feature-gates";
import { ApiError } from "@/lib/api/responses";

/**
 * Ranking remains an explicit local candidate switch. Unknown, missing or
 * malformed values are treated as disabled; a hidden button is never the
 * security boundary.
 */
export function isRankingFeatureEnabled(env: { [key: string]: string | undefined } = process.env): boolean {
  return env.RANKING_ENABLED === "true";
}

export function requireRankingFeature(options: { multiUser?: boolean } = {}): void {
  if (!isRankingFeatureEnabled()) throw new ApiError("RANKING_DISABLED", 404);
  if (options.multiUser) requireRbacFeature();
}
