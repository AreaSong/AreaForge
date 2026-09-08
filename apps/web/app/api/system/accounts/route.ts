import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { apiErrorResponse } from "@/lib/api/responses";
import { listOperatorAccounts } from "@/lib/system/account-management-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiUser(request);
    return NextResponse.json({ accounts: await listOperatorAccounts(actor) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
