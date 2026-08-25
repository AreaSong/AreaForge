import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createQuickReviewActivityRuntime,
  type QuickReviewActivityEnvironment,
} from "../../apps/web/lib/client/quick-review-activity-runtime";
import {
  QUICK_REVIEW_CLAIM_TTL_MS,
  createQuickReviewActivityClaim,
  createQuickReviewCommandReceipt,
  parseQuickReviewActivityClaim,
  quickReviewActivityIdentityMatches,
  type QuickReviewCommandMessage,
} from "../../apps/web/lib/client/quick-review-activity-protocol";
import {
  applyQuickReviewDraftCommand,
  bindQuickReviewDraftToSchedule,
  compareAndSwapQuickReviewDraft,
  createQuickReviewDraft,
  createQuickReviewDraftIfAbsent,
  quickReviewElapsedAt,
  readStoredQuickReviewDraft,
  resumeQuickReviewDraft,
  suspendQuickReviewDraft,
  upgradeQuickReviewDraftStorage,
  type QuickReviewDraftStorage,
} from "../../apps/web/lib/client/quick-review-draft";

const CLAIM_PREFIX = "af.quick-review.activity.v2.";

class ManualClock {
  now = 1_000_000;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; delay: number; repeat: boolean; callback: () => void }>();

  setTimeout(callback: () => void, delay: number): number {
    return this.addTask(callback, delay, false);
  }

  setInterval(callback: () => void, delay: number): number {
    return this.addTask(callback, delay, true);
  }

  clear(handle: unknown): void {
    this.tasks.delete(Number(handle));
  }

  advance(ms: number): void {
    const target = this.now + ms;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!next) break;
      const [id, task] = next;
      this.now = task.at;
      if (task.repeat) task.at += task.delay;
      else this.tasks.delete(id);
      task.callback();
    }
    this.now = target;
  }

  jumpWithoutTimers(ms: number): void {
    this.now += ms;
  }

  runThrottledTimersOnce(): void {
    const due = [...this.tasks.entries()].filter(([, task]) => task.at <= this.now);
    for (const [id, task] of due) {
      if (task.repeat) task.at = this.now + task.delay;
      else this.tasks.delete(id);
      task.callback();
    }
  }

  private addTask(callback: () => void, delay: number, repeat: boolean): number {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + delay, delay, repeat, callback });
    return id;
  }
}

class FakeBrowserWorld {
  readonly data = new Map<string, string>();
  readonly published: unknown[] = [];
  readonly writes = new Map<string, number>();
  private readonly claimListeners = new Map<string, Set<() => void>>();
  private readonly messageListeners = new Map<string, Set<(message: unknown) => void>>();
  private readonly heldLocks = new Set<string>();
  private readonly lockQueues = new Map<string, Array<() => void>>();
  private nextUuid = 1;

  constructor(readonly clock: ManualClock) {}

  environment(pageName: string, withLocks = true): QuickReviewActivityEnvironment {
    return {
      localStorage: this.storage(pageName),
      now: () => this.clock.now,
      randomUUID: () => `${pageName}-uuid-${this.nextUuid++}`,
      setInterval: (callback, delay) => this.clock.setInterval(callback, delay),
      clearInterval: (handle) => this.clock.clear(handle),
      setTimeout: (callback, delay) => this.clock.setTimeout(callback, delay),
      clearTimeout: (handle) => this.clock.clear(handle),
      requestExclusiveLock: withLocks
        ? (name, options, callback) => this.requestLock(name, options.ifAvailable, callback)
        : undefined,
      subscribeClaimChanges: (userId, listener) => this.subscribe(
        this.claimListeners,
        `${pageName}:${userId}`,
        listener,
      ),
      notifyClaimChange: (userId) => this.emit(this.claimListeners, `${pageName}:${userId}`),
      subscribeMessages: (userId, listener) => this.subscribe(this.messageListeners, userId, listener),
      publishMessage: (userId, message) => {
        this.published.push(message);
        this.emit(this.messageListeners, userId, message);
      },
    };
  }

