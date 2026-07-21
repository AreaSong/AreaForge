import { NOTE_KINDS, type NoteKind, isNoteKind } from "./knowledge-card";

export const AI_DRAFT_ENDPOINTS = ["learning-tree", "knowledge-card", "plan", "motivation"] as const;
export type AiDraftEndpoint = (typeof AI_DRAFT_ENDPOINTS)[number];

export const AI_DRAFT_SCOPES = ["global", "subject", "branch"] as const;
export type AiDraftScope = (typeof AI_DRAFT_SCOPES)[number];

export const AI_DRAFT_MOTIVATION_TONES = ["CALM", "DIRECT", "BRIEF"] as const;
export type AiDraftMotivationTone = (typeof AI_DRAFT_MOTIVATION_TONES)[number];

export const AI_PAYLOAD_BINDING_PURPOSES = ["selection:v1", "preview:v1", "provider:v1"] as const;
export type AiPayloadBindingPurpose = (typeof AI_PAYLOAD_BINDING_PURPOSES)[number];

export const AI_DRAFT_PREVIEW_PURPOSE = "ai-draft-preview:v1";
export const AI_DRAFT_PREVIEW_TTL_MS = 30 * 60 * 1000;

export const AI_DRAFT_PROJECTION_VERSIONS = {
  "learning-tree": "learning-tree-input-v1",
  "knowledge-card": "knowledge-card-input-v1",
  plan: "plan-input-v1",
  motivation: "motivation-input-v1",
} as const satisfies Record<AiDraftEndpoint, string>;

export const AI_DRAFT_OUTPUT_SCHEMAS = {
  "learning-tree": "learning-tree-draft-v1",
  "knowledge-card": "knowledge-card-draft-v1",
  plan: "plan-draft-v1",
  motivation: "motivation-draft-v1",
} as const satisfies Record<AiDraftEndpoint, string>;

export const AI_DRAFT_LIMITS = {
  "learning-tree": { maxBytes: 32 * 1024, maxTokens: 8000 },
  "knowledge-card": { maxBytes: 12 * 1024, maxTokens: 3000 },
  plan: { maxBytes: 12 * 1024, maxTokens: 3000 },
  motivation: { maxBytes: 4 * 1024, maxTokens: 1000 },
} as const satisfies Record<AiDraftEndpoint, { maxBytes: number; maxTokens: number }>;

export const AI_DRAFT_LABEL_MAX_CHARS = 120;
export const AI_DRAFT_DURATION_MIN = 5;
export const AI_DRAFT_DURATION_MAX = 480;

export type AiDraftErrorCode =
  | "AI_PAYLOAD_TOO_LARGE"
  | "AI_DRAFT_UNKNOWN_FIELD"
  | "AI_DRAFT_INVALID_ENUM"
  | "AI_DRAFT_PROJECTION_MISMATCH"
  | "AI_BINDING_SECRET_INVALID"
  | "AI_DRAFT_TOKEN_INVALID"
  | "AI_DRAFT_OPERATION_CONFLICT";

export interface AiDraftLearningTreeProjection {
  subjectLabel?: string;
  rootNodeLabel?: string;
}

export interface AiDraftKnowledgeCardProjection {
  subjectLabel?: string;
  nodeLabel?: string;
}

export interface AiDraftPlanProjection {
  subjectLabel?: string;
  milestoneLabel?: string;
  dateWindow?: { start: string; end: string };
  defaultDurationMinutes?: number;
}

export type AiDraftProjectionByEndpoint = {
  "learning-tree": AiDraftLearningTreeProjection;
  "knowledge-card": AiDraftKnowledgeCardProjection;
  plan: AiDraftPlanProjection;
  motivation: Record<string, never>;
};

export interface AiDraftPreviewInputBase {
  selectedText: string;
}

export interface AiDraftLearningTreeInput extends AiDraftPreviewInputBase {
  endpoint: "learning-tree";
  scope: AiDraftScope;
  checkedProjection?: AiDraftLearningTreeProjection;
}

export interface AiDraftKnowledgeCardInput extends AiDraftPreviewInputBase {
  endpoint: "knowledge-card";
  kind: NoteKind;
  checkedProjection?: AiDraftKnowledgeCardProjection;
}

export interface AiDraftPlanInput extends AiDraftPreviewInputBase {
  endpoint: "plan";
  checkedProjection?: AiDraftPlanProjection;
}

export interface AiDraftMotivationInput extends AiDraftPreviewInputBase {
  endpoint: "motivation";
  tone: AiDraftMotivationTone;
  checkedProjection?: Record<string, never>;
}

export type AiDraftNormalizedInput =
  | AiDraftLearningTreeInput
  | AiDraftKnowledgeCardInput
  | AiDraftPlanInput
  | AiDraftMotivationInput;

