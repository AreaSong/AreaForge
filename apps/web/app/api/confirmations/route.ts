import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { listConfirmationItems, type ConfirmationFilter } from "@/lib/study/confirmation-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const filterParam = request.nextUrl.searchParams.get("filter");
    const filter: ConfirmationFilter = filterParam === "history" ? "history" : "pending";
    return NextResponse.json({ items: await listConfirmationItems(user.id, filter) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
