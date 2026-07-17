import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Issue = { field: string; message: string };
type JsonRecord = Record<string, unknown>;

const registerPath = "docs/development/governance-register.json";
const domains = [
  "public-repository",
  "code-review",
  "security-privacy",
  "dependency-supply-chain",
  "external-capability",
  "runtime-write-boundary",
  "documentation",
];
const forbiddenControlKeys = [
  "status", "lifecycleStatus", "executionState", "residualRiskIds", "severity", "due", "closeCondition",
  "requiredEvidence", "currentImpact",
];

export function validateGovernanceRegister(value: unknown, root = process.cwd()): Issue[] {
  const issues: Issue[] = [];
  if (!isRecord(value)) return [{ field: "register", message: "must be a JSON object" }];
  requireExactKeys(value, ["schemaVersion", "mode", "controls"], "register", issues);
  if (value.schemaVersion !== 1) issues.push({ field: "schemaVersion", message: "must be 1" });
  if (value.mode !== "areaforge_governance_register") issues.push({ field: "mode", message: "must be areaforge_governance_register" });
  validateControls(value.controls, root, issues);
  scanSecrets(JSON.stringify(value), issues);
  return issues;
}

function validateControls(value: unknown, root: string, issues: Issue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ field: "controls", message: "must be a non-empty array" });
    return;
  }
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  const tracked = trackedFiles(root);
  const seenIds = new Set<string>();
  const seenDomains = new Set<string>();
  value.forEach((item, index) => {
    const field = `controls[${index}]`;
    if (!isRecord(item)) return issues.push({ field, message: "must be an object" });
    requireExactKeys(item, ["id", "domain", "authorityPaths", "ownerSkill", "enforcementRefs", "reviewTriggers"], field, issues);
    for (const key of forbiddenControlKeys) {
      if (key in item) issues.push({ field: `${field}.${key}`, message: "belongs to lifecycle or residual source facts, not governance register" });
    }
    const id = requireString(item.id, `${field}.id`, issues);
    if (id && !/^AF-GOV-[A-Z0-9-]+-\d{3}$/.test(id)) issues.push({ field: `${field}.id`, message: "must match AF-GOV-*-NNN" });
    if (id && seenIds.has(id)) issues.push({ field: `${field}.id`, message: "must be unique" });
    if (id) seenIds.add(id);
    const domain = requireString(item.domain, `${field}.domain`, issues);
    if (domain && !domains.includes(domain)) issues.push({ field: `${field}.domain`, message: `must be one of ${domains.join(", ")}` });
    if (domain) seenDomains.add(domain);
    validateAuthorityPaths(item.authorityPaths, root, tracked, `${field}.authorityPaths`, issues);
    validateOwnerSkill(item.ownerSkill, root, `${field}.ownerSkill`, issues);
    validateEnforcementRefs(item.enforcementRefs, packageJson.scripts ?? {}, `${field}.enforcementRefs`, issues);
    validateReviewTriggers(item.reviewTriggers, `${field}.reviewTriggers`, issues);
  });
  for (const domain of domains) {
    if (!seenDomains.has(domain)) issues.push({ field: "controls", message: `missing baseline domain ${domain}` });
  }
}

function validateAuthorityPaths(
  value: unknown,
  root: string,
  tracked: Set<string>,
  field: string,
  issues: Issue[],
): void {
  const paths = stringArray(value, field, issues);
  if (new Set(paths).size !== paths.length) issues.push({ field, message: "must not contain duplicates" });
  if (!paths.some((file) => file.startsWith("docs/") || /^[A-Z][A-Z0-9_-]*\.md$/.test(file))) {
    issues.push({ field, message: "must include a docs path or root governance Markdown authority" });
  }
  for (const file of paths) {
    if (path.isAbsolute(file) || file.includes("..") || /[*?{}[\]]/.test(file)) {
      issues.push({ field, message: `must use a concrete repository-relative path: ${file}` });
      continue;
    }
    if (!existsSync(path.join(root, file))) issues.push({ field, message: `authority path does not exist: ${file}` });
    if (!tracked.has(file)) issues.push({ field, message: `authority path must be Git tracked: ${file}` });
  }
}

function validateOwnerSkill(value: unknown, root: string, field: string, issues: Issue[]): void {
  const owner = requireString(value, field, issues);
  if (owner && !existsSync(path.join(root, ".codex/skills-src", owner, "SKILL.md"))) {
    issues.push({ field, message: `unknown owner skill ${owner}` });
  }
}

function validateEnforcementRefs(value: unknown, scripts: Record<string, string>, field: string, issues: Issue[]): void {
  const refs = stringArray(value, field, issues);
  if (new Set(refs).size !== refs.length) issues.push({ field, message: "must not contain duplicates" });
  for (const ref of refs) {
    const match = ref.match(/^pnpm ([a-z0-9:_-]+)$/);
    if (!match) {
      issues.push({ field, message: `must use an existing pnpm package script reference: ${ref}` });
      continue;
    }
    if (!scripts[match[1] ?? ""]) issues.push({ field, message: `unknown package script ${ref}` });
  }
}

function validateReviewTriggers(value: unknown, field: string, issues: Issue[]): void {
  const triggers = stringArray(value, field, issues);
  if (new Set(triggers).size !== triggers.length) issues.push({ field, message: "must not contain duplicates" });
  for (const trigger of triggers) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trigger)) issues.push({ field, message: `must use kebab-case trigger: ${trigger}` });
  }
}

function trackedFiles(root: string): Set<string> {
  return new Set(execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean));
}

function requireExactKeys(value: JsonRecord, expected: string[], field: string, issues: Issue[]): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    issues.push({ field, message: `must contain exact keys: ${expected.join(", ")}` });
  }
}

function requireString(value: unknown, field: string, issues: Issue[]): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push({ field, message: "must be a non-empty string" });
    return null;
  }
  return value;
}

function stringArray(value: unknown, field: string, issues: Issue[]): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim().length > 0)) {
    issues.push({ field, message: "must be a non-empty string array" });
    return [];
  }
  return value as string[];
}

function scanSecrets(raw: string, issues: Issue[]): void {
  for (const [label, pattern] of [
    ["database URL", /postgres(?:ql)?:\/\/[^\s"']+/i],
    ["API key", /\b(?:sk-|rk-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/],
    ["private key", /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/],
    ["absolute user path", /\/(?:Users|home|root)\/[^\s"']+/],
  ] as const) {
    if (pattern.test(raw)) issues.push({ field: "register", message: `must not contain ${label}` });
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function main(): void {
  const file = process.argv[2] ?? registerPath;
  const absolute = path.resolve(file);
  if (!existsSync(absolute)) {
    console.error(`governance register not found: ${file}`);
    process.exit(2);
  }
  const issues = validateGovernanceRegister(JSON.parse(readFileSync(absolute, "utf8")));
  if (issues.length > 0) {
    for (const issue of issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
    console.error(`governance register validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }
  console.log("governance register validation passed: authority paths, accountable owners, enforcement refs, review triggers, exact schema, and secret boundaries are valid.");
  console.log("claimBoundary: the register does not prove lifecycle state, production activation, residual closure, or execution of referenced commands.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
