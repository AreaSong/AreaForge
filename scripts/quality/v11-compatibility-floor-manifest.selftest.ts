import {
  assertEmbeddedMigrationManifests,
  assertGitCommitMigrationManifest,
  assertSourceMigrationManifest,
  currentMigrationManifest,
  floorCommit,
  floorMigrationManifest,
  legacyCommit,
  legacyMigrationManifest,
} from "./v11-compatibility-floor-manifest";

const root = process.cwd();

assertEmbeddedMigrationManifests();
assertSourceMigrationManifest(root, currentMigrationManifest, "candidate source");
assertGitCommitMigrationManifest(root, legacyCommit, legacyMigrationManifest, "legacy commit");
assertGitCommitMigrationManifest(root, floorCommit, floorMigrationManifest, "floor commit");

console.log("PASS v1.1 compatibility floor 12/15/24 migration manifests");
