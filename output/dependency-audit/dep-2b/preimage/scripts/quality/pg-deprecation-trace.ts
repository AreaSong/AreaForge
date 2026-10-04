import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createPrismaClient } from "../../packages/db/src/index";

const warningPatterns = [
  /client\.query/i,
  /already executing a query/i,
  /deprecated/i,
] as const;

const require = createRequire(import.meta.url);
const dbRequire = createRequire(new URL("../../packages/db/src/index.ts", import.meta.url));
const warnings: string[] = [];
const originalWarn = console.warn.bind(console);

console.warn = (...args: unknown[]) => {
  warnings.push(args.map(String).join(" "));
  originalWarn(...args);
};

process.on("warning", (warning) => {
  warnings.push(`${warning.name}: ${warning.message}\n${warning.stack ?? ""}`);
});

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for pg deprecation trace.");
  }
  if (!isLocalDatabaseUrl(databaseUrl) && process.env.AREAFORGE_PG_TRACE_ALLOW_NON_LOCAL !== "true") {
    throw new Error("pg deprecation trace may issue rollback-protected writes and only runs against local database URLs by default.");
  }

  const prisma = createPrismaClient(databaseUrl);
  try {
    const subjectCount = await prisma.subject.count();
    const concurrentCounts = await Promise.all([
      prisma.user.count(),
      prisma.studyTask.count(),
      prisma.studySession.count(),
      prisma.note.count(),
      prisma.simulationExam.count(),
      prisma.stagePlan.count(),
    ]);
    const transactionCounts = await prisma.$transaction(async (tx) => ({
      users: await tx.user.count(),
      tasks: await tx.studyTask.count(),
      sessions: await tx.studySession.count(),
    }));
    const representativeInclude = await prisma.$transaction(async (tx) => {
      const subject = await tx.subject.findFirstOrThrow({
        orderBy: { sortOrder: "asc" },
        select: { id: true },
      });
      const node = await tx.syllabusNode.create({
        data: {
          subjectId: subject.id,
          title: `pg trace representative ${Date.now()}`,
          kind: "TOPIC",
          status: "LEARNING",
          targetMinutes: 1,
        },
        include: {
          _count: {
            select: {
              tasks: true,
              sessions: true,
              notes: true,
              mistakes: true,
            },
          },
          tasks: {
            take: 1,
            select: { id: true },
          },
          sessions: {
            take: 1,
            select: { id: true },
          },
          notes: {
            take: 1,
            select: { id: true },
          },
          mistakes: {
            take: 1,
            select: { id: true },
          },
        },
      });

      await tx.syllabusNode.delete({ where: { id: node.id } });
      return { id: node.id, relationCount: node._count.tasks + node._count.sessions + node._count.notes + node._count.mistakes };
    });
    await prisma.$queryRaw`SELECT 1`;

    const matchedWarnings = warnings.filter((warning) =>
      warningPatterns.some((pattern) => pattern.test(warning)),
    );
    const facts = {
      ok: matchedWarnings.length === 0,
      node: process.version,
      pgVersion: packageVersion("pg"),
      prismaAdapterPgVersion: packageVersion("@prisma/adapter-pg"),
      subjectCount,
      concurrentCounts,
      transactionCounts,
      representativeInclude,
      warningCount: warnings.length,
      matchedWarningCount: matchedWarnings.length,
    };
    console.log(JSON.stringify(facts, null, 2));

    if (matchedWarnings.length > 0) {
      console.error(matchedWarnings.join("\n---\n"));
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

function isLocalDatabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function packageVersion(name: string): string {
  for (const packageRequire of [require, dbRequire]) {
    const version = packageVersionFromRequire(packageRequire, name);
    if (version !== "unknown") {
      return version;
    }
  }

  return "unknown";
}

function packageVersionFromRequire(
  packageRequire: NodeJS.Require,
  name: string,
): string {
  try {
    return packageRequire(`${name}/package.json`).version as string;
  } catch {
    return packageVersionFromEntry(packageRequire, name);
  }
}

function packageVersionFromEntry(
  packageRequire: NodeJS.Require,
  name: string,
): string {
  try {
    let currentDirectory = dirname(packageRequire.resolve(name));
    while (currentDirectory !== dirname(currentDirectory)) {
      const packageJsonPath = join(currentDirectory, "package.json");
      if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
          version?: unknown;
        };
        return typeof packageJson.version === "string" ? packageJson.version : "unknown";
      }
      currentDirectory = dirname(currentDirectory);
    }
  } catch {
    return "unknown";
  }

  return "unknown";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "pg deprecation trace failed");
  process.exit(1);
});
