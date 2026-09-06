/**
 * Data-lifecycle primitives that are deliberately independent from persistence.
 *
 * This module only normalizes in-memory values. It does not read files, query a
 * database, or decide whether a deletion is authorized. Callers must perform
 * ownership/permission checks before supplying records for an export.
 */

export const DATA_EXPORT_PROTOCOL = "areaforge-data-export" as const;
export const DATA_EXPORT_SCHEMA_VERSION = 1 as const;

export type DataExportScope = "account" | "workspace";
export type DataInventorySensitivity = "public" | "private" | "secret" | "internal";
export type DataInventoryOwner = "account" | "workspace" | "system";
export type DataInventoryExportPolicy = "include" | "metadata_only" | "exclude";
export type DataInventoryDeletePolicy = "eligible" | "retained" | "never";

export interface DataInventoryItem {
  kind: string;
  owner: DataInventoryOwner;
  sensitivity: DataInventorySensitivity;
  exportPolicy: DataInventoryExportPolicy;
  deletePolicy: DataInventoryDeletePolicy;
}

export interface DataExportRecordInput {
  kind: string;
  id: string;
  data: unknown;
}

export interface DataExportManifestEntry {
  kind: string;
  id: string;
  data: unknown;
  sha256: string;
  omittedFieldCount: number;
}

export interface DataExportManifest {
  protocol: typeof DATA_EXPORT_PROTOCOL;
  schemaVersion: typeof DATA_EXPORT_SCHEMA_VERSION;
  scope: DataExportScope;
  generatedAt: string;
  entries: readonly DataExportManifestEntry[];
}

export interface CreateDataExportManifestInput {
  scope: DataExportScope;
  generatedAt: string;
  records: readonly DataExportRecordInput[];
}

/**
 * Keys that may reveal credentials, session material, or server filesystem
 * details. They are omitted rather than replaced with a placeholder so that
 * an exported package cannot be mistaken for a complete source record.
 */
const RESTRICTED_KEY_NAMES = new Set([
  "accesskey",
  "accesstoken",
  "apikey",
  "authorization",
  "authactiontokensecret",
  "authsessionsecret",
  "clientsecret",
  "connectionstring",
  "cookie",
  "credential",
  "credentials",
  "databaseurl",
  "decryptionkey",
  "encryptionkey",
  "filepath",
  "filesystempath",
  "internalpath",
  "privatekey",
  "refreshtoken",
  "secret",
  "secrets",
  "sessiontoken",
  "signingkey",
  "storedname",
  "token",
  "uploadpath",
  "uri",
  "absolutepath",
  "directory",
  "dirname",
  "path",
  "rootpath",
]);

/**
 * Return true when a property name is not safe to put in an export.
 *
 * camelCase, snake_case and kebab-case are intentionally normalized to the
 * same comparison form. `workspaceKey` and `stableKey` remain exportable: a
 * key is not a secret merely because its name ends in "Key".
 */
export function isRestrictedDataExportKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return RESTRICTED_KEY_NAMES.has(normalized)
    || normalized.includes("apikey")
    || normalized.startsWith("internal")
    || normalized.startsWith("secret")
    || normalized.startsWith("password")
    || normalized.startsWith("session")
    || normalized.startsWith("privatekey")
    || normalized.endsWith("token")
    || normalized.endsWith("secret")
    || normalized.endsWith("password")
    || normalized.endsWith("passwordhash")
    || normalized.endsWith("credential")
    || normalized.endsWith("credentials")
    || normalized.endsWith("privatekey")
    || normalized.endsWith("uploadpath")
    || normalized.endsWith("filepath");
}

/**
 * Recursively omit restricted fields from a JSON-like value.
 *
 * The input is never mutated. `undefined` values and array elements that are
 * restricted are omitted, while ordinary null/boolean/number/string values
 * are retained. Cyclic values fail closed because an export must be JSONable.
 */
export function redactDataExportValue(value: unknown): unknown {
  return redactDataExportValueWithSummary(value).value;
}

export interface DataExportRedactionResult {
  value: unknown;
  omittedFieldCount: number;
}

