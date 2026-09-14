export class RootOperationNoEffectRejection extends Error {
  constructor(readonly requestHash: string, readonly evidenceHash: string, readonly reasonCode: string) {
    super("CONTROLLED_OPERATION_VERIFIED_NO_EFFECT_REJECTION");
  }
}
export class RootOperationUncertainResult extends Error {
  constructor(readonly requestHash: string, readonly evidenceHash: string) {
    super("CONTROLLED_OPERATION_VERIFIED_UNCERTAIN_RESULT");
  }
}
export function validateRootDispatchReceipt(raw: unknown, expectedRequestHash: string, expectsEffect: boolean): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("OPS_PRODUCTION_RECEIPT_INVALID");
  const value = raw as Record<string, unknown>;
  const keys = ["outcome", "requestHash", "evidenceHash", "executionAttempted", "reasonCode"];
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || value.requestHash !== expectedRequestHash
    || typeof value.evidenceHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.evidenceHash)
    || typeof value.reasonCode !== "string" || !/^[A-Z0-9_]{1,80}$/.test(value.reasonCode)
    || (value.executionAttempted !== true && value.executionAttempted !== false && value.executionAttempted !== null)) throw new Error("OPS_PRODUCTION_RECEIPT_INVALID");
  if (value.outcome === "REJECTED" && value.executionAttempted === false) throw new RootOperationNoEffectRejection(expectedRequestHash, value.evidenceHash, value.reasonCode);
  if (value.outcome !== "SUCCEEDED" || value.executionAttempted !== expectsEffect) throw new RootOperationUncertainResult(expectedRequestHash, value.evidenceHash);
  return value.evidenceHash;
}
