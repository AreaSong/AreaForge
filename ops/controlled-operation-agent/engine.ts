import path from "node:path";
import { readdir } from "node:fs/promises";
import {
  assertRootExecutionAllowed, canRecoverRootReceipt, claimRootOperation, expireRootOperation, heartbeatRootOperation, operationCanonical, operationHash,
  listRootOperationRegistrations, projectRootOperationEvent, readRootOperation, registerRootOperation, settleRootOperation,
  type BoundOperation, type OperationClaim, type OperationExecutionContext, type PrismaClient,
} from "../../packages/db/src/index";
import {
  appendOperationEvent, assertInheritedOperationLocks, ensureRootDirectory, operationJournalDirectory, readOperationJournal,
  readRootJson, rootEventProjection, writeRootJson,
  type RootOperationEvent, type RootOperationOutcome, type RootOperationPhase,
} from "./journal";
import { RootOperationNoEffectRejection, RootOperationUncertainResult } from "./result";

export interface RootOperationDriver {
  environment: "local_fixture" | "production";
  observe(): Promise<OperationExecutionContext>;
  phases(claim: OperationClaim): RootOperationPhase[];
  execute(phase: RootOperationPhase, claim: OperationClaim): Promise<string>;
}
export interface RootOperationEngineInput {
  client: PrismaClient; root: string; requestId: string; workerId: string; operatorEmail: string;
  scopeId: string; driver: RootOperationDriver; leaseMs?: number;
  checkpoint?: (point: string) => Promise<void>;
}
const effectPhases = new Set<RootOperationPhase>(["backup", "prepare", "migration", "switch", "rollback", "maintenance", "execution"]);

