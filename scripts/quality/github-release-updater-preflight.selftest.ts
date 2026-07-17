import { findMissingOwnedTerms, findMissingScriptFragments } from "./github-release-updater-preflight";

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

console.log("GitHub Release updater preflight owner-map selftest passed.");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}
