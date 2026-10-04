import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { storageQuotaFixtureEnvironment, type StorageQuotaFixture } from "./storage-quota-fixture";
import { storageQuotaSourceFingerprint } from "./storage-quota-source";

export interface StorageProcessRequest {
  kind: "upload" | "cleanup" | "reconcile" | "release"; ownerId: string; noteId?: string; key?: string; attachmentId?: string;
  point?: "intent" | "staging" | "renamed" | "removed" | "released" | "before-unlink" | "cas-precommit" | "verified-release";
}
type Message = { state: string; nonce?: string; pid?: number; ppid?: number; uid?: number; fixtureId?: string;
  backendPid?: number; sourceFingerprint?: string; point?: string; result?: unknown; code?: string; observation?: unknown };
export async function startStorageProcess(fixture: StorageQuotaFixture, request: StorageProcessRequest) {
  const nonce = randomBytes(32).toString("hex"); const fingerprint = storageQuotaSourceFingerprint();
  const child = spawn(process.execPath, ["--import", "tsx", path.resolve("scripts/quality/storage-quota-process-child.ts"), fixture.root, nonce], {
    cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: { ...storageQuotaFixtureEnvironment(fixture), TSX_TSCONFIG_PATH: path.resolve("apps/web/tsconfig.json") },
  });
  const diagnostics: string[] = [];
  child.stderr?.on("data", (chunk: Buffer) => {
    if (chunk.toString().includes("WORKSPACE_STORAGE_QUOTA_BUSY")) diagnostics.push("WORKSPACE_STORAGE_QUOTA_BUSY");
  });
  let ended = false; let notify: (() => void) | undefined; const messages: Message[] = [];
  child.on("message", value => { messages.push(value as Message); notify?.(); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once("exit", (code, signal) => { ended = true; notify?.(); resolve({ code, signal }); });
    child.once("error", () => { ended = true; notify?.(); resolve({ code: -1, signal: null }); });
  });
  const next = () => new Promise<Message>((resolve, reject) => {
    const finish = () => {
      if (messages.length) { clearTimeout(timer); notify = undefined; resolve(messages.shift()!); }
      else if (ended) { clearTimeout(timer); notify = undefined; reject(new Error("STORAGE_CHILD_EARLY_EXIT")); }
    };
    const timer = setTimeout(() => { notify = undefined; reject(new Error("STORAGE_CHILD_BARRIER_TIMEOUT")); }, 12_000);
    notify = finish; finish();
  });
  const identity = (message: Message) => {
    assert.equal(message.nonce, nonce); assert.equal(message.pid, child.pid); assert.equal(message.ppid, process.pid);
    assert.equal(message.uid, fixture.ownerUid); assert.equal(message.fixtureId, fixture.scopeId);
    assert.equal(message.sourceFingerprint, fingerprint); assert.ok(message.backendPid);
  };
  const stop = async () => { if (!ended) { assert.ok(child.pid); assert.equal(child.kill("SIGKILL"), true); } return exited; };
  try {
    const ready = await next(); assert.equal(ready.state, "ready"); identity(ready);
    child.send(request);
    return {
      pid: child.pid!, backendPid: ready.backendPid!, diagnostics: () => [...diagnostics], next: async () => {
        const message = await next(); if (message.state !== "failed") identity(message); return message;
      },
      continue: () => child.send({ action: "continue", nonce }), stop,
      finish: async () => {
        const message = await next(); assert.equal(message.state, "done", message.code); identity(message);
        const result = await exited; assert.deepEqual(result, { code: 0, signal: null }); return message.result;
      },
      // 成功/失败都只回收本次 spawn 的尚存活子进程，不按名称或进程组操作。
      close: stop,
    };
  } catch (error) { await stop(); throw error; }
}
export async function runStorageProcess(fixture: StorageQuotaFixture, request: StorageProcessRequest) {
  const child = await startStorageProcess(fixture, request);
  try { return await child.finish(); } finally { await child.close(); }
}
