import { NextResponse } from "next/server";
import { z } from "zod";
import { DataDeleteError } from "@areaforge/core";
import { apiErrorResponse } from "@/lib/api/responses";

export const deletionTargetSchema = z.object({ scope: z.enum(["ACCOUNT", "WORKSPACE", "RESOURCE"]),
  workspaceId: z.string().min(1).max(200).optional(), resourceType: z.enum(["Note", "Mistake", "StudyTask", "StudyResource", "KnowledgePoint"]).optional(),
  resourceId: z.string().min(1).max(200).optional() }).strict();
export const deletionCreateSchema = deletionTargetSchema.extend({ fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  idempotencyKey: z.string().min(1).max(200), receiptToken: z.string().regex(/^[a-f0-9]{64}$/), confirmation: z.string().min(1).max(30) }).strict();
export function deletionJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
export function deletionErrorResponse(error: unknown) {
  if (error instanceof DataDeleteError) {
    const status = ["DATA_DELETE_NOT_FOUND", "DATA_DELETE_DISABLED", "DATA_DELETE_AUTHORIZATION_CHANGED"].includes(error.code) ? 404
      : error.code === "DATA_DELETE_REAUTHENTICATION_REQUIRED" ? 403
      : ["DATA_DELETE_SCOPE_INVALID", "DATA_DELETE_IDENTIFIER_INVALID", "DATA_DELETE_CONFIRMATION_REQUIRED"].includes(error.code) ? 400 : 409;
    return deletionJson({ error: error.code, workbench: "/settings/data" }, status);
  }
  const response = apiErrorResponse(error); response.headers.set("Cache-Control", "private, no-store"); return response;
}
