import { NextRequest } from "next/server";
import { z } from "zod";
import { readJson, requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { redeemExportDownloadGrant } from "@/lib/system/data-lifecycle-service";

export const dynamic = "force-dynamic";

const redeemSchema = z.object({
  token: z.string().min(32).max(160).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    const parsed = redeemSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    const download = await redeemExportDownloadGrant(actor, parsed.data.token, request.signal);
    return new Response(download.body, { headers: download.headers });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
