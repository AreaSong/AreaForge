import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth/session";
import { sanitizeReturnPath } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const query = await searchParams;
  const returnTo = sanitizeReturnPath(query.returnTo);
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
