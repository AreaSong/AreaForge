import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serializeAuditEvent, summarizeAuditMetadata } from "./audit-search-service";

const systemRoot = path.dirname(fileURLToPath(import.meta.url));

test("audit metadata summary keeps only bounded, non-sensitive scalar fields", () => {
  const summary = summarizeAuditMetadata({
    workspaceId: "workspace-1",
    status: "SUCCEEDED",
    revision: 3,
    reason: "private operator reason must stay hidden",
    requestHash: "sha256:secret",
    tokenHash: "secret",
    objectKey: "/srv/private/archive.zip",
    nested: { body: "private" },
  });
  assert.deepEqual(summary, { workspaceId: "workspace-1", status: "SUCCEEDED", revision: 3 });
});

test("audit event serializer never returns raw metadata", () => {
  const dto = serializeAuditEvent({
    id: "audit-1",
    actorId: "user-1",
    action: "CONTROLLED_OPERATION_REQUEST_CREATED",
    entityType: "ControlledOperationRequest",
    entityId: "request-1",
    metadata: { operationCode: "DIAGNOSTIC_HEALTH", requestHash: "secret" },
    createdAt: new Date("2026-09-07T00:00:00.000Z"),
  });
  assert.deepEqual(dto.metadata, { operationCode: "DIAGNOSTIC_HEALTH" });
  assert.equal("requestHash" in dto.metadata, false);
});

test("audit route is read-only and operator delegated", async () => {
  const source = await readFile(path.join(systemRoot, "../../app/api/system/audit-events/route.ts"), "utf8");
  const service = await readFile(path.join(systemRoot, "audit-search-service.ts"), "utf8");
  assert.match(source, /requireApiUser/);
  assert.match(source, /listAuditEvents/);
  assert.doesNotMatch(source, /POST|PATCH|DELETE/);
  assert.match(service, /requirePlatformOperator/);
  assert.match(service, /normalizeAuditSearchQuery/);
  assert.doesNotMatch(service, /tokenHash|requestHash|objectKey|leaseToken/);
});
