import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadOperationFixture, operationFixtureEnvironment, assertOperationFixtureContainer } from "./controlled-operation-fixture";

try {
  const fixture = loadOperationFixture(process.argv[2] ?? ""); assertOperationFixtureContainer(fixture);
  if (readdirSync("prisma/migrations").filter(name => /^\d+_/.test(name)).length !== 53
    || createHash("sha256").update(readFileSync("prisma/schema.prisma")).digest("hex") !== "ab77429b40205a644f13cdf03864f9b73aa45b03003cd4161763bccf33a5a7e0") throw new Error("PREIMAGE_CHANGED");
  const result = spawnSync("pnpm", ["db:migrate:deploy"], { env: operationFixtureEnvironment(fixture), stdio: "inherit" });
  if (result.error || result.status !== 0) process.exitCode = 1;
} catch { console.error("CONTROLLED_OPERATION_FIXTURE_MIGRATION_REFUSED"); process.exitCode = 1; }
