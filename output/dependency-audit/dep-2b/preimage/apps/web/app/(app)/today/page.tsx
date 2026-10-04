import { ActionCenterToday } from "@/components/action-center-today";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { getActionCenterToday } from "@/lib/study/action-center-service";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/today");

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const today = await getActionCenterToday(user.id, query.date);
  return <ActionCenterToday initial={today} />;
}
