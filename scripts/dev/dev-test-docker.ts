import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEV_TEST_LABELS,
  DEV_TEST_POOL,
  containerName,
  parseSlot,
  type PoolInstance,
  type SlotNumber,
} from "./dev-test-pool-core";

const UPLOADS_VOLUME = `${DEV_TEST_POOL}-uploads`;

type DockerInspect = {
  Id: string;
  Name: string;
  Created: string;
  Image: string;
  Config: { Image: string; Labels?: Record<string, string> };
  State: { Running: boolean; Status: string };
};

type ImageInspect = {
  Id: string;
  Config: { Labels?: Record<string, string> };
};

export type BuildIdentity = {
  imageTag: string;
  appVersion: string;
  gitCommit: string;
  sourceFingerprint: string;
  buildId: string;
  generation: number;
  note: string;
};

export type DockerDiskUsage = {
  type: string;
  totalCount: string;
  active: string;
  size: string;
  reclaimable: string;
};

export class DockerClient {
  constructor(private readonly root: string) {}

  assertAvailable(): void {
    this.run(["version", "--format", "{{.Server.Version}}"]);
  }

  build(identity: BuildIdentity): string {
    this.runHostBuild();
    const context = this.prepareStandaloneContext(identity);
    try {
      const labels = this.identityLabels(identity);
      const args = ["build", "-f", path.join(this.root, "infra/docker/web.dev-test.Dockerfile"), "-t", identity.imageTag];
      for (const [key, value] of Object.entries(labels)) args.push("--label", `${key}=${value}`);
      args.push(context);
      this.run(args, { stdio: "inherit" });
      return this.run(["image", "inspect", "--format", "{{.Id}}", identity.imageTag]).trim();
    } finally {
      rmSync(context, { recursive: true, force: true });
    }
  }

  listOwned(): PoolInstance[] {
    const ids = this.run([
      "ps", "-aq", "--filter", `label=${DEV_TEST_LABELS.pool}=${DEV_TEST_POOL}`,
    ]).split(/\s+/).filter(Boolean);
    if (ids.length === 0) return [];
    return this.inspectContainers(ids).map((container) => this.toPoolInstance(container));
  }

  diskUsage(): DockerDiskUsage[] {
    const output = this.run(["system", "df", "--format", "{{json .}}"]);
    return output.split(/\r?\n/).filter(Boolean).map((line) => {
      const item = JSON.parse(line) as Record<string, unknown>;
      return {
        type: requiredString(item, "Type"),
        totalCount: requiredString(item, "TotalCount"),
        active: requiredString(item, "Active"),
        size: requiredString(item, "Size"),
        reclaimable: requiredString(item, "Reclaimable"),
      };
    });
  }

  assertSlotNamesOwned(): void {
    for (let slot = 1; slot <= 3; slot += 1) {
      const expectedSlot = slot as SlotNumber;
      const container = this.inspectContainer(containerName(expectedSlot));
      if (!container) continue;
      const labels = container.Config.Labels ?? {};
      if (labels[DEV_TEST_LABELS.pool] !== DEV_TEST_POOL || labels[DEV_TEST_LABELS.slot] !== String(slot)) {
        throw new Error(`container name ${containerName(expectedSlot)} is occupied by a non-pool container`);
      }
    }
  }

  ensureUploadsVolume(): void {
    const inspected = this.runJson<{ Labels?: Record<string, string> }[]>(["volume", "inspect", UPLOADS_VOLUME], true)?.[0];
    if (!inspected) {
      this.run(["volume", "create", "--label", `${DEV_TEST_LABELS.pool}=${DEV_TEST_POOL}`, UPLOADS_VOLUME]);
      return;
    }
    if (inspected.Labels?.[DEV_TEST_LABELS.pool] !== DEV_TEST_POOL) {
      throw new Error(`volume ${UPLOADS_VOLUME} exists without the AreaForge test-pool ownership label`);
    }
  }

