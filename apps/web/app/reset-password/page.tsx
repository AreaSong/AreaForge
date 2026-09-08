import { PublicAuthCard } from "@/components/public-auth-card";
import { TokenPasswordResetClient } from "@/components/token-password-reset-client";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";

export const metadata = getRouteMetadata("/reset-password");
export default function ResetPasswordPage() { return <PublicAuthCard title="重置密码" description="重置成功后，所有旧设备会话都会立即失效。"><TokenPasswordResetClient /></PublicAuthCard>; }
