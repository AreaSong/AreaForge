import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { hashPassword } from "../../packages/auth/src/index";
import { prisma } from "../../packages/db/src/index";
import { resetRbacRuntimeFixture, seedRbacRuntimeFixture } from "../quality/v15-rbac-runtime-fixture";

interface BrowserResult {
  id: string;
  actor: "anonymous" | "owner" | "coach" | "member" | "viewer" | "operator";
  status: number;
  error: string | null;
}

const root = process.cwd();
const baseUrl = loopbackUrl(process.env.AREAFORGE_V15_BROWSER_BASE_URL);
const expectedDatabase = required(process.env.AREAFORGE_V15_BROWSER_EXPECTED_DATABASE, "AREAFORGE_V15_BROWSER_EXPECTED_DATABASE");
const operatorEmail = required(process.env.AREAFORGE_V15_BROWSER_OPERATOR_EMAIL, "AREAFORGE_V15_BROWSER_OPERATOR_EMAIL").toLowerCase();
const outputDirectory = path.join(root, "output/playwright/v15-failure-matrix");
const results: BrowserResult[] = [];
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
let fixtureSeeded = false;

try {
  await assertIsolatedDatabase();
  const password = randomBytes(24).toString("base64url");
  const fixture = await seedRbacRuntimeFixture("browser-failure", {
    passwordHash: await hashPassword(password),
    operatorEmail,
  });
  fixtureSeeded = true;
  await mkdir(outputDirectory, { recursive: true });

  const browser = await chromium.launch({ headless: true, executablePath: chromeExecutablePath() });
  try {
    const anonymous = instrumentContext(await browser.newContext({ baseURL: baseUrl.origin, viewport: { width: 1280, height: 900 } }));
    await (await anonymous.newPage()).goto(`${baseUrl.origin}/login`);
    const owner = await authenticatedContext(browser, fixture.users.owner.email, password, { width: 1280, height: 900 });
    const coach = await authenticatedContext(browser, fixture.users.coach.email, password, { width: 1280, height: 900 });
    const member = await authenticatedContext(browser, fixture.users.member.email, password, { width: 390, height: 844 });
    const viewer = await authenticatedContext(browser, fixture.users.viewer.email, password, { width: 390, height: 844 });
    const operator = await authenticatedContext(browser, fixture.users.operator.email, password, { width: 1280, height: 900 });
    const contexts = [anonymous, owner, coach, member, viewer, operator];
    try {
      await runMatrix({ anonymous, owner, coach, member, viewer, operator }, fixture);
      const visualObservations = await captureScreenshots(owner, member);
      assert.equal(results.length, 17);
      assert.equal(results.every((result) => result.status >= 400), true);
      const unexpectedConsoleErrors = consoleErrors.filter((message) => !isExpectedHttpFailureConsole(message));
      const expectedHttpFailureConsoleCount = consoleErrors.length - unexpectedConsoleErrors.length;
      assert.equal(expectedHttpFailureConsoleCount, results.length);
      assert.deepEqual(unexpectedConsoleErrors, []);
      assert.deepEqual(pageErrors, []);
      const health = await fetch(`${baseUrl.origin}/api/health`).then((response) => response.json()) as {
        version?: string;
        runtimeIdentity?: { gitCommit?: string; productExperienceSourceHash?: string; buildId?: string; status?: string };
      };
      assert.equal(health.runtimeIdentity?.status, "verified");
      await resetRbacRuntimeFixture();
      fixtureSeeded = false;
      await writeFile(path.join(outputDirectory, "evidence.json"), `${JSON.stringify({
        schemaVersion: "v15-rbac-browser-failure-matrix-v1",
        status: "pass",
        generatedAt: new Date().toISOString(),
        contentClassification: "synthetic-only",
        runtime: {
          database: expectedDatabase,
          url: baseUrl.origin,
          appVersion: health.version ?? "unknown",
          sourceGitCommit: health.runtimeIdentity?.gitCommit ?? "unknown",
          sourceFingerprint: health.runtimeIdentity?.productExperienceSourceHash ?? "unknown",
          buildId: health.runtimeIdentity?.buildId ?? "unknown",
          runtimeMode: "production-build-test-pool",
        },
        cases: results,
        visualObservations,
        telemetry: {
          expectedHttpFailureConsoleCount,
          unexpectedConsoleErrors,
          pageErrors,
        },
        screenshots: ["owner-failure-matrix-desktop.png", "member-session-invalidated-mobile.png"],
        safetyFacts: {
          isolatedDatabaseUsed: true,
          isolatedDatabaseCleaned: true,
          testPoolUsed: true,
          syntheticAccountsOnly: true,
          productionWriteAttempted: false,
          sharedDatabaseMigrationAttempted: false,
          physicalDeleteAttempted: false,
          serverCommandExecutionAttempted: false,
          secretValuePersisted: false,
        },
        doesNotProve: [
          "protected PR merge or signed Release readiness",
          "production migration, production feature enablement or production health",
          "real SMTP delivery",
        ],
      }, null, 2)}\n`, "utf8");
      console.log(JSON.stringify({ status: "pass", caseCount: results.length, output: path.relative(root, outputDirectory) }, null, 2));
    } finally {
      await Promise.allSettled(contexts.map((context) => context.close()));
    }
  } finally {
    await browser.close();
  }
} finally {
  if (fixtureSeeded) await resetRbacRuntimeFixture();
  await prisma.$disconnect();
}

