import nodemailer, { type Transporter } from "nodemailer";
import { getAuthEnv } from "./env";
import { normalizeEmail } from "./session";

export type AuthMailPurpose = "INVITATION" | "EMAIL_VERIFICATION" | "PASSWORD_RESET";

export interface AuthMailInput {
  to: string;
  purpose: AuthMailPurpose;
  actionUrl: string;
}

export async function sendAuthMail(input: AuthMailInput): Promise<{ messageId: string }> {
  const env = getAuthEnv();
  const to = normalizeEmail(input.to);
  const actionUrl = validateActionUrl(input.actionUrl, env.APP_URL);
  const content = buildAuthMailContent(input.purpose, actionUrl);
  const transport = createAuthMailTransport();
  const result = await transport.sendMail({
    from: env.SMTP_FROM ?? "AreaForge <no-reply@localhost>",
    to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
  return { messageId: result.messageId };
}

export function buildAuthMailContent(purpose: AuthMailPurpose, actionUrl: string) {
  const title = purpose === "INVITATION"
    ? "加入 AreaForge Workspace"
    : purpose === "EMAIL_VERIFICATION"
      ? "验证 AreaForge 邮箱"
      : "重置 AreaForge 密码";
  const action = purpose === "INVITATION" ? "接受邀请" : purpose === "EMAIL_VERIFICATION" ? "验证邮箱" : "重置密码";
  const safeUrl = escapeHtml(actionUrl);
  return {
    subject: title,
    text: `${title}\n\n${action}：${actionUrl}\n\n如果这不是你的操作，请忽略本邮件。`,
    html: `<p>${title}</p><p><a href="${safeUrl}">${action}</a></p><p>如果这不是你的操作，请忽略本邮件。</p>`,
  };
}

function createAuthMailTransport(): Transporter {
  const env = getAuthEnv();
  const smtpConfigured = Boolean(env.SMTP_HOST && env.SMTP_FROM);
  const authConfigured = Boolean(env.SMTP_USER && env.SMTP_PASSWORD);
  const partialAuth = Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD);
  if (smtpConfigured && !partialAuth) {
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      requireTLS: !env.SMTP_SECURE,
      auth: authConfigured ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }
  if (env.APP_ENV === "development" || env.APP_ENV === "test") {
    return nodemailer.createTransport({ jsonTransport: true });
  }
  throw new Error("SMTP configuration is incomplete for auth mail delivery.");
}

function validateActionUrl(value: string, appUrl: string): string {
  const actionUrl = new URL(value);
  const expected = new URL(appUrl);
  const fragment = new URLSearchParams(actionUrl.hash.slice(1));
  const token = fragment.get("token");
  if (
    actionUrl.origin !== expected.origin
    || actionUrl.username
    || actionUrl.password
    || actionUrl.search
    || fragment.size !== 1
    || !token
    || token.length < 32
    || token.length > 256
  ) {
    throw new Error("Auth action URL must use the configured AreaForge origin.");
  }
  return actionUrl.toString();
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
