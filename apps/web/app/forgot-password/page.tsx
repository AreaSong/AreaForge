import { PasswordResetRequestClient } from "@/components/password-reset-request-client";
import { PublicAuthCard } from "@/components/public-auth-card";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";

export const metadata = getRouteMetadata("/forgot-password");
export default function ForgotPasswordPage() { return <PublicAuthCard title="找回密码" description="无论邮箱是否存在，响应都保持一致，避免泄露账户状态。"><PasswordResetRequestClient /></PublicAuthCard>; }
