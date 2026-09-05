import { InvitationAcceptClient } from "@/components/invitation-accept-client";
import { PublicAuthCard } from "@/components/public-auth-card";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata = getRouteMetadata("/invitations/accept");
export default async function InvitationPage({ searchParams }: { searchParams: Promise<{ resume?: string }> }) {
  const query = await searchParams;
  const user = await getCurrentUser();
  if (query.resume === "1" && !user) {
    redirect("/login?returnTo=%2Finvitations%2Faccept%3Fresume%3D1");
  }
  return <PublicAuthCard title="Workspace 邀请" description="已有账户需先使用受邀邮箱登录；新账户只能通过有效邀请创建。"><InvitationAcceptClient currentUser={user ? { id: user.id, email: user.email } : null} /></PublicAuthCard>;
}