export interface AiDraftPreviewTokenClaims {
  purpose: typeof AI_DRAFT_PREVIEW_PURPOSE;
  actorId: string;
  workspaceId: string;
  endpoint: AiDraftEndpoint;
  operationId: string;
  nonce: string;
  projectionVersion: string;
  selectionHash: string;
  previewPayloadHash: string;
  providerPayloadHash: string;
  requestFingerprint: string;
  expiry: number;
}

export function isAiDraftEndpoint(value: string): value is AiDraftEndpoint {
  return (AI_DRAFT_ENDPOINTS as readonly string[]).includes(value);
}

export function isAiDraftScope(value: string): value is AiDraftScope {
  return (AI_DRAFT_SCOPES as readonly string[]).includes(value);
}

export function isAiDraftMotivationTone(value: string): value is AiDraftMotivationTone {
  return (AI_DRAFT_MOTIVATION_TONES as readonly string[]).includes(value);
}

/** Normalize selected text: Unicode NFC + unify newlines. Does not truncate. */
export function normalizeAiDraftSelectedText(value: string): string {
  return value.normalize("NFC").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function estimateTokenCount(text: string): number {
  // Conservative estimate: ~4 chars per token for mixed CJK/Latin.
  return Math.ceil(text.length / 4);
}

export function assertAiDraftSize(
  endpoint: AiDraftEndpoint,
  selectedText: string,
): { ok: true } | { ok: false; code: "AI_PAYLOAD_TOO_LARGE" } {
  const limits = AI_DRAFT_LIMITS[endpoint];
  const bytes = utf8ByteLength(selectedText);
  if (bytes > limits.maxBytes || estimateTokenCount(selectedText) > limits.maxTokens) {
    return { ok: false, code: "AI_PAYLOAD_TOO_LARGE" };
  }
  return { ok: true };
}

function assertLabel(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw draftError("AI_DRAFT_INVALID_ENUM", field);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > AI_DRAFT_LABEL_MAX_CHARS) throw draftError("AI_DRAFT_INVALID_ENUM", field);
  return trimmed;
}

function draftError(code: AiDraftErrorCode, field?: string): Error & { code: AiDraftErrorCode; field?: string } {
  const error = new Error(code) as Error & { code: AiDraftErrorCode; field?: string };
  error.code = code;
  error.field = field;
  return error;
}

const LEARNING_TREE_PROJECTION_KEYS = new Set(["subjectLabel", "rootNodeLabel"]);
const KNOWLEDGE_CARD_PROJECTION_KEYS = new Set(["subjectLabel", "nodeLabel"]);
const PLAN_PROJECTION_KEYS = new Set(["subjectLabel", "milestoneLabel", "dateWindow", "defaultDurationMinutes"]);

function rejectUnknownKeys(record: Record<string, unknown>, allowed: Set<string>) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw draftError("AI_DRAFT_UNKNOWN_FIELD", key);
  }
}

