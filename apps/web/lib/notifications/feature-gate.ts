import { ApiError } from "@/lib/api/responses";

export function isPlatformNotificationsEnabled(
  env: { [key: string]: string | undefined } = process.env,
): boolean {
  return env.PLATFORM_NOTIFICATIONS_ENABLED === "true";
}

export function requirePlatformNotifications(): void {
  if (!isPlatformNotificationsEnabled()) throw new ApiError("PLATFORM_NOTIFICATIONS_DISABLED", 404);
}
