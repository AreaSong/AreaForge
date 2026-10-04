import { NextRequest, NextResponse } from "next/server";
import { readJson, requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import { readSearchIndex, requestSearchIndex, searchIndexQuerySchema, searchIndexRequestSchema } from "@/lib/system/workspace-search-index-service";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request); const parsed = searchIndexQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ searchIndex: await readSearchIndex(actor, parsed.data.workspaceId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiUser(request); const parsed = searchIndexRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);
    return NextResponse.json({ job: await requestSearchIndex(actor, parsed.data) }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
