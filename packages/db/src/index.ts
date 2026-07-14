import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

type Queryable = {
  queryRaw: (...args: unknown[]) => Promise<unknown>;
  executeRaw: (...args: unknown[]) => Promise<unknown>;
};

type Adapter = object & {
  startTransaction?: (...args: unknown[]) => Promise<Queryable>;
};

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

let processPrisma = globalForPrisma.prisma;

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to create PrismaClient.");
  }

  const adapter = createSerializedPrismaPg(connectionString);
  return new PrismaClient({ adapter });
}

function createSerializedPrismaPg(connectionString: string): PrismaPg {
  const factory = new PrismaPg({ connectionString });

  return new Proxy(factory, {
    get(target, property, receiver) {
      if (property === "connect" || property === "connectToShadowDb") {
        const connect = Reflect.get(target, property, receiver) as (...args: unknown[]) => Promise<Adapter>;
        return async (...args: unknown[]) => serializeAdapter(await connect.apply(target, args));
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function serializeAdapter<T extends Adapter>(adapter: T): T {
  return new Proxy(adapter, {
    get(target, property, receiver) {
      if (property === "startTransaction") {
        const startTransaction = Reflect.get(target, property, receiver) as (...args: unknown[]) => Promise<Queryable>;
        return async (...args: unknown[]) => serializeQueryable(await startTransaction.apply(target, args));
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function serializeQueryable<T extends Queryable>(queryable: T): T {
  let tail: Promise<void> = Promise.resolve();

  function enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = tail.then(operation, operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return new Proxy(queryable, {
    get(target, property, receiver) {
      if (property === "queryRaw" || property === "executeRaw") {
        const query = Reflect.get(target, property, receiver) as (...args: unknown[]) => Promise<unknown>;
        return (...args: unknown[]) => enqueue(() => query.apply(target, args));
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function getPrismaClient(): PrismaClient {
  const client = globalForPrisma.prisma ?? processPrisma ?? createPrismaClient();

  processPrisma = client;
  globalForPrisma.prisma = client;

  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export type { PrismaClient };
export type { Prisma } from "../generated/prisma/client";
