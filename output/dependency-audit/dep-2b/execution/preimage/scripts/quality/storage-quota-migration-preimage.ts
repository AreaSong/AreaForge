import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const STORAGE_QUOTA_SCHEMA_SHA256 = "d98c9ca16c73d06a6ac761baee23ee81d57aa6c578d250cec7124b1eb0a82793";
// 独立 STORAGE 兼容候选：原 54 条加工作区存储计量一条；不升级旧域护栏。
const migrationFingerprint = "6717c239290bcce247481e4935fd1d91bbf66d7e2ec51b9f94a80b18e2c0178f";
const refused = "STORAGE_QUOTA_MIGRATION_PREIMAGE_CHANGED";

export function assertStorageQuotaMigrationPreimage(repository = process.cwd()): number {
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
  assert.equal(files.length, 56, refused);
  const hash = createHash("sha256");
  for (const file of files) {
    const absolute = path.join(root, file);
    assert.ok(lstatSync(absolute).isFile(), refused);
    hash.update(file).update("\0").update(readFileSync(absolute)).update("\0");
  }
  assert.equal(hash.digest("hex"), migrationFingerprint, refused);
  const schema = path.join(repository, "prisma/schema.prisma");
  assert.ok(lstatSync(schema).isFile(), refused);
  assert.equal(createHash("sha256").update(readFileSync(schema)).digest("hex"), STORAGE_QUOTA_SCHEMA_SHA256, refused);
  return 55;
}
