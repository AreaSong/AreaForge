import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import {
  createUpdateRequest,
  autoApplyPolicies,
  updateActions,
} from "@/lib/system/update-center";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  action: z.enum(updateActions),
  tag: z.string().regex(/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/).optional(),
  autoApply: z.enum(autoApplyPolicies).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = requestSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    const updateRequest = await createUpdateRequest({
      action: parsed.data.action,
      tag: parsed.data.tag,
      autoApply: parsed.data.autoApply,
      actorEmail: user.email,
    });

    return NextResponse.json({ request: updateRequest }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
