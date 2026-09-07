import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DATA_EXPORT_MODEL_DISPOSITIONS } from "./data-export-inventory-policy";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(webRoot, "../..");

test("every Prisma model has an explicit export lifecycle disposition", async () => {
  const schema = await readFile(path.join(repoRoot, "prisma/schema.prisma"), "utf8");
  const models = Array.from(schema.matchAll(/^model\s+(\w+)\s+\{/gm), (match) => match[1]!).sort();
  const classified = DATA_EXPORT_MODEL_DISPOSITIONS.map((item) => item.model).sort();
  assert.deepEqual(classified, models);
  assert.equal(new Set(classified).size, classified.length);
  assert.equal(DATA_EXPORT_MODEL_DISPOSITIONS.every((item) => item.reason.trim().length >= 12), true);
  assert.equal(
    DATA_EXPORT_MODEL_DISPOSITIONS.some((item) => item.disposition === "PLANNED_MINIMIZED"),
    false,
  );
  const dispositionCounts = DATA_EXPORT_MODEL_DISPOSITIONS.reduce<Record<string, number>>((counts, item) => ({
    ...counts,
    [item.disposition]: (counts[item.disposition] ?? 0) + 1,
  }), {});
  assert.deepEqual(dispositionCounts, {
    INCLUDED_PREVIEW: 83,
    EXCLUDED_SECURITY: 5,
    DERIVED_REBUILDABLE: 1,
  });
});

test("included preview delegates and security exclusions stay aligned with implementation", async () => {
  const service = [
    "data-lifecycle-service.ts",
    "data-export-inventory-records.ts",
    "data-export-inventory-related-records.ts",
  ].map((file) => readFile(path.join(webRoot, "lib/system", file), "utf8"));
  const implementation = (await Promise.all(service)).join("\n");
  const includedDelegates = Array.from(
    implementation.matchAll(/appendRows\(db, records, "[^"]+", "([^"]+)"/g),
    (match) => `${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)}`,
  ).sort();
  const classifiedIncluded = DATA_EXPORT_MODEL_DISPOSITIONS
    .filter((item) => item.disposition === "INCLUDED_PREVIEW")
    .map((item) => item.model)
    .sort();
  assert.deepEqual(includedDelegates, classifiedIncluded);

  for (const item of DATA_EXPORT_MODEL_DISPOSITIONS.filter((entry) => entry.disposition === "EXCLUDED_SECURITY")) {
    assert.equal(includedDelegates.includes(item.model), false, `${item.model} must stay outside export preview`);
  }
  assert.doesNotMatch(
    implementation,
    /passwordHash:\s*true|tokenHash:\s*true|ipHash:\s*true|userAgentHash:\s*true|apiKeyCiphertext:\s*true|encryptedApiKey:\s*true|objectKey:\s*true|nonce:\s*true|previewNonce:\s*true|idempotencyKey:\s*true|requestFingerprint:\s*true|intentHash:\s*true|requestHash:\s*true|workerId:\s*true|leaseToken:\s*true/,
  );
});
