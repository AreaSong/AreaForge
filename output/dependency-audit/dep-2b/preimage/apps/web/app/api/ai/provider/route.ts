import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, readJson } from "@/lib/api/auth";
import { apiErrorResponse, zodErrorResponse } from "@/lib/api/responses";
import {
  deleteAiProviderCredential,
  getAiProviderCredentialStatus,
  saveAiProviderCredential,
} from "@/lib/study/ai-provider-credential-service";
import { patchAiProviderCredentialSchema } from "@/lib/study/schemas";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ provider: await getAiProviderCredentialStatus(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const parsed = patchAiProviderCredentialSchema.safeParse(await readJson(request));
    if (!parsed.success) return zodErrorResponse(parsed.error);

    return NextResponse.json({
      provider: await saveAiProviderCredential(user.id, parsed.data),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    return NextResponse.json({ provider: await deleteAiProviderCredential(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