/** Redact a value and report how many restricted fields were omitted. */
export function redactDataExportValueWithSummary(value: unknown): DataExportRedactionResult {
  const state = { active: new Set<object>(), omittedFieldCount: 0 };
  return { value: redactValue(value, state, "$root"), omittedFieldCount: state.omittedFieldCount };
}

/**
 * Canonical JSON for hashes and manifests. Object keys are sorted and numbers
 * follow JSON semantics (`NaN`, infinities, and -0 become 0/null as JSON does).
 */
export function canonicalizeDataExportValue(value: unknown): string {
  return canonicalizeValue(redactDataExportValue(value));
}

/** Compute a portable, deterministic SHA-256 digest of an export value. */
export function hashDataExportValue(value: unknown): string {
  return `sha256:${sha256Hex(canonicalizeDataExportValue(value))}`;
}

/** Compute SHA-256 over exact binary bytes, for archive/checksum binding. */
export function hashDataExportBytes(value: Uint8Array): string {
  return `sha256:${sha256HexBytes(value)}`;
}

/**
 * Normalize and validate a DATA-0 inventory list. The result is sorted by
 * object kind and duplicate kinds are rejected to keep policy unambiguous.
 */
export function normalizeDataInventory(items: readonly DataInventoryItem[]): readonly DataInventoryItem[] {
  const normalized = items.map((item) => {
    const kind = normalizeIdentifier(item.kind, "inventory kind");
    if (!isInventoryOwner(item.owner)) throw new TypeError(`Invalid inventory owner for ${kind}.`);
    if (!isInventorySensitivity(item.sensitivity)) throw new TypeError(`Invalid inventory sensitivity for ${kind}.`);
    if (!isInventoryExportPolicy(item.exportPolicy)) throw new TypeError(`Invalid export policy for ${kind}.`);
    if (!isInventoryDeletePolicy(item.deletePolicy)) throw new TypeError(`Invalid delete policy for ${kind}.`);
    return {
      kind,
      owner: item.owner,
      sensitivity: item.sensitivity,
      exportPolicy: item.exportPolicy,
      deletePolicy: item.deletePolicy,
    };
  });

  normalized.sort((left, right) => compareStrings(left.kind, right.kind));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index]?.kind === normalized[index - 1]?.kind) {
      throw new TypeError(`Duplicate inventory kind: ${normalized[index]?.kind}.`);
    }
  }
  return normalized;
}

/**
 * Build a versioned, redacted manifest. It intentionally returns metadata and
 * records only; creating a temporary archive or download grant is a separate,
 * high-risk service concern.
 */
export function createDataExportManifest(input: CreateDataExportManifestInput): DataExportManifest {
  if (input.scope !== "account" && input.scope !== "workspace") {
    throw new TypeError("Data export scope must be account or workspace.");
  }
  const generatedAt = input.generatedAt.trim();
  if (!generatedAt) throw new TypeError("Data export generatedAt is required.");

  const entries = input.records.map((record) => {
    const kind = normalizeIdentifier(record.kind, "export record kind");
    const id = normalizeIdentifier(record.id, "export record id");
    const redaction = redactDataExportValueWithSummary(record.data);
    return {
      kind,
      id,
      data: redaction.value,
      sha256: hashDataExportValue(redaction.value),
      omittedFieldCount: redaction.omittedFieldCount,
    };
  });

  entries.sort((left, right) => compareStrings(left.kind, right.kind) || compareStrings(left.id, right.id));
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (previous?.kind === current?.kind && previous?.id === current?.id) {
      throw new TypeError(`Duplicate export record: ${current.kind}/${current.id}.`);
    }
  }

  return {
    protocol: DATA_EXPORT_PROTOCOL,
    schemaVersion: DATA_EXPORT_SCHEMA_VERSION,
    scope: input.scope,
    generatedAt,
    entries,
  };
}

/** Hash the canonical, redacted manifest envelope (including per-entry hashes). */
export function hashDataExportManifest(manifest: DataExportManifest): string {
  const entries = [...manifest.entries].sort((left, right) => compareStrings(left.kind, right.kind) || compareStrings(left.id, right.id));
  return hashDataExportValue({
    protocol: manifest.protocol,
    schemaVersion: manifest.schemaVersion,
    scope: manifest.scope,
    generatedAt: manifest.generatedAt,
    entries,
  });
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  // IDs and kinds may be opaque, but must never be used to smuggle a path.
  if (normalized.includes("/") || normalized.includes("\\") || normalized === "." || normalized === "..") {
    throw new TypeError(`${label} must not contain a filesystem path.`);
  }
  return normalized;
}

