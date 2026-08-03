import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type MigrationManifestEntry = Readonly<{
  name: string;
  sha256: string;
}>;

export const legacyCommit = "749692ba719d801f14186a94af97b96350380141";
export const floorCommit = "c30fe8f59e9e9a64ed0ee9d2ef115a0ed5214dd4";

const currentEntries = [
  ["20260706000000_init", "06078375b526eb670afeae8e1829b61e5c14badbde22037530d850733c80d6d2"],
  ["20260706010000_add_auth_session", "17d88ea5ab8f8b6acfe0a8b95e0b10cff8ffe60e9b6e1c90644eb3985b09e4ad"],
  ["20260707000000_add_study_session_closeout_fields", "df641fbba9cc83ef6da6a4807ebfb6c7b8d60f6e5380b1cfa7b821db6e65c873"],
  ["20260707010000_add_check_in_snapshots", "b955617c673365bf06bf9bf17e8f1b5ca8e4ec40310df1c49df2d000ff4d5795"],
  ["20260707020000_add_task_debt_events", "862fb18821732d62e46bc6959ba15a3ded933ff57122b3940b18d8b7d9dc488c"],
  ["20260707030000_add_recovery_state", "f0041dfff70968b660de915d47bd4253fe670a841eae737900fb6743eaffdddb"],
  ["20260707040000_add_mastery_records", "ff42b5d77b35157e35af000015ce9c45cb5f4b9515ca0f120b607db45b297768"],
  ["20260707050000_add_simulation_exam_records", "4d7a4e6af9ecce27367283a2b3f12262304ab638473cb379d07b1b7c5c9c2fb2"],
  ["20260707060000_add_stage_plan_records", "9062317af3fe32157897a5ed1ecc97fbf6c97d28a78a02246b7834ec99350f7d"],
  ["20260708010000_add_periodic_report_decisions", "6232f4c6a136081b8b2f791cce10979d98f2c4490f0a09198a8c765430d5f639"],
  ["20260718010000_add_active_session_unique_index", "928b5e3e60b2ce2f4e1292393ac8d2ff1bde2a4ee5c860170f422cb1fbf2b953"],
  ["20260721010000_attachment_staging_write_intent", "63c75bb2d71f84fcd0607c2d34120da53ad7ef578714279096079b4d39edbfb0"],
  ["20260721120000_v11_m1_exam_workspace_subject", "db7957b5d9634822bd28eb179eac02994edcf28f5676565e93233eb22bc8fb86"],
  ["20260721130000_v11_m2_note_task_session_relations", "b16d3b80e0195f21075051e89adb52c1b953e369c244988ef03e414a7c73c1b3"],
  ["20260721140000_v11_m3_milestone_dependency_inbox", "13ef0f06c073c6b03aa437387db61af5cdcf8211e0c0255e5e2845ed8318787b"],
  ["20260721200000_v11_m4_study_resource", "41394f3ee11302edbaf9543c4f0838d75e28829261ff60be52498d4f70744ee1"],
  ["20260721210000_v11_m5_learning_tree_import", "de7b2a53f103fd264c1e62c0d90969692fe79e45b7a3fe2fa1e6bc54d8670bfb"],
  ["20260721220000_v11_m6_review_checkin_v2", "abe1d45c357e5e29e47e9f10bb696a4d357e5017f90b3969572b1cb0f295a103"],
  ["20260721230000_v11_m7_canvas_motivation_notification", "aa79c57ebcc1d75c9c1e3552c36a84698b374f3cb9fb582b7bbda3cd1d7aedbc"],
  ["20260722010000_v11_m8_simulation_loss", "c6a09e28a38b26566ba37ad1c8c84b3a678901b2ac1a3b63e7a95fa52c49922c"],
  ["20260722150000_v11_daily_review_revision", "2f5327ab46965f363d70d38ea16169fa8cb65988271e72901ac7f0865ad9ed22"],
  ["20260722160000_v11_versioned_stage_simulation", "cecc92bc1199ac4b17455ad4d4d84e04c7be60c6093214bbbe843da9fc45e05e"],
  ["20260722170000_v11_learning_tree_export_grants", "ad52c20c685babb0be18ce92994295d0791fd9fcc203b4e75dfad214a5e5d7dd"],
  ["20260723100000_v11_report_stage_lineage", "c70fccb3699751ce32169efe4876d8330a500fe6c12f82256d3f8ff61c209190"],
  ["20260802120000_ai_provider_credentials", "0253dd9556a34f7509db223713ac16dfb093c48771d7f0202d05be756c661986"],
  ["20260802140000_ai_runtime_setting", "866ae03b000bcfd93ad4fc39ea56271344568a67192a3021dfe9d9ae57d2c489"],
  ["20260802162211_v2_knowledge_center_foundation", "a72cb2789c317b45b3f6219d6ed8c04be198336022008c523b471c392b6834d8"],
  ["20260803090000_study_session_closing", "95b763f406feb7d04ffcfc121c8f77d2e901aaec2948b050cd1625a4ce885315"],
  ["20260803093000_study_session_device_presence", "0ecab6334a98e1594fd174f610f6966991c43ec0aa99bab608bcdd8c415da9e1"],
  ["20260803100000_retest_requires_explicit_results", "2c8aecb3ab10fdc8dde3136a88755999f4a01698d99585b31c982a300d6def8f"],
  ["20260803103000_task_stage_links", "981df8e8aacbf0646fa9ae8a165b518537635d5146fa7662f129a1439a55270d"],
  ["20260803104500_ai_confirmation_rejection", "9dcb2e15dce0a380033cfc60a1947c72e8910ac83c33155ef12ed4a42539a1c7"],
  ["20260803110000_reconcile_device_presence_table", "aa0f9275fa0fc3023b1c9ae7e63c7953dd211cbf69266e692afef06435e31143"],
  ["20260803120000_task_knowledge_point_links", "9b4ba41c9b9d9f0505657c796cffb1bef15a28ca372cb4a11ead2c04ddf3b646"],
] as const;

