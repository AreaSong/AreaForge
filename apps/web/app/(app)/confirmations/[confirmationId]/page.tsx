import { redirect } from "next/navigation";
import { ConfirmationWindowEntry } from "@/components/confirmation-window-entry";
import { PageFrame } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/confirmations/detail");

export default async function ConfirmationDetailPage({ params }: {
  params: Promise<{ confirmationId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { confirmationId } = await params;
  return (
    <PageFrame variant="content-focus">
      <ConfirmationWindowEntry filter="pending" confirmationId={decodeURIComponent(confirmationId)} />
    </PageFrame>
  );
}
