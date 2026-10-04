import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const CAPACITY_SCHEMA_SHA256 = "6001f7ef0e030295a589f4e845eba3f75ba3b214885863f9251e637aa4ae4583";
// 对应批准基线 7620816 的 migration tree b4f334e02e7871632d010856b72d72c875fb9f6f。
const migrationFingerprint = "c0bef75c08d04669d96db7b204dba5a649a8fa1f3c5e84ea0036260083a66413";
const refused = "CAPACITY_MIGRATION_PREIMAGE_CHANGED";

export function assertCapacityMigrationPreimage(repository = process.cwd()): number {
  const root = path.join(repository, "prisma/migrations");
  assert.ok(lstatSync(path.join(repository, "prisma")).isDirectory(), refused);
  assert.ok(lstatSync(root).isDirectory(), refused);
  const files: string[] = [];
  for (const name of readdirSync(root).sort()) {
    const stat = lstatSync(path.join(root, name));
    if (name === "migration_lock.toml" && stat.isFile()) files.push(name);
    else {
      assert.ok(stat.isDirectory() && /^\d+_/.test(name), refused);
      assert.deepEqual(readdirSync(path.join(root, name)), ["migration.sql"], refused);
      files.push(`${name}/migration.sql`);
    }
  }
  assert.equal(files.length, 55, refused);
  const hash = createHash("sha256");
  for (const file of files) {
    const absolute = path.join(root, file);
    assert.ok(lstatSync(absolute).isFile(), refused);
    hash.update(file).update("\0").update(readFileSync(absolute)).update("\0");
  }
  assert.equal(hash.digest("hex"), migrationFingerprint, refused);
  const schema = path.join(repository, "prisma/schema.prisma");
  assert.ok(lstatSync(schema).isFile(), refused);
  assert.equal(createHash("sha256").update(readFileSync(schema)).digest("hex"), CAPACITY_SCHEMA_SHA256, refused);
  return 54;
}