  storage(pageName: string): QuickReviewDraftStorage {
    const data = this.data;
    return {
      get length() { return data.size; },
      key: (index) => [...data.keys()][index] ?? null,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
        this.writes.set(key, (this.writes.get(key) ?? 0) + 1);
        this.emitOtherClaimPages(pageName, key);
      },
      removeItem: (key) => {
        const existed = data.delete(key);
        if (existed) {
          this.writes.set(key, (this.writes.get(key) ?? 0) + 1);
          this.emitOtherClaimPages(pageName, key);
        }
      },
    };
  }

  private requestLock(
    name: string,
    ifAvailable: boolean,
    callback: (acquired: boolean) => Promise<void>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const run = () => {
        this.heldLocks.add(name);
        void callback(true).then(() => {
          this.heldLocks.delete(name);
          resolve();
          this.grantNext(name);
        }, (error) => {
          this.heldLocks.delete(name);
          reject(error);
          this.grantNext(name);
        });
      };
      if (!this.heldLocks.has(name)) {
        run();
        return;
      }
      if (ifAvailable) {
        void callback(false).then(resolve, reject);
        return;
      }
      const queue = this.lockQueues.get(name) ?? [];
      queue.push(run);
      this.lockQueues.set(name, queue);
    });
  }

  private grantNext(name: string): void {
    const queue = this.lockQueues.get(name);
    const next = queue?.shift();
    if (!queue?.length) this.lockQueues.delete(name);
    next?.();
  }

  private subscribe<T>(registry: Map<string, Set<T>>, key: string, listener: T): () => void {
    const listeners = registry.get(key) ?? new Set<T>();
    listeners.add(listener);
    registry.set(key, listeners);
    return () => listeners.delete(listener);
  }

  private emit<T>(registry: Map<string, Set<T>>, key: string, value?: unknown): void {
    for (const listener of registry.get(key) ?? []) {
      (listener as (...args: unknown[]) => void)(...(value === undefined ? [] : [value]));
    }
  }

  private emitOtherClaimPages(writerPage: string, key: string): void {
    if (!key.startsWith(CLAIM_PREFIX)) return;
    const userId = key.slice(CLAIM_PREFIX.length);
    for (const listenerKey of this.claimListeners.keys()) {
      if (listenerKey !== `${writerPage}:${userId}` && listenerKey.endsWith(`:${userId}`)) {
        this.emit(this.claimListeners, listenerKey);
      }
    }
  }
}

