import { redirect } from "next/navigation";
import { ConfirmationWindowEntry } from "@/components/confirmation-window-entry";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/confirmations");

export default async function ConfirmationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <ConfirmationWindowEntry filter="pending" />;
}
