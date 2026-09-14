import { createHash } from "node:crypto";

export type OperationParameters =
  | { operation: "CHECK_RELEASE"; tag: string | null }
  | { operation: "BACKUP_PREVIEW"; scope: "DATABASE" | "UPLOADS" | "FULL" }
  | { operation: "DIAGNOSTIC_HEALTH"; includeCapacity: boolean }
  | { operation: "APPLY_RELEASE"; tag: string }
  | { operation: "ROLLBACK_RELEASE"; targetVersion: string }
  | { operation: "MAINTENANCE_HOLD"; reasonCode: "RELEASE" | "INCIDENT" | "RESTORE" | "CAPACITY" };

export interface OperationExpectedBefore {
  currentVersion: string;
  currentImage: string | null;
  autoApply: "none" | "patch" | "minor" | "all";
  signatureRequired: boolean;
  rollbackAvailable: boolean;
  rollbackTargetVersion: string | null;
  rollbackTargetImage: string | null;
  rollbackSourceRecordSha256: string | null;
}
export interface OperationReleaseTarget {
  releaseId: number;
  manifestSha256: string;
  manifestVersion: string;
  webImageDigest: string;
}
export interface OperationExecutionContext {
  schemaVersion: 1;
  environment: "local_fixture" | "production";
  scopeId: string;
  observedAt: string;
  expectedBefore: OperationExpectedBefore;
  target: OperationReleaseTarget | null;
  snapshotHash: string;
}

export interface OperationUpdateWire {
  schemaVersion: 2; id: string; action: "check" | "apply" | "rollback"; status: "queued";
  requestedAt: string; expiresAt: string; actorEmailHash: string; idempotencyKey: string;
  params: { tag: string | null; autoApply: null };
  target: { [K in keyof OperationReleaseTarget]: OperationReleaseTarget[K] | null };
  expectedBefore: OperationExpectedBefore;
  expectedBeforeHash: string; semanticHash: string; requestHash: string;
}
export interface BoundOperation {
  schemaVersion: 2;
  parameters: OperationParameters;
  execution: {
    schemaVersion: 1;
    context: OperationExecutionContext;
    originalRequestHash: string;
    nonce: string;
    initialRevision: 1;
    updaterRequest: OperationUpdateWire | null;
    bindingHash: string;
  };
}
export interface OperationHashIntent {
  operation: OperationParameters;
  expectedBeforeHash: string;
  idempotencyKey: string;
  requestedReason: string;
  executionSnapshotHash?: string;
}
export interface OperationHashInput {
  id: string; actorId: string; intent: OperationHashIntent;
  descriptor: { code: string; risk: "READ_ONLY" | "HIGH_RISK"; requiresApproval: boolean };
  intentHash: string; nonce: string; requestedAt: string; expiresAt: string;
}