async function runMatrix(
  contexts: Record<"anonymous" | "owner" | "coach" | "member" | "viewer" | "operator", BrowserContext>,
  fixture: Awaited<ReturnType<typeof seedRbacRuntimeFixture>>,
): Promise<void> {
  await expectBrowserError(contexts.anonymous, "anonymous", "anonymous-private-api", "/api/system/accounts", "GET", undefined, 401, "UNAUTHORIZED");
  await expectBrowserError(contexts.owner, "owner", "non-operator-directory", "/api/system/accounts", "GET", undefined, 404, "PLATFORM_OPERATOR_NOT_FOUND");
  await expectBrowserError(contexts.member, "member", "cross-workspace-capability", `/api/exam-workspaces/${fixture.workspaceIds.secondary}/capabilities`, "GET", undefined, 404, "WORKSPACE_RESOURCE_NOT_FOUND");
  await expectBrowserError(contexts.member, "member", "member-role-escalation", `/api/exam-workspaces/${fixture.workspaceIds.primary}/members/${fixture.memberships.viewer}/role`, "PATCH", { role: "MEMBER", expectedRevision: 1 }, 404, "WORKSPACE_RESOURCE_NOT_FOUND");
  await expectBrowserError(contexts.viewer, "viewer", "viewer-cannot-share-owner-note", `/api/exam-workspaces/${fixture.workspaceIds.primary}/share-grants`, "POST", { resourceType: "NOTE", resourceId: fixture.notes.userGrant, scope: "USER", granteeUserId: fixture.users.member.userId, access: "VIEW" }, 404, "WORKSPACE_RESOURCE_NOT_FOUND");
  await expectBrowserError(contexts.owner, "owner", "self-grant-rejected", `/api/exam-workspaces/${fixture.workspaceIds.primary}/share-grants`, "POST", { resourceType: "NOTE", resourceId: fixture.notes.userGrant, scope: "USER", granteeUserId: fixture.users.owner.userId, access: "VIEW" }, 400, "WORKSPACE_SHARE_GRANT_TARGET_INVALID");
  await expectBrowserError(contexts.owner, "owner", "workspace-coach-grant-rejected", `/api/exam-workspaces/${fixture.workspaceIds.primary}/share-grants`, "POST", { resourceType: "NOTE", resourceId: fixture.notes.userGrant, scope: "WORKSPACE", access: "COACH" }, 400, "WORKSPACE_SHARE_GRANT_COACH_SCOPE_INVALID");
  await expectBrowserError(contexts.owner, "owner", "stale-role-revision", `/api/exam-workspaces/${fixture.workspaceIds.primary}/members/${fixture.memberships.member}/role`, "PATCH", { role: "VIEWER", expectedRevision: 999 }, 409, "WORKSPACE_MEMBERSHIP_CONFLICT");
  await expectBrowserError(contexts.coach, "coach", "coach-without-grant", "/api/coach/suggestions", "POST", { workspaceId: fixture.workspaceIds.primary, resourceType: "NOTE", resourceId: fixture.notes.userGrant, payload: { title: "不得创建", plannedDate: null, estimatedMinutes: 25, priority: "HIGH", type: "study", subjectId: fixture.subjects.primary, primaryNodeId: null } }, 404, "WORKSPACE_RESOURCE_NOT_FOUND");
  await expectBrowserError(contexts.member, "member", "member-cannot-list-invitations", `/api/exam-workspaces/${fixture.workspaceIds.primary}/invitations`, "GET", undefined, 404, "WORKSPACE_RESOURCE_NOT_FOUND");
  const invitation = await prisma.workspaceInvitation.create({
    data: {
      workspaceId: fixture.workspaceIds.primary,
      emailNormalized: "pending-browser-failure@example.invalid",
      tokenHash: `browser-failure-${randomBytes(16).toString("hex")}`,
      invitedByUserId: fixture.users.owner.userId,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await expectBrowserError(contexts.owner, "owner", "stale-invitation-revoke", `/api/exam-workspaces/${fixture.workspaceIds.primary}/invitations/${invitation.id}`, "DELETE", { expectedRevision: 999 }, 404, "WORKSPACE_INVITATION_NOT_FOUND");

  const coachRoleGrant = await browserRequest(contexts.owner, `/api/exam-workspaces/${fixture.workspaceIds.primary}/share-grants`, "POST", { resourceType: "NOTE", resourceId: fixture.notes.roleGrant, scope: "ROLE", granteeRole: "COACH", access: "COACH" });
  assert.equal(coachRoleGrant.status, 201);
  assert.equal((await browserRequest(contexts.coach, `/api/shared-resources/NOTE/${fixture.notes.roleGrant}`, "GET")).status, 200);
  const coachMembership = await prisma.workspaceMembership.findUniqueOrThrow({ where: { id: fixture.memberships.coach }, select: { revision: true } });
  assert.equal((await browserRequest(contexts.owner, `/api/exam-workspaces/${fixture.workspaceIds.primary}/members/${fixture.memberships.coach}/role`, "PATCH", { role: "MEMBER", expectedRevision: coachMembership.revision })).status, 200);
  await expectBrowserError(contexts.coach, "coach", "role-change-invalidates-role-grant", `/api/shared-resources/NOTE/${fixture.notes.roleGrant}`, "GET", undefined, 404, "WORKSPACE_RESOURCE_NOT_FOUND");

  await prisma.workspaceMembership.update({ where: { id: fixture.memberships.viewer }, data: { status: "REMOVED", removedAt: new Date() } });
  await expectBrowserError(contexts.viewer, "viewer", "membership-removal-invalidates-session", `/api/exam-workspaces/${fixture.workspaceIds.primary}/capabilities`, "GET", undefined, 404, "WORKSPACE_RESOURCE_NOT_FOUND");

  const grant = await browserRequest(contexts.owner, `/api/exam-workspaces/${fixture.workspaceIds.primary}/share-grants`, "POST", { resourceType: "NOTE", resourceId: fixture.notes.userGrant, scope: "USER", granteeUserId: fixture.users.member.userId, access: "VIEW" });
  assert.equal(grant.status, 201);
  const grantId = objectString(grant.body, "grant", "id");
  const grantRevision = objectNumber(grant.body, "grant", "revision");
  assert.equal((await browserRequest(contexts.member, `/api/shared-resources/NOTE/${fixture.notes.userGrant}`, "GET")).status, 200);
  assert.equal((await browserRequest(contexts.owner, `/api/exam-workspaces/${fixture.workspaceIds.primary}/share-grants/${grantId}`, "DELETE", { expectedRevision: grantRevision })).status, 200);
  await expectBrowserError(contexts.member, "member", "revoked-grant-invalidates-read", `/api/shared-resources/NOTE/${fixture.notes.userGrant}`, "GET", undefined, 404, "WORKSPACE_RESOURCE_NOT_FOUND");

  await expectBrowserError(contexts.operator, "operator", "operator-self-action-rejected", `/api/system/accounts/${fixture.users.operator.userId}/status`, "PATCH", { status: "SUSPENDED", expectedAuthRevision: 1, reason: "SECURITY_REVIEW" }, 409, "OPERATOR_SELF_ACTION_FORBIDDEN");
  await expectBrowserError(contexts.operator, "operator", "operator-stale-auth-revision", `/api/system/accounts/${fixture.users.viewer.userId}/status`, "PATCH", { status: "SUSPENDED", expectedAuthRevision: 999, reason: "SECURITY_REVIEW" }, 409, "AUTH_REVISION_CONFLICT");
  const memberBefore = await prisma.user.findUniqueOrThrow({ where: { id: fixture.users.member.userId }, select: { authRevision: true } });
  const suspended = await browserRequest(contexts.operator, `/api/system/accounts/${fixture.users.member.userId}/status`, "PATCH", { status: "SUSPENDED", expectedAuthRevision: memberBefore.authRevision, reason: "SECURITY_REVIEW" });
  assert.equal(suspended.status, 200);
  await expectBrowserError(contexts.member, "member", "suspension-invalidates-session", "/api/auth/me", "GET", undefined, 401, "UNAUTHORIZED");
}

async function authenticatedContext(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  email: string,
  password: string,
  viewport: { width: number; height: number },
): Promise<BrowserContext> {
  const context = instrumentContext(await browser.newContext({ baseURL: baseUrl.origin, viewport }));
  const page = await context.newPage();
  const response = await page.goto(`${baseUrl.origin}/login`);
  assert.equal(response?.status(), 200);
  await page.getByLabel("邮箱").fill(email);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForResponse((candidate) => candidate.url().endsWith("/api/auth/login") && candidate.request().method() === "POST"),
    page.getByRole("button", { name: "登录" }).click(),
  ]).then(([login]) => assert.equal(login.status(), 200));
  return context;
}

async function expectBrowserError(
  context: BrowserContext,
  actor: BrowserResult["actor"],
  id: string,
  url: string,
  method: string,
  body: unknown,
  status: number,
  error: string,
): Promise<void> {
  const response = await browserRequest(context, url, method, body);
  assert.equal(response.status, status, `${id} status`);
  assert.equal(response.error, error, `${id} error`);
  results.push({ id, actor, status, error });
}

async function browserRequest(context: BrowserContext, url: string, method: string, body?: unknown) {
  const page = context.pages()[0] ?? await context.newPage();
  if (new URL(page.url()).origin !== baseUrl.origin) {
    await page.goto(`${baseUrl.origin}/login`);
  }
  const result = await page.evaluate(async ({ url: requestUrl, method: requestMethod, body: requestBody }) => {
    const response = await fetch(requestUrl, {
      method: requestMethod,
      headers: requestBody === undefined ? undefined : { "content-type": "application/json" },
      body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
    });
    const parsed = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { status: response.status, body: parsed, error: typeof parsed.error === "string" ? parsed.error : null };
  }, { url, method, body });
  return result;
}

async function captureScreenshots(owner: BrowserContext, member: BrowserContext) {
  const ownerPage = await visiblePage(owner, "/settings/workspaces");
  await ownerPage.screenshot({ path: path.join(outputDirectory, "owner-failure-matrix-desktop.png"), fullPage: true });
  const memberPage = await visiblePage(member, "/settings/workspaces");
  await memberPage.screenshot({ path: path.join(outputDirectory, "member-session-invalidated-mobile.png"), fullPage: true });
  return Promise.all([
    visualObservation("owner-desktop", ownerPage),
    visualObservation("member-mobile", memberPage),
  ]);
}

async function visiblePage(context: BrowserContext, pathname: string): Promise<Page> {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(`${baseUrl.origin}${pathname}`, { waitUntil: "networkidle" });
  return page;
}

function instrumentContext(context: BrowserContext): BrowserContext {
  const attach = (page: Page) => {
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
  };
  context.on("page", attach);
  context.pages().forEach(attach);
  return context;
}

function isExpectedHttpFailureConsole(message: string): boolean {
  return /^Failed to load resource: the server responded with a status of (?:400|401|404|409) \(/.test(message);
}

async function visualObservation(id: string, page: Page) {
  const measurement = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    finalPath: window.location.pathname,
  }));
  const horizontalOverflow = Math.max(0, measurement.scrollWidth - measurement.innerWidth);
  assert.equal(horizontalOverflow, 0, `${id} horizontal overflow`);
  return { id, ...measurement, horizontalOverflow };
}

