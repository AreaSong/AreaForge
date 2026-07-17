import { spawnSync } from "node:child_process";

type ProbeKind = "github-release" | "ghcr-image";

interface ProbeResult {
  kind: ProbeKind;
  identity: string;
  state: "absent" | "exists";
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail("INVALID_RELEASE_IDENTITY_INPUT");
  return value;
}

function fail(reason: string): never {
  console.error(reason);
  process.exit(1);
}

function run(command: string, args: string[]): { status: number | null; output: string } {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim(),
  };
}

function probeGitHubRelease(repository: string, tag: string): ProbeResult {
  const result = run("gh", ["release", "view", tag, "--repo", repository, "--json", "tagName"]);
  if (result.status === 0) return { kind: "github-release", identity: `${repository}@${tag}`, state: "exists" };
  if (/^release not found\s*$/im.test(result.output)) {
    return { kind: "github-release", identity: `${repository}@${tag}`, state: "absent" };
  }
  fail("GITHUB_RELEASE_PROBE_FAILED");
}

function probeGhcrImage(image: string): ProbeResult {
  const result = run("docker", ["buildx", "imagetools", "inspect", image]);
  if (result.status === 0) return { kind: "ghcr-image", identity: image, state: "exists" };
  if (/\bmanifest unknown\b|\bno such manifest\b|:\s*not found\s*$/im.test(result.output)) {
    return { kind: "ghcr-image", identity: image, state: "absent" };
  }
  fail("GHCR_IMAGE_PROBE_FAILED");
}

function main(): void {
  const repository = required("AREAFORGE_RELEASE_REPOSITORY");
  const tag = required("AREAFORGE_RELEASE_TAG");
  const webImage = required("AREAFORGE_RELEASE_WEB_IMAGE");
  const migrationImage = required("AREAFORGE_RELEASE_MIGRATION_IMAGE");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    fail("INVALID_RELEASE_IDENTITY_INPUT");
  }
  for (const image of [webImage, migrationImage]) {
    if (!/^ghcr\.io\/[A-Za-z0-9._/-]+:v\d+\.\d+\.\d+$/.test(image)) fail("INVALID_RELEASE_IDENTITY_INPUT");
  }

  const results = [
    probeGitHubRelease(repository, tag),
    probeGhcrImage(webImage),
    probeGhcrImage(migrationImage),
  ];
  const existing = results.filter((result) => result.state === "exists");
  if (existing.length > 0) {
    console.error(JSON.stringify({ reason: "RELEASE_IDENTITY_EXISTS", existing }));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: "absent", results }));
}

main();
