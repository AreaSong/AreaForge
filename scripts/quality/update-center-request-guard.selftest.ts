import {
  validateUpdateRequestAgainstStatus,
  type UpdateCenterStatus,
} from "../../apps/web/lib/system/update-center";

const baseStatus: UpdateCenterStatus = {
  currentVersion: "0.1.7",
  currentImage: "ghcr.io/areasong/areaforge-web:v0.1.7@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  appUrl: "https://forge.areasong.top",
  deployMode: "release",
  releaseUrl: "https://github.com/AreaSong/AreaForge/releases/tag/v0.1.7",
  latestVersion: "v0.1.7",
  latestPublishedAt: "2026-07-12T00:00:00Z",
  updateAvailable: false,
  autoApply: "none",
  signatureRequired: true,
  timerEnabled: true,
  timerActive: true,
  lastCheckedAt: "2026-07-13T00:00:00Z",
  lastOperation: null,
  rollback: {
    available: false,
    targetVersion: null,
    targetImage: null,
  },
  blocker: null,
  requestQueueLength: 0,
  statusUpdatedAt: "2026-07-13T00:00:00Z",
};

function main(): void {
  expectCode("same version apply rejected", { action: "apply", tag: "v0.1.7" }, "UPDATE_TARGET_NOT_NEWER");
  expectCode("older version apply rejected", { action: "apply", tag: "v0.1.6" }, "UPDATE_TARGET_NOT_NEWER");
  expectCode("missing apply tag rejected", { action: "apply" }, "UPDATE_TAG_REQUIRED");
  expectCode("missing rollback target rejected", { action: "rollback" }, "ROLLBACK_TARGET_UNAVAILABLE");
  expectCode("unchanged auto policy rejected", { action: "set_auto_apply", autoApply: "none" }, "AUTO_APPLY_POLICY_UNCHANGED");
  expectCode("missing auto policy rejected", { action: "set_auto_apply" }, "AUTO_APPLY_POLICY_REQUIRED");
  expectPass("newer patch apply allowed", { action: "apply", tag: "v0.1.8" });
  expectPass("newer minor apply allowed", { action: "apply", tag: "v0.2.0" });
  expectPass("check request allowed", { action: "check" });
  expectPass("changed auto policy allowed", { action: "set_auto_apply", autoApply: "patch" });
  expectPass("rollback with target allowed", { action: "rollback" }, {
    rollback: {
      available: true,
      targetVersion: "0.1.5",
      targetImage: "ghcr.io/areasong/areaforge-web:v0.1.5@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
  });

  console.log("update center request guard selftest passed.");
}

function expectPass(
  label: string,
  input: Parameters<typeof validateUpdateRequestAgainstStatus>[0],
  override: Partial<UpdateCenterStatus> = {},
): void {
  const code = validateUpdateRequestAgainstStatus(input, status(override));
  if (code !== null) throw new Error(`FAIL ${label}: expected pass, got ${code}`);
}

function expectCode(
  label: string,
  input: Parameters<typeof validateUpdateRequestAgainstStatus>[0],
  expected: NonNullable<ReturnType<typeof validateUpdateRequestAgainstStatus>>,
  override: Partial<UpdateCenterStatus> = {},
): void {
  const code = validateUpdateRequestAgainstStatus(input, status(override));
  if (code !== expected) throw new Error(`FAIL ${label}: expected ${expected}, got ${code ?? "pass"}`);
}

function status(override: Partial<UpdateCenterStatus>): UpdateCenterStatus {
  return {
    ...baseStatus,
    ...override,
    rollback: override.rollback ?? baseStatus.rollback,
  };
}

main();
