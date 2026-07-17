import path from "node:path";
import { configuredMaxAge, readSafeJsonFile, validateControlledPr, validateReadback, type ValidationResult } from "../quality/github-main-protection-validate";

type Status = "needs_remote_readback" | "needs_controlled_pr" | "ready_for_human_review" | "invalid";

export function buildSc004Preflight(env: NodeJS.ProcessEnv = process.env, now = Date.now()): Record<string, unknown> {
  let maxAgeSeconds: number;
  try { maxAgeSeconds = configuredMaxAge(env); } catch (error) { return base("invalid", { configuration: String(error) }); }
  const readback = inspect(env.AREAFORGE_SC004_READBACK_RECORD, "readback", now, maxAgeSeconds);
  const controlledPr = inspect(env.AREAFORGE_SC004_CONTROLLED_PR_RECORD, "controlledPr", now, maxAgeSeconds);
  let status: Status;
  if (readback.status === "invalid" || controlledPr.status === "invalid") status = "invalid";
  else if (readback.status === "missing") status = "needs_remote_readback";
  else if (controlledPr.status === "missing") status = "needs_controlled_pr";
  else {
    const readbackResult = readback.result as ValidationResult;
    const prResult = controlledPr.result as ValidationResult;
    status = readbackResult.maintenanceWindowId === prResult.maintenanceWindowId ? "ready_for_human_review" : "invalid";
  }
  return {
    ...base(status),
    residualRiskId: "AF-RISK-SC-004",
    maxAgeSeconds,
    evidence: { readback, controlledPr },
    requiredNextSteps: [
      "obtain a redacted GitHub main protection/ruleset readback in a maintenance window",
      "obtain a redacted controlled PR result in the same maintenance window",
      "perform separate human review before any residual decision",
    ],
  };
}

function inspect(rawPath: string | undefined, kind: "readback" | "controlledPr", now: number, maxAgeSeconds: number): Record<string, unknown> {
  if (!rawPath?.trim()) return { status: "missing", path: null, detail: `AREAFORGE_SC004_${kind === "readback" ? "READBACK" : "CONTROLLED_PR"}_RECORD is not set` };
  let raw: string;
  try { raw = readSafeJsonFile(rawPath).raw; } catch (error) { return { status: "invalid", path: "<redacted path>", detail: String(error) }; }
  const result = kind === "readback" ? validateReadback(raw, now, maxAgeSeconds) : validateControlledPr(raw, now, maxAgeSeconds);
  return { status: result.valid ? "valid" : "invalid", path: "<redacted path>", detail: result.valid ? "local validator passed" : result.issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "), result };
}

function base(status: Status, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    mode: "read_only_sc004_main_protection_preflight",
    status,
    doesNotProve: ["remote GitHub settings currently exist", "GitHub required checks actually ran", "a PR was merged", "AF-RISK-SC-004 residual closure"],
    forbiddenActions: ["call_github_api", "run_gh", "run_curl", "write_github_settings", "merge_pull_request", "create_or_modify_pull_request", "read_github_token", "read_or_print_secret_values", "update_residual_ledger"],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      githubApiCalled: false,
      ghCalled: false,
      curlCalled: false,
      githubWriteAttempted: false,
      tokenRead: false,
      controlledPrCreated: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      residualClosed: false,
      residualLedgerUpdated: false,
    },
    ...extra,
  };
}

function main(): void {
  const result = buildSc004Preflight();
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "invalid") process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
