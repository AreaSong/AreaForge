import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(import.meta.dirname, "seed.ts"), "utf8");

test("db seed initializes identity without creating fixed business subjects", () => {
  assert.match(source, /seedAdmin\(adminEmail, adminPasswordHash\)/);
  assert.doesNotMatch(source, /subjectSeeds|SUBJECTS_SEEDED|prisma\.subject\.(create|update|upsert)/);
});
