import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { grantAllowsActor } from "./policy-service";

const coach = { actorId: "coach-1", role: "COACH" as const };
const member = { actorId: "member-1", role: "MEMBER" as const };
const activeUntil = new Date("2030-01-01T00:00:00.000Z");
const now = new Date("2029-01-01T00:00:00.000Z");

test("grant matching keeps USER, ROLE and WORKSPACE scopes exact", () => {
  assert.equal(grantAllowsActor({ scope: "USER", granteeUserId: "member-1", granteeRole: null, access: "VIEW", revokedAt: null, expiresAt: activeUntil }, member, "VIEW", now), true);
  assert.equal(grantAllowsActor({ scope: "USER", granteeUserId: "other", granteeRole: null, access: "VIEW", revokedAt: null, expiresAt: activeUntil }, member, "VIEW", now), false);
  assert.equal(grantAllowsActor({ scope: "ROLE", granteeUserId: null, granteeRole: "COACH", access: "COACH", revokedAt: null, expiresAt: activeUntil }, coach, "COACH", now), true);
  assert.equal(grantAllowsActor({ scope: "WORKSPACE", granteeUserId: null, granteeRole: null, access: "VIEW", revokedAt: null, expiresAt: null }, member, "VIEW", now), true);
});

test("revocation, expiry and Coach role changes invalidate grants immediately", () => {
  const coachGrant = { scope: "USER" as const, granteeUserId: "coach-1", granteeRole: null, access: "COACH" as const, revokedAt: null, expiresAt: activeUntil };
  assert.equal(grantAllowsActor(coachGrant, coach, "COACH", now), true);
  assert.equal(grantAllowsActor(coachGrant, { ...coach, role: "MEMBER" }, "COACH", now), false);
  assert.equal(grantAllowsActor({ ...coachGrant, revokedAt: now }, coach, "COACH", now), false);
  assert.equal(grantAllowsActor({ ...coachGrant, expiresAt: now }, coach, "COACH", now), false);
});

test("workspace policy rejects a missing or duplicated active Owner", async () => {
  const source = await readFile(fileURLToPath(new URL("./policy-service.ts", import.meta.url)), "utf8");
  assert.match(source, /workspaceMembership\.findMany\([\s\S]*?role: "OWNER"[\s\S]*?take: 2/);
  assert.match(source, /activeOwners\.length !== 1/);
  assert.match(source, /activeOwners\[0\]\?\.userId !== membership\.workspace\.userId/);
});
