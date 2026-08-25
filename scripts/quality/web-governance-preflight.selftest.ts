import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectWebGovernancePreflightReport,
  WEB_GOVERNANCE_GATES,
  WEB_GOVERNANCE_G8_QUALITY_FILES,
  WEB_GOVERNANCE_G8_SELFTESTS,
  WEB_GOVERNANCE_G8_VALIDATORS,
  WEB_GOVERNANCE_PREFLIGHT_SELFTEST,
  WEB_GOVERNANCE_SELFTESTS,
} from "./web-governance-preflight";

function qualityScriptPath(name: string): string {
  const selftest = name.endsWith(":selftest");
  const base = name.replace(/^web:/, "web-").replace(/:selftest$/, "").replaceAll(":", "-");
  return `scripts/quality/${base}${selftest ? ".selftest" : ""}.ts`;
}

const workspace = mkdtempSync(path.join(tmpdir(), "areaforge-web-governance-preflight-"));
try {
  mkdirSync(path.join(workspace, "scripts/quality"), { recursive: true });
  mkdirSync(path.join(workspace, "docs/architecture"), { recursive: true });
  mkdirSync(path.join(workspace, ".github/workflows"), { recursive: true });
  for (const relative of [
    "docs/architecture/web-shared-capability-inventory.json",
    ...WEB_GOVERNANCE_GATES.map((gate) => qualityScriptPath(gate)),
    ...WEB_GOVERNANCE_SELFTESTS.map((gate) => qualityScriptPath(gate)),
    qualityScriptPath(WEB_GOVERNANCE_PREFLIGHT_SELFTEST),
    ...WEB_GOVERNANCE_G8_QUALITY_FILES,
  ]) write(relative, "export {};\n");

  const gateScripts = Object.fromEntries(WEB_GOVERNANCE_GATES.map((gate) => [
    gate,
    `tsx ${qualityScriptPath(gate)}`,
  ]));
  const selftestScripts = Object.fromEntries(WEB_GOVERNANCE_SELFTESTS.map((name) => [
    name,
    `tsx ${qualityScriptPath(name)}`,
  ]));
  selftestScripts[WEB_GOVERNANCE_PREFLIGHT_SELFTEST] = "tsx scripts/quality/web-governance-preflight.selftest.ts";
  const g8Scripts = Object.fromEntries([
    ...WEB_GOVERNANCE_G8_VALIDATORS,
    ...WEB_GOVERNANCE_G8_SELFTESTS,
  ].map(([name, script]) => [name, `tsx ${script}`]));
  const scripts = {
    ...gateScripts,
    ...selftestScripts,
    ...g8Scripts,
    "web:governance:typecheck": [
      ...WEB_GOVERNANCE_GATES.flatMap((gate) => [
        qualityScriptPath(gate),
        qualityScriptPath(`${gate}:selftest`),
      ]),
      qualityScriptPath(WEB_GOVERNANCE_PREFLIGHT_SELFTEST),
      ...WEB_GOVERNANCE_G8_QUALITY_FILES,
    ].join(" "),
    "web:governance:selftest": [
      ...WEB_GOVERNANCE_SELFTESTS,
      ...WEB_GOVERNANCE_G8_SELFTESTS.map(([name]) => name),
      WEB_GOVERNANCE_PREFLIGHT_SELFTEST,
    ].map((name) => `pnpm ${name}`).join(" && "),
    "web:governance:preflight": "tsx scripts/quality/web-governance-preflight.ts",
    check: [
      "pnpm web:governance:preflight",
      "pnpm web:governance:selftest",
      "pnpm web:governance:typecheck",
      ...WEB_GOVERNANCE_GATES.map((gate) => `pnpm ${gate}`),
    ].join(" && "),
  };
  write("package.json", JSON.stringify({ scripts }));
  write(".github/workflows/ci.yml", "run: pnpm web:governance:preflight\nrun: pnpm web:governance:selftest\n");

  assert.deepEqual(collectWebGovernancePreflightReport(workspace).issues, []);
  const baseline = read("package.json");

  const brokenCheck = JSON.parse(baseline) as { scripts: Record<string, string> };
  brokenCheck.scripts.check = brokenCheck.scripts.check.replace("pnpm web:governance:selftest && ", "");
  write("package.json", JSON.stringify(brokenCheck));
  assert(collectWebGovernancePreflightReport(workspace).issues.some((issue) => issue.includes("check must include pnpm web:governance:selftest")));
  write("package.json", baseline);

  const brokenG8Selftest = JSON.parse(baseline) as { scripts: Record<string, string> };
  const firstG8Selftest = WEB_GOVERNANCE_G8_SELFTESTS[0][0];
  brokenG8Selftest.scripts["web:governance:selftest"] = brokenG8Selftest.scripts["web:governance:selftest"].replace(`pnpm ${firstG8Selftest} && `, "");
  write("package.json", JSON.stringify(brokenG8Selftest));
  assert(collectWebGovernancePreflightReport(workspace).issues.some((issue) => issue.includes(`web:governance:selftest must run ${firstG8Selftest}`)));
  write("package.json", baseline);

  const brokenG8Typecheck = JSON.parse(baseline) as { scripts: Record<string, string> };
  const missingQualityFile = WEB_GOVERNANCE_G8_QUALITY_FILES[0];
  brokenG8Typecheck.scripts["web:governance:typecheck"] = brokenG8Typecheck.scripts["web:governance:typecheck"].replace(`${missingQualityFile} `, "").replace(missingQualityFile, "");
  write("package.json", JSON.stringify(brokenG8Typecheck));
  assert(collectWebGovernancePreflightReport(workspace).issues.some((issue) => issue.includes(`web:governance:typecheck must include ${missingQualityFile}`)));
  write("package.json", baseline);

  const brokenG8Command = JSON.parse(baseline) as { scripts: Record<string, string> };
  const [g8Command] = WEB_GOVERNANCE_G8_VALIDATORS[0];
  delete brokenG8Command.scripts[g8Command];
  write("package.json", JSON.stringify(brokenG8Command));
  assert(collectWebGovernancePreflightReport(workspace).issues.some((issue) => issue.includes(`${g8Command} must point to its canonical quality script`)));

  console.log("web governance preflight selftest passed.");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

function write(relative: string, contents: string): void {
  const absolute = path.join(workspace, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function read(relative: string): string {
  return readFileSync(path.join(workspace, relative), "utf8");
}
