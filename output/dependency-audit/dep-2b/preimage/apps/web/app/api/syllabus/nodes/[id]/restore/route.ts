import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { restoreSyllabusNode } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

const commandSchema = z.object({ expectedRevision: z.number().int().positive() });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { id } = await context.params;
    const parsed = commandSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ node: await restoreSyllabusNode(id, parsed.data.expectedRevision, user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