async function flushLockRelease(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const clock = new ManualClock();
const world = new FakeBrowserWorld(clock);
const envA = world.environment("page-a");
const envB = world.environment("page-b");
const envC = world.environment("page-c");
const runtimeA = createQuickReviewActivityRuntime(envA);
const runtimeB = createQuickReviewActivityRuntime(envB);
const runtimeC = createQuickReviewActivityRuntime(envC);

// A duplicated tab may clone sessionStorage, but identity now lives only in each JS realm.
assert.notEqual(runtimeA.getPageInstanceId(), runtimeB.getPageInstanceId());
assert.equal(runtimeA.getPageInstanceId(), runtimeA.getPageInstanceId());

const canonical = createQuickReviewActivityClaim({
  userId: "user-protocol",
  scheduleId: "schedule-1",
  draftId: "draft-1",
  ownerPageId: "page-a",
  leaseId: "lease-1",
  now: clock.now,
});
assert.deepEqual(parseQuickReviewActivityClaim(canonical, "user-protocol", clock.now), canonical);
assert.equal(parseQuickReviewActivityClaim({ ...canonical, draftId: "" }, "user-protocol", clock.now), null);
assert.equal(parseQuickReviewActivityClaim({ ...canonical, href: "https://example.invalid" }, "user-protocol", clock.now), null);
assert.ok(parseQuickReviewActivityClaim(canonical, "user-protocol", clock.now + QUICK_REVIEW_CLAIM_TTL_MS));
assert.equal(parseQuickReviewActivityClaim(canonical, "user-protocol", clock.now + QUICK_REVIEW_CLAIM_TTL_MS + 1), null);

const noLockRuntime = createQuickReviewActivityRuntime(world.environment("page-no-lock", false));
assert.equal(await noLockRuntime.acquireActivity({ userId: "user-no-lock", scheduleId: "schedule-1", draftId: "draft-1" }), null);
assert.equal(await noLockRuntime.acquireDraftWriter({ userId: "user-no-lock", scheduleId: "schedule-1" }), null);
assert.equal(await noLockRuntime.acquireBarrier("user-no-lock"), null);
assert.equal(await noLockRuntime.tryAcquireBarrier("user-no-lock"), null);

// First open and all later writes are serialized by a per-schedule draft writer lock.
const writerA = await runtimeA.acquireDraftWriter({ userId: "user-draft", scheduleId: "schedule-1" });
assert.ok(writerA);
assert.equal(await runtimeB.acquireDraftWriter({ userId: "user-draft", scheduleId: "schedule-1" }), null);
const storageA = world.storage("page-a");
const initial = createQuickReviewDraft("user-draft", { id: "schedule-1", revision: 3, targetType: "NOTE" }, clock.now);
const firstCreate = createQuickReviewDraftIfAbsent(initial, storageA, clock.now);
assert.equal(firstCreate.created, true);
writerA.release();
await flushLockRelease();
const writerB = await runtimeB.acquireDraftWriter({ userId: "user-draft", scheduleId: "schedule-1" });
assert.ok(writerB);
const losingCreate = createQuickReviewDraftIfAbsent(
  createQuickReviewDraft("user-draft", { id: "schedule-1", revision: 3, targetType: "NOTE" }, clock.now),
  world.storage("page-b"),
  clock.now,
);
assert.equal(losingCreate.created, false);
assert.equal(losingCreate.draft.draftId, firstCreate.draft.draftId);

const edited = compareAndSwapQuickReviewDraft(firstCreate.draft, { ...firstCreate.draft, note: "owner edit" }, storageA, clock.now);
assert.ok(edited.ok);
const staleWrite = compareAndSwapQuickReviewDraft(firstCreate.draft, { ...firstCreate.draft, note: "stale overwrite" }, storageA, clock.now);
assert.equal(staleWrite.ok, false);
assert.equal(readStoredQuickReviewDraft("user-draft", "schedule-1", null, storageA, clock.now)?.note, "owner edit");
writerB.release();

// Legacy v2 suspension must retain unknown server revision until the real schedule is loaded.
const legacyStorage = world.storage("legacy-page");
legacyStorage.setItem("areaforge.quick-review.v2.user-legacy.schedule-1", JSON.stringify({
  version: 2,
  userId: "user-legacy",
  scheduleId: "schedule-1",
  createdAt: clock.now,
  updatedAt: clock.now,
  idempotencyKey: "legacy-command",
  elapsedSeconds: 8,
  runningSince: clock.now,
  suspended: false,
  result: "PARTIAL",
  nextDueDate: "",
  note: "legacy",
  answerMode: "TEXT",
  answerText: "answer",
  paperOrOralCompleted: false,
  revealed: true,
}));
const legacy = readStoredQuickReviewDraft("user-legacy", "schedule-1", null, legacyStorage, clock.now);
assert.ok(legacy);
assert.equal(legacy.baseRevision, null);
const legacySuspended = applyQuickReviewDraftCommand({
  userId: "user-legacy",
  scheduleId: "schedule-1",
  draftId: legacy.draftId,
  action: "suspend",
  now: clock.now,
}, legacyStorage);
assert.ok(legacySuspended.ok && legacySuspended.draft);
assert.equal(legacySuspended.draft.baseRevision, null);
const rebound = bindQuickReviewDraftToSchedule(
  legacySuspended.draft,
  { id: "schedule-1", revision: 7, targetType: "NOTE" },
  legacyStorage,
  clock.now,
);
assert.ok(rebound.ok);
assert.equal(rebound.draft.baseRevision, 7);
assert.notEqual(rebound.draft.idempotencyKey, "legacy-command");

legacyStorage.setItem("areaforge.quick-review.v2.user-v3.schedule-1", JSON.stringify({
  ...rebound.draft,
  version: 3,
  userId: "user-v3",
  draftId: undefined,
  draftRevision: undefined,
  baseRevision: 4,
}));
const legacyV3 = readStoredQuickReviewDraft("user-v3", "schedule-1", null, legacyStorage, clock.now);
assert.ok(legacyV3);
assert.equal(legacyV3.draftRevision, 0);
const upgradedV3 = upgradeQuickReviewDraftStorage(legacyV3, legacyStorage, clock.now);
assert.ok(upgradedV3.ok);
assert.equal(upgradedV3.draft.draftRevision, 1);

// Receipt is published while the owner still holds the activity lock; receipt alone cannot run the operation.
const commandWriter = await runtimeA.acquireDraftWriter({ userId: "user-command", scheduleId: "schedule-1" });
assert.ok(commandWriter);
const commandDraft = createQuickReviewDraft("user-command", { id: "schedule-1", revision: 2, targetType: "NOTE" }, clock.now);
const storedCommandDraft = createQuickReviewDraftIfAbsent(commandDraft, storageA, clock.now).draft;
const runningCommandDraft = compareAndSwapQuickReviewDraft(
  storedCommandDraft,
  resumeQuickReviewDraft(storedCommandDraft, clock.now),
  storageA,
  clock.now,
);
assert.ok(runningCommandDraft.ok);
clock.advance(2_500);
assert.equal(quickReviewElapsedAt(runningCommandDraft.draft, clock.now), 2);
const commandLease = await runtimeA.acquireActivity({
  userId: "user-command",
  scheduleId: "schedule-1",
  draftId: runningCommandDraft.draft.draftId,
});
assert.ok(commandLease);
let receiptPublished = false;
const unsubscribeCommand = runtimeA.subscribeCommands({
  userId: "user-command",
  ownerPageId: runtimeA.getPageInstanceId(),
  onCommand(command) {
    if (!quickReviewActivityIdentityMatches(commandLease.claim, command)) return null;
    if (!commandLease.markReleasing(command.commandId, command.action)) return null;
    const applied = applyQuickReviewDraftCommand({
      userId: command.userId,
      scheduleId: command.scheduleId,
      draftId: command.draftId,
      action: command.action,
      now: clock.now,
    }, storageA);
    if (!applied.ok) return null;
    return {
      draftRevision: applied.draftRevision,
      afterReceiptPublished() { receiptPublished = true; },
    };
  },
});
const queuedBarrier = runtimeB.acquireBarrier("user-command");
let barrierOwned = false;
void queuedBarrier.then((lease) => { barrierOwned = Boolean(lease); });
const receipt = await runtimeB.requestCommand(commandLease.claim, "suspend");
assert.ok(receipt);
assert.equal(receiptPublished, true);
await Promise.resolve();
assert.equal(barrierOwned, false);
commandLease.release();
const barrier = await queuedBarrier;
assert.ok(barrier);
barrierOwned = true;
assert.equal(barrierOwned, true);
assert.equal(await runtimeC.acquireActivity({
  userId: "user-command",
  scheduleId: "schedule-2",
  draftId: "draft-2",
}), null);
barrier.release();
await flushLockRelease();
const afterBarrier = await runtimeC.acquireActivity({
  userId: "user-command",
  scheduleId: "schedule-2",
  draftId: "draft-2",
});
assert.ok(afterBarrier);
afterBarrier.release();
commandWriter.release();
unsubscribeCommand();

// Wrong action/identity receipts never satisfy the exact command and time out fail-closed.
const timeoutLease = await runtimeA.acquireActivity({
  userId: "user-timeout",
  scheduleId: "schedule-1",
  draftId: "draft-timeout",
});
assert.ok(timeoutLease);
const timeoutPromise = runtimeB.requestCommand(timeoutLease.claim, "suspend");
const sentCommand = [...world.published].reverse().find((value) => (
  value as { type?: unknown; userId?: unknown }
).type === "command" && (value as { userId?: unknown }).userId === "user-timeout") as QuickReviewCommandMessage;
assert.ok(sentCommand);
envB.publishMessage("user-timeout", {
  ...createQuickReviewCommandReceipt(sentCommand, null, clock.now),
  action: "discard",
});
clock.advance(4_000);
assert.equal(await timeoutPromise, null);
timeoutLease.release();

// Heartbeat claims remain advisory: expiration may hide a claim, but the held Web Lock still rejects a contender.
const throttledLease = await runtimeA.acquireActivity({
  userId: "user-throttled",
  scheduleId: "schedule-1",
  draftId: "draft-throttled",
});
assert.ok(throttledLease);
clock.jumpWithoutTimers(QUICK_REVIEW_CLAIM_TTL_MS + 1);
assert.equal(runtimeB.readActiveClaim("user-throttled"), null);
assert.equal(runtimeB.readHandoffClaim("user-throttled")?.leaseId, throttledLease.claim.leaseId);
assert.equal(await runtimeB.acquireActivity({
  userId: "user-throttled",
  scheduleId: "schedule-2",
  draftId: "draft-2",
}), null);
clock.runThrottledTimersOnce();
throttledLease.release();

// Static guards cover the React wiring that the pure runtime selftest cannot mount.
const quickReviewClientSource = readFileSync("apps/web/components/quick-review-client.tsx", "utf8");
const quickReviewDraftRuntimeSource = readFileSync(
  "apps/web/components/quick-review-draft-runtime.ts",
  "utf8",
);
const guardSource = readFileSync("apps/web/components/quick-review-activity-guard.tsx", "utf8");
const activitySource = readFileSync("apps/web/lib/client/quick-review-activity.ts", "utf8");
const activityRuntimeSource = readFileSync(
  "apps/web/lib/client/quick-review-activity-runtime.ts",
  "utf8",
);
const focusSessionSource = readFileSync("apps/web/components/focus-session-client.tsx", "utf8");
const focusSessionCommandSource = readFileSync("apps/web/components/focus-session-command.ts", "utf8");
const focusSessionEffectsSource = readFileSync("apps/web/components/focus-session-effects.ts", "utf8");
const focusSessionBehaviorSource = `${focusSessionSource}\n${focusSessionCommandSource}\n${focusSessionEffectsSource}`;
const focusSessionDraftSource = readFileSync("apps/web/components/focus-session-draft.ts", "utf8");
const focusPanelsSource = readFileSync("apps/web/components/focus-session-panels.tsx", "utf8");
const focusEvidenceFormsSource = readFileSync("apps/web/components/focus-evidence-forms.tsx", "utf8");
const focusEvidenceClientSource = readFileSync("apps/web/lib/client/focus-evidence.ts", "utf8");
const reviewScheduleAdapterSource = readFileSync("apps/web/lib/api/review-schedule.ts", "utf8");
const noteAdapterSource = readFileSync("apps/web/lib/api/notes.ts", "utf8");
const mistakeAdapterSource = readFileSync("apps/web/lib/api/mistakes.ts", "utf8");
const sessionAdapterSource = readFileSync("apps/web/lib/api/session.ts", "utf8");
const sessionCommandSource = readFileSync("apps/web/lib/study/session-command-service.ts", "utf8");
const sessionCommandSupportSource = readFileSync("apps/web/lib/study/session-command-support.ts", "utf8");
const appShellSource = readFileSync("apps/web/components/app-shell.tsx", "utf8");
const globalTopBarSource = readFileSync("apps/web/components/global-top-bar.tsx", "utf8");
const overlaysSource = readFileSync("apps/web/components/ui/overlays.tsx", "utf8");
const focusScopeSource = readFileSync("apps/web/components/ui/focus-scope.ts", "utf8");
const dailyReviewPageSource = readFileSync("apps/web/lib/routes/daily-review-page.tsx", "utf8");
const dailyReviewFormSource = readFileSync("apps/web/components/review-form.tsx", "utf8");
const dailyReviewResultSource = readFileSync("apps/web/components/daily-review-result.tsx", "utf8");
const dailyReviewFactsSource = readFileSync("apps/web/lib/study/daily-review-facts-service.ts", "utf8");
const dailyReviewApiSource = readFileSync("apps/web/app/api/daily-reviews/route.ts", "utf8");
const planInboxItemSource = readFileSync("apps/web/components/plan-inbox-item-client.tsx", "utf8");
const planInboxItemViewSource = readFileSync("apps/web/components/plan-inbox-item-view.tsx", "utf8");
const planInboxItemUtilsSource = readFileSync("apps/web/components/plan-inbox-item-utils.ts", "utf8");
const planInboxOriginSource = readFileSync("apps/web/components/plan-inbox-origin.tsx", "utf8");
assert.doesNotMatch(quickReviewClientSource, /writeQuickReviewDraft/);
assert.match(quickReviewDraftRuntimeSource, /accessRef\.current === "writable"/);
assert.match(quickReviewDraftRuntimeSource, /markStale\(nextDraft\)/);
assert.ok(
  quickReviewClientSource.indexOf("if (done)") < quickReviewClientSource.indexOf("if (!draft)"),
  "confirmed review result must render before the removed local draft fallback",
);
assert.match(guardSource, /await ensureReviewSession\(/);
assert.match(guardSource, /await request\.operation\(\)/);
assert.match(guardSource, /requestQuickReviewCommand/);
assert.doesNotMatch(activitySource, /sessionStorage|TAB_ID_KEY/);
assert.doesNotMatch(
  activityRuntimeSource,
  /\b(?:window|navigator|BroadcastChannel|StorageEvent|CustomEvent)\b/,
);
assert.match(focusSessionSource, /useState\(\(\) => new Date\(props\.initialNow\)\)/);
assert.match(focusSessionSource, /getTimerElapsedSeconds\(/);
assert.match(focusSessionBehaviorSource, /publishFocusSyncEvent/);
assert.match(focusSessionBehaviorSource, /syncFocusOfflineQueue/);
assert.doesNotMatch(focusSessionSource, /minimalOutput:\s*draft\.minimalOutput\s*\|\|/);
assert.doesNotMatch(focusSessionSource, /本次最小产出/);
assert.match(focusSessionDraftSource, /minimalOutput\.length < 4/);
assert.match(focusPanelsSource, /<form noValidate/);
assert.match(focusPanelsSource, /至少 4 个字符/);
assert.match(quickReviewClientSource, /confirmReviewEvent\(props\.schedule\.id,/);
assert.doesNotMatch(quickReviewClientSource, /\bfetch\s*\(/);
assert.match(reviewScheduleAdapterSource, /export function confirmReviewEvent/);
assert.match(reviewScheduleAdapterSource, /`\/api\/review-schedules\/\$\{encodeURIComponent\(id\)\}\/events`/);
assert.match(focusEvidenceFormsSource, /createNote\(\{/);
assert.match(focusEvidenceFormsSource, /createMistake\(\{/);
assert.doesNotMatch(focusEvidenceFormsSource, /\bfetch\s*\(/);
assert.match(noteAdapterSource, /export function createNote/);
assert.match(noteAdapterSource, /requestApiResult\("\/api\/notes"/);
assert.match(mistakeAdapterSource, /export function createMistake/);
assert.match(mistakeAdapterSource, /requestApiResult\("\/api\/mistakes"/);
assert.match(focusEvidenceFormsSource, /SyllabusRetestForm/);
assert.match(focusEvidenceClientSource, /linkStudySessionEvidence\(session\.id/);
assert.match(sessionAdapterSource, /`\/api\/study-sessions\/\$\{encodeURIComponent\(sessionId\)\}\/evidence`/);
assert.match(sessionCommandSource, /SESSION_EVIDENCE_REQUIRES_COMPLETED/);
assert.match(sessionCommandSupportSource, /SESSION_EVIDENCE_CONTEXT_MISMATCH/);
assert.match(sessionCommandSource, /producedNote: true/);
assert.match(sessionCommandSource, /producedMistake: true/);
assert.match(appShellSource, /statusOpen=\{lightOpen\}/);
assert.match(globalTopBarSource, /aria-expanded=\{props\.statusOpen\}/);
assert.match(globalTopBarSource, /今日状态/);
assert.match(appShellSource, /GlobalSessionCloseout/);
assert.match(appShellSource, /displayStatus\.lights\.map/);
assert.match(focusScopeSource, /event\.key === "Escape" && input\.allowEscape/);
assert.match(focusScopeSource, /returnTarget\?\.isConnected/);
assert.match(dailyReviewPageSource, /getDailyReviewFacts/);
assert.match(dailyReviewPageSource, /getDailyReviewMinimumInboxItem/);
assert.match(dailyReviewFormSource, /setInboxItem\(isPlanInboxItemDto/);
assert.match(dailyReviewResultSource, /补全明日任务/);
assert.match(dailyReviewFactsSource, /STUDY_SESSION_EVIDENCE_LINKED/);
assert.match(dailyReviewApiSource, /\{ review, inboxItem \}/);
assert.match(
  planInboxItemSource,
  /withReturnTo\(`\/roadmap\/allocation\/tasks\/\$\{body\.item\.convertedTaskId\}`, returnTo\)/,
);
assert.match(planInboxItemSource, /withInboxStatus\(returnTo, "CONVERTED"\)/);
assert.match(planInboxItemViewSource, /<Link href=\{props\.returnTo\}/);
assert.match(planInboxItemUtilsSource, /isoToShanghaiDateInput\(date\)/);
assert.match(planInboxItemSource, /shanghaiDateInputToIso\(snapshot\.plannedDate\)/);
assert.match(planInboxItemViewSource, /planInboxOriginLabel/);
assert.match(planInboxOriginSource, /来自今日复盘/);
assert.match(planInboxOriginSource, /来自模拟考试补救/);

for (const path of [
  "apps/web/components/task-detail-client.tsx",
  "apps/web/components/action-center-today.tsx",
  "apps/web/components/recovery-action-drawer.tsx",
  "apps/web/components/workspace-settings-client.tsx",
]) {
  const source = readFileSync(path, "utf8");
  assert.match(source, /withActivityBarrier/);
  assert.doesNotMatch(source, /ensureActivityAvailable/);
}

console.log("PASS v1.1 quick-review writer, CAS, receipt, barrier, and hydration invariants");
