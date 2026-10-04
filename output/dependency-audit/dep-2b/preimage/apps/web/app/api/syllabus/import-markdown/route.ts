import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { importSyllabusMarkdownSchema } from "@/lib/study/schemas";
import { importSyllabusMarkdown } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = importSyllabusMarkdownSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json(
      { import: await importSyllabusMarkdown(parsed.data, user.id) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
