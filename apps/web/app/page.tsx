import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveAuthenticatedAppEntry } from "@/lib/study/app-entry-service";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  redirect(await resolveAuthenticatedAppEntry(user.id));
}
