import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "./idempotent-command";
import { redirectToLoginWithCurrentLocation } from "./private-business-drafts";
import { getBrowserStoragePort } from "./storage-port";
import { isUnauthorized } from "./api-errors";
import { linkStudySessionEvidence } from "@/lib/api/session";
import type {
  StudySessionDto,
  StudySessionEvidenceReceiptDto,
  StudySessionEvidenceTypeDto,
} from "@/lib/contracts";

export function isFocusEvidenceFlowOpen(userId: string, sessionId: string): boolean {
  if (typeof window === "undefined") return false;
  return getBrowserStoragePort("local")?.getItem(focusEvidenceFlowKey(userId, sessionId)) === "open";
}

export function setFocusEvidenceFlowOpen(userId: string, sessionId: string, open: boolean): void {
  if (typeof window === "undefined") return;
  const key = focusEvidenceFlowKey(userId, sessionId);
  const storage = getBrowserStoragePort("local");
  if (!storage) return;
  if (open) storage.setItem(key, "open");
  else storage.removeItem(key);
}

export async function linkFocusSessionEvidence(
  session: StudySessionDto,
  input: { evidenceType: StudySessionEvidenceTypeDto; evidenceId: string },
): Promise<{ session: StudySessionDto; receipt: StudySessionEvidenceReceiptDto }> {
  const commandScope = `focus-evidence-link:${session.id}:${input.evidenceType}:${input.evidenceId}`;
  const payload = {
    expectedCloseoutVersion: session.closeoutVersion || 1,
    evidenceType: input.evidenceType,
    evidenceId: input.evidenceId,
  };
  const result = await linkStudySessionEvidence(session.id, {
    idempotencyKey: getOrCreateIdempotencyKey(commandScope, "focus-evidence-link", payload),
    ...payload,
  });
  const body = result.body;
  if (isUnauthorized(result)) {
    redirectToLoginWithCurrentLocation();
    throw new Error("登录已过期，证据已经创建，回写身份仍保留。重新登录后请显式重试。");
  }
  if (!result.ok || !body?.session || !body.receipt) {
    throw new Error(body?.error ?? "证据已经创建，但回写本次学习失败；请显式重试，不会重复创建。");
  }
  completeIdempotentCommand(commandScope);
  return { session: body.session, receipt: body.receipt };
}

function focusEvidenceFlowKey(userId: string, sessionId: string): string {
  return `areaforge.focus.evidence-flow.v1.${userId}.${sessionId}`;
}
