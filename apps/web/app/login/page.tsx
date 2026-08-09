import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/app-navigation";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/login");

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const query = await searchParams;
  const returnTo = sanitizeReturnPath(query.returnTo ?? "/focus");
  const user = await getCurrentUser();
  if (user) {
    redirect(returnTo);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#080b0f] px-4 py-8 text-zinc-100">
      <LoginForm returnTo={returnTo} />
    </main>
  );
}
