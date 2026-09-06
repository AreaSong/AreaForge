import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeDataExportValue,
  createDataExportManifest,
  hashDataExportManifest,
  hashDataExportBytes,
  hashDataExportValue,
  isRestrictedDataExportKey,
  normalizeDataInventory,
  redactDataExportValue,
  redactDataExportValueWithSummary,
} from "./data-lifecycle";

test("redaction omits secrets and internal paths without mutating input", () => {
  const input = {
    stableKey: "node-1",
    workspaceKey: "workspace-1",
    apiKey: "do-not-export",
    session_token: "do-not-export",
    "internal-path": "/srv/areaforge/uploads/a.pdf",
    attachment: { uri: "uploads/a.pdf", storedName: "a.pdf", title: "notes" },
    nested: [{ authorization: "Bearer secret", value: 3 }, undefined],
  };

  const copy = structuredClone(input);
  const redacted = redactDataExportValue(input);

  assert.deepEqual(redacted, {
    stableKey: "node-1",
    workspaceKey: "workspace-1",
    attachment: { title: "notes" },
    nested: [{ value: 3 }],
  });
  assert.deepEqual(input, copy);
  assert.equal(JSON.stringify(redacted).includes("do-not-export"), false);
  assert.equal(JSON.stringify(redacted).includes("uploads"), false);
  assert.equal(isRestrictedDataExportKey("provider_api_key"), true);
  assert.equal(isRestrictedDataExportKey("secretKey"), true);
  assert.equal(isRestrictedDataExportKey("stableKey"), false);
});

test("redaction summary and canonical hash are deterministic", () => {
  const first = { b: 2, a: 1, passwordHash: "hidden" };
  const second = { a: 1, b: 2, passwordHash: "different-hidden" };
  const summary = redactDataExportValueWithSummary(first);

  assert.equal(summary.omittedFieldCount, 1);
  assert.equal(canonicalizeDataExportValue(first), '{"a":1,"b":2}');
  assert.equal(canonicalizeDataExportValue(first), canonicalizeDataExportValue(second));
  assert.equal(hashDataExportValue(first), "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
  assert.equal(hashDataExportValue(first), hashDataExportValue(second));
});

test("manifest sorts records, reports omissions, and binds entry hashes", () => {
  const manifest = createDataExportManifest({
    scope: "workspace",
    generatedAt: "2026-09-06T00:00:00.000Z",
    records: [
      { kind: "note", id: "n-2", data: { title: "B" } },
      { kind: "account", id: "a-1", data: { email: "a@example.test", sessionToken: "hidden" } },
      { kind: "note", id: "n-1", data: { title: "A", path: "/private/file" } },
    ],
  });

  assert.deepEqual(manifest.entries.map((entry) => `${entry.kind}/${entry.id}`), ["account/a-1", "note/n-1", "note/n-2"]);
  assert.equal(manifest.entries[0]?.omittedFieldCount, 1);
  assert.equal(manifest.entries[1]?.omittedFieldCount, 1);
  assert.equal(manifest.entries[1]?.sha256, hashDataExportValue({ title: "A" }));
  assert.equal(hashDataExportManifest(manifest), hashDataExportManifest({ ...manifest, entries: [...manifest.entries].reverse() }));
  assert.equal(JSON.stringify(manifest).includes("sessionToken"), false);
  assert.equal(JSON.stringify(manifest).includes("/private/file"), false);
});

test("inventory is normalized and duplicate/path policies fail closed", () => {
  const normalized = normalizeDataInventory([
    { kind: "StudySession", owner: "workspace", sensitivity: "private", exportPolicy: "include", deletePolicy: "eligible" },
    { kind: "AccountCredential", owner: "account", sensitivity: "secret", exportPolicy: "exclude", deletePolicy: "retained" },
  ]);
  assert.deepEqual(normalized.map((item) => item.kind), ["AccountCredential", "StudySession"]);
  assert.throws(() => normalizeDataInventory([
    { kind: "Note", owner: "workspace", sensitivity: "private", exportPolicy: "include", deletePolicy: "eligible" },
    { kind: "Note", owner: "workspace", sensitivity: "private", exportPolicy: "include", deletePolicy: "eligible" },
  ]), /Duplicate inventory kind/);
  assert.throws(() => createDataExportManifest({
    scope: "account",
    generatedAt: "now",
    records: [{ kind: "note", id: "../secret", data: {} }],
  }), /filesystem path/);
});

test("cyclic and unsupported values fail closed", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => redactDataExportValue(cyclic), /Cyclic export value/);
  assert.throws(() => redactDataExportValue(Symbol("secret")), /Unsupported export value/);
});

test("Prisma-shaped temporal and numeric values become portable JSON", () => {
  const decimalLike = { constructor: { name: "Decimal" }, toString: () => "12.3400" };
  assert.deepEqual(redactDataExportValue({ at: new Date("2026-09-06T00:00:00.000Z"), count: 12n, amount: decimalLike }), {
    at: "2026-09-06T00:00:00.000Z",
    count: "12",
    amount: "12.3400",
  });
  assert.throws(() => redactDataExportValue(new Date("invalid")), /Invalid date/);
});

test("binary hash binds exact archive bytes", () => {
  assert.equal(hashDataExportBytes(Uint8Array.from([97, 98, 99])), "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.notEqual(hashDataExportBytes(Uint8Array.from([97, 98, 99])), hashDataExportBytes(Uint8Array.from([97, 98, 100])));
});