  runInstance(slot: SlotNumber, port: number, identity: BuildIdentity, environment: Record<string, string>): string {
    this.ensureUploadsVolume();
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "areaforge-dev-test-env-"));
    const envFile = path.join(temporaryDirectory, "runtime.env");
    writeFileSync(envFile, serializeEnvironment(environment), { encoding: "utf8", mode: 0o600 });
    try {
      const labels = { ...this.identityLabels(identity), [DEV_TEST_LABELS.slot]: String(slot), [DEV_TEST_LABELS.port]: String(port) };
      const args = ["run", "-d", "--name", containerName(slot), "--restart", "no"];
      for (const [key, value] of Object.entries(labels)) args.push("--label", `${key}=${value}`);
      args.push(
        "--env-file", envFile,
        "--add-host", "host.docker.internal:host-gateway",
        "-p", `127.0.0.1:${port}:3000`,
        "-v", `${UPLOADS_VOLUME}:/app/uploads`,
        identity.imageTag,
      );
      return this.run(args).trim();
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  stop(name: string): void {
    this.run(["stop", "--time", "10", name]);
  }

  start(name: string): void {
    this.run(["start", name]);
  }

  rename(from: string, to: string): void {
    this.run(["rename", from, to]);
  }

  remove(name: string): void {
    this.run(["rm", "-f", name]);
  }

  logs(name: string): string {
    return this.run(["logs", "--tail", "200", name], { allowFailure: true });
  }

  removeOwnedImageIfUnused(imageId: string): void {
    if (!imageId) return;
    const image = this.runJson<ImageInspect[]>(["image", "inspect", imageId], true)?.[0];
    if (!image || image.Config.Labels?.[DEV_TEST_LABELS.pool] !== DEV_TEST_POOL) return;
    const references = this.run(["ps", "-aq", "--filter", `ancestor=${imageId}`], { allowFailure: true }).trim();
    if (references) return;
    this.run(["image", "rm", imageId], { allowFailure: true });
  }

  removeCandidateImage(imageId: string): void {
    this.removeOwnedImageIfUnused(imageId);
  }

  inspectContainer(name: string): DockerInspect | null {
    return this.runJson<DockerInspect[]>(["inspect", name], true)?.[0] ?? null;
  }

  private inspectContainers(ids: string[]): DockerInspect[] {
    return this.runJson<DockerInspect[]>(["inspect", ...ids]) ?? [];
  }

  private toPoolInstance(container: DockerInspect): PoolInstance {
    const labels = container.Config.Labels ?? {};
    return {
      id: container.Id,
      name: container.Name.replace(/^\//, ""),
      slot: parseSlot(requiredLabel(labels, DEV_TEST_LABELS.slot)),
      port: parseIntegerLabel(labels, DEV_TEST_LABELS.port),
      generation: parseIntegerLabel(labels, DEV_TEST_LABELS.generation),
      createdAt: container.Created,
      running: container.State.Running,
      imageId: container.Image,
      sourceFingerprint: requiredLabel(labels, DEV_TEST_LABELS.sourceFingerprint),
      gitCommit: requiredLabel(labels, DEV_TEST_LABELS.gitCommit),
      buildId: requiredLabel(labels, DEV_TEST_LABELS.buildId),
      note: labels[DEV_TEST_LABELS.note] ?? "",
    };
  }

  private identityLabels(identity: BuildIdentity): Record<string, string> {
    return {
      [DEV_TEST_LABELS.pool]: DEV_TEST_POOL,
      [DEV_TEST_LABELS.generation]: String(identity.generation),
      [DEV_TEST_LABELS.sourceFingerprint]: identity.sourceFingerprint,
      [DEV_TEST_LABELS.gitCommit]: identity.gitCommit,
      [DEV_TEST_LABELS.buildId]: identity.buildId,
      [DEV_TEST_LABELS.note]: identity.note,
    };
  }

  private runHostBuild(): void {
    this.runProcess("pnpm", ["db:generate"], { stdio: "inherit" });
    this.runProcess("pnpm", ["--filter", "@areaforge/web", "build"], { stdio: "inherit" });
  }

  private prepareStandaloneContext(identity: BuildIdentity): string {
    const context = mkdtempSync(path.join(tmpdir(), "areaforge-dev-test-build-"));
    try {
      const copyOptions = { recursive: true, verbatimSymlinks: true } as const;
      cpSync(path.join(this.root, "apps/web/.next/standalone"), path.join(context, "standalone"), copyOptions);
      cpSync(path.join(this.root, "apps/web/.next/static"), path.join(context, "static"), copyOptions);
      cpSync(path.join(this.root, "apps/web/public"), path.join(context, "public"), copyOptions);
      mkdirSync(context, { recursive: true });
      this.runProcess("pnpm", ["exec", "tsx", "scripts/ops/generate-runtime-identity.ts", path.join(context, "runtime-identity.json")], {
        environment: {
          AREAFORGE_APP_VERSION: identity.appVersion,
          AREAFORGE_GIT_COMMIT: identity.gitCommit,
          AREAFORGE_UX_SOURCE_FINGERPRINT_SCHEMA: "ux-source-v2",
          AREAFORGE_UX_SOURCE_HASH: identity.sourceFingerprint,
          AREAFORGE_BUILD_ID: identity.buildId,
        },
      });
      return context;
    } catch (error) {
      rmSync(context, { recursive: true, force: true });
      throw error;
    }
  }

  private run(args: string[], options: { allowFailure?: boolean; stdio?: "inherit" } = {}): string {
    return this.runProcess("docker", args, options);
  }

  private runProcess(
    command: string,
    args: string[],
    options: { allowFailure?: boolean; stdio?: "inherit"; environment?: Record<string, string> } = {},
  ): string {
    const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
      cwd: this.root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: options.stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
      env: options.environment ? { ...process.env, ...options.environment } : process.env,
    };
    const result = spawnSync(command, args, spawnOptions);
    if (result.status !== 0 && !options.allowFailure) {
      const detail = compact(result.stderr || result.stdout || result.error?.message || `${command} command failed`);
      throw new Error(`${command} ${args[0] ?? "command"} failed: ${detail}`);
    }
    return result.stdout ?? "";
  }

  private runJson<T>(args: string[], allowFailure = false): T | null {
    const output = this.run(args, { allowFailure }).trim();
    if (!output) return null;
    return JSON.parse(output) as T;
  }
}

function requiredLabel(labels: Record<string, string>, key: string): string {
  const value = labels[key]?.trim();
  if (!value) throw new Error(`owned container is missing required label ${key}`);
  return value;
}

function requiredString(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`docker system df is missing field ${key}`);
  return value;
}

function parseIntegerLabel(labels: Record<string, string>, key: string): number {
  const value = Number(requiredLabel(labels, key));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`owned container has invalid label ${key}`);
  return value;
}

function serializeEnvironment(environment: Record<string, string>): string {
  return `${Object.entries(environment).map(([key, value]) => `${key}=${value.replace(/\r?\n/g, "")}`).join("\n")}\n`;
}

function compact(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 500);
}
