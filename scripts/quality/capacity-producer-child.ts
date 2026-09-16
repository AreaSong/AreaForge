import assert from "node:assert/strict";
import { loadCapacityFixture, capacityFixtureEnvironment, assertCapacityFixtureContainer, verifyCapacityFixtureLedger } from "./capacity-fixture";
import { capacityRuntimeCode, retryCapacityFixture } from "./capacity-runtime-support";
import { instrumentCapacityClient } from "./capacity-transaction-fixture";

type Input = { mode: "job" | "search"; userId: string; workspaceId: string; key: string; kind?: "EXPORT" | "SEARCH_INDEX_REBUILD" | "RANKING_REBUILD" }
  | { mode: "member"; userId: string | null; token: string; password?: string };
const policyKeys = ["DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER", "DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_WORKSPACE", "DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE",
  "WORKSPACE_MEMBER_QUOTA_MAX_SEATS"];

async function main() {
  const fixture = loadCapacityFixture(process.env.AREAFORGE_CAPACITY_FIXTURE_ROOT ?? ""); assertCapacityFixtureContainer(fixture);
  const input = JSON.parse(process.env.CAPACITY_PRODUCER_INPUT ?? "null") as Input;
  const policy = JSON.parse(process.env.CAPACITY_CHILD_POLICY ?? "{}");
  assert.ok(policy && typeof policy === "object" && !Array.isArray(policy));
  assert.ok(Object.entries(policy).every(([key, value]) => policyKeys.includes(key) && typeof value === "string"));
  Object.assign(process.env, capacityFixtureEnvironment(fixture), policy);
  assert.ok(input && ["job", "search", "member"].includes(input.mode));
  if (input.mode === "member") assert.match(input.token, /^[A-Za-z0-9_-]{32,256}$/);
  else { for (const id of [input.userId, input.workspaceId, input.key]) assert.match(id, /^[A-Za-z0-9_-]{1,191}$/); }
  const pauseAt = process.env.CAPACITY_PRODUCER_PAUSE_AT ?? "none";
  assert.ok(["none", "counted", "written"].includes(pauseAt));
  const { createPrismaClient, enqueueDataJobInTransaction, enqueueWorkspaceSearchIndex } = await import("../../packages/db/src/index");
  const { acceptWorkspaceInvitation } = await import("../../apps/web/lib/workspace/membership-service");
  const client = createPrismaClient(process.env.DATABASE_URL); let paused = false;
  async function checkpoint(point: string) {
    if (point !== pauseAt || paused) return;
    paused = true; process.send?.({ point });
    await new Promise<void>(resolve => { const listener = (message: unknown) => {
      if (message && typeof message === "object" && "action" in message && message.action === "continue") {
        process.off("message", listener); resolve();
      }
    }; process.on("message", listener); });
  }
  const observed = instrumentCapacityClient(client, { afterQuery: async sql => {
    if (sql.includes("COUNT(*)")) await checkpoint("counted");
  }, beforeCommit: () => checkpoint("written") });
  try {
    await verifyCapacityFixtureLedger(client, fixture);
    const actor = input.userId ? await childActor(input.userId) : null;
    async function run() {
      if (input.mode === "member") return acceptWorkspaceInvitation({ token: input.token, actor, password: input.password }, observed);
      assert.ok(actor);
      const workspace = await client.examWorkspace.findUniqueOrThrow({ where: { id: input.workspaceId } });
      assert.ok(workspace.stableKey.startsWith("capacity-"));
      if (input.mode === "search") return enqueueWorkspaceSearchIndex(observed, { actorId: actor.id, sessionId: actor.sessionId!,
        workspaceId: input.workspaceId, expectedGeneration: 0, idempotencyKey: input.key });
      assert.ok(["EXPORT", "SEARCH_INDEX_REBUILD", "RANKING_REBUILD"].includes(input.kind ?? ""));
      return observed.$transaction(tx => enqueueDataJobInTransaction(tx, { kind: input.kind!, scope: "WORKSPACE", requestedByUserId: actor.id,
        workspaceId: input.workspaceId, idempotencyKey: input.key, requestFingerprint: `sha256:${"a".repeat(64)}`, expiresAt: new Date(Date.now() + 3_600_000) }),
      { isolationLevel: "Serializable", timeout: 15_000 });
    }
    try { await (pauseAt === "none" ? retryCapacityFixture(run) : run()); process.send?.({ point: "result", status: "accepted" }); }
    catch (error) { process.send?.({ point: "result", status: "rejected", code: capacityRuntimeCode(error) }); }
  } finally { await client.$disconnect(); }

  async function childActor(id: string) {
    const user = await client.user.findUniqueOrThrow({ where: { id } }); assert.ok(user.email.startsWith("capacity-") && user.email.endsWith("@example.test"));
    const session = await client.authSession.findFirstOrThrow({ where: { userId: id, revokedAt: null }, orderBy: { createdAt: "desc" } });
    return { id, email: user.email, status: user.status, emailVerifiedAt: user.emailVerifiedAt, sessionId: session.id, reauthenticatedAt: session.reauthenticatedAt };
  }
}

main().catch(error => { process.send?.({ point: "failed", code: capacityRuntimeCode(error) }); process.exitCode = 1; })
  .finally(() => { if (process.connected) process.disconnect(); });
