import { EmailVerificationClient } from "@/components/email-verification-client";
import { PublicAuthCard } from "@/components/public-auth-card";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";

export const metadata = getRouteMetadata("/verify-email");
export default function VerifyEmailPage() { return <PublicAuthCard title="验证邮箱" description="验证链接只能使用一次，并且有固定有效期。"><EmailVerificationClient /></PublicAuthCard>; }
