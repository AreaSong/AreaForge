import { redirect } from "next/navigation";
import { ConfirmationWindowEntry } from "@/components/confirmation-window-entry";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/confirmations/detail");

export default async function ConfirmationDetailPage({ params }: {
  params: Promise<{ confirmationId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { confirmationId } = await params;
  return <ConfirmationWindowEntry filter="pending" confirmationId={decodeURIComponent(confirmationId)} />;
}
