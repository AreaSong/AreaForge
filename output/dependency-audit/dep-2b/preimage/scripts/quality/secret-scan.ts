import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

interface Finding {
  RuleID?: string;
  File?: string;
  StartLine?: number;
  EndLine?: number;
}

const root = process.cwd();
const temp = mkdtempSync(path.join(os.tmpdir(), "areaforge-secret-scan-"));
const historyMode = process.argv.includes("--history");
const expectedVersion = process.env.AREAFORGE_GITLEAKS_VERSION?.trim() || "8.30.1";

try {
  requireGitleaks();
  const scans = historyMode
    ? [{ label: "history", args: ["--log-opts", "--all"] }]
    : changedScans();

  if (scans.length === 0) {
    console.log("secret scan passed: nothing to scan.");
    process.exit(0);
  }

  const findings: Array<Finding & { scan: string }> = [];
  for (const scan of scans) {
    findings.push(...runScan(scan.label, scan.args).map((finding) => ({ ...finding, scan: scan.label })));
  }

  if (findings.length > 0) {
    console.error(`secret scan failed: ${findings.length} redacted finding(s).`);
    for (const finding of findings) {
      const rule = finding.RuleID ?? "unknown-rule";
      const file = finding.File ?? "unknown-file";
      const line = finding.StartLine ?? 0;
      console.error(`${finding.scan}: ${rule} ${file}:${line}`);
    }
    process.exit(1);
  }

  console.log(`secret scan passed: ${scans.map((scan) => scan.label).join(", ")}.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function changedScans(): Array<{ label: string; args: string[] }> {
  const scans: Array<{ label: string; args: string[] }> = [
    { label: "working-tree", args: ["--pre-commit"] },
  ];
  const base = resolveBase();
  if (!base) return scans;
  const mergeBase = git(["merge-base", base, "HEAD"]);
  if (!mergeBase || mergeBase === git(["rev-parse", "HEAD"])) return scans;
  scans.push({ label: `commits:${mergeBase.slice(0, 12)}..HEAD`, args: ["--log-opts", `${mergeBase}..HEAD`] });
  return scans;
}

function resolveBase(): string | null {
  const explicit = process.env.AREAFORGE_SECRET_SCAN_BASE?.trim();
  if (explicit && gitRefExists(explicit)) return explicit;

  const baseBranch = process.env.GITHUB_BASE_REF?.trim();
  if (baseBranch && gitRefExists(`origin/${baseBranch}`)) return `origin/${baseBranch}`;

  const before = process.env.GITHUB_EVENT_BEFORE?.trim();
  if (before && /^[0-9a-f]{40}$/.test(before) && !/^0+$/.test(before) && gitRefExists(before)) return before;

  if (process.env.CI === "true" && gitRefExists("HEAD^")) return "HEAD^";
  if (gitRefExists("origin/main")) return "origin/main";
  return gitRefExists("HEAD^") ? "HEAD^" : null;
}

function runScan(label: string, scanArgs: string[]): Finding[] {
  const report = path.join(temp, `${label.replace(/[^A-Za-z0-9_.-]+/g, "-")}.json`);
  const result = spawnSync("gitleaks", [
    "git",
    "--redact=100",
    "--no-banner",
    "--no-color",
    "--report-format", "json",
    "--report-path", report,
    ...scanArgs,
    root,
  ], { cwd: root, encoding: "utf8" });

  const parsed = existsSync(report) ? JSON.parse(readFileSync(report, "utf8")) as Finding[] : [];
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`${label} secret scan could not run (exit ${result.status ?? "unknown"})`);
  }
  return parsed;
}

function requireGitleaks(): void {
  const result = spawnSync("gitleaks", ["version"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error("gitleaks is required; install it locally or use the pinned CI installer");
  }
  const actualVersion = result.stdout.trim().replace(/^v/, "");
  if (actualVersion !== expectedVersion) {
    throw new Error(`gitleaks version mismatch: expected ${expectedVersion}, received ${actualVersion || "unknown"}`);
  }
}

function git(args: string[]): string | null {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function gitRefExists(ref: string): boolean {
  return git(["rev-parse", "--verify", "--quiet", ref]) !== null;
}
