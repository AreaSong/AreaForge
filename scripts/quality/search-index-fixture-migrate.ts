import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { loadSearchIndexFixture, assertSearchIndexFixtureContainer, searchIndexFixtureEnvironment, SEARCH_INDEX_SCHEMA_SHA256 } from "./search-index-fixture";

try {
  const fixture = loadSearchIndexFixture(process.argv[2] ?? ""); assertSearchIndexFixtureContainer(fixture);
  if (readdirSync("prisma/migrations").filter(name => /^\d+_/.test(name)).length !== 54
    || createHash("sha256").update(readFileSync("prisma/schema.prisma")).digest("hex") !== SEARCH_INDEX_SCHEMA_SHA256) throw new Error("PREIMAGE_CHANGED");
  const result = spawnSync("pnpm", ["db:migrate:deploy"], { env: searchIndexFixtureEnvironment(fixture), stdio: "inherit" });
  if (result.error || result.status !== 0) process.exitCode = 1;
} catch { console.error("SEARCH_INDEX_FIXTURE_MIGRATION_REFUSED"); process.exitCode = 1; }
