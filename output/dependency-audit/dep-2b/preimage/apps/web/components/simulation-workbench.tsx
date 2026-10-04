"use client";

import {
  createAiSimulationStageAdjustmentDraft,
  createSimulationExam,
  createSimulationStageAdjustmentDraft,
  createSimulationStagePlan,
  decideSimulationStageAdjustmentDraft,
  saveFirstSimulationDiary,
  submitSimulationExamResults,
} from "@/lib/api/simulation";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { useEntityOperationMap } from "@/lib/client/use-entity-operation-map";
import type { StagePlanDto } from "@/lib/contracts";
import { isShanghaiDateInputError, shanghaiDateTimeInputToIso } from "@/lib/formatters";
import { mutationFeedback } from "@/lib/client/mutation-feedback";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import {
  SimulationDiarySection,
  SimulationExamSection,
  SimulationResultSection,
} from "@/components/simulation-workbench-exam-sections";
import { SimulationStageSection } from "@/components/simulation-workbench-stage-section";
import {
  mergeSubjectResults,
  parseOptionalNumber,
  splitLossReasons,
  sumNumeric,
  toDatetimeLocal,
  type SimulationWorkbenchProps,
} from "@/components/simulation-workbench-model";

const examCreateOperation = "exam:create";
const diaryOperation = "diary:first";
const stagePlanOperation = "stage-plan:create";

function resultOperation(examId: string): string {
  return `result:${examId || "unselected"}`;
}

function draftGenerationOperation(stagePlanId: string): string {
  return `draft:generate:${stagePlanId || "unbound"}`;
}

function draftDecisionOperation(draftId: string): string {
  return `draft:decide:${draftId}`;
}

