import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/app-navigation";
import { LoginClient } from "./login-client";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/login");

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const query = await searchParams;
  const returnTo = sanitizeReturnPath(query.returnTo ?? "/focus");
  const user = await getCurrentUser();
  if (user) {
    redirect(returnTo);
  }

  return <LoginClient returnTo={returnTo} />;
}
