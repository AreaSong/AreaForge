import {
  findMissingOwnedTerms,
  findMissingScriptFragments,
  findWebDockerPatchContextIssues,
} from "./github-release-updater-preflight";

const complete = findMissingOwnedTerms([
  ["runtime", "EXPECTED_BEFORE_MISMATCH production-state.lock", ["EXPECTED_BEFORE_MISMATCH", "production-state.lock"]],
  ["docs", "expected-before", ["expected-before"]],
]);
assert(complete.length === 0, `complete owner map should pass: ${complete.join(", ")}`);

const runtimeMissing = findMissingOwnedTerms([
  ["runtime", "production-state.lock", ["EXPECTED_BEFORE_MISMATCH", "production-state.lock"]],
  ["docs", "EXPECTED_BEFORE_MISMATCH expected-before", ["expected-before"]],
  ["selftest", "EXPECTED_BEFORE_MISMATCH", ["EXPECTED_BEFORE_MISMATCH"]],
]);
assert(runtimeMissing.join(",") === "runtime:EXPECTED_BEFORE_MISMATCH", "docs or selftest tokens must not satisfy a runtime owner");

const aggregateMembers = ["health", "request-v2", "request-guard", "agent", "lock"];
assert(findMissingScriptFragments(aggregateMembers.join(" && "), aggregateMembers).length === 0, "complete aggregate script should pass");
assert(findMissingScriptFragments("health && request-v2 && agent && lock", aggregateMembers).join(",") === "request-guard", "removed aggregate member must fail closed");

const patchHash = "28b4c71225869f15a755c74f2d16a508a61a525e1dbd48758ba33c89bc313b36";
const validPatchContext = {
  dockerfile: "COPY patches ./patches\nRUN pnpm install --frozen-lockfile\n",
  workspace: "patchedDependencies:\n  minimatch@3.1.5: patches/minimatch@3.1.5.patch\n",
  lockfile: `patchedDependencies:\n  minimatch@3.1.5: ${patchHash}\n`,
  patchPath: "patches/minimatch@3.1.5.patch",
  patchSha256: patchHash,
};
assert(findWebDockerPatchContextIssues(validPatchContext).length === 0, "complete Web Docker patch context should pass");

const negativePatchContexts = [
  [{ ...validPatchContext, dockerfile: "RUN pnpm install --frozen-lockfile\n" }, "dockerfile missing COPY"],
  [{ ...validPatchContext, dockerfile: "RUN pnpm install --frozen-lockfile\nCOPY patches ./patches\n" }, "copies patches after"],
  [{ ...validPatchContext, workspace: "patchedDependencies: {}\n" }, "workspace patch path"],
  [{ ...validPatchContext, lockfile: "patchedDependencies: {}\n" }, "lockfile patch hash"],
  [{ ...validPatchContext, patchSha256: null }, "patch file is missing"],
  [{ ...validPatchContext, patchSha256: "0".repeat(64) }, "does not match lockfile"],
] as const;
for (const [context, expectedIssue] of negativePatchContexts) {
  assert(
    findWebDockerPatchContextIssues(context).some((issue) => issue.includes(expectedIssue)),
    `expected Web Docker patch context issue: ${expectedIssue}`,
  );
}

console.log("GitHub Release updater preflight owner-map selftest passed.");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}
