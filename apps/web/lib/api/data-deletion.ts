import { createJsonRequest, requestApiResult } from "./client";
import type { DeletionResponse, DeletionTargetInput, TrashResourceType } from "@/lib/contracts/data-deletion";
export const listDeletions = () => requestApiResult<DeletionResponse>("/api/system/deletions");
export const previewDeletion = (target: DeletionTargetInput) => requestApiResult<DeletionResponse>("/api/system/deletions/preview", createJsonRequest("POST", target));
export const createDeletion = (input: DeletionTargetInput & { fingerprint: string; idempotencyKey: string; receiptToken: string; confirmation: string }) =>
  requestApiResult<DeletionResponse>("/api/system/deletions", createJsonRequest("POST", input));
export const controlDeletion = (id: string, action: "cancel" | "restore" | "retry", expectedRevision: number) =>
  requestApiResult<DeletionResponse>("/api/system/deletions/" + encodeURIComponent(id), createJsonRequest("PATCH", { action, expectedRevision }));
export const readDeletionReceipt = (id: string, token: string) =>
  requestApiResult<DeletionResponse>("/api/system/deletions/receipt", createJsonRequest("POST", { id, token }));
export const deletionCandidates = (workspaceId: string, resourceType: TrashResourceType, query = "") =>
  requestApiResult<DeletionResponse>("/api/system/deletions/candidates?" + new URLSearchParams({ workspaceId, resourceType, query }));
