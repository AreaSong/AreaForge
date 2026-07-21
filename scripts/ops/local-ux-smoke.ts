import { readRestrictedSmokePassword } from "./smoke-password";

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
  durationMs: number;
};

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  rawBody?: BodyInit;
  cookie?: string;
  headers?: HeadersInit;
};

const timeoutMs = Number(process.env.AREAFORGE_SMOKE_TIMEOUT_MS ?? "10000");
const baseUrl = normalizeBaseUrl(process.env.AREAFORGE_SMOKE_BASE_URL ?? "http://127.0.0.1:3102");
const smokeEmail = process.env.AREAFORGE_SMOKE_EMAIL;
const allowWrites = process.env.AREAFORGE_SMOKE_ALLOW_WRITES === "true";
let smokePassword: string | undefined;
const results: CheckResult[] = [];

async function main(): Promise<void> {
  try {
    validateConfig();
  } catch (error) {
    recordFailure("config", error);
    report();
    return;
  }

  let cookie = "";
  const tag = Date.now().toString(36);
  const today = new Date().toISOString();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await check("health", async () => {
    const body = await requestJson("/api/health");
    const data = asRecord(body);
    if (data.ok !== true || data.service !== "AreaForge") {
      throw new Error("health payload is not AreaForge ok=true");
    }
  });

  await check("login", async () => {
    const response = await request("/api/auth/login", {
      method: "POST",
      body: { email: smokeEmail, password: smokePassword },
    });
    cookie = cookieFrom(response.response);
    const user = asRecord(asRecord(response.body).user);
    if (!cookie) throw new Error("login did not return a session cookie");
    if (user.email !== smokeEmail) throw new Error("login response user email mismatch");
  });

  await assertNoActiveSession("active session preflight", cookie);

  const subjectId = await ensureSmokeWorkspace(cookie, tag);

  await assertNoActiveSession("active session before synthetic writes", cookie);

  const nodeBody = await checkedJson("create syllabus node", "/api/syllabus/nodes", cookie, {
    method: "POST",
    body: {
      subjectId,
      title: `UX smoke 知识点 ${tag}`,
      kind: "topic",
      status: "learning",
      targetMinutes: 60,
    },
  });
  const syllabusNodeId = stringField(asRecord(nodeBody).node, "id");
  if (!syllabusNodeId) throw new Error("create syllabus node response missing node.id");

  const taskBody = await checkedJson("create task", "/api/tasks", cookie, {
    method: "POST",
    body: {
      subjectId,
      syllabusNodeId,
      title: `UX smoke 今日最小任务 ${tag}`,
      priority: "high",
      plannedDate: today,
      estimatedMinutes: 35,
    },
  });
  const taskId = stringField(asRecord(taskBody).task, "id");
  if (!taskId) throw new Error("create task response missing task.id");

  await assertNoActiveSession("active session before start", cookie);

  const sessionBody = await checkedJson("start session", "/api/study-sessions/start", cookie, {
    method: "POST",
    body: { taskId },
  });
  const sessionId = stringField(asRecord(sessionBody).session, "id");
  if (!sessionId) throw new Error("start session response missing session.id");

  await assertActiveSession("active session after start", cookie);

  await checkedJson("end session closeout", `/api/study-sessions/${encodeURIComponent(sessionId)}/end`, cookie, {
    method: "POST",
    body: {
      qualityScore: 4,
      isEffective: true,
      understandingLevel: "能独立复述主链路",
      minimalOutput: "完成一条 UX smoke 闭环记录",
      nextAction: "复查首页和报告是否刷新",
      producedNote: true,
      producedMistake: true,
      note: "本地 smoke 合成收口文本",
      completeTask: true,
    },
  });

  await checkedJson("save daily review", "/api/reviews/today", cookie, {
    method: "POST",
    body: {
      summary: `今天完成本地 UX smoke 闭环 ${tag}。`,
      keepAction: "继续保留最小任务优先。",
      tomorrowMinimum: "明天至少复查一个薄弱知识点。",
      mood: "steady",
    },
  });

  const noteBody = await checkedJson("create note", "/api/notes", cookie, {
    method: "POST",
    body: {
      subjectId,
      syllabusNodeId,
      taskId,
      title: `UX smoke 笔记 ${tag}`,
      content: "这是一条本地 smoke 笔记，用于验证附件和笔记列表。",
      masteryStatus: "partial",
      nextReviewAt: tomorrow,
    },
  });
  const noteId = stringField(asRecord(noteBody).note, "id");
  if (!noteId) throw new Error("create note response missing note.id");

  const attachmentBody = await checkedAttachmentUpload(noteId, cookie);
  const attachment = asRecord(attachmentBody.attachment);
  if (attachment.uri || attachment.storedName) throw new Error("attachment response leaked internal storage fields");
  const downloadApiPath = stringField(attachment, "downloadApiPath");
  if (!downloadApiPath) throw new Error("attachment response missing downloadApiPath");

  await check("download note attachment", async () => {
    const response = await requestRaw(downloadApiPath, { cookie });
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength <= 0) throw new Error("attachment response was empty");
    if (response.headers.get("cache-control") !== "private, no-store") {
      throw new Error("attachment response missing private no-store cache header");
    }
    if (response.headers.get("x-content-type-options") !== "nosniff") {
      throw new Error("attachment response missing nosniff");
    }
  });

  await checkedJson("create mistake", "/api/mistakes", cookie, {
    method: "POST",
    body: {
      subjectId,
      syllabusNodeId,
      title: `UX smoke 错题 ${tag}`,
      source: "本地 smoke",
      cause: "concept_confusion",
      correctIdea: "把定义、例题和反例串起来。",
      nextReviewAt: tomorrow,
    },
  });

  await checkedJson("dashboard today", "/api/dashboard/today", cookie, undefined, (body) =>
    asRecord(body).dashboard ? null : "dashboard payload missing");
  await checkedJson("app shell status", "/api/app-shell/status", cookie, undefined, (body) =>
    asRecord(body).status ? null : "app-shell status payload missing");
  await checkedJson("action center today", "/api/action-center/today", cookie, undefined, (body) =>
    asRecord(body).today ? null : "action-center today payload missing");
  await checkedJson("plan rolling", "/api/plan/rolling", cookie, undefined, (body) =>
    asRecord(body).plan ? null : "plan rolling payload missing");
  await checkedJson("analytics summary", "/api/analytics/summary", cookie, undefined, (body) =>
    asRecord(body).analytics ? null : "analytics payload missing");
  await checkedJson("reports periodic", "/api/reports/periodic", cookie, undefined, (body) =>
    asRecord(body).reports ? null : "reports payload missing");

  const examBody = await checkedJson("create simulation exam", "/api/simulation/exams", cookie, {
    method: "POST",
    body: {
      name: `UX smoke 模拟 ${tag}`,
      examDate: today,
      isFirstSynchronized: false,
      targetDurationMinutes: 180,
      targetScore: 300,
    },
  });
  const exam = asRecord(examBody.exam);
  const examId = stringField(exam, "id");
  const examRevision = exam.revision;
  if (!examId) throw new Error("create simulation exam response missing exam.id");
  if (typeof examRevision !== "number") throw new Error("create simulation exam response missing exam.revision");

  await checkedJson("save simulation result", `/api/simulation/exams/${encodeURIComponent(examId)}/results`, cookie, {
    method: "POST",
    body: {
      expectedRevision: examRevision,
      targetDurationMinutes: 180,
      actualDurationMinutes: 170,
      targetScore: 300,
      actualScore: 250,
      blankQuestionCount: 2,
      lossReasons: ["概念不稳"],
      mindset: "稳定",
      summary: "本地 smoke 模拟结果。",
      subjectResults: [
        {
          subjectId,
          paperFullScore: 100,
          targetScore: 100,
          actualScore: 82,
          durationMinutes: 50,
          blankQuestionCount: 1,
          lossReasons: ["基础概念"],
          summary: "需要复盘。",
          lossItems: [{
            reason: "CONCEPT_GAP",
            syllabusNodeId,
            lostScore: 18,
            note: "本地 smoke 结构化失分",
          }],
        },
      ],
    },
  });

  const stagePlanBody = await checkedJson("create stage plan", "/api/simulation/stage-plans", cookie, {
    method: "POST",
    body: {
      name: `UX smoke 阶段 ${tag}`,
      startDate: today,
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      goal: "验证阶段计划和调整草稿路径。",
      mode: "maintain",
      status: "active",
    },
  });
  const stagePlanId = stringField(asRecord(stagePlanBody).plan, "id");
  if (!stagePlanId) throw new Error("create stage plan response missing plan.id");

  const draftBody = await checkedJson("create stage draft local rule", "/api/simulation/stage-adjustment-drafts", cookie, {
    method: "POST",
    body: { stagePlanId },
  });
  const draft = asRecord(asRecord(draftBody).draft);
  if (draft.canAutoApply !== false || draft.requiresUserConfirmation !== true) {
    throw new Error("stage adjustment draft must remain confirm-only");
  }

  await checkedJson("long-term risks readonly", "/api/analytics/long-term-risks", cookie, undefined, (body) =>
    asRecord(body).longTermRisks ? null : "longTermRisks payload missing");
  const updateStatusBody = await checkedJson("update center status readonly", "/api/system/update-status", cookie, undefined, (body) => {
    const status = asRecord(asRecord(body).status);
    return typeof status.currentVersion === "string" ? null : "update status missing currentVersion";
  });
  await check("update center request boundary", async () => {
    const status = asRecord(updateStatusBody.status);
    const snapshotHash = stringField(status, "snapshotHash");
    if (!snapshotHash) {
      if (status.snapshotSchemaVersion !== null && status.snapshotSchemaVersion !== undefined) {
        throw new Error("missing V2 snapshot hash without an explicit unknown state");
      }
      return;
    }
    const response = await request("/api/system/update-requests", {
      method: "POST",
      cookie,
      body: {
        action: "check",
        confirmedSnapshotHash: snapshotHash,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    if (!response.response.ok) throw new Error("V2 check request was not accepted");
  });

  for (const page of [
    "/today",
    "/today/plan",
    "/today/inbox",
    "/settings",
    "/settings/workspace",
    "/knowledge/canvas",
    "/knowledge/overview",
    "/knowledge/notes",
    "/knowledge/syllabus",
    "/knowledge/reviews",
    "/analytics",
    "/reports",
    "/simulation",
  ]) {
    await check(`page ${page}`, async () => {
      const response = await requestRaw(page, { cookie });
      const text = await response.text();
      if (text.includes("NEXT_REDIRECT;replace;/login")) {
        throw new Error("authenticated page redirected to login");
      }
      if (!text.includes("AreaForge")) {
        throw new Error("page payload missing AreaForge marker");
      }
    });
  }

  await check("batch10 app shell nav isolation", async () => {
    const response = await requestRaw("/today", { cookie });
    const text = await response.text();
    if (text.includes("NEXT_REDIRECT;replace;/login")) {
      throw new Error("authenticated /today redirected to login");
    }
    for (const label of ["今日", "计划", "知识", "复盘", "阶段", "设置"]) {
      if (!text.includes(label)) {
        throw new Error(`Batch 10 nav missing label: ${label}`);
      }
    }
    for (const href of ['href="/knowledge/canvas"', 'href="/review/reports"', 'href="/stage/overview"']) {
      if (!text.includes(href)) {
        throw new Error(`Batch 10 App Shell must expose ${href}`);
      }
    }
    const forbiddenHrefs = [
      'href="/analytics"',
      'href="/reports"',
      'href="/simulation"',
      'href="/motivation"',
      'href="/dashboard"',
    ];
    for (const href of forbiddenHrefs) {
      if (text.includes(href)) {
        throw new Error(`Batch 10 App Shell must not expose legacy ${href}`);
      }
    }
  });

  await check("batch9 settings openings", async () => {
    for (const path of ["/settings/profile", "/settings/notifications", "/settings/ai"]) {
      const response = await requestRaw(path, { cookie });
      const text = await response.text();
      if (text.includes("NEXT_REDIRECT;replace;/login")) {
        throw new Error(`authenticated ${path} redirected to login`);
      }
      if (response.status >= 500) {
        throw new Error(`${path} returned ${response.status}`);
      }
    }
  });

  await checkedJson("batch8 knowledge canvas api", "/api/knowledge-canvas?depth=1&limit=40", cookie, {
    method: "GET",
  }, (body) => {
    const canvas = asRecord(body).canvas;
    if (!canvas || typeof canvas !== "object") return "knowledge canvas missing canvas payload";
    const record = asRecord(canvas);
    if (!Array.isArray(record.nodes) || !Array.isArray(record.list)) {
      return "knowledge canvas missing nodes/list";
    }
    if (!record.layout || typeof asRecord(record.layout).revision !== "number") {
      return "knowledge canvas missing layout revision";
    }
    return null;
  });

  await assertNoActiveSession("active session before subject shortcut", cookie);
  const shortcutBody = await checkedJson("subject shortcut start", "/api/study-sessions/start", cookie, {
    method: "POST",
    body: {
      subjectId,
      goalMinutes: 25,
      startSource: "SUBJECT_SHORTCUT",
    },
  });
  const shortcutSessionId = stringField(asRecord(shortcutBody).session, "id");
  if (!shortcutSessionId) throw new Error("subject shortcut start missing session.id");

  await check("page /focus/[sessionId]", async () => {
    const response = await requestRaw(`/focus/${encodeURIComponent(shortcutSessionId)}`, { cookie });
    const text = await response.text();
    if (text.includes("NEXT_REDIRECT;replace;/login")) {
      throw new Error("authenticated focus page redirected to login");
    }
    if (!text.includes("AreaForge") && !text.includes("专注")) {
      throw new Error("focus page payload missing expected markers");
    }
  });

  await checkedJson("end subject shortcut session", `/api/study-sessions/${encodeURIComponent(shortcutSessionId)}/end`, cookie, {
    method: "POST",
    body: {
      qualityScore: 3,
      isEffective: true,
      understandingLevel: "能独立复述主链路",
      minimalOutput: "Batch 7 科目快捷计时 smoke",
      nextAction: "回到今日行动中心",
      producedNote: false,
      producedMistake: false,
      note: "Batch 7 subject shortcut closeout",
      completeTask: false,
    },
  });

  report();
}

async function checkedAttachmentUpload(noteId: string, cookie: string): Promise<Record<string, unknown>> {
  return await checkedJson("upload note attachment", `/api/notes/${encodeURIComponent(noteId)}/attachments`, cookie, {
    method: "POST",
    rawBody: attachmentFormData(),
  });
}

async function ensureSmokeWorkspace(cookie: string, tag: string): Promise<string> {
  const workspacesBody = await checkedJson("exam workspaces", "/api/exam-workspaces", cookie);
  const workspaces = asRecord(workspacesBody).workspaces;
  let workspace = Array.isArray(workspaces)
    ? workspaces.map(asRecord).find((item) => item.status === "ACTIVE")
    : undefined;

  if (!stringField(workspace, "id")) {
    const createdBody = await checkedJson("create active exam workspace", "/api/exam-workspaces", cookie, {
      method: "POST",
      body: {
        stableKey: `ux-smoke-${tag}`,
        name: `UX smoke 工作区 ${tag}`,
        activate: true,
      },
    });
    workspace = asRecord(createdBody.workspace);
  }

  const workspaceId = stringField(workspace, "id");
  if (!workspaceId) throw new Error("active exam workspace response missing workspace.id");

  const subjectsPath = `/api/exam-workspaces/${encodeURIComponent(workspaceId)}/subjects`;
  const subjectsBody = await checkedJson("workspace subjects", subjectsPath, cookie);
  let subject = firstArrayItem(asRecord(subjectsBody).subjects);
  if (!stringField(subject, "id")) {
    const createdBody = await checkedJson("create workspace subject", subjectsPath, cookie, {
      method: "POST",
      body: {
        stableKey: `ux-smoke-subject-${tag}`,
        name: `UX smoke 科目 ${tag}`,
        color: "#0f766e",
        sortOrder: 10,
      },
    });
    subject = asRecord(createdBody.subject);
  }

  const subjectId = stringField(subject, "id");
  if (!subjectId) throw new Error("workspace subject response missing subject.id");
  return subjectId;
}

async function assertNoActiveSession(name: string, cookie: string): Promise<void> {
  await check(name, async () => {
    const body = await requestJson("/api/study-sessions/active", { cookie });
    const session = asRecord(body).session;
    if (session !== null && session !== undefined) {
      throw new Error("an active study session already exists; local UX smoke stopped before synthetic writes");
    }
  });
  if (results.at(-1)?.ok === false) throw new Error(`${name} failed`);
}

async function assertActiveSession(name: string, cookie: string): Promise<void> {
  await check(name, async () => {
    const body = await requestJson("/api/study-sessions/active", { cookie });
    if (asRecord(body).session === null || asRecord(body).session === undefined) {
      throw new Error("active study session was not returned after start");
    }
  });
  if (results.at(-1)?.ok === false) throw new Error(`${name} failed`);
}

function attachmentFormData(): FormData {
  const png = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0,
    1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99,
    248, 15, 0, 1, 1, 1, 0, 24, 221, 141, 176, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
    96, 130,
  ]);
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "ux-smoke.png");
  return form;
}

