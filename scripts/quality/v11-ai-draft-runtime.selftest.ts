import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  AI_DRAFT_RESULT_PROOF_MAX_LENGTH,
  mintAiDraftResultProof,
} from "../../packages/auth/src/index";
import { prisma } from "../../packages/db/src/index";
import { listConfirmationItems } from "../../apps/web/lib/study/confirmation-service";
import {
  acknowledgeAiDraftResult,
  clearAiDraftResultCacheForTesting,
  generateAiDraft,
  hasCachedAiDraftResultForTesting,
  handleAiDraftRequest,
  previewAiDraft,
  rejectAiDraftResult,
} from "../../apps/web/lib/study/ai-draft-service";
import { bindAiLearningTreeDraftMarkdown } from "../../apps/web/lib/client/ai-learning-tree-draft";
import { createFallbackLearningTreeDraftAdvice, type AiJsonProvider } from "../../packages/ai/src/index";
import { parseLearningTreeMarkdown } from "../../packages/core/src/learning-tree-parse";
import type { AiDraftEndpoint } from "../../packages/core/src/ai-draft";

const cases: Array<{ endpoint: AiDraftEndpoint; input: Record<string, unknown>; schemaVersion: string }> = [
  { endpoint: "learning-tree", input: { phase: "preview", selectedText: "极限与连续", scope: "subject", checkedProjection: { subjectLabel: "数学" } }, schemaVersion: "learning-tree-draft-v1" },
  { endpoint: "knowledge-card", input: { phase: "preview", selectedText: "先检查定义域", kind: "METHOD", checkedProjection: { subjectLabel: "数学" } }, schemaVersion: "knowledge-card-draft-v1" },
  { endpoint: "plan", input: { phase: "preview", selectedText: "完成极限复测", checkedProjection: { defaultDurationMinutes: 25 } }, schemaVersion: "plan-draft-v1" },
  { endpoint: "motivation", input: { phase: "preview", selectedText: "只做眼前一步", tone: "CALM" }, schemaVersion: "motivation-draft-v1" },
];
const originalFetch = globalThis.fetch;
const originalAuthSessionSecret = process.env.AUTH_SESSION_SECRET;
const originalAiEnv = readAiEnv();
let unexpectedFetchCallCount = 0;

if (!process.env.AUTH_SESSION_SECRET || process.env.AUTH_SESSION_SECRET.length < 32) {
  process.env.AUTH_SESSION_SECRET = "v11-ai-isolated-auth-session-secret-20260726";
}
disableExternalAi();
globalThis.fetch = async () => {
  unexpectedFetchCallCount += 1;
  throw new Error("unexpected network access in v1.1 AI draft isolated selftest");
};