export async function executeRootOperation(input: RootOperationEngineInput) {
  assertInheritedOperationLocks(input.root);
  const { row, operation } = await readRootOperation(input.client, input.requestId);
  if (operation.execution.context.environment !== input.driver.environment || operation.execution.context.scopeId !== input.scopeId) throw new Error("OPS_EXECUTION_SCOPE_MISMATCH");
  const directory = operationJournalDirectory(input.root, row.requestHash);
  const history = await readOperationJournal(directory);
  verifyHistoryBinding(history, row, operation);
  const rootScopeHash = operationHash({ domain: "areaforge.controlled-operation.root-scope.v1", scopeId: input.scopeId, root: input.root });
  await registerRootOperation(input.client, row.id, rootScopeHash);
  if (await expireRootOperation(input.client, row.id)) return { status: "EXPIRED", resultCode: "REQUEST_EXPIRED", replayed: false };
  if (["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(row.status)) {
    if (row.attempt === 0 && !history.length && ["EXPIRED", "CANCELLED"].includes(row.status)) return { status: row.status, resultCode: row.resultCode, replayed: false };
    const terminal = history.at(-1);
    if (!terminal || !["terminal", "reconciliation"].includes(terminal.phase) || terminal.outcome !== row.status) throw new Error("OPS_TERMINAL_EVIDENCE_MISSING");
    return { status: row.status, replayed: false, resultCode: row.resultCode };
  }
  await assertOtherJournalsSettled(input.client, input.root, row.requestHash, input.scopeId, rootScopeHash);
  await ensureRootDirectory(directory);
  const envelope = { schemaVersion: 1, requestId: row.id, requestHash: row.requestHash, nonce: row.nonce, operation };
  if (history.length === 0) {
    try { await writeRootJson(directory, "request.json", envelope); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  if (operationCanonical(await readRootJson(path.join(directory, "request.json"))) !== operationCanonical(envelope)) throw new Error("OPS_BRIDGE_IDENTITY_MISMATCH");
  const recovery = row.status !== "QUEUED";
  const last = history.at(-1);
  const receipt = last && last.phase === "terminal" && last.state === "complete" && last.outcome
    ? { eventHash: last.eventHash, generation: last.generation, leaseTokenHash: last.leaseTokenHash } : undefined;
  const recoveringReceipt = recovery && receipt && await canRecoverRootReceipt(input.client, row, receipt);
  const claim = await claimRootOperation(input.client, { requestId: row.id, workerId: input.workerId, operatorEmail: input.operatorEmail,
    environment: input.driver.environment, scopeId: input.scopeId, leaseMs: input.leaseMs,
    ...(recoveringReceipt ? { recoveryReceipt: receipt } : {}) }, recovery);
  await input.checkpoint?.("claim:committed");
  const pulse = startHeartbeat(input, claim);
  try {
    if (history.length) {
      const last = history.at(-1)!;
      if (recoveringReceipt) return await writeBack(input, claim, last);
      if (history.some(event => event.executionAttempted) || history.some(event => event.phase === "reconciliation")) {
        return await finish(input, claim, directory, "FAILED", "NEEDS_RECONCILIATION", true);
      }
      // 无任何已启动副作用时才可重试；TTL 与当前控制状态仍由下方双检查约束。
    }
    await record(input, claim, directory, { phase: "admission", state: "complete" });
    await input.checkpoint?.("admission:complete");
    return await runPhases(input, claim, directory, pulse);
  } finally { await pulse.stop(); }
}

async function runPhases(input: RootOperationEngineInput, claim: OperationClaim, directory: string, pulse: ReturnType<typeof startHeartbeat>) {
  let attempted = false;
  let completedEffect = false;
  let finalizing = false;
  try {
    for (const phase of input.driver.phases(claim)) {
      assertInheritedOperationLocks(input.root);
      if (pulse.error) throw pulse.error;
      const control = await heartbeatRootOperation(input.client, claim, input.operatorEmail, input.leaseMs);
      if (control.status !== "RUNNING" && !(attempted && ["health", "smoke"].includes(phase))) {
        const outcome = attempted ? "FAILED" : control.status === "HELD" ? "HELD" : "CANCELLED";
        finalizing = true;
        return await finish(input, claim, directory, outcome, attempted ? "NEEDS_RECONCILIATION" : "STOP_CONFIRMED", attempted);
      }
      // 第一次校验在验证前，第二次校验紧邻首个副作用；不能仅信入队时的 snapshot。
      if (!attempted) await assertRootExecutionAllowed(input.client, claim, { operatorEmail: input.operatorEmail, liveContext: await input.driver.observe() });
      const isEffect = effectPhases.has(phase);
      await record(input, claim, directory, { phase, state: "started", executionAttempted: isEffect });
      await input.checkpoint?.(`${phase}:started`);
      if (!attempted) await assertRootExecutionAllowed(input.client, claim, { operatorEmail: input.operatorEmail, liveContext: await input.driver.observe() });
      if (pulse.error) throw pulse.error;
      attempted ||= isEffect;
      const detailHash = await input.driver.execute(phase, claim);
      completedEffect ||= isEffect;
      await input.checkpoint?.(`${phase}:effect`);
      await record(input, claim, directory, { phase, state: "complete", executionAttempted: isEffect, detailHash });
      await input.checkpoint?.(`${phase}:complete`);
    }
  } catch (error) {
    if (finalizing) throw error;
    if (!completedEffect && error instanceof RootOperationNoEffectRejection && error.requestHash === claim.request.requestHash) {
      return finish(input, claim, directory, "FAILED", error.reasonCode, false, error.evidenceHash);
    }
    if (error instanceof RootOperationUncertainResult && error.requestHash === claim.request.requestHash) {
      return finish(input, claim, directory, "FAILED", "NEEDS_RECONCILIATION", true, error.evidenceHash);
    }
    const code = error instanceof Error && /^CONTROLLED_OPERATION_[A-Z_]+$/.test(error.message) ? error.message.replace("CONTROLLED_OPERATION_", "") : "EXECUTOR_FAILED";
    if (!attempted && code === "CONTROL_PENDING") {
      const control = await heartbeatRootOperation(input.client, claim, input.operatorEmail, input.leaseMs);
      return finish(input, claim, directory, control.status === "HELD" ? "HELD" : "CANCELLED", "STOP_CONFIRMED", false);
    }
    // 副作用启动后不能用 catch/租约过期猜测失败，更不能自动重复应用。
    return await finish(input, claim, directory, "FAILED", attempted ? "NEEDS_RECONCILIATION" : code, attempted);
  }
  return finish(input, claim, directory, "SUCCEEDED", input.driver.environment === "local_fixture" ? "LOCAL_FIXTURE_COMPLETED" : "ROOT_OPERATION_COMPLETED", attempted);
}

async function finish(input: RootOperationEngineInput, claim: OperationClaim, directory: string, outcome: RootOperationOutcome, resultCode: string, attempted: boolean, detailHash?: string) {
  const event = await appendOperationEvent(directory, claim, { phase: resultCode === "NEEDS_RECONCILIATION" ? "reconciliation" : "terminal",
    state: resultCode === "NEEDS_RECONCILIATION" ? "uncertain" : "complete", executionAttempted: attempted, outcome, resultCode, detailHash });
  // 这里故意先持久化事实、后写 DB。写回失败只能恢复回执，不能重新执行动作。
  await input.checkpoint?.("terminal:durable");
  return writeBack(input, claim, event);
}
async function writeBack(input: RootOperationEngineInput, claim: OperationClaim, event: RootOperationEvent) {
  await input.checkpoint?.("writeback:before");
  const projection = rootEventProjection(event);
  try {
    await projectRootOperationEvent(input.client, claim, projection);
    const row = await settleRootOperation(input.client, claim, {
      outcome: event.outcome!, resultCode: event.resultCode, evidenceHash: projection.projectionHash, rawEvidenceHash: event.eventHash,
      retryable: event.outcome === "FAILED" && !event.executionAttempted && event.resultCode === "EXECUTOR_FAILED",
    });
    return { status: row.status, resultCode: row.resultCode, rawEvidenceHash: event.eventHash, evidenceHash: projection.projectionHash, replayed: false };
  } catch (error) {
    if (event.outcome !== "HELD" || event.executionAttempted || !(error instanceof Error) || error.message !== "CONTROLLED_OPERATION_CONTROL_CHANGED") throw error;
    const { row } = await readRootOperation(input.client, claim.request.id);
    if (row.status !== "CANCEL_REQUESTED") throw error;
    const cancelled = await appendOperationEvent(operationJournalDirectory(input.root, row.requestHash), claim,
      { phase: "terminal", state: "complete", outcome: "CANCELLED", resultCode: "STOP_CONFIRMED", detailHash: event.eventHash });
    return writeBack(input, claim, cancelled);
  }
}
async function record(input: RootOperationEngineInput, claim: OperationClaim, directory: string, data: Parameters<typeof appendOperationEvent>[2]) {
  const event = await appendOperationEvent(directory, claim, data);
  await projectRootOperationEvent(input.client, claim, rootEventProjection(event));
  return event;
}
function startHeartbeat(input: RootOperationEngineInput, claim: OperationClaim) {
  let stopped = false; let pending = Promise.resolve(); let error: Error | null = null;
  const timer = setInterval(() => {
    pending = pending.then(async () => {
      if (stopped || error) return;
      try { await heartbeatRootOperation(input.client, claim, input.operatorEmail, input.leaseMs); }
      catch { error = new Error("CONTROLLED_OPERATION_HEARTBEAT_UNCERTAIN"); }
    });
  }, Math.max(250, Math.floor((input.leaseMs ?? 30_000) / 4)));
  return { get error() { return error; }, async stop() { stopped = true; clearInterval(timer); await pending; } };
}
function verifyHistoryBinding(history: RootOperationEvent[], row: { id: string; requestHash: string; nonce: string; evidenceHash: string | null; attempt: number }, operation: BoundOperation) {
  if (history.some(event => event.requestId !== row.id || event.requestHash !== row.requestHash || event.nonce !== row.nonce
    || event.bindingHash !== operation.execution.bindingHash || event.scopeId !== operation.execution.context.scopeId
    || event.environment !== operation.execution.context.environment || event.generation > row.attempt)) throw new Error("OPS_JOURNAL_REQUEST_MISMATCH");
  if (row.evidenceHash && !history.some(event => rootEventProjection(event).projectionHash === row.evidenceHash)) throw new Error("OPS_JOURNAL_TRUNCATED");
}
async function assertOtherJournalsSettled(client: PrismaClient, root: string, requestHash: string, scopeId: string, rootScopeHash: string) {
  const registrations = await listRootOperationRegistrations(client, rootScopeHash);
  const byName = new Map(registrations.map(record => [record.requestHash.slice(7), record]));
  for (const name of new Set([...(await readdir(root)), ...byName.keys()])) {
    if (!/^[a-f0-9]{64}$/.test(name) || name === requestHash.slice(7)) continue;
    const events = await readOperationJournal(path.join(root, name)); const last = events.at(-1);
    const registration = byName.get(name); const id = registration?.requestId ?? last?.requestId;
    if (!id) throw new Error("OPS_SCOPE_RECONCILIATION_REQUIRED");
    const { row, operation } = await readRootOperation(client, id);
    if (row.requestHash.slice(7) !== name || (registration && (row.requestHash !== registration.requestHash || row.nonce !== registration.nonce))) throw new Error("OPS_ROOT_REGISTRY_INVALID");
    verifyHistoryBinding(events, row, operation);
    if (!last && row.attempt === 0 && row.workerId === null && row.leaseToken === null && row.evidenceHash === null) continue;
    if (!last || last.phase !== "terminal" || last.state !== "complete") throw new Error("OPS_SCOPE_RECONCILIATION_REQUIRED");
    if (operation.execution.context.scopeId !== scopeId || row.workerId !== null || row.leaseToken !== null
      || !["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED", "HELD"].includes(row.status)) throw new Error("OPS_SCOPE_RECONCILIATION_REQUIRED");
  }
}

export function rootOperationResultHash(value: unknown): string { return operationHash({ domain: "areaforge.controlled-operation.result.v2", value }); }
