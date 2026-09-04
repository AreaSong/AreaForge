import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/app-navigation";
import { ROOT_ROUTES } from "@/lib/navigation/route-helpers";
import { resolveAuthenticatedAppEntry } from "@/lib/study/app-entry-service";
import { LoginClient } from "./login-client";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/login");

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const query = await searchParams;
  const returnTo = query.returnTo
    ? sanitizeReturnPath(query.returnTo, ROOT_ROUTES.public)
    : ROOT_ROUTES.public;
  const user = await getCurrentUser();
  if (user) {
    redirect(returnTo === ROOT_ROUTES.public ? await resolveAuthenticatedAppEntry(user.id) : returnTo);
  }

  return <LoginClient returnTo={returnTo} />;
}
