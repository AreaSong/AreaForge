export const LEARNING_TREE_PROTOCOL = "AREAFORGE_LEARNING_TREE_V1" as const;
export const LEARNING_TREE_PARSER_VERSION = "1.0.0" as const;
export const LEARNING_TREE_PREVIEW_PURPOSE = "learning-tree-preview:v1" as const;

export const LEARNING_TREE_MAX_BYTES = 2 * 1024 * 1024;
export const LEARNING_TREE_MAX_OBJECTS = 5000;
export const LEARNING_TREE_MAX_DEPTH = 6;
export const LEARNING_TREE_PREVIEW_TTL_MS = 30 * 60 * 1000;

export type LearningTreeScope = "global" | "subject" | "branch";

export type LearningTreeObjectType = "group" | "subject" | "node" | "card" | "resource" | "plan";

export type LearningTreeDiffType =
  | "ADD"
  | "UPDATE"
  | "MOVE"
  | "ARCHIVE"
  | "UNCHANGED"
  | "CONFLICT"
  | "SKIP";

export type LearningTreeNoteKind =
  | "GENERAL"
  | "CONCEPT"
  | "METHOD"
  | "EXAMPLE"
  | "JOURNAL"
  | "SUMMARY";

export type LearningTreeErrorCode =
  | "PROTOCOL_INVALID"
  | "SCOPE_INVALID"
  | "FRONTMATTER_INVALID"
  | "SIZE_LIMIT"
  | "OBJECT_LIMIT"
  | "DEPTH_LIMIT"
  | "UNKNOWN_DIRECTIVE"
  | "RAW_HTML_FORBIDDEN"
  | "IMAGE_FORBIDDEN"
  | "DUPLICATE_STABLE_KEY"
  | "CROSS_SUBJECT_REF"
  | "URL_INVALID"
  | "DEPENDENCY_CYCLE"
  | "MISSING_SUBJECT"
  | "EMPTY_TITLE"
  | "PARSE_ERROR";

export interface LearningTreeIssue {
  code: LearningTreeErrorCode;
  message: string;
  sourceLine?: number;
  stableKey?: string;
}

export interface LearningTreeFrontmatter {
  protocol: typeof LEARNING_TREE_PROTOCOL;
  scope: LearningTreeScope;
  workspaceKey: string;
  subjectKey?: string;
  rootNodeKey?: string;
}

export interface LearningTreePreviewTokenClaims {
  actorId: string;
  workspaceId: string;
  protocolVersion: typeof LEARNING_TREE_PROTOCOL;
  parserVersion: typeof LEARNING_TREE_PARSER_VERSION;
  sourceSha256: string;
  canonicalPlanHash: string;
  scope: LearningTreeScope;
  rootRevision: number;
  expiry: number;
  nonce: string;
}

/** Deterministic preview-generated stable keys without Node crypto. */
export function createStableKey(prefix: string, seed: string): string {
  const input = `${prefix}:${seed}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const left = (hash >>> 0).toString(16).padStart(8, "0");
  let hash2 = 0x811c9dc5;
  for (let index = input.length - 1; index >= 0; index -= 1) {
    hash2 ^= input.charCodeAt(index);
    hash2 = Math.imul(hash2, 16777619);
  }
  const right = (hash2 >>> 0).toString(16).padStart(8, "0");
  return `${prefix}_${left}${right}`;
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}
