import { readFileSync } from "node:fs";
import path from "node:path";
import { validateGovernanceRegister } from "./governance-register-validate";

const root = process.cwd();
const source = JSON.parse(readFileSync(path.join(root, "docs/development/governance-register.json"), "utf8")) as Record<string, unknown>;

assertValid(source);
assertInvalid({ ...source, schemaVersion: 2 }, "schemaVersion");
assertInvalid(mutateControl(source, (control) => ({ ...control, status: "active" })), "exact keys");
assertInvalid(mutateControl(source, (control) => ({ ...control, id: "bad-id" })), "AF-GOV");
assertInvalid(mutateControl(source, (control) => ({ ...control, domain: "release" })), "domain");
assertInvalid(mutateControl(source, (control) => ({ ...control, authorityPaths: ["../outside"] })), "repository-relative");
assertInvalid(mutateControl(source, (control) => ({ ...control, ownerSkill: "missing-owner-skill" })), "owner skill");
assertInvalid(mutateControl(source, (control) => ({ ...control, enforcementRefs: ["pnpm missing:script"] })), "unknown package script");
assertInvalid(mutateControl(source, (control) => ({ ...control, reviewTriggers: ["Not Kebab"] })), "kebab-case");
assertInvalid({ ...source, injected: "postgresql://user:pass@example.invalid/db" }, "exact keys");

console.log("governance register validator selftest passed.");

function mutateControl(
  value: Record<string, unknown>,
  mutate: (control: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  const controls = structuredClone(value.controls as Record<string, unknown>[]);
  controls[0] = mutate(controls[0] ?? {});
  return { ...structuredClone(value), controls };
}

function assertValid(value: unknown): void {
  const issues = validateGovernanceRegister(value, root);
  if (issues.length > 0) throw new Error(`expected valid register: ${JSON.stringify(issues)}`);
}

function assertInvalid(value: unknown, expected: string): void {
  const issues = validateGovernanceRegister(value, root);
  if (issues.length === 0 || !JSON.stringify(issues).includes(expected)) {
    throw new Error(`expected invalid register containing ${expected}: ${JSON.stringify(issues)}`);
  }
}
