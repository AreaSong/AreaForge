"use client";

import { CheckCircle2, Plus, Save, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SimulationStageDraftDto } from "@/lib/study/simulation-service";
import type {
  MotivationVaultDto,
  SimulationExamDto,
  StageAdjustmentDraftRecordDto,
  StagePlanDto,
  StudyTaskDto,
  SubjectDto,
} from "@/lib/study/types";

interface SimulationWorkbenchProps {
  subjects: SubjectDto[];
  exams: SimulationExamDto[];
  tasks: StudyTaskDto[];
  stage: SimulationStageDraftDto;
  stagePlans: StagePlanDto[];
  stageAdjustmentDrafts: StageAdjustmentDraftRecordDto[];
  motivationVault: MotivationVaultDto | null;
}

export function SimulationWorkbench({
  subjects,
  exams,
  tasks,
  stage,
  stagePlans,
  stageAdjustmentDrafts,
  motivationVault,
}: SimulationWorkbenchProps) {
  const router = useRouter();
  const [examName, setExamName] = useState("2026 同步全真自测");
  const [examDate, setExamDate] = useState(toDatetimeLocal(stage.simulationNode.date));
  const [isFirstSynchronized, setIsFirstSynchronized] = useState(true);
  const [targetDurationMinutes, setTargetDurationMinutes] = useState(180);
  const [examTargetScore, setExamTargetScore] = useState("");
  const [selectedExamId, setSelectedExamId] = useState(exams[0]?.id ?? "");
  const [resultSubjectId, setResultSubjectId] = useState(subjects[0]?.id ?? "");
  const [resultTargetScore, setResultTargetScore] = useState("");
  const [resultActualScore, setResultActualScore] = useState("");
  const [resultDurationMinutes, setResultDurationMinutes] = useState(180);
  const [blankCount, setBlankCount] = useState(0);
  const [lossReason, setLossReason] = useState("");
  const [mindset, setMindset] = useState("");
  const [summary, setSummary] = useState("");
  const [firstSimulationDiary, setFirstSimulationDiary] = useState(motivationVault?.firstSimulationDiary ?? "");
  const [stagePlanName, setStagePlanName] = useState("2026 同步全真自测准备期");
  const [stagePlanGoal, setStagePlanGoal] = useState("2026 年 12 月同步全真自测");
  const [stagePlanStartDate, setStagePlanStartDate] = useState(toDatetimeLocal(new Date().toISOString()));
  const [stagePlanEndDate, setStagePlanEndDate] = useState(toDatetimeLocal(stage.simulationNode.date));
  const [stagePlanMode, setStagePlanMode] = useState<StagePlanDto["mode"]>("maintain");
  const [stagePlanStatus, setStagePlanStatus] = useState<StagePlanDto["status"]>("active");
  const [selectedStagePlanId, setSelectedStagePlanId] = useState(stagePlans.find((plan) => plan.status === "active")?.id ?? stagePlans[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedExam = exams.find((exam) => exam.id === selectedExamId) ?? exams[0] ?? null;
  const resolvedSelectedExamId = selectedExamId || selectedExam?.id || "";

  async function submitExam(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/simulation/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: examName,
        examDate: new Date(examDate).toISOString(),
        isFirstSynchronized,
        targetDurationMinutes,
        targetScore: parseOptionalNumber(examTargetScore),
      }),
    });

    if (!response.ok) {
      await showError(response, "创建模拟考试失败");
      return;
    }

    const body = (await response.json().catch(() => null)) as { exam?: SimulationExamDto } | null;
    if (body?.exam?.id) setSelectedExamId(body.exam.id);
    startTransition(() => router.refresh());
  }

  async function saveStructuredResults(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!resolvedSelectedExamId || !resultSubjectId) {
      setError("请先选择一条结构化模拟考试和科目");
      return;
    }

    const currentResult = {
      subjectId: resultSubjectId,
      targetScore: parseOptionalNumber(resultTargetScore),
      actualScore: parseOptionalNumber(resultActualScore),
      durationMinutes: resultDurationMinutes,
      blankQuestionCount: blankCount,
      lossReasons: splitLossReasons(lossReason),
      summary,
    };
    const subjectResults = mergeSubjectResults(selectedExam, currentResult);

    const response = await fetch(`/api/simulation/exams/${resolvedSelectedExamId}/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetDurationMinutes: selectedExam?.targetDurationMinutes ?? targetDurationMinutes,
        actualDurationMinutes: sumNumeric(subjectResults.map((result) => result.durationMinutes)),
        targetScore: sumNumeric(subjectResults.map((result) => result.targetScore)),
        actualScore: sumNumeric(subjectResults.map((result) => result.actualScore)),
        blankQuestionCount: sumNumeric(subjectResults.map((result) => result.blankQuestionCount)) ?? 0,
        lossReasons: splitLossReasons(lossReason),
        mindset,
        summary,
        subjectResults,
      }),
    });

    if (!response.ok) {
      await showError(response, "保存模拟结果失败");
      return;
    }

    setSummary("");
    startTransition(() => router.refresh());
  }

  async function saveDiary(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/simulation/first-diary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstSimulationDiary }),
    });

    if (!response.ok) {
      await showError(response, "保存阶段日记失败");
      return;
    }

    startTransition(() => router.refresh());
  }

  async function submitStagePlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/simulation/stage-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: stagePlanName,
        startDate: new Date(stagePlanStartDate).toISOString(),
        endDate: new Date(stagePlanEndDate).toISOString(),
        goal: stagePlanGoal,
        mode: stagePlanMode,
        status: stagePlanStatus,
      }),
    });

    if (!response.ok) {
      await showError(response, "保存阶段计划失败");
      return;
    }

    const body = (await response.json().catch(() => null)) as { plan?: StagePlanDto } | null;
    if (body?.plan?.id) setSelectedStagePlanId(body.plan.id);
    startTransition(() => router.refresh());
  }

  async function generatePersistentDraft() {
    setError(null);
    const response = await fetch("/api/simulation/stage-adjustment-drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stagePlanId: selectedStagePlanId || null }),
    });

    if (!response.ok) {
      await showError(response, "生成阶段调整草稿失败");
      return;
    }

    startTransition(() => router.refresh());
  }

  async function decidePersistentDraft(id: string, action: "confirm" | "reject") {
    setError(null);
    const response = await fetch(`/api/simulation/stage-adjustment-drafts/${id}/${action}`, {
      method: "POST",
    });

    if (!response.ok) {
      await showError(response, action === "confirm" ? "确认阶段草稿失败" : "驳回阶段草稿失败");
      return;
    }

    startTransition(() => router.refresh());
  }

  async function showError(response: Response, fallback: string) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setError(body?.error ?? fallback);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
        <div className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-teal-300" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-white">创建结构化模拟考试</h2>
        </div>
        <form className="mt-5 grid gap-3" onSubmit={submitExam}>
          <input
            className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
            value={examName}
            onChange={(event) => setExamName(event.target.value)}
            placeholder="考试名称"
            required
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              type="datetime-local"
              value={examDate}
              onChange={(event) => setExamDate(event.target.value)}
              required
            />
            <input
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              type="number"
              min={30}
              max={720}
              value={targetDurationMinutes}
              onChange={(event) => setTargetDurationMinutes(Number(event.target.value))}
              aria-label="目标用时"
            />
            <input
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              value={examTargetScore}
              onChange={(event) => setExamTargetScore(event.target.value)}
              placeholder="目标总分"
            />
          </div>
          <label className="flex items-center gap-2 rounded-md border border-white/10 bg-[#151a20] px-3 py-3 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={isFirstSynchronized}
              onChange={(event) => setIsFirstSynchronized(event.target.checked)}
            />
            2026 年 12 月同步自测
          </label>
          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={isPending}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            新建
          </button>
        </form>

        <div className="mt-6 grid gap-3">
          <h3 className="font-medium text-white">结构化模拟考试</h3>
          {exams.length === 0 ? (
            <p className="rounded-md border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-400">
              还没有结构化模拟考试记录。
            </p>
          ) : null}
          {exams.map((exam) => (
            <article key={exam.id} className="rounded-md border border-white/10 bg-[#151a20] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm text-zinc-400">
                    {new Date(exam.examDate).toLocaleString("zh-CN")}
                    {exam.isFirstSynchronized ? " / 同步自测" : ""}
                  </p>
                  <h3 className="mt-1 font-medium text-white">{exam.name}</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    总分 {formatMaybeNumber(exam.actualScore)} / {formatMaybeNumber(exam.targetScore)}
                    {" · "}
                    用时 {exam.actualDurationMinutes ?? "-"} / {exam.targetDurationMinutes ?? "-"} 分
                    {" · "}
                    空题 {exam.blankQuestionCount}
                  </p>
                </div>
                <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300">
                  {exam.subjectResults.length} 科
                </span>
              </div>
              {exam.subjectResults.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {exam.subjectResults.map((result) => (
                    <p key={result.id} className="rounded-md border border-white/10 px-3 py-2 text-xs leading-5 text-zinc-300">
                      {result.subjectName}：{formatMaybeNumber(result.actualScore)} / {formatMaybeNumber(result.targetScore)}
                      {" · "}
                      {result.durationMinutes ?? "-"} 分
                      {" · "}
                      空题 {result.blankQuestionCount}
                    </p>
                  ))}
                </div>
              ) : null}
              {exam.reviewText ? (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{exam.reviewText}</p>
              ) : null}
            </article>
          ))}
        </div>

        {tasks.length > 0 ? (
          <div className="mt-6 grid gap-3">
            <h3 className="font-medium text-white">旧任务型模拟（只读）</h3>
            {tasks.map((task) => (
              <article key={task.id} className="rounded-md border border-white/10 bg-[#151a20] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm text-zinc-400">{task.subjectName}</p>
                    <h3 className="mt-1 font-medium text-white">{task.title}</h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      {new Date(task.plannedDate).toLocaleString("zh-CN")} / {labelStatus(task.status)}
                    </p>
                    {task.syllabusNodeTitle ? <p className="mt-1 text-xs text-teal-200">节点：{task.syllabusNodeTitle}</p> : null}
                  </div>
                  <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300">
                    {task.actualMinutes || task.estimatedMinutes} 分
                  </span>
                </div>
                {task.reviewText ? (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{task.reviewText}</p>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <div className="grid gap-5">
        <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-sky-300" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-white">阶段计划与持久草稿</h2>
          </div>
          <form className="mt-5 grid gap-3" onSubmit={submitStagePlan}>
            <input
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              value={stagePlanName}
              onChange={(event) => setStagePlanName(event.target.value)}
              placeholder="阶段计划名称"
              required
            />
            <textarea
              className="min-h-24 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
              value={stagePlanGoal}
              onChange={(event) => setStagePlanGoal(event.target.value)}
              placeholder="阶段目标"
              required
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
                type="datetime-local"
                value={stagePlanStartDate}
                onChange={(event) => setStagePlanStartDate(event.target.value)}
                required
              />
              <input
                className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
                type="datetime-local"
                value={stagePlanEndDate}
                onChange={(event) => setStagePlanEndDate(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
                value={stagePlanMode}
                onChange={(event) => setStagePlanMode(event.target.value as StagePlanDto["mode"])}
              >
                <option value="maintain">维持</option>
                <option value="recovery">恢复</option>
                <option value="strengthen">强化</option>
                <option value="sprint">冲刺</option>
              </select>
              <select
                className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
                value={stagePlanStatus}
                onChange={(event) => setStagePlanStatus(event.target.value as StagePlanDto["status"])}
              >
                <option value="draft">草稿</option>
                <option value="active">进行中</option>
                <option value="completed">已完成</option>
                <option value="archived">已归档</option>
              </select>
            </div>
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-sky-300 px-4 font-medium text-[#071018] disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
              disabled={isPending}
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              保存阶段计划
            </button>
          </form>

          <div className="mt-6 grid gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="font-medium text-white">持久阶段计划</h3>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-sky-200/20 px-3 text-sm text-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={generatePersistentDraft}
                disabled={isPending}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                生成持久草稿
              </button>
            </div>
            {stagePlans.length === 0 ? (
              <p className="rounded-md border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-400">
                还没有阶段计划；先保存计划，再确认草稿。
              </p>
            ) : (
              <select
                className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
                value={selectedStagePlanId}
                onChange={(event) => setSelectedStagePlanId(event.target.value)}
              >
                {stagePlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} / {labelStageMode(plan.mode)} / {labelStagePlanStatus(plan.status)}
                  </option>
                ))}
              </select>
            )}
            {stagePlans.map((plan) => (
              <article key={plan.id} className="rounded-md border border-white/10 bg-[#151a20] p-4">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-md border border-sky-200/20 px-2 py-1 text-xs text-sky-100">
                    {labelStageMode(plan.mode)}
                  </span>
                  <span className="rounded-md border border-sky-200/20 px-2 py-1 text-xs text-sky-100">
                    {labelStagePlanStatus(plan.status)}
                  </span>
                </div>
                <h3 className="mt-3 font-medium text-white">{plan.name}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-300">{plan.goal}</p>
                <p className="mt-2 text-xs text-zinc-500">
                  {new Date(plan.startDate).toLocaleDateString("zh-CN")} 至 {new Date(plan.endDate).toLocaleDateString("zh-CN")}
                </p>
              </article>
            ))}
          </div>

          <div className="mt-6 grid gap-3">
            <h3 className="font-medium text-white">已持久化阶段调整草稿</h3>
            {stageAdjustmentDrafts.length === 0 ? (
              <p className="rounded-md border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-400">
                还没有持久草稿；生成后会固定 canAutoApply=false / requiresUserConfirmation=true。
              </p>
            ) : null}
            {stageAdjustmentDrafts.map((draft) => (
              <article key={draft.id} className="rounded-md border border-white/10 bg-[#151a20] p-4">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-md border border-violet-200/20 px-2 py-1 text-xs text-violet-100">
                    {labelStageDraftStatus(draft.status)}
                  </span>
                  <span className="rounded-md border border-violet-200/20 px-2 py-1 text-xs text-violet-100">
                    {draft.canAutoApply ? "可自动应用" : "不自动应用"}
                  </span>
                  <span className="rounded-md border border-violet-200/20 px-2 py-1 text-xs text-violet-100">
                    {draft.requiresUserConfirmation ? "需用户确认" : "无需确认"}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-violet-50">{draft.riskConclusion}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-300">{draft.nextStageEmphasis}</p>
                <p className="mt-2 text-xs text-zinc-500">
                  {labelStageMode(draft.mode)} / {labelTaskIntensity(draft.taskIntensity)} / {new Date(draft.createdAt).toLocaleString("zh-CN")}
                </p>
                {draft.status === "draft" ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-violet-300 px-3 text-sm font-medium text-[#120d1b] disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      onClick={() => decidePersistentDraft(draft.id, "confirm")}
                      disabled={isPending || !draft.stagePlanId}
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      确认应用到阶段计划
                    </button>
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      onClick={() => decidePersistentDraft(draft.id, "reject")}
                      disabled={isPending}
                    >
                      <XCircle className="h-4 w-4" aria-hidden="true" />
                      驳回
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-amber-300" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-white">保存结构化模拟结果</h2>
          </div>
          <form className="mt-5 grid gap-3" onSubmit={saveStructuredResults}>
            <select
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              value={resolvedSelectedExamId}
              onChange={(event) => setSelectedExamId(event.target.value)}
              required
            >
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.name} / {new Date(exam.examDate).toLocaleDateString("zh-CN")}
                </option>
              ))}
            </select>
            <select
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              value={resultSubjectId}
              onChange={(event) => setResultSubjectId(event.target.value)}
              required
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
                value={resultTargetScore}
                onChange={(event) => setResultTargetScore(event.target.value)}
                placeholder="科目目标分"
              />
              <input
                className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
                value={resultActualScore}
                onChange={(event) => setResultActualScore(event.target.value)}
                placeholder="科目实际分"
              />
              <input
                className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
                type="number"
                min={0}
                max={300}
                value={blankCount}
                onChange={(event) => setBlankCount(Number(event.target.value))}
                aria-label="空题数量"
              />
            </div>
            <input
              className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
              type="number"
              min={0}
              max={720}
              value={resultDurationMinutes}
              onChange={(event) => setResultDurationMinutes(Number(event.target.value))}
              aria-label="实际用时"
            />
            <textarea
              className="min-h-24 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
              value={lossReason}
              onChange={(event) => setLossReason(event.target.value)}
              placeholder="失分原因"
            />
            <textarea
              className="min-h-24 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
              value={mindset}
              onChange={(event) => setMindset(event.target.value)}
              placeholder="心态记录"
            />
            <textarea
              className="min-h-28 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="考后总结"
              required
            />
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-amber-300 px-4 font-medium text-[#17110a] disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
              disabled={isPending || exams.length === 0 || subjects.length === 0}
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              保存结果
            </button>
          </form>
        </section>

        <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
          <h2 className="text-lg font-semibold text-white">第一次全真自测阶段日记</h2>
          <form className="mt-5 grid gap-3" onSubmit={saveDiary}>
            <textarea
              className="min-h-32 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
              value={firstSimulationDiary}
              onChange={(event) => setFirstSimulationDiary(event.target.value)}
              placeholder="自测后写下分数、心态、暴露问题和下一阶段判断"
              required
            />
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
              disabled={isPending}
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              保存阶段日记
            </button>
          </form>
        </section>

        {error ? <p className="rounded-md border border-red-300/25 bg-red-300/10 px-4 py-3 text-sm text-red-100">{error}</p> : null}
      </div>
    </div>
  );
}

function mergeSubjectResults(
  exam: SimulationExamDto | null,
  current: {
    subjectId: string;
    targetScore?: number;
    actualScore?: number;
    durationMinutes: number;
    blankQuestionCount: number;
    lossReasons: string[];
    summary: string;
  },
) {
  return [
    ...(exam?.subjectResults ?? [])
      .filter((result) => result.subjectId !== current.subjectId)
      .map((result) => ({
        subjectId: result.subjectId,
        targetScore: result.targetScore ?? undefined,
        actualScore: result.actualScore ?? undefined,
        durationMinutes: result.durationMinutes ?? undefined,
        blankQuestionCount: result.blankQuestionCount,
        lossReasons: result.lossReasons,
        summary: result.summary ?? undefined,
      })),
    current,
  ];
}

function splitLossReasons(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,，;；、]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 20);
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sumNumeric(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => typeof value === "number");
  if (present.length === 0) return undefined;
  return present.reduce((total, value) => total + value, 0);
}

function toDatetimeLocal(value: string): string {
  const date = new Date(value);
  const pad = (part: number) => `${part}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatMaybeNumber(value: number | null | undefined): string {
  if (value == null) return "-";
  return Number.isInteger(value) ? `${value}` : `${Math.round(value * 10) / 10}`;
}

function labelStatus(status: StudyTaskDto["status"]): string {
  switch (status) {
    case "todo":
      return "待开始";
    case "in_progress":
      return "进行中";
    case "done":
      return "已完成";
    case "skipped":
      return "已放弃";
    case "deferred":
      return "已延期";
  }
}

function labelStageMode(mode: StagePlanDto["mode"]): string {
  switch (mode) {
    case "recovery":
      return "恢复";
    case "strengthen":
      return "强化";
    case "sprint":
      return "冲刺";
    case "maintain":
      return "维持";
  }
}

function labelStagePlanStatus(status: StagePlanDto["status"]): string {
  switch (status) {
    case "draft":
      return "草稿";
    case "active":
      return "进行中";
    case "completed":
      return "已完成";
    case "archived":
      return "已归档";
  }
}

function labelStageDraftStatus(status: StageAdjustmentDraftRecordDto["status"]): string {
  switch (status) {
    case "draft":
      return "待确认";
    case "applied":
      return "已应用";
    case "rejected":
      return "已驳回";
  }
}

function labelTaskIntensity(intensity: StageAdjustmentDraftRecordDto["taskIntensity"]): string {
  switch (intensity) {
    case "reduce":
      return "降载";
    case "keep":
      return "维持";
    case "increase":
      return "加压";
    case "sprint":
      return "冲刺";
  }
}
