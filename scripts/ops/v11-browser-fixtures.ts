import { randomBytes, randomUUID } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "../../packages/auth/src/index";
import { prisma, type Prisma } from "../../packages/db/src/index";
import {
  V11_FIXTURE_SCHEMA,
  V11_JOURNEY_IDS,
  V11_VIEWPORT_CONTRACT,
  computeFixtureManifestHash,
  type V11JourneyId,
  type V11ViewportId,
} from "../quality/v11-browser-evidence-contract";
import { canonicalSha256, findWorkspaceRoot } from "../quality/product-experience-source";
import { readRestrictedSmokePassword } from "./smoke-password";
import {
  assertEmbeddedMigrationManifests,
  assertSourceMigrationManifest,
  currentMigrationManifest,
} from "../quality/v11-compatibility-floor-manifest";

export const JOURNEY_IDS = V11_JOURNEY_IDS;

export const VIEWPORTS = {
  desktop: { name: "desktop", ...V11_VIEWPORT_CONTRACT.desktop, isMobile: false },
  mobile: { name: "mobile", ...V11_VIEWPORT_CONTRACT.mobile, isMobile: true },
} as const;

export type JourneyId = V11JourneyId;
export type ViewportName = V11ViewportId;
export type EvidenceViewport = (typeof VIEWPORTS)[ViewportName];

export interface BrowserEvidenceConfig {
  root: string;
  baseUrl: URL;
  databaseUrl: string;
  expectedDatabaseName: string;
  outputDirectory: string;
  outputDirectoryRelative: string;
  chromeExecutablePath: string;
  password: string;
  timeoutMs: number;
}

export interface FixtureAccount {
  accountRef: string;
  userId: string;
  email: string;
  workspaceId: string;
  subjectId: string;
  secondarySubjectId: string | null;
  syllabusNodeId: string;
  secondarySyllabusNodeId: string | null;
  taskId: string;
  noteId: string | null;
  activeSessionId: string | null;
}

export interface JourneyFixture extends FixtureAccount {
  journeyId: JourneyId;
  viewport: ViewportName;
}

export interface FixtureManifest {
  schemaVersion: typeof V11_FIXTURE_SCHEMA;
  fixtureSetId: string;
  generatedAt: string;
  contentClassification: "synthetic-only";
  isolation: "one-user-per-viewport-journey";
  journeyAccountCount: 18;
  accessibilityAccountCount: 1;
  accounts: Array<{
    accountRef: string;
    purpose: "journey" | "accessibility";
    viewport: ViewportName | "suite";
    journeyId: JourneyId | null;
  }>;
  manifestSha256: string;
}

export interface BrowserFixtureSet {
  manifest: FixtureManifest;
  journeys: JourneyFixture[];
  accessibility: FixtureAccount;
}

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const defaultChromePaths = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
];

export function loadBrowserEvidenceConfig(): BrowserEvidenceConfig {
  requireWriteConsent();
  rejectPlaintextPasswordInputs();

  const root = findWorkspaceRoot();
  const baseUrl = parseLocalBaseUrl(process.env.AREAFORGE_BROWSER_EVIDENCE_BASE_URL);
  const expectedDatabaseName = parseExpectedDatabaseName(
    process.env.AREAFORGE_BROWSER_EVIDENCE_EXPECTED_DATABASE_NAME,
  );
  const databaseUrl = parseLocalDatabaseUrl(process.env.DATABASE_URL, expectedDatabaseName);
  const output = resolveOutputDirectory(root, process.env.AREAFORGE_BROWSER_EVIDENCE_OUTPUT_DIR);
  const chromeExecutablePath = resolveSystemChrome(process.env.AREAFORGE_BROWSER_EVIDENCE_CHROME_PATH);
  const password = readRestrictedSmokePassword();
  if (password.length > 256) throw new Error("smoke password exceeds the login input limit");
  const timeoutMs = parseTimeout(process.env.AREAFORGE_BROWSER_EVIDENCE_TIMEOUT_MS);

  return {
    root,
    baseUrl,
    databaseUrl,
    expectedDatabaseName,
    outputDirectory: output.absolute,
    outputDirectoryRelative: output.relative,
    chromeExecutablePath,
    password,
    timeoutMs,
  };
}