export function normalizeAiDraftInput(
  endpoint: AiDraftEndpoint,
  raw: Record<string, unknown>,
): AiDraftNormalizedInput {
  const allowedBase = new Set(["selectedText", "checkedProjection", "scope", "kind", "tone", "phase", "previewToken"]);
  for (const key of Object.keys(raw)) {
    if (!allowedBase.has(key)) throw draftError("AI_DRAFT_UNKNOWN_FIELD", key);
  }

  if (typeof raw.selectedText !== "string" || !raw.selectedText.trim()) {
    throw draftError("AI_DRAFT_INVALID_ENUM", "selectedText");
  }
  const selectedText = normalizeAiDraftSelectedText(raw.selectedText);
  const size = assertAiDraftSize(endpoint, selectedText);
  if (!size.ok) throw draftError(size.code);

  const projectionRaw =
    raw.checkedProjection === undefined || raw.checkedProjection === null
      ? {}
      : raw.checkedProjection;
  if (typeof projectionRaw !== "object" || Array.isArray(projectionRaw)) {
    throw draftError("AI_DRAFT_INVALID_ENUM", "checkedProjection");
  }
  const projection = projectionRaw as Record<string, unknown>;

  switch (endpoint) {
    case "learning-tree": {
      rejectUnknownKeys(projection, LEARNING_TREE_PROJECTION_KEYS);
      if (typeof raw.scope !== "string" || !isAiDraftScope(raw.scope)) {
        throw draftError("AI_DRAFT_INVALID_ENUM", "scope");
      }
      return {
        endpoint,
        selectedText,
        scope: raw.scope,
        checkedProjection: {
          subjectLabel: assertLabel(projection.subjectLabel, "subjectLabel"),
          rootNodeLabel: assertLabel(projection.rootNodeLabel, "rootNodeLabel"),
        },
      };
    }
    case "knowledge-card": {
      rejectUnknownKeys(projection, KNOWLEDGE_CARD_PROJECTION_KEYS);
      if (typeof raw.kind !== "string" || !isNoteKind(raw.kind)) {
        throw draftError("AI_DRAFT_INVALID_ENUM", "kind");
      }
      return {
        endpoint,
        selectedText,
        kind: raw.kind,
        checkedProjection: {
          subjectLabel: assertLabel(projection.subjectLabel, "subjectLabel"),
          nodeLabel: assertLabel(projection.nodeLabel, "nodeLabel"),
        },
      };
    }
    case "plan": {
      rejectUnknownKeys(projection, PLAN_PROJECTION_KEYS);
      let dateWindow: { start: string; end: string } | undefined;
      if (projection.dateWindow !== undefined) {
        if (
          typeof projection.dateWindow !== "object" ||
          projection.dateWindow === null ||
          Array.isArray(projection.dateWindow)
        ) {
          throw draftError("AI_DRAFT_INVALID_ENUM", "dateWindow");
        }
        const window = projection.dateWindow as Record<string, unknown>;
        for (const key of Object.keys(window)) {
          if (key !== "start" && key !== "end") throw draftError("AI_DRAFT_UNKNOWN_FIELD", `dateWindow.${key}`);
        }
        if (typeof window.start !== "string" || typeof window.end !== "string") {
          throw draftError("AI_DRAFT_INVALID_ENUM", "dateWindow");
        }
        dateWindow = { start: window.start, end: window.end };
      }
      let defaultDurationMinutes: number | undefined;
      if (projection.defaultDurationMinutes !== undefined) {
        if (
          typeof projection.defaultDurationMinutes !== "number" ||
          !Number.isInteger(projection.defaultDurationMinutes) ||
          projection.defaultDurationMinutes < AI_DRAFT_DURATION_MIN ||
          projection.defaultDurationMinutes > AI_DRAFT_DURATION_MAX
        ) {
          throw draftError("AI_DRAFT_INVALID_ENUM", "defaultDurationMinutes");
        }
        defaultDurationMinutes = projection.defaultDurationMinutes;
      }
      return {
        endpoint,
        selectedText,
        checkedProjection: {
          subjectLabel: assertLabel(projection.subjectLabel, "subjectLabel"),
          milestoneLabel: assertLabel(projection.milestoneLabel, "milestoneLabel"),
          dateWindow,
          defaultDurationMinutes,
        },
      };
    }
    case "motivation": {
      rejectUnknownKeys(projection, new Set());
      if (typeof raw.tone !== "string" || !isAiDraftMotivationTone(raw.tone)) {
        throw draftError("AI_DRAFT_INVALID_ENUM", "tone");
      }
      return {
        endpoint,
        selectedText,
        tone: raw.tone,
        checkedProjection: {},
      };
    }
  }
}

/** Canonical JSON for hashing: sorted keys, only checked projection fields that are defined. */
export function buildAiDraftCanonicalPayloads(input: AiDraftNormalizedInput): {
  selectionPayload: string;
  previewPayload: string;
  providerPayload: string;
  projectionVersion: string;
  requestFingerprint: string;
} {
  const projectionVersion = AI_DRAFT_PROJECTION_VERSIONS[input.endpoint];
  const selectionPayload = stableStringify({
    endpoint: input.endpoint,
    selectedText: input.selectedText,
  });

  const previewObject: Record<string, unknown> = {
    endpoint: input.endpoint,
    projectionVersion,
    selectedText: input.selectedText,
  };
  const providerObject: Record<string, unknown> = {
    endpoint: input.endpoint,
    projectionVersion,
    selectedText: input.selectedText,
  };

  switch (input.endpoint) {
    case "learning-tree":
      previewObject.scope = input.scope;
      providerObject.scope = input.scope;
      previewObject.checkedProjection = compactProjection({ ...(input.checkedProjection ?? {}) });
      providerObject.checkedProjection = compactProjection({ ...(input.checkedProjection ?? {}) });
      break;
    case "knowledge-card":
      previewObject.kind = input.kind;
      providerObject.kind = input.kind;
      previewObject.checkedProjection = compactProjection({ ...(input.checkedProjection ?? {}) });
      providerObject.checkedProjection = compactProjection({ ...(input.checkedProjection ?? {}) });
      break;
    case "plan":
      previewObject.checkedProjection = compactProjection({ ...(input.checkedProjection ?? {}) });
      providerObject.checkedProjection = compactProjection({ ...(input.checkedProjection ?? {}) });
      break;
    case "motivation":
      previewObject.tone = input.tone;
      providerObject.tone = input.tone;
      break;
  }

  const previewPayload = stableStringify(previewObject);
  const providerPayload = stableStringify(providerObject);
  const requestFingerprint = stableStringify({
    endpoint: input.endpoint,
    projectionVersion,
    selectionPayload,
    previewPayload,
    providerPayload,
  });

  return {
    selectionPayload,
    previewPayload,
    providerPayload,
    projectionVersion,
    requestFingerprint,
  };
}

function compactProjection(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null));
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // surrogate pair
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}

export { NOTE_KINDS, isNoteKind };
export type { NoteKind };