async function assertIsolatedDatabase(): Promise<void> {
  if (process.env.AREAFORGE_V15_BROWSER_ISOLATED_DB !== "1") throw new Error("isolated browser matrix grant is required");
  const url = new URL(required(process.env.DATABASE_URL, "DATABASE_URL"));
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname)) throw new Error("database host must be loopback");
  const database = decodeURIComponent(url.pathname.slice(1));
  if (database !== expectedDatabase || !database.includes("v15rbac")) throw new Error("isolated database identity mismatch");
  const rows = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  assert.equal(rows[0]?.current_database, expectedDatabase);
  const userCount = await prisma.user.count();
  assert.equal(userCount, 0, "isolated browser database must be empty before seeding");
}

function loopbackUrl(raw: string | undefined): URL {
  const url = new URL(required(raw, "AREAFORGE_V15_BROWSER_BASE_URL"));
  if (url.protocol !== "http:" || !new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(url.hostname)) {
    throw new Error("browser base URL must be loopback HTTP");
  }
  return url;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function chromeExecutablePath(): string {
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}

function objectString(value: Record<string, unknown>, parent: string, key: string): string {
  const nested = value[parent];
  if (!nested || typeof nested !== "object" || Array.isArray(nested) || typeof (nested as Record<string, unknown>)[key] !== "string") {
    throw new Error(`${parent}.${key} missing`);
  }
  return (nested as Record<string, string>)[key]!;
}

function objectNumber(value: Record<string, unknown>, parent: string, key: string): number {
  const nested = value[parent];
  if (!nested || typeof nested !== "object" || Array.isArray(nested) || typeof (nested as Record<string, unknown>)[key] !== "number") {
    throw new Error(`${parent}.${key} missing`);
  }
  return (nested as Record<string, number>)[key]!;
}
