import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PrismaClient } from "../../packages/db/src/index";

export const SEARCH_INDEX_SCHEMA_SHA256 = "6001f7ef0e030295a589f4e845eba3f75ba3b214885863f9251e637aa4ae4583";
export interface SearchIndexFixture {
  root: string; databaseName: string; containerName: string; volumeName: string; port: number; image: string;
  ownerUid: number; ownerGid: number; operatorEmail: string; scopeId: string;
  password: string; sessionSecret: string; actionSecret: string;
}

export function loadSearchIndexFixture(root: string, repository = process.cwd()): SearchIndexFixture {
  const uid = process.getuid?.(); const gid = process.getgid?.();
  if (uid === undefined || uid === 0 || gid === undefined || !path.isAbsolute(root) || root !== realpathSync(root)
    || ![realpathSync(tmpdir()), realpathSync("/tmp")].includes(path.dirname(root))
    || !/^areaforge-v20-search-[A-Za-z0-9]+$/.test(path.basename(root))) invalid();
  for (const directory of [root, path.join(root, "uploads"), path.join(root, "exports")]) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || stat.mode & 0o077 || realpathSync(directory) !== directory) invalid();
  }
  const marker = readSearchIndexPrivate(path.join(root, ".areaforge-search-fixture.json"), uid);
  const secret = readSearchIndexPrivate(path.join(root, ".fixture.private.json"), uid);
  const keys = ["schemaVersion", "fixtureKind", "databaseName", "containerName", "volumeName", "port", "image", "ownerUid", "ownerGid", "repositoryHash"];
  if (Object.keys(marker).length !== keys.length || keys.some(key => !(key in marker)) || marker.schemaVersion !== 1
    || marker.fixtureKind !== "search-index" || marker.ownerUid !== uid || marker.ownerGid !== gid
    || marker.repositoryHash !== createHash("sha256").update(realpathSync(repository)).digest("hex")) invalid();
  const suffix = String(marker.databaseName).match(/^areaforge_v20_search_([a-f0-9]{12})$/)?.[1];
  if (!suffix || marker.containerName !== `areaforge-v20-search-${suffix}` || marker.volumeName !== `areaforge-v20-search-${suffix}-data`
    || !Number.isSafeInteger(marker.port) || Number(marker.port) < 1024 || Number(marker.port) > 65535
    || !/^sha256:[a-f0-9]{64}$/.test(String(marker.image))) invalid();
  if (Object.keys(secret).length !== 3 || ["password", "sessionSecret", "actionSecret"].some(key => !/^[a-f0-9]{64}$/.test(String(secret[key])))
    || new Set(Object.values(secret)).size !== 3) invalid();
  return { root, databaseName: String(marker.databaseName), containerName: String(marker.containerName), volumeName: String(marker.volumeName),
    port: Number(marker.port), image: String(marker.image), ownerUid: uid, ownerGid: gid, operatorEmail: `operator-search-${suffix}@example.test`,
    scopeId: createHash("sha256").update(JSON.stringify(marker)).digest("hex"), password: String(secret.password),
    sessionSecret: String(secret.sessionSecret), actionSecret: String(secret.actionSecret) };
}

export function searchIndexFixtureEnvironment(fixture: SearchIndexFixture): NodeJS.ProcessEnv {
  return { ...searchIndexToolEnvironment(), DATABASE_URL: `postgresql://fixture:${fixture.password}@127.0.0.1:${fixture.port}/${fixture.databaseName}`,
    DOTENV_CONFIG_PATH: path.join(fixture.root, ".fixture-env-disabled"), AREAFORGE_SEARCH_INDEX_ISOLATED_DB: "1",
    AREAFORGE_SEARCH_INDEX_FIXTURE_ROOT: fixture.root, AUTH_ADMIN_EMAIL: fixture.operatorEmail,
    AUTH_SESSION_SECRET: fixture.sessionSecret, AUTH_ACTION_TOKEN_SECRET: fixture.actionSecret, AUTH_MULTI_USER_ENABLED: "true", AUTH_RBAC_ENABLED: "true",
    SEARCH_INDEX_ENABLED: "true", SEARCH_INDEX_QUEUE_ENABLED: "true", DATA_JOB_WORKER_ENABLED: "true",
    RANKING_ENABLED: "false", RANKING_PROJECTION_ENABLED: "false", RANKING_REBUILD_QUEUE_ENABLED: "false",
    UPLOAD_DIR: path.join(fixture.root, "uploads"), EXPORT_DIR: path.join(fixture.root, "exports"),
    DATA_LIFECYCLE_ENABLED: "false", DATA_DELETE_ENABLED: "false", DATA_DELETE_WORKER_ENABLED: "false", DATA_EXPORT_ENABLED: "false",
    OPS_EXECUTION_ENABLED: "false", OPS_AGENT_ENABLED: "false", OPS_AGENT_PRODUCTION_ENABLED: "false",
    PLATFORM_NOTIFICATIONS_ENABLED: "false", PLATFORM_NOTIFICATION_QUEUE_ENABLED: "false", AI_ENABLED: "false", AI_API_KEY: "",
    SMTP_HOST: "", SMTP_USER: "", SMTP_PASSWORD: "", SMTP_FROM: "" };
}

