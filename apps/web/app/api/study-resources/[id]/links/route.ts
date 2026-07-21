import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { linkStudyResource } from "@/lib/study/study-resource-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  taskIds: z.array(z.string()).optional(),
  noteIds: z.array(z.string()).optional(),
  mistakeIds: z.array(z.string()).optional(),
  syllabusNodeIds: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ resource: await linkStudyResource(user.id, id, parsed.data) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
