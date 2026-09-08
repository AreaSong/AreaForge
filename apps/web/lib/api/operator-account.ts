import type { OperatorAccountDto, OperatorAccountReasonCode } from "@/lib/contracts/operator-account";
import { createJsonRequest, requestApiResult, type ApiResult } from "./client";

export interface OperatorAccountsResponse {
  accounts?: OperatorAccountDto[];
  account?: OperatorAccountDto;
  revokedSessionCount?: number;
  error?: string;
}

export function listOperatorAccounts(): Promise<ApiResult<OperatorAccountsResponse>> {
  return requestApiResult("/api/system/accounts");
}

export function updateOperatorAccountStatus(
  userId: string,
  input: {
    status: OperatorAccountDto["status"];
    expectedAuthRevision: number;
    reason: OperatorAccountReasonCode;
  },
): Promise<ApiResult<OperatorAccountsResponse>> {
  return requestApiResult(
    `/api/system/accounts/${encodeURIComponent(userId)}/status`,
    createJsonRequest("PATCH", input),
  );
}

export function revokeOperatorAccountSessions(
  userId: string,
  reason: OperatorAccountReasonCode,
): Promise<ApiResult<OperatorAccountsResponse>> {
  return requestApiResult(
    `/api/system/accounts/${encodeURIComponent(userId)}/sessions/revoke`,
    createJsonRequest("POST", { reason }),
  );
}