export function searchIndexToolEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(["PATH", "HOME", "TMPDIR", "PNPM_HOME", "LANG", "LC_ALL", "DOCKER_HOST", "DOCKER_CONTEXT"]
    .flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
}

export function readSearchIndexPrivate(file: string, uid: number): Record<string, unknown> {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== uid || stat.mode & 0o077 || stat.size > 16_384) invalid();
    const value = JSON.parse(readFileSync(fd, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    return value;
  } finally { closeSync(fd); }
}

export async function verifySearchIndexFixtureLedger(client: PrismaClient, fixture: SearchIndexFixture): Promise<number> {
  const [database] = await client.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(database?.name, fixture.databaseName);
  assert.equal(createHash("sha256").update(readFileSync("prisma/schema.prisma")).digest("hex"), SEARCH_INDEX_SCHEMA_SHA256);
  const root = path.resolve("prisma/migrations"); const expected = readdirSync(root).filter(name => /^\d+_/.test(name)).sort();
  assert.equal(expected.length, 54);
  const rows = await client.$queryRaw<Array<{ name: string; checksum: string; finished: Date | null; rolledBack: Date | null; logs: string | null; steps: number }>>`
    SELECT migration_name AS name, checksum, finished_at AS finished, rolled_back_at AS "rolledBack", logs, applied_steps_count AS steps
    FROM "_prisma_migrations" ORDER BY started_at, migration_name`;
  assert.deepEqual(rows.map(row => row.name), expected);
  for (const row of rows) {
    assert.ok(row.finished); assert.equal(row.rolledBack, null); assert.ok(!row.logs); assert.equal(row.steps, 1);
    assert.equal(row.checksum, createHash("sha256").update(readFileSync(path.join(root, row.name, "migration.sql"))).digest("hex"));
  }
  return rows.length;
}

export function assertSearchIndexFixtureContainer(fixture: SearchIndexFixture): void {
  const env = searchIndexToolEnvironment();
  if (env.DOCKER_HOST && !env.DOCKER_HOST.startsWith("unix://")) invalid();
  if (!execFileSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { env, encoding: "utf8" }).trim().startsWith("unix://")) invalid();
  const row = JSON.parse(execFileSync("docker", ["inspect", fixture.containerName], { env, encoding: "utf8" }))[0];
  if (row.Config.Labels?.["com.areaforge.fixture"] !== "search-index" || row.Config.Labels?.["com.areaforge.fixture.owner"] !== String(fixture.ownerUid)
    || row.Image !== fixture.image || row.Config.Env.filter((entry: string) => entry.startsWith("POSTGRES_DB=")).join() !== `POSTGRES_DB=${fixture.databaseName}`
    || !row.Mounts.some((mount: { Type: string; Name: string; Destination: string }) => mount.Type === "volume" && mount.Name === fixture.volumeName && mount.Destination === "/var/lib/postgresql/data")) invalid();
  const [volume] = JSON.parse(execFileSync("docker", ["volume", "inspect", fixture.volumeName], { env, encoding: "utf8" }));
  if (volume.Labels?.["com.areaforge.fixture"] !== "search-index" || volume.Labels?.["com.areaforge.fixture.owner"] !== String(fixture.ownerUid)) invalid();
  const port = execFileSync("docker", ["port", fixture.containerName, "5432/tcp"], { env, encoding: "utf8" }).trim();
  if (port !== `127.0.0.1:${fixture.port}`) invalid();
}
function invalid(): never { throw new Error("SEARCH_INDEX_FIXTURE_INVALID"); }
