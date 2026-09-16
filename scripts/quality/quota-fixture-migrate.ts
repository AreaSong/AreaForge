import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { loadQuotaFixture, assertQuotaFixtureContainer, quotaFixtureEnvironment, QUOTA_SCHEMA_SHA256 } from "./quota-fixture";

try {
  const fixture = loadQuotaFixture(process.argv[2] ?? ""); assertQuotaFixtureContainer(fixture);
  if (readdirSync("prisma/migrations").filter(name => /^\d+_/.test(name)).length !== 54
    || createHash("sha256").update(readFileSync("prisma/schema.prisma")).digest("hex") !== QUOTA_SCHEMA_SHA256) throw new Error("PREIMAGE_CHANGED");
  const result = spawnSync("pnpm", ["db:migrate:deploy"], { env: quotaFixtureEnvironment(fixture), stdio: "inherit" });
  if (result.error || result.status !== 0) process.exitCode = 1;
} catch { console.error("QUOTA_FIXTURE_MIGRATION_REFUSED"); process.exitCode = 1; }
