import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { createMotivationItemSchema } from "@/lib/study/schemas";
import { createMotivationItem, listMotivationItems } from "@/lib/study/motivation-library-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "1";
    return NextResponse.json({ items: await listMotivationItems(user.id, includeArchived) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = createMotivationItemSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ item: await createMotivationItem(user.id, parsed.data) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
