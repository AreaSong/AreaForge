import { redirect } from "next/navigation";
import { ConfirmationWindowEntry } from "@/components/confirmation-window-entry";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/app-navigation";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/confirmations/detail");

export default async function ConfirmationDetailPage({ params, searchParams }: {
  params: Promise<{ confirmationId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { confirmationId } = await params;
  const query = await searchParams;
  const returnTo = query.returnTo ? sanitizeReturnPath(query.returnTo) : "/today";
  return <ConfirmationWindowEntry filter="pending" confirmationId={decodeURIComponent(confirmationId)} returnTo={returnTo.startsWith("/confirmations") ? "/today" : returnTo} />;
}
