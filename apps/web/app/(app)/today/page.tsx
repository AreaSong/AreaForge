import { ActionCenterToday } from "@/components/action-center-today";
import { getCurrentUser } from "@/lib/auth/session";
import { getActionCenterToday } from "@/lib/study/action-center-service";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const today = await getActionCenterToday(user.id);
  return <ActionCenterToday initial={today} />;
}
