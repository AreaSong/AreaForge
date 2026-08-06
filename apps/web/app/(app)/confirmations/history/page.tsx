import { redirect } from "next/navigation";
import { ConfirmationWindowEntry } from "@/components/confirmation-window-entry";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/confirmations/history");

export default async function ConfirmationHistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <ConfirmationWindowEntry filter="history" />;
}
