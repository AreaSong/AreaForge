import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { quotaToolEnvironment } from "./quota-fixture";

async function main() {
  const root = process.argv[2] ?? ""; const uid = process.getuid!();
  if (!path.isAbsolute(root) || root !== realpathSync(root) || uid === 0 || !/^areaforge-v20-quota-[A-Za-z0-9]+$/.test(path.basename(root))) throw new Error("ROOT_INVALID");
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || stat.mode & 0o077 || readdirSync(root).length
    || ![realpathSync(tmpdir()), realpathSync("/tmp")].includes(path.dirname(root))) throw new Error("ROOT_INVALID");
  const env = quotaToolEnvironment();
  const run = (args: string[], additional: NodeJS.ProcessEnv = {}) => execFileSync("docker", args, { env: { ...env, ...additional }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if ((env.DOCKER_HOST && !env.DOCKER_HOST.startsWith("unix://")) || !run(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]).startsWith("unix://")) throw new Error("REMOTE_DOCKER");
  const image = run(["image", "inspect", "postgres:16-alpine", "--format", "{{.Id}}"]);
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("IMAGE_INVALID");
  const suffix = randomBytes(6).toString("hex"); const containerName = `areaforge-v20-quota-${suffix}`;
  const databaseName = `areaforge_v20_quota_${suffix}`; const volumeName = `${containerName}-data`;
  if (run(["volume", "ls", "--filter", `name=^${volumeName}$`, "--format", "{{.Name}}"])) throw new Error("VOLUME_EXISTS");
  const password = randomBytes(32).toString("hex");
  for (const name of ["uploads", "exports"]) mkdirSync(path.join(root, name), { mode: 0o700 });
  run(["volume", "create", "--label", "com.areaforge.fixture=quota", "--label", `com.areaforge.fixture.owner=${uid}`, volumeName]);
  run(["run", "-d", "--name", containerName, "--label", "com.areaforge.fixture=quota", "--label", `com.areaforge.fixture.owner=${uid}`,
    "--cpus=2", "--memory=1g", "--mount", `type=volume,source=${volumeName},target=/var/lib/postgresql/data`, "-p", "127.0.0.1::5432",
    "-e", "POSTGRES_USER=fixture", "-e", `POSTGRES_DB=${databaseName}`, "-e", "POSTGRES_PASSWORD", image], { POSTGRES_PASSWORD: password });
  const port = run(["port", containerName, "5432/tcp"]);
  if (!/^127\.0\.0\.1:\d+$/.test(port)) throw new Error("PORT_INVALID");
  const marker = { schemaVersion: 1, fixtureKind: "quota", databaseName, containerName, volumeName, port: Number(port.split(":")[1]), image,
    ownerUid: uid, ownerGid: process.getgid!(), repositoryHash: createHash("sha256").update(realpathSync(process.cwd())).digest("hex") };
  writeFileSync(path.join(root, ".areaforge-quota-fixture.json"), JSON.stringify(marker), { flag: "wx", mode: 0o600 });
  writeFileSync(path.join(root, ".fixture.private.json"), JSON.stringify({ password, sessionSecret: randomBytes(32).toString("hex"), actionSecret: randomBytes(32).toString("hex") }), { flag: "wx", mode: 0o600 });
  for (let attempt = 0; attempt < 30; attempt++) {
    try { run(["exec", containerName, "pg_isready", "-U", "fixture", "-d", databaseName]);
      console.log(JSON.stringify({ created: true, containerName, volumeName, databaseName, port: marker.port, productionTouched: false })); return;
    } catch { await delay(500); }
  }
  throw new Error("DATABASE_NOT_READY");
}
main().catch(() => { console.error("QUOTA_FIXTURE_CREATE_FAILED; preserve registered resources"); process.exitCode = 1; });