type MigrationLedgerRow = {
  checksum: string;
  finished_at: Date | null;
  migration_name: string;
  logs: string | null;
  rolled_back_at: Date | null;
  applied_steps_count: bigint | number;
};

export async function assertBrowserEvidenceDatabasePreflight(
  config: BrowserEvidenceConfig,
): Promise<void> {
  assertEmbeddedMigrationManifests();
  assertSourceMigrationManifest(config.root, currentMigrationManifest, "browser evidence source");
  const identities = await prisma.$queryRaw<Array<{
    database_name: string;
    server_version_num: string | number;
  }>>`SELECT current_database() AS database_name, current_setting('server_version_num') AS server_version_num`;
  const identity = identities[0];
  if (!identity || identity.database_name !== config.expectedDatabaseName) {
    throw new Error("browser evidence database identity does not match the explicit expected database name");
  }
  const serverVersionNum = Number(identity.server_version_num);
  if (serverVersionNum < 160000 || serverVersionNum >= 170000) {
    throw new Error("browser evidence database must run PostgreSQL 16.x");
  }

  const ledger = await prisma.$queryRaw<MigrationLedgerRow[]>`
    SELECT checksum, finished_at, migration_name, logs, rolled_back_at, applied_steps_count
      FROM "_prisma_migrations"
     ORDER BY started_at ASC, id ASC
  `;
  if (ledger.length !== currentMigrationManifest.length) {
    throw new Error(`browser evidence database migration ledger must contain exactly ${currentMigrationManifest.length} rows`);
  }
  ledger.forEach((row, index) => {
    const expected = currentMigrationManifest[index];
    if (
      !expected
      || row.migration_name !== expected.name
      || row.checksum !== expected.sha256
      || row.finished_at === null
      || row.rolled_back_at !== null
      || row.logs !== null
      || Number(row.applied_steps_count) !== 1
    ) {
      throw new Error(`browser evidence database migration ledger mismatch at row ${index + 1}`);
    }
  });

  const [users, workspaces, subjects] = await Promise.all([
    prisma.user.count(),
    prisma.examWorkspace.count(),
    prisma.subject.count(),
  ]);
  if (users !== 0 || workspaces !== 0 || subjects !== 0) {
    throw new Error("browser evidence database must be an empty disposable database before fixture creation");
  }
}

export async function createNoClobberOutputDirectory(config: BrowserEvidenceConfig): Promise<void> {
  const parent = path.dirname(config.outputDirectory);
  assertRealDirectoryChain(config.root, parent);
  const parentMetadata = lstatSync(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    throw new Error("browser evidence output parent must be a real directory");
  }
  const realRoot = realpathSync(config.root);
  const realParent = realpathSync(parent);
  if (!isWithin(realRoot, realParent)) throw new Error("browser evidence output parent escapes the workspace");
  await mkdir(config.outputDirectory, { mode: 0o700, recursive: false });
  await mkdir(path.join(config.outputDirectory, "screenshots"), { mode: 0o700, recursive: false });
  await mkdir(path.join(config.outputDirectory, "observations"), { mode: 0o700, recursive: false });
}

