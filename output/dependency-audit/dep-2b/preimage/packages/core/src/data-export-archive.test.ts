import assert from "node:assert/strict";
import test from "node:test";
import { createDataExportArchive, writeDataExportArchive } from "./data-export-archive";

const input = {
  scope: "workspace" as const,
  generatedAt: "2026-09-06T00:00:00.000Z",
  records: [
    { kind: "note", id: "n-2", data: { title: "B", sessionToken: "secret" } },
    { kind: "note", id: "n-1", data: { title: "A" } },
  ],
};

test("archive is deterministic, redacted, and contains manifest plus sorted entries", () => {
  const first = createDataExportArchive(input);
  const second = createDataExportArchive({ ...input, records: [...input.records].reverse() });
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.equal(first.archiveSha256, second.archiveSha256);
  assert.deepEqual(first.entries, ["manifest.json", "entries/note/n-1.json", "entries/note/n-2.json"]);
  assert.equal(JSON.stringify(first.manifest).includes("sessionToken"), false);
  assert.equal(first.contentType, "application/zip");
  assert.equal(first.bytes[0], 0x50);
  assert.equal(first.bytes[1], 0x4b);
});

test("archive sink receives a copy and no filesystem primitive is required", async () => {
  const archive = createDataExportArchive(input);
  let received: Uint8Array | null = null;
  await writeDataExportArchive(archive, { put: async ({ bytes }) => { received = bytes; } });
  assert.ok(received);
  assert.notEqual(received, archive.bytes);
  assert.deepEqual(received, archive.bytes);
});
