import { setTimeout as delay } from "node:timers/promises";
import { quotaRuntimeCode, quotaTransient } from "./quota-runtime-support";

export const capacityRuntimeCode = quotaRuntimeCode;
export function capacityTransient(code: string): boolean {
  return quotaTransient(code) || ["WORKSPACE_MEMBER_QUOTA_BUSY", "57014"].includes(code);
}
export async function retryCapacityFixture<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { return await run(); }
    catch (error) { if (!capacityTransient(capacityRuntimeCode(error)) || attempt === 29) throw error; await delay(25 + attempt * 3); }
  }
  throw new Error("CAPACITY_RETRY_EXHAUSTED");
}
