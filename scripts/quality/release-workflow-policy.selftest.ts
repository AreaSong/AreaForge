import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const workflow = readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");
const policySource = readFileSync(path.join(root, "scripts/quality/release-workflow-policy.ts"), "utf8");
const temp = mkdtempSync(path.join(tmpdir(), "areaforge-release-workflow-policy-"));

try {
  assert(policySource.includes('const canonicalWorkflowPath = path.join(root, ".github/workflows/release.yml")'), "policy must bind the canonical workflow path independently of fixture overrides");
  assert(policySource.includes("RELEASE_CANONICAL_WORKFLOW_DIGEST_MISMATCH"), "policy must fail when the canonical workflow digest changes");
  expect("current workflow", workflow, 0, undefined, "full");
  expect("unique concurrency", workflow.replace("inputs.tag || github.ref_name", "github.run_id"), 1, "CONCURRENCY_NOT_TAG_BOUND");
  expect("build job validation dependency missing", workflow.replace("    needs: validate", "    needs: []"), 1, "RELEASE_BUILD_JOB_VALIDATION_DEPENDENCY_MISSING");
  expect("missing channel validation", workflow.replace('if [[ "${channel}" != "stable" && "${channel}" != "preview" ]]; then', "if false; then"), 1, "CHANNEL_NOT_VALIDATED");
  expect("workflow comment changes digest", `${workflow}\n# gh release view is forbidden here\n`, 1, "RELEASE_WORKFLOW_DIGEST_MISMATCH", "full");
  expect("inline probe", workflow.replace("run: pnpm release:identity:probe", "run: gh release view v1.2.3"), 1, "INLINE_IDENTITY_PROBE_FORBIDDEN");
  expect("admission token in inline comment", workflow.replaceAll("run: pnpm release:admission", 'run: echo "admission disabled" # pnpm release:admission'), 1, "ADMISSION_NOT_CALLED");
  expect("channel validation token in heredoc", workflow.replace(
    '          if [[ "${channel}" != "stable" && "${channel}" != "preview" ]]; then',
    '          cat <<\'POLICY\'\n          if [[ "${channel}" != "stable" && "${channel}" != "preview" ]]; then\n          POLICY',
  ), 1, "CHANNEL_NOT_VALIDATED");
  expect("duplicate admission step", `${workflow}\n      - name: Validate release admission\n        run: pnpm release:admission\n`, 1, "RELEASE_STEP_DUPLICATE_VALIDATE_RELEASE_ADMISSION");
  expect("admission continue on error", injectStepField(workflow, "Validate release admission", "continue-on-error: true"), 1, "RELEASE_STEP_CONTINUE_ON_ERROR_VALIDATE_RELEASE_ADMISSION");
  expect("admission custom shell", injectStepField(workflow, "Validate release admission", "shell: echo {0}"), 1, "RELEASE_STEP_SHELL_INVALID_VALIDATE_RELEASE_ADMISSION");
  expect("signing conditional", injectStepField(workflow, "Sign checksums", "if: always()"), 1, "RELEASE_STEP_CONDITIONAL_SIGN_CHECKSUMS");
  expect("signing early success", workflow.replace(
    '          if ! cosign sign-blob --yes --key "${signing_key}" --bundle SHA256SUMS.sig SHA256SUMS 2>"${signing_error}"; then',
    '          exit 0\n          if ! cosign sign-blob --yes --key "${signing_key}" --bundle SHA256SUMS.sig SHA256SUMS 2>"${signing_error}"; then',
  ), 1, "RELEASE_STEP_EARLY_SUCCESS_EXIT_SIGN_CHECKSUMS");
  expect("signing no-op", workflow.replace(
    'if ! cosign sign-blob --yes --key "${signing_key}" --bundle SHA256SUMS.sig SHA256SUMS 2>"${signing_error}"; then',
    'if ! echo "signing disabled"; then',
  ), 1, "SIGNING_COMMAND_NOT_CALLED");
  expect("publish action replaced", workflow.replace(
    /uses: softprops\/action-gh-release@[a-f0-9]{40}/,
    "uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd",
  ), 1, "RELEASE_PUBLISH_ACTION_INVALID");
  expect("early renamed publish action", insertStepBefore(workflow, "Sign checksums", [
    "      - name: Early release publication",
    "        uses: softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65",
    "        with:",
    "          tag_name: ${{ steps.vars.outputs.tag }}",
  ].join("\n")), 1, "RELEASE_PUBLISH_ACTION_DUPLICATE_OR_RENAMED");
  expect("early gh release create", insertStepBefore(workflow, "Sign checksums", [
    "      - name: Early CLI release publication",
    "        run: gh release create ${{ steps.vars.outputs.tag }}",
  ].join("\n")), 1, "INLINE_RELEASE_PUBLISH_FORBIDDEN");
  expect("build job always condition", workflow.replace("    needs: validate", "    needs: validate\n    if: always()"), 1, "RELEASE_BUILD_RELEASE_JOB_CONDITIONAL");
  expect("unnamed publish action", insertStepBefore(workflow, "Sign checksums", "      - uses: softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65"), 1, "RELEASE_PUBLISH_ACTION_DUPLICATE_OR_RENAMED");
  expect("unpinned renamed publish action", insertStepBefore(workflow, "Sign checksums", [
    "      - name: Unpinned early publication",
    "        uses: softprops/action-gh-release@v2",
  ].join("\n")), 1, "RELEASE_ACTION_UNPINNED");
  expect("folded scalar publication", insertStepBefore(workflow, "Sign checksums", [
    "      - name: Folded early publication",
    "        run: >",
    "          gh release create ${{ steps.vars.outputs.tag }}",
  ].join("\n")), 1, "INLINE_RELEASE_PUBLISH_FORBIDDEN");
  expect("job default shell override", workflow.replace("    needs: validate", "    needs: validate\n    defaults:\n      run:\n        shell: echo {0}"), 1, "RELEASE_BUILD_RELEASE_JOB_DEFAULTS_FORBIDDEN");
  expect("compound early success", workflow.replace(
    '          if ! cosign sign-blob --yes --key "${signing_key}" --bundle SHA256SUMS.sig SHA256SUMS 2>"${signing_error}"; then',
    '          true && exit 0; if ! cosign sign-blob --yes --key "${signing_key}" --bundle SHA256SUMS.sig SHA256SUMS 2>"${signing_error}"; then',
  ), 1, "RELEASE_STEP_EARLY_SUCCESS_EXIT_SIGN_CHECKSUMS");
  expect("top-level permissions widened", workflow.replace("permissions:\n  contents: read", "permissions:\n  contents: write"), 1, "RELEASE_TOP_LEVEL_PERMISSIONS_INVALID");
  expect("web image push disabled", workflow.replace("          push: true", "          push: false"), 1, "RELEASE_WEB_IMAGE_PUSH_DISABLED");
  expect("web image tag unbound", workflow.replace("          tags: ${{ steps.vars.outputs.web_image }}", "          tags: latest"), 1, "RELEASE_WEB_IMAGE_TAG_UNBOUND");
  expect("checksum asset removed", workflow.replace("            areaforge-sbom.spdx.json \\\n", ""), 1, "RELEASE_CHECKSUM_ASSET_SET_INVALID");
  expect("release asset removed", workflow.replace("            SHA256SUMS.sig\n", ""), 1, "RELEASE_ASSET_LIST_INVALID");
  expect(
    "guard after publish",
    moveStepBefore(workflow, "Reject existing immutable release identity", "Publish GitHub Release"),
    1,
    "RELEASE_GUARD_ORDER_INVALID",
  );
  expect(
    "signing before checksums",
    moveStepBefore(workflow, "Sign checksums", "Generate release checksums"),
    1,
    "RELEASE_GUARD_ORDER_INVALID",
  );
  expect(
    "publish before signing",
    moveStepBefore(workflow, "Publish GitHub Release", "Sign checksums"),
    1,
    "RELEASE_GUARD_ORDER_INVALID",
  );
  expect(
    "signing and publish detached from build job",
    detachStepsToJob(workflow, ["Sign checksums", "Publish GitHub Release"], "detached-release"),
    1,
    "RELEASE_STEP_WRONG_JOB_SIGN_CHECKSUMS",
  );
  console.log("release workflow policy selftest passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function moveStepBefore(content: string, movingName: string, targetName: string): string {
  const marker = (name: string) => `      - name: ${name}`;
  const movingStart = content.indexOf(marker(movingName));
  assert(movingStart >= 0, `missing moving step: ${movingName}`);
  const movingEndCandidate = content.indexOf("\n      - name:", movingStart + marker(movingName).length);
  const movingEnd = movingEndCandidate >= 0 ? movingEndCandidate + 1 : content.length;
  const movingBlock = content.slice(movingStart, movingEnd);
  const withoutMoving = `${content.slice(0, movingStart)}${content.slice(movingEnd)}`;
  const targetStart = withoutMoving.indexOf(marker(targetName));
  assert(targetStart >= 0, `missing target step: ${targetName}`);
  return `${withoutMoving.slice(0, targetStart)}${movingBlock}${withoutMoving.slice(targetStart)}`;
}

function detachStepsToJob(content: string, stepNames: string[], jobName: string): string {
  let remaining = content;
  const blocks: string[] = [];
  for (const name of stepNames) {
    const extracted = extractStep(remaining, name);
    remaining = extracted.remaining;
    blocks.push(extracted.block.trimEnd());
  }
  return `${remaining.trimEnd()}\n\n  ${jobName}:\n    runs-on: ubuntu-latest\n    steps:\n${blocks.join("\n")}\n`;
}

function injectStepField(content: string, stepName: string, field: string): string {
  const marker = `      - name: ${stepName}`;
  const start = content.indexOf(marker);
  assert(start >= 0, `missing step: ${stepName}`);
  const lineEnd = content.indexOf("\n", start);
  return `${content.slice(0, lineEnd + 1)}        ${field}\n${content.slice(lineEnd + 1)}`;
}

function insertStepBefore(content: string, targetName: string, block: string): string {
  const marker = `      - name: ${targetName}`;
  const target = content.indexOf(marker);
  assert(target >= 0, `missing target step: ${targetName}`);
  return `${content.slice(0, target)}${block}\n\n${content.slice(target)}`;
}

function extractStep(content: string, name: string): { block: string; remaining: string } {
  const marker = `      - name: ${name}`;
  const start = content.indexOf(marker);
  assert(start >= 0, `missing step: ${name}`);
  const endCandidate = content.indexOf("\n      - name:", start + marker.length);
  const end = endCandidate >= 0 ? endCandidate + 1 : content.length;
  return {
    block: content.slice(start, end),
    remaining: `${content.slice(0, start)}${content.slice(end)}`,
  };
}

function expect(label: string, content: string, status: number, reason?: string, mode = "semantics"): void {
  const file = path.join(temp, `${label.replace(/\W+/g, "-")}.yml`);
  writeFileSync(file, content);
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/release-workflow-policy.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_RELEASE_WORKFLOW_PATH: file,
      AREAFORGE_RELEASE_WORKFLOW_POLICY_MODE: mode,
    },
  });
  assert.equal(result.status, status, `${label}: ${result.stderr}`);
  if (reason) assert.match(result.stderr, new RegExp(reason), label);
}
