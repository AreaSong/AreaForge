import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "../../packages/db/src/index";
import { leaveWorkspace } from "../../apps/web/lib/workspace/membership-service";
import { createCapacityCase, createAdmissionActor, seedCapacityInvitation, withCapacityPolicy, settleCapacityCase, type CapacityCase } from "./capacity-runtime-data";
import { capacityFixtureEnvironment, type CapacityFixture } from "./capacity-fixture";

type ProducerInput = { mode: "job" | "search"; userId: string; workspaceId: string; key: string; kind?: "EXPORT" | "SEARCH_INDEX_REBUILD" | "RANKING_REBUILD" }
  | { mode: "member"; userId: string | null; token: string; password?: string };
function startProducer(fixture: CapacityFixture, input: ProducerInput, pauseAt: "none" | "counted" | "written" = "none") {
  const keys = ["DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER", "DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_WORKSPACE", "DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE", "WORKSPACE_MEMBER_QUOTA_MAX_SEATS"];
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./capacity-producer-child.ts", import.meta.url))], {
    stdio: ["ignore", "ignore", "ignore", "ipc"], env: { ...capacityFixtureEnvironment(fixture), TSX_TSCONFIG_PATH: "apps/web/tsconfig.json",
      CAPACITY_PRODUCER_INPUT: JSON.stringify(input), CAPACITY_PRODUCER_PAUSE_AT: pauseAt,
      CAPACITY_CHILD_POLICY: JSON.stringify(Object.fromEntries(keys.map(key => [key, process.env[key]]))) },
  });
  const events: Array<{ point: string; status?: string; code?: string }> = []; let exited = false;
  child.on("message", message => { if (message && typeof message === "object" && "point" in message) events.push(message as typeof events[number]); });
  const done = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once("error", reject); child.once("exit", (code, signal) => { exited = true; resolve({ code, signal }); });
  });
  return { child, events, done, async waitFor(point: string) {
    const end = Date.now() + 20_000;
    while (!events.some(event => event.point === point)) {
      if (exited || Date.now() > end || events.some(event => event.point === "failed")) throw new Error(`CAPACITY_CHILD_POINT_MISSING_${point}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }, stop() { if (!exited) child.kill("SIGKILL"); } };
}

export async function capacityMultiProcessJobs(client: PrismaClient, fixture: CapacityFixture, axis: "user" | "workspace" | "instance") {
  const first = await createCapacityCase(client, fixture, `process-${axis}-a`); const second = await createCapacityCase(client, fixture, `process-${axis}-b`);
  await withCapacityPolicy({ DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: axis === "user" ? "2" : "100",
    DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_WORKSPACE: axis === "workspace" ? "2" : "100", DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE: axis === "instance" ? "2" : "100" }, async () => {
    const children = Array.from({ length: 6 }, (_, index) => {
      const data = axis === "instance" && index % 2 ? second : first;
      const user = axis === "workspace" && index % 2 ? data.member : data.owner;
      const workspace = axis === "user" && index % 2 ? data.secondary.workspace : data.workspace;
      return startProducer(fixture, { mode: "job", userId: user.id, workspaceId: workspace.id,
        key: randomUUID(), kind: (["EXPORT", "SEARCH_INDEX_REBUILD", "RANKING_REBUILD"] as const)[index % 3]! });
    });
    try {
      for (const result of await Promise.all(children.map(child => child.done))) assert.equal(result.code, 0);
      const results = children.map(child => child.events.find(event => event.point === "result")!);
      assert.equal(results.filter(row => row?.status === "accepted").length, 2);
      for (const row of results) if (row.status !== "accepted") assert.equal(row.code, `DATA_JOB_QUOTA_${axis.toUpperCase()}_ACTIVE_LIMIT`);
      assert.equal(await client.dataJob.count({ where: { requestedByUserId: { in: [first.owner.id, first.member.id, second.owner.id, second.member.id] } } }), 2);
    } finally { for (const child of children) child.stop(); await Promise.all(children.map(child => child.done));
      await settleCapacityCase(client, first); await settleCapacityCase(client, second); }
  });
}

export async function capacityMultiProcessMembers(client: PrismaClient, fixture: CapacityFixture) {
  const data = await createCapacityCase(client, fixture, "process-members"); await freeMemberSlot(client, data);
  const actors = await Promise.all(Array.from({ length: 6 }, (_, index) => createAdmissionActor(client, `${data.prefix}-guest-${index}@example.test`, "synthetic-not-login")));
  const invitations = await Promise.all(actors.map(actor => seedCapacityInvitation(client, fixture, { workspaceId: data.workspace.id, owner: data.owner, email: actor.email })));
  const children = actors.map((actor, index) => startProducer(fixture, { mode: "member", userId: actor.id, token: invitations[index]!.token }));
  try {
    for (const result of await Promise.all(children.map(child => child.done))) assert.equal(result.code, 0);
    const results = children.map(child => child.events.find(event => event.point === "result")!);
    assert.equal(results.filter(row => row?.status === "accepted").length, 1);
    for (const row of results) if (row.status !== "accepted") assert.equal(row.code, "WORKSPACE_MEMBER_QUOTA_LIMIT");
    assert.equal(await client.workspaceMembership.count({ where: { workspaceId: data.workspace.id, status: "ACTIVE" } }), 2);
  } finally { for (const child of children) child.stop(); await Promise.all(children.map(child => child.done)); }
}

export async function capacitySearchProcessCrashes(client: PrismaClient, fixture: CapacityFixture) {
  for (const point of ["counted", "written"] as const) {
    const data = await createCapacityCase(client, fixture, `search-kill-${point}`);
    const input = { mode: "search" as const, userId: data.owner.id, workspaceId: data.workspace.id, key: randomUUID() };
    const child = startProducer(fixture, input, point);
    try {
      await child.waitFor(point);
      assert.equal(await client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), 0);
    } finally { child.stop(); assert.equal((await child.done).signal, "SIGKILL"); }
    assert.equal(await client.dataJob.count({ where: { requestedByUserId: data.owner.id } }), 0);
    assert.equal(await client.workspaceSearchPartition.count({ where: { userId: data.owner.id } }), 0);
    assert.equal(await client.auditEvent.count({ where: { actorId: data.owner.id, action: "DATA_JOB_ENQUEUED" } }), 0);
    const replay = startProducer(fixture, input);
    try { assert.equal((await replay.done).code, 0); assert.equal(replay.events.find(event => event.point === "result")?.status, "accepted"); }
    finally { replay.stop(); await replay.done; await settleCapacityCase(client, data); }
  }
}

export async function capacityRegistrationProcessCrashes(client: PrismaClient, fixture: CapacityFixture) {
  for (const point of ["counted", "written"] as const) {
    const data = await createCapacityCase(client, fixture, `member-kill-${point}`); await freeMemberSlot(client, data);
    const email = `${data.prefix}-register@example.test`;
    const pending = await seedCapacityInvitation(client, fixture, { workspaceId: data.workspace.id, owner: data.owner, email });
    const input = { mode: "member" as const, userId: null, token: pending.token, password: `Capacity-${randomBytes(12).toString("hex")}9!` };
    const child = startProducer(fixture, input, point);
    try { await child.waitFor(point); assert.equal(await client.user.count({ where: { email } }), 0); }
    finally { child.stop(); assert.equal((await child.done).signal, "SIGKILL"); }
    assert.equal(await client.user.count({ where: { email } }), 0);
    assert.equal((await client.workspaceInvitation.findUniqueOrThrow({ where: { id: pending.invitation.id } })).status, "PENDING");
    assert.equal(await client.workspaceMembership.count({ where: { workspaceId: data.workspace.id, status: "ACTIVE" } }), 1);
    const replay = startProducer(fixture, input);
    try {
      assert.equal((await replay.done).code, 0); assert.equal(replay.events.find(event => event.point === "result")?.status, "accepted");
      const created = await client.user.findUniqueOrThrow({ where: { email } });
      assert.equal(await client.examWorkspace.count({ where: { userId: created.id, stableKey: "personal" } }), 1);
    } finally { replay.stop(); await replay.done; }
  }
}

async function freeMemberSlot(client: PrismaClient, data: CapacityCase) {
  const member = await client.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: data.workspace.id, userId: data.member.id } } });
  await leaveWorkspace(data.member, data.workspace.id, member.revision);
}