try {
  if (process.env.AREAFORGE_V11_AI_ISOLATED_DB !== "1") throw new Error("requires AREAFORGE_V11_AI_ISOLATED_DB=1");
  const proofSecret = ["v11", "ai", "isolated", "result", "proof", "fixture", "20260726"].join("-");
  process.env.AI_PAYLOAD_BINDING_SECRET = proofSecret;
  const [{ current_database: database }] = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  if (!database.includes("v11ai")) throw new Error("refused database without v11ai marker");

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "AiDraftOperation", "ExamWorkspace", "User" RESTART IDENTITY CASCADE`);
  const user = await prisma.user.create({ data: { email: `v11ai-${randomUUID()}@example.invalid`, passwordHash: "synthetic" } });
  const foreign = await prisma.user.create({ data: { email: `v11ai-foreign-${randomUUID()}@example.invalid`, passwordHash: "synthetic" } });
  await prisma.examWorkspace.create({ data: { userId: user.id, stableKey: "ai", name: "AI", status: "ACTIVE" } });
  await prisma.examWorkspace.create({ data: { userId: foreign.id, stableKey: "foreign", name: "Foreign", status: "ACTIVE" } });
  const workspace = await prisma.examWorkspace.findFirstOrThrow({ where: { userId: user.id, status: "ACTIVE" } });

  const fallbackTree = createFallbackLearningTreeDraftAdvice({
    selectedText: "极限与连续",
    scope: "subject",
    subjectLabel: "数学",
  });
  const boundTree = bindAiLearningTreeDraftMarkdown({
    markdown: fallbackTree.markdownDraft,
    scope: "subject",
    workspaceKey: "ai",
    subjectKey: "subject_math",
  });
  assert.equal(boundTree.ok, true);
  assert.equal(boundTree.ok && parseLearningTreeMarkdown(boundTree.markdown).ok, true);
  assert.equal(
    bindAiLearningTreeDraftMarkdown({ markdown: fallbackTree.markdownDraft, scope: "branch", workspaceKey: "ai", subjectKey: "subject_math" }).ok,
    false,
  );

  for (const fixture of cases) {
    const preview = await previewAiDraft(user.id, fixture.endpoint, fixture.input);
    assert.equal(preview.endpoint, fixture.endpoint);
    assert.equal(preview.outputSchema, fixture.schemaVersion);
    assert.match(preview.note, /当前浏览器未开启外部 AI Provider/);
    assert.equal("selectionHash" in preview, false);
    assert.equal("providerPayloadHash" in preview, false);
    await assert.rejects(
      () => generateAiDraft(foreign.id, fixture.endpoint, preview.previewToken, { ...fixture.input, phase: "generate", previewToken: preview.previewToken }),
      (error: unknown) => error instanceof Error && error.message === "AI_DRAFT_TOKEN_INVALID",
    );
    await assert.rejects(
      () => generateAiDraft(user.id, fixture.endpoint, preview.previewToken, { ...fixture.input, selectedText: `${fixture.input.selectedText} tampered`, phase: "generate", previewToken: preview.previewToken }),
      (error: unknown) => error instanceof Error && error.message === "AI_DRAFT_PROJECTION_MISMATCH",
    );
    const generated = await generateAiDraft(user.id, fixture.endpoint, preview.previewToken, { ...fixture.input, phase: "generate", previewToken: preview.previewToken });
    assert.equal(generated.status, "local_rule_fallback");
    assert.equal(generated.externalCall, false);
    assert.equal((generated.draft as { schemaVersion: string }).schemaVersion, fixture.schemaVersion);
    assert.equal(generated.meta.sensitiveContextIncluded, false);
    assert.ok(generated.resultProof.startsWith("v1."));
    const beforeAck = await prisma.aiDraftOperation.findFirstOrThrow({
      where: { actorId: user.id, operationId: generated.operationId },
    });
    assert.equal(beforeAck.status, "SUCCEEDED");
    assert.equal(beforeAck.consumedAt, null);
    assert.equal(beforeAck.resultReference, `draft:${fixture.endpoint}:${generated.operationId}:${generated.status}`);
    assert.equal(beforeAck.revision, 3);
    const replayed = await generateAiDraft(user.id, fixture.endpoint, preview.previewToken, {
      ...fixture.input,
      phase: "generate",
      previewToken: preview.previewToken,
    });
    assert.deepEqual(replayed, generated);
    assert.equal(hasCachedAiDraftResultForTesting(workspace.id, generated.operationId), true);
    const acknowledged = await acknowledgeAiDraftResult(user.id, fixture.endpoint, generated.resultProof);
    assert.deepEqual(acknowledged, generated);
    assert.equal(hasCachedAiDraftResultForTesting(workspace.id, generated.operationId), false);
    await assert.rejects(
      () => generateAiDraft(user.id, fixture.endpoint, preview.previewToken, {
        ...fixture.input,
        phase: "generate",
        previewToken: preview.previewToken,
      }),
      (error: unknown) => error instanceof Error && error.message === "AI_DRAFT_OPERATION_CONSUMED",
    );
    const acknowledgedAgain = await acknowledgeAiDraftResult(user.id, fixture.endpoint, generated.resultProof);
    assert.deepEqual(acknowledgedAgain, generated);
    await assert.rejects(
      () => acknowledgeAiDraftResult(foreign.id, fixture.endpoint, generated.resultProof),
      (error: unknown) => error instanceof Error && error.message === "AI_DRAFT_RESULT_PROOF_INVALID",
    );
  }

  const rejectInput = { phase: "preview", selectedText: "驳回草稿路径", tone: "CALM" };
  const rejectPreview = await previewAiDraft(user.id, "motivation", rejectInput);
  const rejectGenerated = await generateAiDraft(
    user.id,
    "motivation",
    rejectPreview.previewToken,
    { ...rejectInput, phase: "generate", previewToken: rejectPreview.previewToken },
  );
  const rejected = await rejectAiDraftResult(user.id, "motivation", rejectGenerated.resultProof);
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.operationId, rejectGenerated.operationId);
  assert.equal(rejected.resultProof, rejectGenerated.resultProof);
  const rejectedOperation = await prisma.aiDraftOperation.findFirstOrThrow({
    where: { actorId: user.id, operationId: rejectGenerated.operationId },
  });
  assert.equal(rejectedOperation.status, "REJECTED");
  assert.equal(rejectedOperation.consumedAt !== null, true);
  assert.equal(
    rejectedOperation.resultReference,
    `draft:motivation:${rejectGenerated.operationId}:rejected`,
  );
  const rejectedAgain = await rejectAiDraftResult(user.id, "motivation", rejectGenerated.resultProof);
  assert.deepEqual(rejectedAgain, rejected);
  await assert.rejects(
    () => acknowledgeAiDraftResult(user.id, "motivation", rejectGenerated.resultProof),
    (error: unknown) => error instanceof Error && error.message === "AI_DRAFT_OPERATION_CONFLICT",
  );
  const routedRejected = await handleAiDraftRequest(user.id, "motivation", {
    phase: "reject",
    resultProof: rejectGenerated.resultProof,
  });
  assert.deepEqual(routedRejected, rejected);
  const pendingAfterReject = await listConfirmationItems(user.id, "pending");
  const historyAfterReject = await listConfirmationItems(user.id, "history");
  const rejectedConfirmation = historyAfterReject.find((item) => item.sourceId === rejectGenerated.operationId);
  assert.ok(rejectedConfirmation);
  assert.equal(rejectedConfirmation.status, "REJECTED");
  assert.equal(rejectedConfirmation.frozenAt !== null, true);
  assert.equal(rejectedConfirmation.confirmedAt, null);
  assert.equal(rejectedConfirmation.href, `/confirmations/${rejectGenerated.operationId}`);
  assert.equal(rejectedConfirmation.sourceHref, "/settings/profile");
  assert.equal(rejectedConfirmation.sourceLabel, "AI 建议 · 动机内容");
  assert.equal(pendingAfterReject.some((item) => item.sourceId === rejectGenerated.operationId), false);
  process.env.AI_ENABLED = "true";
  await prisma.aiRuntimeSetting.upsert({
    where: { id: "global" },
    update: { enabled: true },
    create: { id: "global", enabled: true },
  });
  process.env.AI_ALLOW_SENSITIVE_CONTEXT = "false";
  let providerCallCount = 0;
  const provider: AiJsonProvider = {
    externalCall: true,
    async generateJson() {
      providerCallCount += 1;
      return {
        schemaVersion: "motivation-draft-v1",
        line: "先做眼前一步。",
        recoveryHint: "只启动五分钟，然后回到真实学习行动。",
        reason: "显式测试 provider 防重放。",
      };
    },
  };
  const providerInput = { phase: "preview", selectedText: "先开始五分钟", tone: "CALM" };
  const providerPreview = await previewAiDraft(user.id, "motivation", providerInput, {
    allowExternalProvider: true,
  });
  const providerGenerateBody = {
    ...providerInput,
    phase: "generate",
    previewToken: providerPreview.previewToken,
  };
  const providerGenerated = await generateAiDraft(
    user.id,
    "motivation",
    providerPreview.previewToken,
    providerGenerateBody,
    { allowExternalProvider: true, provider },
  );
  const providerReplayed = await generateAiDraft(
    user.id,
    "motivation",
    providerPreview.previewToken,
    providerGenerateBody,
    { allowExternalProvider: true, provider },
  );
  assert.deepEqual(providerReplayed, providerGenerated);
  assert.equal(providerCallCount, 1);
  clearAiDraftResultCacheForTesting();
  await assert.rejects(
    () => generateAiDraft(
      user.id,
      "motivation",
      providerPreview.previewToken,
      providerGenerateBody,
      { allowExternalProvider: true, provider },
    ),
    (error: unknown) => error instanceof Error && error.message === "AI_DRAFT_RESULT_UNAVAILABLE",
  );
  assert.equal(providerCallCount, 1);

  const [providerAcknowledged, providerConcurrentReplay] = await Promise.all([
    acknowledgeAiDraftResult(user.id, "motivation", providerGenerated.resultProof),
    acknowledgeAiDraftResult(user.id, "motivation", providerGenerated.resultProof),
  ]);
  assert.deepEqual(providerAcknowledged, providerGenerated);
  assert.deepEqual(providerConcurrentReplay, providerGenerated);
  assert.equal(providerCallCount, 1);
  await assert.rejects(
    () => generateAiDraft(
      user.id,
      "motivation",
      providerPreview.previewToken,
      providerGenerateBody,
      { allowExternalProvider: true, provider },
    ),
    (error: unknown) => error instanceof Error && error.message === "AI_DRAFT_OPERATION_CONSUMED",
  );
  assert.equal(providerCallCount, 1);
  await assert.rejects(
    () => acknowledgeAiDraftResult(user.id, "motivation", tamperProof(providerGenerated.resultProof)),
    (error: unknown) => error instanceof Error && error.message === "AI_DRAFT_RESULT_PROOF_INVALID",
  );

  const guardedFetch = globalThis.fetch;
  const guardedAiEnv = readAiEnv();
  let defaultProviderCallCount = 0;
  try {
    process.env.AI_ENABLED = "true";
    process.env.AI_BASE_URL = "https://provider.example.invalid/v1";
    process.env.AI_API_KEY = "isolated-provider-key";
    process.env.AI_MODEL = "isolated-model";
    process.env.AI_MAX_RETRIES = "5";
    process.env.AI_TIMEOUT_MS = "60000";
    globalThis.fetch = async () => {
      defaultProviderCallCount += 1;
      return new Response(JSON.stringify({ error: "synthetic failure" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    };
    const noRetryPreview = await previewAiDraft(user.id, "motivation", {
      phase: "preview",
      selectedText: "默认 provider 不可重试",
      tone: "DIRECT",
    }, { allowExternalProvider: true });
    const noRetryGenerated = await generateAiDraft(
      user.id,
      "motivation",
      noRetryPreview.previewToken,
      {
        phase: "generate",
        selectedText: "默认 provider 不可重试",
        tone: "DIRECT",
        previewToken: noRetryPreview.previewToken,
      },
      { allowExternalProvider: true },
    );
    assert.equal(noRetryGenerated.status, "ai_error_fallback");
    assert.equal(noRetryGenerated.externalCall, true);
    assert.equal(defaultProviderCallCount, 1);
    await acknowledgeAiDraftResult(user.id, "motivation", noRetryGenerated.resultProof);
  } finally {
    globalThis.fetch = guardedFetch;
    restoreEnv(guardedAiEnv);
  }

  const expiredOperationId = randomUUID();
  const largeProofOperationId = randomUUID();
  const largeResultProof = mintAiDraftResultProof({
    actorId: user.id,
    workspaceId: workspace.id,
    endpoint: "learning-tree",
    operationId: largeProofOperationId,
    projectionVersion: "learning-tree-input-v1",
    outputSchema: "learning-tree-draft-v1",
    status: "local_rule_fallback",
    externalCall: false,
    draft: {
      status: "local_rule_fallback",
      schemaVersion: "learning-tree-draft-v1",
      markdownDraft: "\ud800".repeat(32_000),
      notes: [],
      reason: "验证合法上限输出的 proof 可以显式确认。",
    },
    meta: { reason: "large-proof", sensitiveContextIncluded: false },
  }, proofSecret).token;
  assert.ok(largeResultProof.length > 256_000);
  assert.ok(largeResultProof.length <= AI_DRAFT_RESULT_PROOF_MAX_LENGTH);
  await prisma.aiDraftOperation.create({
    data: {
      operationId: largeProofOperationId,
      actorId: user.id,
      workspaceId: workspace.id,
      endpoint: "learning-tree",
      purpose: "preview:v1",
      requestFingerprint: "isolated-large-proof-fingerprint",
      nonce: randomUUID(),
      projectionVersion: "learning-tree-input-v1",
      status: "SUCCEEDED",
      resultReference: `draft:learning-tree:${largeProofOperationId}:local_rule_fallback`,
      expiresAt: new Date(Date.now() + 60_000),
      revision: 3,
    },
  });
  const largeProofAcknowledged = await handleAiDraftRequest(user.id, "learning-tree", {
    phase: "ack",
    resultProof: largeResultProof,
  });
  assert.equal(largeProofAcknowledged.phase, "generate");
  assert.equal(largeProofAcknowledged.operationId, largeProofOperationId);

  await prisma.aiDraftOperation.create({
    data: {
      operationId: expiredOperationId,
      actorId: user.id,
      workspaceId: workspace.id,
      endpoint: "plan",
      purpose: "preview:v1",
      requestFingerprint: "isolated-expired-proof-fingerprint",
      nonce: randomUUID(),
      projectionVersion: "plan-projection-v1",
      status: "IN_FLIGHT",
      expiresAt: new Date(Date.now() - 60_000),
      revision: 2,
    },
  });
  const expiredProof = mintAiDraftResultProof({
    actorId: user.id,
    workspaceId: workspace.id,
    endpoint: "plan",
    operationId: expiredOperationId,
    projectionVersion: "plan-projection-v1",
    outputSchema: "plan-draft-v1",
    status: "local_rule_fallback",
    externalCall: false,
    draft: {
      status: "local_rule_fallback",
      schemaVersion: "plan-draft-v1",
      title: "Expired proof fixture",
      tasks: [{ title: "Expired task", estimatedMinutes: 25 }],
      reason: "Expired runtime proof fixture.",
    },
    meta: { reason: "expired", sensitiveContextIncluded: false },
    now: Date.now() - 10_000,
    ttlMs: 1,
  }, proofSecret).token;
  await assert.rejects(
    () => acknowledgeAiDraftResult(user.id, "plan", expiredProof),
    (error: unknown) => error instanceof Error && error.message === "AI_DRAFT_RESULT_PROOF_INVALID",
  );

  const expiredPendingId = randomUUID();
  await prisma.aiDraftOperation.create({
    data: {
      operationId: expiredPendingId,
      actorId: user.id,
      workspaceId: workspace.id,
      endpoint: "knowledge-card",
      purpose: "preview:v1",
      requestFingerprint: "isolated-expired-pending-fingerprint",
      nonce: randomUUID(),
      projectionVersion: "knowledge-card-projection-v1",
      status: "PENDING",
      expiresAt: new Date(Date.now() - 60_000),
    },
  });
  const staleWorkerPreview = await previewAiDraft(user.id, "motivation", {
    phase: "preview",
    selectedText: "验证迟到 worker 无法覆盖 stale claim",
    tone: "BRIEF",
  }, { allowExternalProvider: true });
  let releaseProvider!: () => void;
  let markProviderStarted!: () => void;
  const providerGate = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  const providerStarted = new Promise<void>((resolve) => {
    markProviderStarted = resolve;
  });
  let staleWorkerProviderCalls = 0;
  const staleWorkerProvider: AiJsonProvider = {
    externalCall: true,
    async generateJson() {
      staleWorkerProviderCalls += 1;
      markProviderStarted();
      await providerGate;
      return {
        schemaVersion: "motivation-draft-v1",
        line: "迟到结果不得提交。",
        recoveryHint: "创建新 preview 后再显式生成。",
        reason: "stale worker CAS fixture",
      };
    },
  };
  const staleWorkerGeneration = generateAiDraft(
    user.id,
    "motivation",
    staleWorkerPreview.previewToken,
    {
      phase: "generate",
      selectedText: "验证迟到 worker 无法覆盖 stale claim",
      tone: "BRIEF",
      previewToken: staleWorkerPreview.previewToken,
    },
    { allowExternalProvider: true, provider: staleWorkerProvider },
  );
  await providerStarted;
  const staleClaimUpdates = await prisma.$executeRaw`
    UPDATE "AiDraftOperation"
    SET "updatedAt" = ${new Date(Date.now() - 120_000)}
    WHERE "workspaceId" = ${workspace.id}
      AND "operationId" = ${staleWorkerPreview.operationId}
  `;
  assert.equal(staleClaimUpdates, 1);
  const cleanupPreview = await previewAiDraft(user.id, "motivation", {
    phase: "preview",
    selectedText: "触发过期 operation 清理",
    tone: "BRIEF",
  });
  await prisma.aiDraftOperation.delete({
    where: {
      workspaceId_operationId: {
        workspaceId: workspace.id,
        operationId: cleanupPreview.operationId,
      },
    },
  });
  releaseProvider();
  await assert.rejects(
    staleWorkerGeneration,
    (error: unknown) => error instanceof Error && error.message === "AI_DRAFT_OPERATION_CONFLICT",
  );
  assert.equal(staleWorkerProviderCalls, 1);
  assert.equal(hasCachedAiDraftResultForTesting(workspace.id, staleWorkerPreview.operationId), false);
  await assert.rejects(
    () => generateAiDraft(
      user.id,
      "motivation",
      staleWorkerPreview.previewToken,
      {
        phase: "generate",
        selectedText: "验证迟到 worker 无法覆盖 stale claim",
        tone: "BRIEF",
        previewToken: staleWorkerPreview.previewToken,
      },
      { allowExternalProvider: true, provider: staleWorkerProvider },
    ),
    (error: unknown) => error instanceof Error && error.message === "AI_DRAFT_RESULT_UNAVAILABLE",
  );
  assert.equal(staleWorkerProviderCalls, 1);

  const inFlightProof = mintAiDraftResultProof({
    actorId: user.id,
    workspaceId: workspace.id,
    endpoint: "plan",
    operationId: expiredOperationId,
    projectionVersion: "plan-projection-v1",
    outputSchema: "plan-draft-v1",
    status: "local_rule_fallback",
    externalCall: false,
    draft: {
      status: "local_rule_fallback",
      schemaVersion: "plan-draft-v1",
      title: "In-flight proof fixture",
      tasks: [{ title: "In-flight task", estimatedMinutes: 25 }],
      reason: "ACK must not finalize an in-flight operation.",
    },
    meta: { reason: "in-flight", sensitiveContextIncluded: false },
  }, proofSecret).token;
  await assert.rejects(
    () => acknowledgeAiDraftResult(user.id, "plan", inFlightProof),
    (error: unknown) => error instanceof Error && error.message === "AI_DRAFT_OPERATION_CONFLICT",
  );

  const operations = await prisma.aiDraftOperation.findMany({ orderBy: { createdAt: "asc" } });
  assert.equal(operations.length, cases.length + 7);
  const successfulOperations = operations.filter((operation) => operation.status === "SUCCEEDED");
  assert.equal(successfulOperations.length, cases.length + 3);
  assert.ok(successfulOperations.every((operation) => operation.status === "SUCCEEDED" && operation.consumedAt));
  assert.ok(successfulOperations.every((operation) => operation.resultReference?.startsWith("draft:")));
  const expiredOperation = operations.find((operation) => operation.operationId === expiredOperationId);
  assert.equal(expiredOperation?.status, "IN_FLIGHT");
  assert.equal(expiredOperation?.revision, 2);
  const expiredPending = operations.find((operation) => operation.operationId === expiredPendingId);
  assert.equal(expiredPending?.status, "EXPIRED");
  assert.equal(expiredPending?.revision, 2);
  const staleWorker = operations.find((operation) => operation.operationId === staleWorkerPreview.operationId);
  assert.equal(staleWorker?.status, "FAILED");
  assert.equal(staleWorker?.revision, 3);
  assert.equal(staleWorker?.resultReference, "error:result-unavailable:v1");
  const persistedOperations = JSON.stringify(operations);
  assert.equal(persistedOperations.includes("极限与连续"), false);
  assert.equal(persistedOperations.includes(providerGenerated.resultProof), false);
  assert.equal(persistedOperations.includes(largeResultProof), false);
  assert.equal(persistedOperations.includes("\\ud800".repeat(100)), false);
  assert.equal(unexpectedFetchCallCount, 0);
  console.log(JSON.stringify({
    schemaVersion: "v11-ai-draft-runtime-selftest-v1",
    status: "pass",
    database,
    checks: {
      fourExplicitPurposes: "pass",
      actorWorkspaceBinding: "pass",
      payloadTamperRejected: "pass",
      localFallbackNoProviderCall: "pass",
      successfulReplayReturnsSameSchema: "pass",
      successPersistedBeforeAck: "pass",
      cacheEvictedAfterAck: "pass",
      consumedGenerateRejected: "pass",
      cacheLossNeverRepeatsProvider: "pass",
      expiredPendingClosed: "pass",
      previewExpiryDoesNotRevokeActiveClaim: "pass",
      staleClaimLateWorkerRejected: "pass",
      providerReplayCallCount: providerCallCount,
      defaultProviderNoRetryCallCount: defaultProviderCallCount,
      unexpectedFetchCallCount,
      largeValidProofAck: "pass",
      resultProofAckRebuild: "pass",
      concurrentAckIdempotency: "pass",
      tamperedCrossActorExpiredProofRejected: "pass",
      digestAndContentNotPersisted: "pass",
      learningTreeDraftCanonicalBinding: "pass",
      rejectedConfirmationProjection: "pass",
    },
  }, null, 2));
  console.log("PASS v1.1 AI draft isolated PostgreSQL runtime selftest");
} finally {
  try {
    await prisma.$disconnect();
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(originalAiEnv);
    if (originalAuthSessionSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = originalAuthSessionSecret;
  }
}

function tamperProof(proof: string): string {
  return `${proof.slice(0, -1)}${proof.endsWith("A") ? "B" : "A"}`;
}

function restoreEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function readAiEnv(): Record<string, string | undefined> {
  return {
    AI_ENABLED: process.env.AI_ENABLED,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
    AI_MAX_RETRIES: process.env.AI_MAX_RETRIES,
    AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
    AI_ALLOW_SENSITIVE_CONTEXT: process.env.AI_ALLOW_SENSITIVE_CONTEXT,
    AI_PAYLOAD_BINDING_SECRET: process.env.AI_PAYLOAD_BINDING_SECRET,
  };
}

function disableExternalAi(): void {
  process.env.AI_ENABLED = "false";
  delete process.env.AI_BASE_URL;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  process.env.AI_MAX_RETRIES = "0";
  process.env.AI_TIMEOUT_MS = "30000";
  process.env.AI_ALLOW_SENSITIVE_CONTEXT = "false";
}
