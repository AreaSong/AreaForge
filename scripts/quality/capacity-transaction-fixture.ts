import type { Prisma, PrismaClient } from "../../packages/db/src/index";

type Hooks = { before?: (tx: Prisma.TransactionClient) => Promise<void>; afterQuery?: (sql: string) => Promise<void>;
  beforeCommit?: () => Promise<void>; onError?: (error: unknown) => void };

/** 仅在合成运行器中插入屏障，不修改实际生产者的授权、SQL或事务隔离选项。 */
export function instrumentCapacityClient(client: PrismaClient, hooks: Hooks): PrismaClient {
  return new Proxy(client, { get(target, key, receiver) {
    if (key === "$transaction") return async <T>(run: (tx: Prisma.TransactionClient) => Promise<T>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number }): Promise<T> => {
      try {
        return await target.$transaction(async tx => {
          await hooks.before?.(tx);
          const proxy = new Proxy(tx, { get(source, field, innerReceiver) {
            if (field === "$queryRaw") return async (sql: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
              const result = await source.$queryRaw(sql, ...values);
              await hooks.afterQuery?.(Array.isArray(sql) ? sql.join("?") : (sql as Prisma.Sql).sql);
              return result;
            };
            const value = Reflect.get(source, field, innerReceiver);
            return typeof value === "function" ? value.bind(source) : value;
          } });
          const result = await run(proxy); await hooks.beforeCommit?.(); return result;
        }, options);
      } catch (error) { hooks.onError?.(error); throw error; }
    };
    const value = Reflect.get(target, key, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

export function capacitySignal() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

export async function waitCapacityBarrier(signal: Promise<void>, operation: Promise<unknown>, timeoutMs = 10_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([signal, operation.then(() => { throw new Error("CAPACITY_BARRIER_OPERATION_ENDED"); }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("CAPACITY_BARRIER_TIMEOUT")), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

export async function settleCapacityResults<T>(attempts: readonly Promise<T>[]): Promise<T[]> {
  // 全部请求排空后才抛错，确保调用方的 finally 不先于迟到提交释放合成名额。
  const results = await Promise.allSettled(attempts);
  return results.map(result => { if (result.status === "rejected") throw result.reason; return result.value; });
}