function redactValue(value: unknown, state: { active: Set<object>; omittedFieldCount: number }, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return undefined;
  if (typeof value !== "object") throw new TypeError(`Unsupported export value at ${path}.`);

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new TypeError(`Invalid date at ${path}.`);
    return value.toISOString();
  }
  // Prisma Decimal instances are intentionally normalized without importing
  // Prisma into core; their public string form is the portable JSON value.
  if (value.constructor?.name === "Decimal" && typeof value.toString === "function") {
    return value.toString();
  }

  if (state.active.has(value)) throw new TypeError(`Cyclic export value at ${path}.`);
  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      return value
        .map((item, index) => redactValue(item, state, `${path}[${index}]`))
        .filter((item): item is Exclude<unknown, undefined> => item !== undefined);
    }

    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (isRestrictedDataExportKey(key)) {
        state.omittedFieldCount += 1;
        continue;
      }
      const redacted = redactValue((value as Record<string, unknown>)[key], state, `${path}.${key}`);
      if (redacted !== undefined) result[key] = redacted;
    }
    return result;
  } finally {
    state.active.delete(value);
  }
}

function canonicalizeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(Object.is(value, -0) ? 0 : value) : "null";
  if (Array.isArray(value)) return `[${value.map(canonicalizeValue).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort(compareStrings).map((key) => `${JSON.stringify(key)}:${canonicalizeValue(object[key])}`).join(",")}}`;
  }
  return "null";
}

function isInventoryOwner(value: string): value is DataInventoryOwner {
  return value === "account" || value === "workspace" || value === "system";
}

function isInventorySensitivity(value: string): value is DataInventorySensitivity {
  return value === "public" || value === "private" || value === "secret" || value === "internal";
}

function isInventoryExportPolicy(value: string): value is DataInventoryExportPolicy {
  return value === "include" || value === "metadata_only" || value === "exclude";
}

function isInventoryDeletePolicy(value: string): value is DataInventoryDeletePolicy {
  return value === "eligible" || value === "retained" || value === "never";
}

// SHA-256 is kept here instead of importing node:crypto so @areaforge/core
// remains usable in browser and server rule evaluation alike.
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function sha256Hex(value: string): string {
  return sha256HexBytes(utf8Bytes(value));
}

function sha256HexBytes(value: ArrayLike<number>): string {
  const bytes = Array.from(value);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length + 8) % 64 !== 0) bytes.push(0);
  for (let shift = 56; shift >= 0; shift -= 8) bytes.push(Math.floor(bitLength / 2 ** shift) & 0xff);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(64).fill(0);
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      words[index] = ((bytes[position]! << 24) | (bytes[position + 1]! << 16) | (bytes[position + 2]! << 8) | bytes[position + 3]!) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const lower = words[index - 15]!;
      const upper = words[index - 2]!;
      const s0 = rotr(lower, 7) ^ rotr(lower, 18) ^ (lower >>> 3);
      const s1 = rotr(upper, 17) ^ rotr(upper, 19) ^ (upper >>> 10);
      words[index] = add32(words[index - 16]!, s0, words[index - 7]!, s1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = add32(h, sum1, choice, SHA256_K[index]!, words[index]!);
      const sum0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = add32(sum0, majority);
      h = g;
      g = f;
      f = e;
      e = add32(d, temp1);
      d = c;
      c = b;
      b = a;
      a = add32(temp1, temp2);
    }
    h0 = add32(h0, a);
    h1 = add32(h1, b);
    h2 = add32(h2, c);
    h3 = add32(h3, d);
    h4 = add32(h4, e);
    h5 = add32(h5, f);
    h6 = add32(h6, g);
    h7 = add32(h7, h);
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((part) => part.toString(16).padStart(8, "0")).join("");
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint <= 0xffff) bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    else bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
  }
  return bytes;
}

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function add32(...values: number[]): number {
  return values.reduce((sum, value) => (sum + value) >>> 0, 0);
}