async function checkedJson(
  name: string,
  path: string,
  cookie: string,
  options?: Omit<RequestOptions, "cookie">,
  expect?: (body: unknown) => string | null,
): Promise<Record<string, unknown>> {
  let output: Record<string, unknown> = {};
  await check(name, async () => {
    const body = await requestJson(path, { ...options, cookie });
    const issue = expect?.(body);
    if (issue) throw new Error(issue);
    output = asRecord(body);
  });
  if (results.at(-1)?.ok === false) {
    throw new Error(`${name} failed`);
  }
  return output;
}

async function requestJson(path: string, options: RequestOptions = {}): Promise<unknown> {
  const response = await request(path, options);
  return response.body;
}

async function request(path: string, options: RequestOptions = {}): Promise<{ response: Response; body: unknown }> {
  const response = await requestRaw(path, options);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body };
}

async function requestRaw(path: string, options: RequestOptions = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(options.headers);
    if (options.cookie) headers.set("Cookie", options.cookie);
    if (options.body) headers.set("Content-Type", "application/json");
    const response = await fetch(new URL(path, baseUrl), {
      method: options.method ?? "GET",
      headers,
      body: options.rawBody ?? (options.body ? JSON.stringify(options.body) : undefined),
      signal: controller.signal,
      redirect: "manual",
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} for ${path}: ${text.slice(0, 200)}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  const startedAt = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, detail: "ok", durationMs: Date.now() - startedAt });
  } catch (error) {
    results.push({
      name,
      ok: false,
      detail: error instanceof Error ? redact(error.message) : "unknown error",
      durationMs: Date.now() - startedAt,
    });
  }
}

