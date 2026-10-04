import { getClientDeviceHeaders } from "@/lib/client/device-identity";
import { getActiveStudySession } from "@/lib/api/session";
import type { StudySessionDto } from "@/lib/contracts";

export type ActiveStudySessionSnapshot = Pick<StudySessionDto, "id" | "status">;

export async function readActiveStudySession(): Promise<StudySessionDto | null> {
  const result = await getActiveStudySession(getClientDeviceHeaders());
  const body = result.body;
  if (!result.ok) throw new Error(body?.error ?? "无法读取当前活动。");
  if (!body?.session) return null;
  if (typeof body.session.id !== "string") throw new Error("活动状态响应缺少 session.id。");
  if (body.session.status !== "running" && body.session.status !== "paused" && body.session.status !== "closing") {
    throw new Error("活动状态响应包含未知状态。");
  }
  return body.session;
}
