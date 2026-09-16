import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SlotSelection } from "./dev-test-pool-core";
import { loadDevTestDeleteFixture } from "./dev-test-delete-fixture";
import { loadDevTestOpsFixture } from "./dev-test-ops-fixture";
import { loadDevTestRankingFixture } from "./dev-test-ranking-fixture";
import { loadDevTestSearchFixture } from "./dev-test-search-fixture";

export interface DevTestExportFixture {
  kind?: "DELETE" | "OPS" | "RANKING" | "SEARCH";
  operationContextRoot?: string;
  operationScopeId?: string;
  operatorEmail?: string;
  id: string;
  root: string;
  uploadRoot: string;
  exportRoot: string;
  databaseUrl: string;
  ownerUid: number;
  ownerGid: number;
  sessionSecret: string;
  actionSecret: string;
}

export function loadDevTestExportFixture(repository: string, env: NodeJS.ProcessEnv = process.env): DevTestExportFixture | undefined {
  if ([env.AREAFORGE_DEV_TEST_OPS_FIXTURE_ROOT, env.AREAFORGE_DEV_TEST_DELETE_FIXTURE_ROOT, env.AREAFORGE_DEV_TEST_EXPORT_FIXTURE_ROOT,
    env.AREAFORGE_DEV_TEST_RANKING_FIXTURE_ROOT, env.AREAFORGE_DEV_TEST_SEARCH_FIXTURE_ROOT].filter(Boolean).length > 1) throw new Error("TEST_FIXTURE_MODES_CONFLICT");
  if (env.AREAFORGE_DEV_TEST_SEARCH_FIXTURE_ROOT) return loadDevTestSearchFixture(repository, env);
  if (env.AREAFORGE_DEV_TEST_RANKING_FIXTURE_ROOT) return loadDevTestRankingFixture(repository, env);
  if (env.AREAFORGE_DEV_TEST_OPS_FIXTURE_ROOT) return loadDevTestOpsFixture(repository, env);
  if (env.AREAFORGE_DEV_TEST_DELETE_FIXTURE_ROOT) return loadDevTestDeleteFixture(repository, env);
  const value = env.AREAFORGE_DEV_TEST_EXPORT_FIXTURE_ROOT;
  if (!value) return undefined;
  try {
    if (env.AREAFORGE_DATA_EXPORT_ISOLATED_DB !== "1") invalid();
    const root = path.resolve(value);
    const temporaryRoots = [realpathSync(tmpdir()), ...(existsSync("/tmp") ? [realpathSync("/tmp")] : [])];
    if (!path.isAbsolute(value) || root !== realpathSync(root) || !temporaryRoots.includes(path.dirname(root))
      || !/^areaforge-v20-export-[A-Za-z0-9]+$/.test(path.basename(root))) invalid();
    const ownerUid = process.getuid?.(); const ownerGid = process.getgid?.();
    if (ownerUid === undefined || ownerUid === 0 || ownerGid === undefined) invalid();
    for (const directory of [root, path.join(root, "uploads"), path.join(root, "exports")]) {
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory
        || stat.uid !== ownerUid || (stat.mode & 0o077) !== 0) invalid();
    }
    const marker = readPrivateJson(path.join(root, ".areaforge-data-export-fixture.json"), ownerUid);
    const url = new URL(env.AREAFORGE_DEV_TEST_DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || url.search || url.hash || !/^\/areaforge_v20_export_[a-z0-9_]+$/.test(url.pathname)) invalid();
    const repositoryHash = createHash("sha256").update(repository).digest("hex");
    const expected = { schemaVersion: 1, fixtureKind: "data-export", databaseName: url.pathname.slice(1), ownerUid, ownerGid, repositoryHash };
    if (Object.keys(marker).length !== Object.keys(expected).length
      || Object.entries(expected).some(([key, expectedValue]) => marker[key] !== expectedValue)) invalid();
    const secrets = readPrivateJson(path.join(root, ".fixture.private.json"), ownerUid);
    if (Object.keys(secrets).length !== 2 || !validSecret(secrets.sessionSecret) || !validSecret(secrets.actionSecret)
      || secrets.sessionSecret === secrets.actionSecret) invalid();
    return { id: createHash("sha256").update(`${root}\n${JSON.stringify(expected)}`).digest("hex"), root,
      uploadRoot: path.join(root, "uploads"), exportRoot: path.join(root, "exports"), databaseUrl: url.href,
      ownerUid, ownerGid, sessionSecret: secrets.sessionSecret, actionSecret: secrets.actionSecret };
  } catch { throw new Error("DATA_EXPORT_TEST_FIXTURE_INVALID"); }
}