export const currentMigrationManifest: readonly MigrationManifestEntry[] = currentEntries.map(([name, sha256]) => ({ name, sha256 }));
export const legacyMigrationManifest = currentMigrationManifest.slice(0, 12);
export const floorMigrationManifest = currentMigrationManifest.slice(0, 15);

const expectedManifestDigests = {
  legacy: "90b88fe3555ff44696cc0968b42b5b7f7828daa1bb2b58115caf003cd7511368",
  floor: "e86f1d7e8f850b76f7b5470c11ccf08cab409ed092ea809d198b74fc8610e57d",
  current: "c750e38859d56f57ed2ba77d46dde0318c77d7c06241f39585bbf1f99beea0f0",
} as const;

export function assertEmbeddedMigrationManifests(): void {
  assert.equal(legacyMigrationManifest.length, 12);
  assert.equal(floorMigrationManifest.length, 15);
  assert.equal(currentMigrationManifest.length, 34);
  assert.equal(migrationManifestDigest(legacyMigrationManifest), expectedManifestDigests.legacy);
  assert.equal(migrationManifestDigest(floorMigrationManifest), expectedManifestDigests.floor);
  assert.equal(migrationManifestDigest(currentMigrationManifest), expectedManifestDigests.current);
}

export function migrationManifestDigest(entries: readonly MigrationManifestEntry[]): string {
  const canonical = `v11-migration-manifest-v1\n${entries.map((entry) => `${entry.name}\t${entry.sha256}`).join("\n")}\n`;
  return createHash("sha256").update(canonical).digest("hex");
}

export function assertSourceMigrationManifest(
  root: string,
  expected: readonly MigrationManifestEntry[],
  label: string,
): void {
  const migrationRoot = path.join(root, "prisma/migrations");
  const directories = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(directories, expected.map((entry) => entry.name), `${label} migration directory set mismatch`);

  for (const entry of expected) {
    const sql = readFileSync(path.join(migrationRoot, entry.name, "migration.sql"));
    assert.equal(sha256(sql), entry.sha256, `${label} migration SQL checksum mismatch: ${entry.name}`);
  }
}

export function assertGitCommitMigrationManifest(
  root: string,
  commit: string,
  expected: readonly MigrationManifestEntry[],
  label: string,
): void {
  const names = git(root, ["ls-tree", "-r", "--name-only", commit, "--", "prisma/migrations"])
    .split("\n")
    .filter((file) => file.endsWith("/migration.sql"))
    .map((file) => path.basename(path.dirname(file)))
    .sort();
  assert.deepEqual(names, expected.map((entry) => entry.name), `${label} git migration set mismatch`);

  for (const entry of expected) {
    const sql = execFileSync("git", ["show", `${commit}:prisma/migrations/${entry.name}/migration.sql`], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(sha256(sql), entry.sha256, `${label} git migration checksum mismatch: ${entry.name}`);
  }
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