function validateConfig(): void {
  if (!allowWrites) throw new Error("AREAFORGE_SMOKE_ALLOW_WRITES=true is required because local UX smoke writes synthetic data");
  if (process.env.AREAFORGE_SMOKE_ALLOW_NON_LOCAL !== undefined) {
    throw new Error("AREAFORGE_SMOKE_ALLOW_NON_LOCAL is unsupported; local UX smoke always requires a local URL");
  }
  if (!isLocalBaseUrl(baseUrl)) throw new Error("local UX smoke requires a localhost, 127.0.0.1, or ::1 HTTP(S) URL");
  if (!smokeEmail) throw new Error("AREAFORGE_SMOKE_EMAIL is required");
  if (process.env.AREAFORGE_SMOKE_PASSWORD !== undefined) {
    throw new Error("AREAFORGE_SMOKE_PASSWORD is unsupported; use AREAFORGE_SMOKE_PASSWORD_FILE");
  }
  smokePassword = readRestrictedSmokePassword();
}

function report(): void {
  const failed = results.filter((result) => !result.ok);
  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.detail} (${result.durationMs}ms)`);
  }
  console.log(JSON.stringify({
    ok: failed.length === 0,
    baseUrl: redactedBaseUrl(),
    checkedAt: new Date().toISOString(),
    writeScope: "synthetic-local-ux-smoke",
    checks: results.map((result) => ({
      name: result.name,
      ok: result.ok,
      detail: result.detail,
      durationMs: result.durationMs,
    })),
  }));
  if (failed.length > 0) process.exitCode = 1;
}

function cookieFrom(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookie = headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  return setCookie
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLocalBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && !url.username
      && !url.password
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
  } catch {
    return false;
  }
}

function firstArrayItem(value: unknown): Record<string, unknown> {
  return Array.isArray(value) && value.length > 0 ? asRecord(value[0]) : {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stringField(value: unknown, field: string): string | null {
  const item = asRecord(value)[field];
  return typeof item === "string" && item.length > 0 ? item : null;
}

function redact(value: string): string {
  let output = value;
  if (smokePassword) {
    output = output.replace(new RegExp(escapeRegExp(smokePassword), "g"), "<redacted>");
  }
  return output
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <redacted>")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://<redacted>")
    .replace(/\/(?:Users|private|tmp|app|srv|mnt|var)\/[^\s"'<>)]*/g, "<redacted-path>");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function recordFailure(name: string, error: unknown): void {
  results.push({
    name,
    ok: false,
    detail: error instanceof Error ? redact(error.message) : "unknown error",
    durationMs: 0,
  });
}

function redactedBaseUrl(): string {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return "<invalid>";
  }
}

main().catch((error) => {
  recordFailure("fatal", error);
  report();
});
