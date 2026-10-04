import type { NextRequest } from "next/server";
import { z } from "zod";
import { readJson, requireSameOrigin } from "@/lib/api/auth";
import { getDeletionReceipt } from "@/lib/system/data-deletion-service";
import { deletionErrorResponse, deletionJson } from "@/lib/system/data-deletion-route";
export const dynamic = "force-dynamic";
const receiptSchema = z.object({ id: z.string().min(1).max(200), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export async function POST(request: NextRequest) {
  try {
    // 账户已删除后仅凭本次高熵、短时回执能力读取最小状态；无控制、正文或下载权限。
    requireSameOrigin(request);
    const parsed = receiptSchema.safeParse(await readJson(request));
    if (!parsed.success) return deletionJson({ error: "DATA_DELETE_NOT_FOUND" }, 404);
    return deletionJson({ intent: await getDeletionReceipt(parsed.data.id, parsed.data.token) });
  } catch (error) { return deletionErrorResponse(error); }
}
