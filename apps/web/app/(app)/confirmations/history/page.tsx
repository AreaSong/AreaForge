import { redirect } from "next/navigation";
import { ConfirmationWindowEntry } from "@/components/confirmation-window-entry";
import { PageFrame } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/confirmations/history");

export default async function ConfirmationHistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <PageFrame variant="content-focus">
      <ConfirmationWindowEntry filter="history" />
    </PageFrame>
  );
}