export async function createBrowserFixtureSet(password: string): Promise<BrowserFixtureSet> {
  const fixtureSetId = `v11-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
  const generatedAt = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const journeyFixtures = createJourneyFixtureInputs(fixtureSetId);
  const accessibility = createAccountInput(fixtureSetId, "accessibility", "suite", null);
  const allAccounts = [...journeyFixtures, accessibility];
  const now = new Date();

  const users: Prisma.UserCreateManyInput[] = allAccounts.map((account) => ({
    id: account.userId,
    email: account.email,
    passwordHash,
  }));
  const workspaces: Prisma.ExamWorkspaceCreateManyInput[] = allAccounts.map((account) => ({
    id: account.workspaceId,
    userId: account.userId,
    stableKey: `synthetic-${fixtureSetId}-${account.accountRef.slice(-12)}`,
    name: "合成考试工作区",
    targetExamDate: new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000),
    status: "ACTIVE",
    revision: 1,
  }));
  const subjects: Prisma.SubjectCreateManyInput[] = allAccounts.flatMap((account) => [{
    id: account.subjectId,
    workspaceId: account.workspaceId,
    stableKey: `synthetic-subject-${account.accountRef.slice(-12)}`,
    name: "合成科目",
    color: "#0f766e",
    sortOrder: 10,
  }, ...(account.secondarySubjectId ? [{
    id: account.secondarySubjectId,
    workspaceId: account.workspaceId,
    stableKey: `synthetic-secondary-subject-${account.accountRef.slice(-12)}`,
    name: "合成第二科目",
    color: "#2563eb",
    sortOrder: 20,
  }] : [])]);
  const syllabusNodes: Prisma.SyllabusNodeCreateManyInput[] = allAccounts.flatMap((account) => [{
    id: account.syllabusNodeId,
    subjectId: account.subjectId,
    stableKey: `synthetic-node-${account.accountRef.slice(-12)}`,
    title: "合成基础节点",
    kind: "TOPIC",
    status: "LEARNING",
    targetMinutes: 45,
    revision: 1,
  }, ...(account.secondarySubjectId && account.secondarySyllabusNodeId ? [{
    id: account.secondarySyllabusNodeId,
    subjectId: account.secondarySubjectId,
    stableKey: `synthetic-secondary-node-${account.accountRef.slice(-12)}`,
    title: "合成第二科目节点",
    kind: "TOPIC" as const,
    status: "LEARNING" as const,
    targetMinutes: 30,
    revision: 1,
  }] : [])]);
  const tasks: Prisma.StudyTaskCreateManyInput[] = allAccounts.map((account) => ({
    id: account.taskId,
    subjectId: account.subjectId,
    syllabusNodeId: account.syllabusNodeId,
    title: "合成最小任务",
    type: "study",
    status: account.activeSessionId ? "IN_PROGRESS" : "TODO",
    priority: "HIGH",
    debtStatus: "NONE",
    plannedDate: now,
    estimatedMinutes: 25,
  }));
  const notes: Prisma.NoteCreateManyInput[] = allAccounts.flatMap((account) => account.noteId ? [{
    id: account.noteId,
    subjectId: account.subjectId,
    syllabusNodeId: account.syllabusNodeId,
    taskId: account.taskId,
    kind: "GENERAL" as const,
    title: "合成无障碍卡片",
    content: "仅用于本地无障碍浏览器检查的合成内容。",
    masteryStatus: "partial",
    revision: 1,
  }] : []);
  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({ data: users });
    await tx.examWorkspace.createMany({ data: workspaces });
    await tx.subject.createMany({ data: subjects });
    await tx.syllabusNode.createMany({ data: syllabusNodes });
    await tx.studyTask.createMany({ data: tasks });
    if (notes.length > 0) await tx.note.createMany({ data: notes });
  });

  const accounts = [
    ...journeyFixtures.map((fixture) => ({
      accountRef: fixture.accountRef,
      purpose: "journey" as const,
      viewport: fixture.viewport,
      journeyId: fixture.journeyId,
    })),
    {
      accountRef: accessibility.accountRef,
      purpose: "accessibility" as const,
      viewport: "suite" as const,
      journeyId: null,
    },
  ];
  const manifestWithoutHash: Omit<FixtureManifest, "manifestSha256"> = {
    schemaVersion: V11_FIXTURE_SCHEMA,
    fixtureSetId,
    generatedAt,
    contentClassification: "synthetic-only" as const,
    isolation: "one-user-per-viewport-journey" as const,
    journeyAccountCount: 18 as const,
    accessibilityAccountCount: 1 as const,
    accounts,
  };
  const manifest: FixtureManifest = {
    ...manifestWithoutHash,
    manifestSha256: computeFixtureManifestHash(manifestWithoutHash),
  };
  return { manifest, journeys: journeyFixtures, accessibility };
}

export async function prepareFixtureActiveSession(fixture: FixtureAccount): Promise<void> {
  if (!fixture.activeSessionId) return;
  await prisma.studySession.create({
    data: {
      id: fixture.activeSessionId,
      userId: fixture.userId,
      workspaceId: fixture.workspaceId,
      subjectId: fixture.subjectId,
      taskId: fixture.taskId,
      syllabusNodeId: fixture.syllabusNodeId,
      status: "RUNNING",
      startedAt: new Date(Date.now() - 6 * 60 * 1000),
      accumulatedPauseSeconds: 0,
      effectiveMinutes: 0,
      goalMinutes: 25,
      startSource: "TASK",
      closeoutVersion: 1,
    },
  });
}

export async function releaseFixtureActiveSessions(fixture: FixtureAccount): Promise<void> {
  await prisma.studySession.updateMany({
    where: {
      subjectId: fixture.subjectId,
      status: { in: ["RUNNING", "PAUSED"] },
    },
    data: {
      status: "CANCELED",
      endedAt: new Date(),
    },
  });
}

function createJourneyFixtureInputs(fixtureSetId: string): JourneyFixture[] {
  return (Object.keys(VIEWPORTS) as ViewportName[]).flatMap((viewport) => JOURNEY_IDS.map((journeyId) => ({
    ...createAccountInput(fixtureSetId, "journey", viewport, journeyId),
    journeyId,
    viewport,
  })));
}

function createAccountInput(
  fixtureSetId: string,
  purpose: "journey" | "accessibility",
  viewport: ViewportName | "suite",
  journeyId: JourneyId | null,
): FixtureAccount {
  const userId = randomUUID();
  const discriminator = journeyId ? `${viewport}-${journeyId}` : "a11y-suite";
  const activeSessionId = journeyId === "timer-closeout" || purpose === "accessibility" ? randomUUID() : null;
  return {
    accountRef: canonicalSha256({ domain: "areaforge.v11.browser-fixture-account.v1", fixtureSetId, userId }),
    userId,
    email: `v11-${fixtureSetId}-${discriminator}@areasong.local`,
    workspaceId: randomUUID(),
    subjectId: randomUUID(),
    secondarySubjectId: purpose === "accessibility" ? randomUUID() : null,
    syllabusNodeId: randomUUID(),
    secondarySyllabusNodeId: purpose === "accessibility" ? randomUUID() : null,
    taskId: randomUUID(),
    noteId: purpose === "accessibility" ? randomUUID() : null,
    activeSessionId,
  };
}

function requireWriteConsent(): void {
  if (process.env.AREAFORGE_BROWSER_EVIDENCE_ALLOW_WRITES !== "true") {
    throw new Error("AREAFORGE_BROWSER_EVIDENCE_ALLOW_WRITES=true is required for synthetic local writes");
  }
  if (process.env.AREAFORGE_BROWSER_EVIDENCE_ALLOW_NON_LOCAL !== undefined) {
    throw new Error("AREAFORGE_BROWSER_EVIDENCE_ALLOW_NON_LOCAL is unsupported");
  }
}

function rejectPlaintextPasswordInputs(): void {
  for (const name of [
    "AREAFORGE_SMOKE_PASSWORD",
    "AREAFORGE_BROWSER_EVIDENCE_PASSWORD",
    "AREAFORGE_BROWSER_EVIDENCE_PASSWORD_VALUE",
  ]) {
    if (process.env[name] !== undefined) throw new Error(`${name} is unsupported; use AREAFORGE_SMOKE_PASSWORD_FILE`);
  }
}

function parseLocalBaseUrl(value: string | undefined): URL {
  if (!value) throw new Error("AREAFORGE_BROWSER_EVIDENCE_BASE_URL is required");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("AREAFORGE_BROWSER_EVIDENCE_BASE_URL must be a valid local origin");
  }
  if (
    !["http:", "https:"].includes(url.protocol)
    || !localHosts.has(url.hostname)
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("AREAFORGE_BROWSER_EVIDENCE_BASE_URL must be a credential-free local origin");
  }
  url.pathname = "/";
  return url;
}

function parseExpectedDatabaseName(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$/.test(value) || !value.includes("v11browser")) {
    throw new Error("AREAFORGE_BROWSER_EVIDENCE_EXPECTED_DATABASE_NAME must be an explicit database name containing v11browser");
  }
  return value;
}

function parseLocalDatabaseUrl(value: string | undefined, expectedDatabaseName: string): string {
  if (!value) throw new Error("DATABASE_URL is required");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid local PostgreSQL URL");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || !localHosts.has(url.hostname)
    || !url.pathname
    || url.pathname === "/"
    || [...url.searchParams.keys()].some((key) => ["host", "hostaddr"].includes(key.toLowerCase()))
  ) {
    throw new Error("DATABASE_URL must target a named database on localhost, 127.0.0.1, or ::1");
  }
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error("DATABASE_URL database name must use valid URL encoding");
  }
  if (databaseName !== expectedDatabaseName) {
    throw new Error("DATABASE_URL database name must match AREAFORGE_BROWSER_EVIDENCE_EXPECTED_DATABASE_NAME");
  }
  return value;
}

function resolveOutputDirectory(root: string, configured: string | undefined): { absolute: string; relative: string } {
  if (!configured) throw new Error("AREAFORGE_BROWSER_EVIDENCE_OUTPUT_DIR is required");
  if (/[\u0000-\u001f\u007f]/.test(configured)) {
    throw new Error("AREAFORGE_BROWSER_EVIDENCE_OUTPUT_DIR contains control characters");
  }
  const absolute = path.resolve(root, configured);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("AREAFORGE_BROWSER_EVIDENCE_OUTPUT_DIR must stay inside the workspace");
  }
  if (path.basename(absolute) === "." || path.basename(absolute) === "..") {
    throw new Error("AREAFORGE_BROWSER_EVIDENCE_OUTPUT_DIR is invalid");
  }
  const normalized = relative.split(path.sep).join("/");
  if (normalized.split("/").some((part) => /^(?:\.env(?:\..*)?|secrets?|tokens?|passwords?|private[-_]?keys?|database[-_]?dumps?)$/i.test(part))) {
    throw new Error("AREAFORGE_BROWSER_EVIDENCE_OUTPUT_DIR contains a forbidden sensitive path component");
  }
  return { absolute, relative: normalized };
}

function resolveSystemChrome(configured: string | undefined): string {
  const candidates = configured ? [configured] : defaultChromePaths;
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue;
    try {
      const metadata = lstatSync(candidate);
      if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
      if ((metadata.mode & constants.S_IXUSR) === 0) continue;
      return candidate;
    } catch {
      // Try the next system installation path without exposing local paths.
    }
  }
  throw new Error("an executable, non-symlink system Google Chrome installation is required");
}

function parseTimeout(value: string | undefined): number {
  const timeout = Number(value ?? "15000");
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 60_000) {
    throw new Error("AREAFORGE_BROWSER_EVIDENCE_TIMEOUT_MS must be an integer between 1000 and 60000");
  }
  return timeout;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertRealDirectoryChain(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("browser evidence output parent escapes the workspace");
  }
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const metadata = lstatSync(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("browser evidence output parent chain must contain only real directories");
    }
  }
}
