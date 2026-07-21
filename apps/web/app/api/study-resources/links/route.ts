import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createLinkStudyResource } from "@/lib/study/study-resource-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.string().trim().min(1).max(2048),
  subjectId: z.string().nullable().optional(),
  category: z.string().optional(),
  stableKey: z.string().trim().min(1).max(80).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json(
      { resource: await createLinkStudyResource(user.id, parsed.data) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
