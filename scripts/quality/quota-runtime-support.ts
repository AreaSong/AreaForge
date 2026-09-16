import { setTimeout as delay } from "node:timers/promises";

export function quotaRuntimeCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const meta = field(error, "meta"); const cause = field(field(meta, "driverAdapterError"), "cause");
  // Prisma 原生 SQL 可能以 P2010 包装 SQLSTATE，而不是返回 ORM 的 P2034。
  for (const code of [field(meta, "code"), field(cause, "originalCode"), field(cause, "code")]) {
    if (["40001", "40P01", "55P03"].includes(String(code))) return String(code);
  }
  const value = "code" in error ? error.code : "";
  return typeof value === "string" && /^[A-Z0-9_]{1,80}$/.test(value) ? value : "UNKNOWN";
}

export function quotaTransient(code: string): boolean {
  return ["P2034", "40001", "40P01", "55P03", "DATA_JOB_QUOTA_BUSY", "DATA_JOB_SCOPE_BUSY", "SEARCH_INDEX_SCOPE_BUSY", "RANKING_REBUILD_SCOPE_BUSY", "DATA_EXPORT_SCOPE_BUSY",
    "SEARCH_INDEX_GENERATION_CONFLICT"].includes(code);
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" && key in value ? (value as Record<string, unknown>)[key] : undefined;
}

export async function retryQuotaFixture<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { return await run(); }
    catch (error) { if (!quotaTransient(quotaRuntimeCode(error)) || attempt === 29) throw error; await delay(25 + attempt * 3); }
  }
  throw new Error("QUOTA_RETRY_EXHAUSTED");
}
