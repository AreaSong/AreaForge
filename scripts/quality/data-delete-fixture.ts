import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import type { PrismaClient } from "../../packages/db/src/index";
import { tmpdir } from "node:os";
import path from "node:path";

export interface DataDeleteFixture {
  root: string; databaseName: string; restoreDatabaseName: string; containerName: string; port: number;
  password: string; sessionSecret: string; actionSecret: string; ownerUid: number; ownerGid: number;
}

export function loadDataDeleteFixture(root: string, repository = process.cwd()): DataDeleteFixture {
  const uid = process.getuid?.(); const gid = process.getgid?.();
  if (!uid || gid === undefined || !path.isAbsolute(root) || root !== realpathSync(root)
    || ![realpathSync(tmpdir()), realpathSync("/tmp")].includes(path.dirname(root))
    || !/^areaforge-v20-delete-[A-Za-z0-9]+$/.test(path.basename(root))) invalid();
  for (const directory of [root, ...["uploads", "exports", "backup", "restored-uploads", "restored-exports"].map(name => path.join(root, name))]) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory || stat.uid !== uid || (stat.mode & 0o077)) invalid();
  }
  const marker = readPrivate(path.join(root, ".areaforge-data-delete-fixture.json"), uid);
  const privateValues = readPrivate(path.join(root, ".fixture.private.json"), uid);
  const expectedKeys = ["schemaVersion", "fixtureKind", "databaseName", "restoreDatabaseName", "containerName", "image", "port", "ownerUid", "ownerGid", "repositoryHash"];
  if (Object.keys(marker).length !== expectedKeys.length || expectedKeys.some(key => !(key in marker)) || marker.schemaVersion !== 1
    || marker.fixtureKind !== "data-delete" || marker.ownerUid !== uid || marker.ownerGid !== gid
    || marker.repositoryHash !== createHash("sha256").update(realpathSync(repository)).digest("hex")) invalid();
  const databaseName = String(marker.databaseName);
  const suffix = databaseName.match(/^areaforge_v20_delete_([a-f0-9]{12})$/)?.[1];
  if (!suffix || marker.restoreDatabaseName !== databaseName + "_restore" || marker.containerName !== "areaforge-v20-delete-" + suffix
    || !Number.isSafeInteger(marker.port) || Number(marker.port) < 1024 || Number(marker.port) > 65535 || !/^sha256:[a-f0-9]{64}$/.test(String(marker.image))) invalid();
  if (Object.keys(privateValues).length !== 3 || ["password", "sessionSecret", "actionSecret"].some(key => !/^[a-f0-9]{64}$/.test(String(privateValues[key])))
    || new Set(Object.values(privateValues)).size !== 3) invalid();
  return { root, databaseName, restoreDatabaseName: String(marker.restoreDatabaseName), containerName: String(marker.containerName),
    port: Number(marker.port), ownerUid: uid, ownerGid: gid, password: String(privateValues.password),
    sessionSecret: String(privateValues.sessionSecret), actionSecret: String(privateValues.actionSecret) };
}

export function deleteFixtureEnvironment(fixture: DataDeleteFixture, restore = false): NodeJS.ProcessEnv {
  return { ...process.env, DATABASE_URL: "postgresql://fixture:" + fixture.password + "@127.0.0.1:" + fixture.port + "/" + (restore ? fixture.restoreDatabaseName : fixture.databaseName),
    AREAFORGE_DATA_DELETE_ISOLATED_DB: "1", AREAFORGE_DATA_DELETE_FIXTURE_ROOT: fixture.root,
    UPLOAD_DIR: path.join(fixture.root, restore ? "restored-uploads" : "uploads"), EXPORT_DIR: path.join(fixture.root, restore ? "restored-exports" : "exports"),
    AUTH_SESSION_SECRET: fixture.sessionSecret, AUTH_ACTION_TOKEN_SECRET: fixture.actionSecret,
    AUTH_MULTI_USER_ENABLED: "true", AUTH_RBAC_ENABLED: "true", DATA_LIFECYCLE_ENABLED: "true", DATA_DELETE_ENABLED: "true",
    DATA_EXPORT_ENABLED: "false", DATA_JOB_WORKER_ENABLED: "false", PLATFORM_NOTIFICATIONS_ENABLED: "false",
    PLATFORM_NOTIFICATION_QUEUE_ENABLED: "false", AI_ENABLED: "false", AI_API_KEY: "", SMTP_HOST: "", SMTP_PASSWORD: "" };
}

function readPrivate(file: string, uid: number): Record<string, unknown> {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== uid || (stat.mode & 0o077) || stat.size > 8192) invalid();
    const result = JSON.parse(readFileSync(fd, "utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) invalid();
    return result;
  } finally { closeSync(fd); }
}
function invalid(): never { throw new Error("DATA_DELETE_FIXTURE_INVALID"); }

export async function verifyDeleteFixtureLedger(client: PrismaClient) {
  const migrations = path.resolve("prisma/migrations");
  const expected = readdirSync(migrations).filter(name => /^\d+_/.test(name)).sort();
  const rows = await client.$queryRaw<Array<{ name: string; checksum: string; finished: Date | null; rolledBack: Date | null; logs: string | null; steps: number }>>`
    SELECT migration_name AS name, checksum, finished_at AS finished, rolled_back_at AS "rolledBack", logs, applied_steps_count AS steps
    FROM "_prisma_migrations" ORDER BY started_at, migration_name`;
  assert.deepEqual(rows.map(row => row.name), expected);
  for (const row of rows) {
    assert.ok(row.finished); assert.equal(row.rolledBack, null); assert.ok(!row.logs); assert.equal(row.steps, 1);
    assert.equal(row.checksum, createHash("sha256").update(readFileSync(path.join(migrations, row.name, "migration.sql"))).digest("hex"));
  }
  return rows.length;
}

export function assertDeleteFixtureContainer(fixture: DataDeleteFixture) {
  if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://")) invalid();
  const endpoint = execFileSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" }).trim();
  if (!endpoint.startsWith("unix://")) invalid();
  const labels = JSON.parse(execFileSync("docker", ["inspect", "--format", "{{json .Config.Labels}}", fixture.containerName], { encoding: "utf8" }));
  if (labels?.["com.areaforge.fixture"] !== "data-delete" || labels?.["com.areaforge.fixture.owner"] !== String(fixture.ownerUid)) invalid();
  const port = execFileSync("docker", ["port", fixture.containerName, "5432/tcp"], { encoding: "utf8" }).trim();
  if (port !== "127.0.0.1:" + fixture.port) invalid();
}