const hashPattern = /^sha256:[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const versionPattern = /^\d+\.\d+\.\d+$/;
const tagPattern = /^v?\d+\.\d+\.\d+$/;
const imagePattern = /^ghcr\.io\/[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$/;
const beforeDomain = "areaforge.update-request.expected-before.v2";

export function operationCanonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(operationCanonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${operationCanonical(record[key])}`).join(",")}}`;
  }
  throw new Error("CONTROLLED_OPERATION_CANONICAL_INVALID");
}
export function operationHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(operationCanonical(value)).digest("hex")}`;
}
export function operationExpectedBeforeHash(expectedBefore: OperationExpectedBefore): string {
  return operationHash({ domain: beforeDomain, expectedBefore });
}
export function operationContextHash(context: Omit<OperationExecutionContext, "snapshotHash">): string {
  const { schemaVersion, environment, scopeId, observedAt, expectedBefore, target } = context;
  return operationHash({ domain: "areaforge.controlled-operation.context.v1", schemaVersion, environment, scopeId, observedAt, expectedBefore, target });
}
export function operationIntentHash(actorId: string, intent: OperationHashIntent): string {
  return operationHash({ domain: "areaforge.controlled-operation.intent.v1", actorId, ...intent });
}
export function operationRequestHash(input: OperationHashInput): string {
  return operationHash({
    domain: "areaforge.controlled-operation.request.v1", id: input.id, actorId: input.actorId,
    operation: input.intent.operation, operationCode: input.descriptor.code, risk: input.descriptor.risk,
    requiresApproval: input.descriptor.requiresApproval, requestedReason: input.intent.requestedReason,
    expectedBeforeHash: input.intent.expectedBeforeHash, idempotencyKey: input.intent.idempotencyKey,
    intentHash: input.intentHash, nonce: input.nonce, requestedAt: input.requestedAt, expiresAt: input.expiresAt,
  });
}
export function boundOperationRequestHash(operation: BoundOperation): string {
  return operationHash({ domain: "areaforge.controlled-operation.request.v2", operation });
}

export function parseOperationParameters(raw: unknown): OperationParameters | null {
  try {
    const value = record(raw);
    const kind = value.operation;
    if (kind === "CHECK_RELEASE" || kind === "APPLY_RELEASE") {
      keys(value, ["operation", "tag"]);
      ensure((kind === "CHECK_RELEASE" && value.tag === null) || matches(value.tag, tagPattern));
    } else if (kind === "BACKUP_PREVIEW") {
      keys(value, ["operation", "scope"]); ensure(["DATABASE", "UPLOADS", "FULL"].includes(String(value.scope)));
    } else if (kind === "DIAGNOSTIC_HEALTH") {
      keys(value, ["operation", "includeCapacity"]); ensure(typeof value.includeCapacity === "boolean");
    } else if (kind === "ROLLBACK_RELEASE") {
      keys(value, ["operation", "targetVersion"]); ensure(matches(value.targetVersion, versionPattern));
    } else if (kind === "MAINTENANCE_HOLD") {
      keys(value, ["operation", "reasonCode"]); ensure(["RELEASE", "INCIDENT", "RESTORE", "CAPACITY"].includes(String(value.reasonCode)));
    } else ensure(false);
    return structuredClone(value) as OperationParameters;
  } catch { return null; }
}

export function parseOperationContext(raw: unknown): OperationExecutionContext | null {
  try {
    const value = record(raw);
    keys(value, ["schemaVersion", "environment", "scopeId", "observedAt", "expectedBefore", "target", "snapshotHash"]);
    ensure(value.schemaVersion === 1 && ["local_fixture", "production"].includes(String(value.environment)));
    ensure(matches(value.scopeId, hashPattern) && isTimestamp(value.observedAt) && matches(value.snapshotHash, hashPattern));
    validateExpectedBefore(value.expectedBefore);
    if (value.target !== null) validateTarget(value.target);
    const result = value as unknown as OperationExecutionContext;
    ensure(result.snapshotHash === operationContextHash(result));
    return structuredClone(result);
  } catch { return null; }
}

/** 将旧请求 hash 当作独立 preimage，避免把最终 hash 嵌入自身的循环绑定。 */
export function bindControlledOperation(input: OperationHashInput & { context: OperationExecutionContext; actorEmail: string }): BoundOperation {
  const context = parseOperationContext(input.context);
  if (!context || input.intent.executionSnapshotHash !== context.snapshotHash
    || input.intent.expectedBeforeHash !== operationExpectedBeforeHash(context.expectedBefore)) invalid();
  const parameters = parseOperationParameters(input.intent.operation);
  if (!parameters) invalid();
  validateTargetForOperation(parameters, context);
  const execution: BoundOperation["execution"] = {
    schemaVersion: 1, context, originalRequestHash: operationRequestHash(input), nonce: input.nonce,
    initialRevision: 1, updaterRequest: buildOperationUpdateWire(input, context), bindingHash: "",
  };
  execution.bindingHash = executionHash(parameters, execution);
  return { schemaVersion: 2, parameters, execution };
}

export function parseBoundOperation(raw: unknown): BoundOperation | null {
  try {
    const value = record(raw); keys(value, ["schemaVersion", "parameters", "execution"]);
    ensure(value.schemaVersion === 2);
    const parameters = parseOperationParameters(value.parameters); ensure(parameters !== null);
    const execution = record(value.execution);
    keys(execution, ["schemaVersion", "context", "originalRequestHash", "nonce", "initialRevision", "updaterRequest", "bindingHash"]);
    ensure(execution.schemaVersion === 1 && execution.initialRevision === 1);
    ensure(matches(execution.originalRequestHash, hashPattern) && matches(execution.nonce, uuidPattern) && matches(execution.bindingHash, hashPattern));
    const context = parseOperationContext(execution.context); ensure(context !== null);
    validateTargetForOperation(parameters!, context!);
    const result = value as unknown as BoundOperation;
    ensure(result.execution.bindingHash === executionHash(parameters!, result.execution));
    if (["CHECK_RELEASE", "APPLY_RELEASE", "ROLLBACK_RELEASE"].includes(parameters!.operation)) validateUpdateWire(result);
    else ensure(execution.updaterRequest === null);
    return structuredClone(result);
  } catch { return null; }
}

export function readStoredOperation(raw: unknown): { parameters: OperationParameters; bound: BoundOperation | null } | null {
  const bound = parseBoundOperation(raw);
  if (bound) return { parameters: bound.parameters, bound };
  const parameters = parseOperationParameters(raw);
  return parameters ? { parameters, bound: null } : null;
}

function executionHash(parameters: OperationParameters, execution: BoundOperation["execution"]): string {
  return operationHash({ domain: "areaforge.controlled-operation.execution.v1", parameters, ...execution, bindingHash: "" });
}

function buildOperationUpdateWire(input: OperationHashInput & { actorEmail: string }, context: OperationExecutionContext): OperationUpdateWire | null {
  const operation = input.intent.operation;
  const action: OperationUpdateWire["action"] | null = operation.operation === "APPLY_RELEASE" ? "apply" : operation.operation === "ROLLBACK_RELEASE" ? "rollback" : operation.operation === "CHECK_RELEASE" ? "check" : null;
  if (!action) return null;
  const params = { tag: operation.operation === "APPLY_RELEASE" ? normalizeVersion(operation.tag, true) : null, autoApply: null };
  const target = action === "apply" ? context.target! : { releaseId: null, manifestSha256: null, manifestVersion: null, webImageDigest: null };
  const expectedBefore = context.expectedBefore;
  const envelope = {
    schemaVersion: 2 as const, id: operationUpdateWireId(input.requestedAt, input.nonce), action, status: "queued" as const,
    requestedAt: input.requestedAt, expiresAt: input.expiresAt,
    actorEmailHash: createHash("sha256").update(input.actorEmail.trim().toLowerCase()).digest("hex"),
    idempotencyKey: input.intent.idempotencyKey, params, target, expectedBefore,
    expectedBeforeHash: operationExpectedBeforeHash(expectedBefore),
    semanticHash: operationHash({ domain: "areaforge.update-request.semantic.v2", action, params, target, expectedBefore }),
  };
  return { ...envelope, requestHash: operationHash({ domain: "areaforge.update-request.v2", ...envelope }) };
}

function validateUpdateWire(bound: BoundOperation): void {
  const wire = record(bound.execution.updaterRequest);
  keys(wire, ["schemaVersion", "id", "action", "status", "requestedAt", "expiresAt", "actorEmailHash", "idempotencyKey", "params", "target", "expectedBefore", "expectedBeforeHash", "semanticHash", "requestHash"]);
  const value = wire as unknown as OperationUpdateWire;
  const action = bound.parameters.operation === "APPLY_RELEASE" ? "apply" : bound.parameters.operation === "ROLLBACK_RELEASE" ? "rollback" : "check";
  ensure(value.schemaVersion === 2 && value.action === action && value.status === "queued");
  ensure(matches(value.id, /^update_\d+_[a-f0-9-]{36}$/i) && matches(value.actorEmailHash, /^[a-f0-9]{64}$/) && matches(value.idempotencyKey, uuidPattern));
  ensure(isTimestamp(value.requestedAt) && isTimestamp(value.expiresAt));
  ensure(Date.parse(value.expiresAt) - Date.parse(value.requestedAt) === (action === "check" ? 900_000 : 300_000));
  ensure(operationCanonical(value.expectedBefore) === operationCanonical(bound.execution.context.expectedBefore));
  const params = { tag: bound.parameters.operation === "APPLY_RELEASE" ? normalizeVersion(bound.parameters.tag, true) : null, autoApply: null };
  const target = action === "apply" ? bound.execution.context.target : { releaseId: null, manifestSha256: null, manifestVersion: null, webImageDigest: null };
  ensure(operationCanonical(value.params) === operationCanonical(params) && operationCanonical(value.target) === operationCanonical(target));
  ensure(value.expectedBeforeHash === operationExpectedBeforeHash(value.expectedBefore));
  ensure(value.semanticHash === operationHash({ domain: "areaforge.update-request.semantic.v2", action, params, target, expectedBefore: value.expectedBefore }));
  const { requestHash, ...envelope } = value;
  ensure(requestHash === operationHash({ domain: "areaforge.update-request.v2", ...envelope }));
}

function validateExpectedBefore(raw: unknown): void {
  const before = record(raw);
  keys(before, ["currentVersion", "currentImage", "autoApply", "signatureRequired", "rollbackAvailable", "rollbackTargetVersion", "rollbackTargetImage", "rollbackSourceRecordSha256"]);
  ensure(matches(before.currentVersion, versionPattern) && ["none", "patch", "minor", "all"].includes(String(before.autoApply)));
  ensure(typeof before.signatureRequired === "boolean" && typeof before.rollbackAvailable === "boolean");
  ensure(before.currentImage === null || imageMatches(before.currentImage, before.currentVersion));
  if (before.rollbackAvailable) {
    ensure(matches(before.rollbackTargetVersion, versionPattern) && imageMatches(before.rollbackTargetImage, before.rollbackTargetVersion));
    ensure(matches(before.rollbackSourceRecordSha256, hashPattern));
  } else ensure(before.rollbackTargetVersion === null && before.rollbackTargetImage === null && before.rollbackSourceRecordSha256 === null);
}
function validateTarget(raw: unknown): void {
  const target = record(raw); keys(target, ["releaseId", "manifestSha256", "manifestVersion", "webImageDigest"]);
  ensure(Number.isSafeInteger(target.releaseId) && Number(target.releaseId) > 0);
  ensure(matches(target.manifestSha256, hashPattern) && matches(target.manifestVersion, versionPattern));
  ensure(imageMatches(target.webImageDigest, target.manifestVersion));
}
function validateTargetForOperation(parameters: OperationParameters, context: OperationExecutionContext): void {
  const before = context.expectedBefore;
  if (["APPLY_RELEASE", "ROLLBACK_RELEASE", "MAINTENANCE_HOLD"].includes(parameters.operation)) ensure(before.signatureRequired);
  if (parameters.operation === "APPLY_RELEASE") {
    ensure(context.target !== null && normalizeVersion(parameters.tag) === context.target.manifestVersion);
    const current = before.currentVersion.split(".").map(Number); const next = context.target!.manifestVersion.split(".").map(Number);
    const difference = next.findIndex((part, index) => part !== current[index]);
    ensure(difference >= 0 && next[difference] > current[difference]);
  }
  if (parameters.operation === "CHECK_RELEASE" && parameters.tag !== null) ensure(context.target?.manifestVersion === normalizeVersion(parameters.tag));
  if (parameters.operation === "ROLLBACK_RELEASE") ensure(before.rollbackAvailable && before.rollbackTargetVersion === parameters.targetVersion);
}
function normalizeVersion(value: string, tag = false): string { return `${tag ? "v" : ""}${value.replace(/^v/, "")}`; }
export function operationUpdateWireId(requestedAt: string, nonce: string): string { return `update_${Date.parse(requestedAt)}_${nonce}`; }
function imageMatches(image: unknown, version: unknown): boolean {
  return matches(image, imagePattern) && typeof version === "string" && (String(image).includes(`:${version}@sha256:`) || String(image).includes(`:v${version}@sha256:`));
}
function isTimestamp(value: unknown): boolean { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value; }
function matches(value: unknown, pattern: RegExp): boolean { return typeof value === "string" && value.length <= 500 && pattern.test(value); }
function record(value: unknown): Record<string, unknown> { ensure(value !== null && typeof value === "object" && !Array.isArray(value)); return value as Record<string, unknown>; }
function keys(value: Record<string, unknown>, expected: string[]): void { ensure(Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key))); }
function ensure(value: boolean): asserts value { if (!value) invalid(); }
function invalid(): never { throw new Error("CONTROLLED_OPERATION_EXECUTION_BINDING_INVALID"); }