export function SimulationWorkbench({
  subjects,
  exams,
  tasks,
  stage,
  stagePlans,
  stageAdjustmentDrafts,
  motivationVault,
  initialNow,
}: SimulationWorkbenchProps) {
  const defaultTimelineDate = stage.simulationNode?.date ?? initialNow ?? new Date().toISOString();
  const router = useRouter();
  const [examName, setExamName] = useState("模拟考试");
  const [examDate, setExamDate] = useState(toDatetimeLocal(defaultTimelineDate));
  const [isFirstSynchronized, setIsFirstSynchronized] = useState(false);
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
  const [stagePlanName, setStagePlanName] = useState("当前考试目标准备期");
  const [stagePlanGoal, setStagePlanGoal] = useState("完成当前考试目标");
  const [stagePlanStartDate, setStagePlanStartDate] = useState(toDatetimeLocal(initialNow ?? defaultTimelineDate));
  const [stagePlanEndDate, setStagePlanEndDate] = useState(toDatetimeLocal(defaultTimelineDate));
  const [stagePlanMode, setStagePlanMode] = useState<StagePlanDto["mode"]>("maintain");
  const [stagePlanStatus, setStagePlanStatus] = useState<StagePlanDto["status"]>("active");
  const [selectedStagePlanId, setSelectedStagePlanId] = useState(stagePlans.find((plan) => plan.status === "active")?.id ?? stagePlans[0]?.id ?? "");
  const [, startTransition] = useTransition();
  const operations = useEntityOperationMap<string>();
  const selectedExam = exams.find((exam) => exam.id === selectedExamId) ?? exams[0] ?? null;
  const resolvedSelectedExamId = selectedExamId || selectedExam?.id || "";
  const currentResultOperation = resultOperation(resolvedSelectedExamId);
  const currentDraftGenerationOperation = draftGenerationOperation(selectedStagePlanId);

  async function submitExam(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const generation = operations.tryBegin(examCreateOperation);
    if (generation === null) return;

    let parsedExamDate: string;
    try {
      parsedExamDate = shanghaiDateTimeInputToIso(examDate);
    } catch (caught) {
      operations.fail(
        examCreateOperation,
        generation,
        isShanghaiDateInputError(caught) ? "考试时间无效，请重新选择日期和时间。" : "无法解析考试时间。",
      );
      return;
    }
    const submission = {
      name: examName,
      examDate: parsedExamDate,
      isFirstSynchronized,
      targetDurationMinutes,
      targetScore: parseOptionalNumber(examTargetScore),
    };
    const commandScope = "simulation-workbench:exam:create";
    try {
      const response = await createSimulationExam({
        ...submission,
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "simulation-exam", submission),
      });
      if (!response.ok) {
        operations.fail(examCreateOperation, generation, responseError(response, "创建模拟考试失败"));
        return;
      }
      const body = response.body;
      if (!body?.exam?.id) {
        operations.fail(examCreateOperation, generation, "服务端未返回已创建考试，当前输入与重试标识仍保留");
        return;
      }
      completeIdempotentCommand(commandScope);
      operations.succeed(examCreateOperation, generation);
      setSelectedExamId(body.exam.id);
      startTransition(() => router.refresh());
    } catch {
      operations.fail(examCreateOperation, generation, "网络结果未知，考试输入与重试标识仍保留；请核对后显式重试。");
    }
  }

  async function saveStructuredResults(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const operationKey = resultOperation(resolvedSelectedExamId);
    const generation = operations.tryBegin(operationKey);
    if (generation === null) return;
    if (!resolvedSelectedExamId || !selectedExam || !resultSubjectId) {
      operations.fail(operationKey, generation, "请先选择一条结构化模拟考试和科目");
      return;
    }

    const resultSnapshot = {
      subjectId: resultSubjectId,
      targetScore: parseOptionalNumber(resultTargetScore),
      actualScore: parseOptionalNumber(resultActualScore),
      durationMinutes: resultDurationMinutes,
      blankQuestionCount: blankCount,
      lossReasons: splitLossReasons(lossReason),
      summary,
    };
    const subjectResults = mergeSubjectResults(selectedExam, resultSnapshot).map((result) => ({
      ...result,
      lossReasons: [...result.lossReasons],
      lossItems: result.lossItems?.map((item) => ({ ...item })),
    }));
    const submission = {
      expectedRevision: selectedExam.revision,
      targetDurationMinutes: selectedExam.targetDurationMinutes ?? targetDurationMinutes,
      actualDurationMinutes: sumNumeric(subjectResults.map((result) => result.durationMinutes)),
      targetScore: sumNumeric(subjectResults.map((result) => result.targetScore)),
      actualScore: sumNumeric(subjectResults.map((result) => result.actualScore)),
      blankQuestionCount: sumNumeric(subjectResults.map((result) => result.blankQuestionCount)) ?? 0,
      lossReasons: splitLossReasons(lossReason),
      mindset,
      summary,
      subjectResults,
    };
    try {
      const response = await submitSimulationExamResults(resolvedSelectedExamId, submission);
      if (!response.ok) {
        operations.fail(operationKey, generation, responseError(response, "保存模拟结果失败"));
        return;
      }
      operations.succeed(operationKey, generation);
      setSummary("");
      startTransition(() => router.refresh());
    } catch {
      operations.fail(operationKey, generation, "网络结果未知，模拟结果输入仍保留；请核对后显式重试。");
    }
  }

  async function saveDiary(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const generation = operations.tryBegin(diaryOperation);
    if (generation === null) return;
    const submission = { firstSimulationDiary };
    const commandScope = "simulation-workbench:first-diary";
    try {
      const response = await saveFirstSimulationDiary({
        ...submission,
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "first-diary", submission),
      });
      if (!response.ok) {
        operations.fail(diaryOperation, generation, responseError(response, "保存阶段日记失败"));
        return;
      }
      if (!response.body?.vault) {
        operations.fail(diaryOperation, generation, "服务端未返回已保存日记，当前输入与重试标识仍保留");
        return;
      }
      completeIdempotentCommand(commandScope);
      operations.succeed(diaryOperation, generation);
      startTransition(() => router.refresh());
    } catch {
      operations.fail(diaryOperation, generation, "网络结果未知，阶段日记与重试标识仍保留；请核对后显式重试。");
    }
  }

  async function submitStagePlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const generation = operations.tryBegin(stagePlanOperation);
    if (generation === null) return;

    let parsedStartDate: string;
    let parsedEndDate: string;
    try {
      parsedStartDate = shanghaiDateTimeInputToIso(stagePlanStartDate);
      parsedEndDate = shanghaiDateTimeInputToIso(stagePlanEndDate);
    } catch (caught) {
      operations.fail(
        stagePlanOperation,
        generation,
        isShanghaiDateInputError(caught) ? "阶段起止时间无效，请重新选择日期和时间。" : "无法解析阶段起止时间。",
      );
      return;
    }
    const submission = {
      name: stagePlanName,
      startDate: parsedStartDate,
      endDate: parsedEndDate,
      goal: stagePlanGoal,
      mode: stagePlanMode,
      status: stagePlanStatus,
    };
    const commandScope = "simulation-workbench:stage-plan:create";
    try {
      const response = await createSimulationStagePlan({
        ...submission,
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "stage-plan", submission),
      });
      if (!response.ok) {
        operations.fail(stagePlanOperation, generation, responseError(response, "保存阶段计划失败"));
        return;
      }
      if (!response.body?.plan?.id) {
        operations.fail(stagePlanOperation, generation, "服务端未返回已保存阶段计划，当前输入与重试标识仍保留");
        return;
      }
      completeIdempotentCommand(commandScope);
      operations.succeed(stagePlanOperation, generation);
      setSelectedStagePlanId(response.body.plan.id);
      startTransition(() => router.refresh());
    } catch {
      operations.fail(stagePlanOperation, generation, "网络结果未知，阶段计划输入与重试标识仍保留；请核对后显式重试。");
    }
  }

  async function generatePersistentDraft() {
    await generateDraft("local");
  }

  async function generateAiPersistentDraft() {
    await generateDraft("ai");
  }

  async function generateDraft(source: "local" | "ai") {
    const operationKey = draftGenerationOperation(selectedStagePlanId);
    const generation = operations.tryBegin(operationKey);
    if (generation === null) return;
    const submission = { stagePlanId: selectedStagePlanId || null };
    const commandScope = `simulation-workbench:stage-draft:${source}:${selectedStagePlanId || "unbound"}`;
    try {
      const createDraft = source === "ai"
        ? createAiSimulationStageAdjustmentDraft
        : createSimulationStageAdjustmentDraft;
      const response = await createDraft({
        ...submission,
        idempotencyKey: getOrCreateIdempotencyKey(
          commandScope,
          source === "ai" ? "stage-draft-ai" : "stage-draft",
          submission,
        ),
      });
      if (!response.ok) {
        operations.fail(
          operationKey,
          generation,
          responseError(response, source === "ai" ? "生成 AI 阶段草稿失败" : "生成阶段调整草稿失败"),
        );
        return;
      }
      if (!response.body?.draft) {
        operations.fail(operationKey, generation, source === "ai"
          ? "服务端未返回 AI 阶段草稿，当前输入与重试标识仍保留"
          : "服务端未返回阶段草稿，当前输入与重试标识仍保留");
        return;
      }
      completeIdempotentCommand(commandScope);
      operations.succeed(operationKey, generation);
      startTransition(() => router.refresh());
    } catch {
      operations.fail(operationKey, generation, "网络结果未知，阶段草稿命令仍保留；请核对后显式重试。");
    }
  }

  async function decidePersistentDraft(id: string, revision: number, action: "confirm" | "reject") {
    if (action === "reject" && !window.confirm("驳回后当前阶段草稿进入不可逆终态。确认驳回？")) return;
    const operationKey = draftDecisionOperation(id);
    const generation = operations.tryBegin(operationKey);
    if (generation === null) return;
    const submission = { id, revision, action } as const;
    try {
      const response = await decideSimulationStageAdjustmentDraft(
        submission.id,
        submission.action,
        submission.revision,
      );
      if (!response.ok) {
        operations.fail(
          operationKey,
          generation,
          responseError(response, action === "confirm" ? "确认阶段草稿失败" : "驳回阶段草稿失败"),
        );
        return;
      }
      operations.succeed(operationKey, generation);
      startTransition(() => router.refresh());
    } catch {
      operations.fail(operationKey, generation, "网络结果未知，阶段草稿决策未自动重放；请核对后显式重试。");
    }
  }

  return (
    <div className="af-simulation-workbench-grid grid gap-5">
      <SimulationExamSection
        exams={exams}
        tasks={tasks}
        pending={operations.get(examCreateOperation).pending}
        error={operations.get(examCreateOperation).error}
        examName={examName}
        examDate={examDate}
        firstSynchronized={isFirstSynchronized}
        targetDurationMinutes={targetDurationMinutes}
        targetScore={examTargetScore}
        onExamNameChange={setExamName}
        onExamDateChange={setExamDate}
        onFirstSynchronizedChange={setIsFirstSynchronized}
        onTargetDurationChange={setTargetDurationMinutes}
        onTargetScoreChange={setExamTargetScore}
        onSubmit={submitExam}
      />
      <div className="grid gap-5">
        <SimulationStageSection
          plans={stagePlans}
          drafts={stageAdjustmentDrafts}
          name={stagePlanName}
          goal={stagePlanGoal}
          startDate={stagePlanStartDate}
          endDate={stagePlanEndDate}
          mode={stagePlanMode}
          status={stagePlanStatus}
          selectedPlanId={selectedStagePlanId}
          stagePlanPending={operations.get(stagePlanOperation).pending}
          stagePlanError={operations.get(stagePlanOperation).error}
          draftGenerationPending={operations.get(currentDraftGenerationOperation).pending}
          draftGenerationError={operations.get(currentDraftGenerationOperation).error}
          getDraftOperation={(id) => operations.get(draftDecisionOperation(id))}
          onNameChange={setStagePlanName}
          onGoalChange={setStagePlanGoal}
          onStartDateChange={setStagePlanStartDate}
          onEndDateChange={setStagePlanEndDate}
          onModeChange={setStagePlanMode}
          onStatusChange={setStagePlanStatus}
          onSelectedPlanChange={setSelectedStagePlanId}
          onSubmit={submitStagePlan}
          onGenerateDraft={() => void generatePersistentDraft()}
          onGenerateAiDraft={() => void generateAiPersistentDraft()}
          onDecideDraft={(id, revision, action) =>
            void decidePersistentDraft(id, revision, action)}
        />
        <SimulationResultSection
          exams={exams}
          subjects={subjects}
          selectedExamId={resolvedSelectedExamId}
          selectedSubjectId={resultSubjectId}
          targetScore={resultTargetScore}
          actualScore={resultActualScore}
          durationMinutes={resultDurationMinutes}
          blankCount={blankCount}
          lossReason={lossReason}
          mindset={mindset}
          summary={summary}
          pending={operations.get(currentResultOperation).pending}
          error={operations.get(currentResultOperation).error}
          onExamChange={setSelectedExamId}
          onSubjectChange={setResultSubjectId}
          onTargetScoreChange={setResultTargetScore}
          onActualScoreChange={setResultActualScore}
          onDurationChange={setResultDurationMinutes}
          onBlankCountChange={setBlankCount}
          onLossReasonChange={setLossReason}
          onMindsetChange={setMindset}
          onSummaryChange={setSummary}
          onSubmit={saveStructuredResults}
        />
        <SimulationDiarySection
          value={firstSimulationDiary}
          pending={operations.get(diaryOperation).pending}
          error={operations.get(diaryOperation).error}
          onChange={setFirstSimulationDiary}
          onSubmit={saveDiary}
        />
      </div>
    </div>
  );
}

function responseError(result: { status: number; body: { error?: string } | null } | null, fallback: string): string {
  const feedback = mutationFeedback(result, fallback);
  if (feedback.kind === "unauthorized") redirectToLoginWithCurrentLocation();
  return feedback.message;
}
