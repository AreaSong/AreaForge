import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { loadRankingFixture, assertRankingFixtureContainer, rankingFixtureEnvironment, RANKING_SCHEMA_SHA256 } from "./ranking-rebuild-fixture";

try {
  const fixture = loadRankingFixture(process.argv[2] ?? ""); assertRankingFixtureContainer(fixture);
  if (readdirSync("prisma/migrations").filter(name => /^\d+_/.test(name)).length !== 53
    || createHash("sha256").update(readFileSync("prisma/schema.prisma")).digest("hex") !== RANKING_SCHEMA_SHA256) throw new Error("PREIMAGE_CHANGED");
  const result = spawnSync("pnpm", ["db:migrate:deploy"], { env: rankingFixtureEnvironment(fixture), stdio: "inherit" });
  if (result.error || result.status !== 0) process.exitCode = 1;
} catch { console.error("RANKING_FIXTURE_MIGRATION_REFUSED"); process.exitCode = 1; }
