import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

type AdmissionFailure =
  | "INVALID_TAG"
  | "TAG_VERSION_MISMATCH"
  | "WORKSPACE_VERSION_MISMATCH"
  | "TAG_NOT_FOUND"
  | "TAG_SHA_MISMATCH"
  | "DEFAULT_BRANCH_NOT_FOUND"
  | "TAG_NOT_ON_DEFAULT_BRANCH";

interface WorkspacePackage {
  name?: unknown;
  version?: unknown;
}

interface AdmissionResult {
  tag: string;
  version: string;
  releaseCommit: string;
  defaultBranch: string;
  eventName: string;
  workspaceCount: number;
}

const root = path.resolve(process.env.AREAFORGE_RELEASE_ADMISSION_ROOT ?? process.cwd());

function fail(reason: AdmissionFailure): never {
  console.error(reason);
  process.exit(1);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    fail(name === "AREAFORGE_RELEASE_TAG" ? "INVALID_TAG" : "TAG_SHA_MISMATCH");
  }
  return value as string;
}

function run(command: string, args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
  };
}

function readRootVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version?: unknown };
    if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
      fail("TAG_VERSION_MISMATCH");
    }
    return packageJson.version;
  } catch {
    fail("TAG_VERSION_MISMATCH");
  }
}

function readWorkspaceVersions(): { versions: string[]; count: number } {
  const result = run("pnpm", ["list", "-r", "--depth", "-1", "--json"]);
  if (result.status !== 0) {
    fail("WORKSPACE_VERSION_MISMATCH");
  }

  try {
    const packages = JSON.parse(result.stdout) as unknown;
    if (!Array.isArray(packages)) {
      fail("WORKSPACE_VERSION_MISMATCH");
    }
    const workspacePackages = packages as WorkspacePackage[];
    if (workspacePackages.length === 0 || workspacePackages.some((item) => typeof item.version !== "string" || item.version.length === 0)) {
      fail("WORKSPACE_VERSION_MISMATCH");
    }
    return {
      versions: workspacePackages.map((item) => item.version as string),
      count: workspacePackages.length,
    };
  } catch {
    fail("WORKSPACE_VERSION_MISMATCH");
  }
}

function gitCommitForTag(tag: string): string {
  const result = run("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`]);
  if (result.status !== 0) {
    fail("TAG_NOT_FOUND");
  }
  const commit = result.stdout.trim();
  if (!commit) {
    fail("TAG_NOT_FOUND");
  }
  return commit;
}

function verifyDefaultBranch(tagCommit: string, defaultBranch: string): void {
  const branchRef = `refs/remotes/origin/${defaultBranch}`;
  const branch = run("git", ["show-ref", "--verify", "--quiet", branchRef]);
  if (branch.status !== 0) {
    fail("DEFAULT_BRANCH_NOT_FOUND");
  }

  const ancestor = run("git", ["merge-base", "--is-ancestor", tagCommit, branchRef]);
  if (ancestor.status !== 0) {
    fail("TAG_NOT_ON_DEFAULT_BRANCH");
  }
}

function main(): void {
  const tag = requiredEnvironment("AREAFORGE_RELEASE_TAG");
  const workflowSha = requiredEnvironment("AREAFORGE_WORKFLOW_SHA");
  const defaultBranch = requiredEnvironment("AREAFORGE_DEFAULT_BRANCH");
  const eventName = requiredEnvironment("AREAFORGE_EVENT_NAME");

  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    fail("INVALID_TAG");
  }

  const version = readRootVersion();
  if (`v${version}` !== tag) {
    fail("TAG_VERSION_MISMATCH");
  }

  const workspaces = readWorkspaceVersions();
  if (workspaces.versions.some((workspaceVersion) => workspaceVersion !== version)) {
    fail("WORKSPACE_VERSION_MISMATCH");
  }

  const releaseCommit = gitCommitForTag(tag);
  if (releaseCommit !== workflowSha) {
    fail("TAG_SHA_MISMATCH");
  }

  verifyDefaultBranch(releaseCommit, defaultBranch);

  const result: AdmissionResult = {
    tag,
    version,
    releaseCommit,
    defaultBranch,
    eventName,
    workspaceCount: workspaces.count,
  };
  console.log(JSON.stringify(result));
}

main();
