import { getClientDeviceHeaders } from "@/lib/client/device-identity";
import type { StudySessionDto } from "@/lib/study/types";

export type ActiveStudySessionSnapshot = Pick<StudySessionDto, "id" | "status">;

export async function readActiveStudySession(): Promise<StudySessionDto | null> {
  const response = await fetch("/api/study-sessions/active", { cache: "no-store", headers: getClientDeviceHeaders() });
  const body = await response.json().catch(() => null) as {
    session?: StudySessionDto | null;
    error?: string;
  } | null;
  if (!response.ok) throw new Error(body?.error ?? "无法读取当前活动。");
  if (!body?.session) return null;
  if (typeof body.session.id !== "string") throw new Error("活动状态响应缺少 session.id。");
  if (body.session.status !== "running" && body.session.status !== "paused" && body.session.status !== "closing") {
    throw new Error("活动状态响应包含未知状态。");
  }
  return body.session;
}