export function assertExportFixtureSlot(selection: SlotSelection, fixture?: DevTestExportFixture): void {
  const previous = selection.replacing?.fixtureId;
  if ((fixture && selection.replacing && previous !== fixture.id) || (previous && previous !== fixture?.id)) {
    throw new Error("DATA_EXPORT_TEST_FIXTURE_SLOT_MISMATCH");
  }
}

export function exportFixtureEnvironment(fixture: DevTestExportFixture, slot: number, port: number, appVersion: string): Record<string, string> {
  if (fixture.kind === "OPS" && (!fixture.operationContextRoot || !fixture.operationScopeId || !fixture.operatorEmail)) throw new Error("OPS_TEST_FIXTURE_INVALID");
  const database = new URL(fixture.databaseUrl); database.hostname = "host.docker.internal";
  return { DATABASE_URL: database.href, APP_URL: `http://127.0.0.1:${port}`, APP_VERSION: appVersion,
    AUTH_SESSION_COOKIE_NAME: `af_dev_test_${slot}`, AUTH_SESSION_SECRET: fixture.sessionSecret, AUTH_ACTION_TOKEN_SECRET: fixture.actionSecret,
    AUTH_MULTI_USER_ENABLED: "true", AUTH_RBAC_ENABLED: "true", DATA_LIFECYCLE_ENABLED: !fixture.kind || fixture.kind === "DELETE" ? "true" : "false", DATA_EXPORT_ENABLED: fixture.kind ? "false" : "true",
    DATA_DELETE_ENABLED: fixture.kind === "DELETE" ? "true" : "false", DATA_DELETE_WORKER_ENABLED: "false",
    // 派生任务的 Web 只检查排队许可；独立 CLI 是唯一进程启动入口。
    DATA_JOB_WORKER_ENABLED: fixture.kind === "RANKING" || fixture.kind === "SEARCH" ? "true" : "false", UPLOAD_DIR: "/app/uploads", EXPORT_DIR: "/app/exports", TRUST_PROXY: "false",
    OPS_AGENT_ENABLED: "false", OPS_EXECUTION_ENABLED: fixture.kind === "OPS" ? "true" : "false",
    ...(fixture.kind === "OPS" ? { AUTH_ADMIN_EMAIL: fixture.operatorEmail!, OPS_EXECUTION_LOCAL_FIXTURE: "true", OPS_EXECUTION_SCOPE_ID: fixture.operationScopeId!, OPS_EXECUTION_CONTEXT_FILE: "/app/ops-context/execution-context.json" } : {}),
    ...(fixture.kind === "RANKING" || fixture.kind === "SEARCH" ? { AUTH_ADMIN_EMAIL: fixture.operatorEmail! } : {}),
    AI_ENABLED: "false", AI_LOG_PROMPTS: "false", AI_ALLOW_SENSITIVE_CONTEXT: "false",
    RANKING_ENABLED: fixture.kind === "RANKING" ? "true" : "false", RANKING_PROJECTION_ENABLED: fixture.kind === "RANKING" ? "true" : "false",
    SEARCH_INDEX_ENABLED: fixture.kind === "SEARCH" ? "true" : "false", SEARCH_INDEX_QUEUE_ENABLED: fixture.kind === "SEARCH" ? "true" : "false",
    RANKING_REBUILD_QUEUE_ENABLED: fixture.kind === "RANKING" ? "true" : "false", PLATFORM_NOTIFICATIONS_ENABLED: "false", PLATFORM_NOTIFICATION_QUEUE_ENABLED: "false" };
}

export function exportFixtureBuildEnvironment(fixture: DevTestExportFixture, environment: Record<string, string>) {
  return { ...environment, DATABASE_URL: fixture.databaseUrl, UPLOAD_DIR: fixture.uploadRoot, EXPORT_DIR: fixture.exportRoot,
    AUTH_ADMIN_EMAIL: fixture.operatorEmail ?? "export-build@example.test", AUTH_ADMIN_PASSWORD_HASH: "", SMTP_HOST: "", SMTP_USER: "", SMTP_PASSWORD: "", SMTP_FROM: "",
    ...(fixture.kind === "OPS" ? { OPS_EXECUTION_CONTEXT_FILE: path.join(fixture.operationContextRoot!, "execution-context.json") } : {}),
    AI_BASE_URL: "http://127.0.0.1:1", AI_API_KEY: "", AI_MODEL: "", AI_CREDENTIALS_ENCRYPTION_KEY: "", AI_PAYLOAD_BINDING_SECRET: "" };
}

function readPrivateJson(file: string, ownerUid: number): Record<string, unknown> {
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.uid !== ownerUid || (stat.mode & 0o077) !== 0 || stat.size > 4_096) invalid();
    const value = JSON.parse(readFileSync(descriptor, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    return value;
  } finally { closeSync(descriptor); }
}
function validSecret(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function invalid(): never { throw new Error("DATA_EXPORT_TEST_FIXTURE_INVALID"); }
