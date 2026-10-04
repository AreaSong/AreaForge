import { CheckCircle2, Plus, Save } from "lucide-react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/field";
import { SectionSurface, Surface } from "@/components/ui/surface";
import type { SimulationExamDto, StudyTaskDto, SubjectDto } from "@/lib/contracts";
import { formatDate, formatDateTime, formatTaskStatus } from "@/lib/formatters";
import { formatMaybeNumber } from "@/components/simulation-workbench-model";

interface SimulationExamSectionProps {
  exams: SimulationExamDto[];
  tasks: StudyTaskDto[];
  pending: boolean;
  error: string | null;
  examName: string;
  examDate: string;
  firstSynchronized: boolean;
  targetDurationMinutes: number;
  targetScore: string;
  onExamNameChange: (value: string) => void;
  onExamDateChange: (value: string) => void;
  onFirstSynchronizedChange: (value: boolean) => void;
  onTargetDurationChange: (value: number) => void;
  onTargetScoreChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function SimulationExamSection(props: SimulationExamSectionProps) {
  return (
    <SectionSurface>
      <div className="flex items-center gap-2">
        <Plus className="h-5 w-5 text-teal-300" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-white">创建结构化模拟考试</h2>
      </div>
      <form className="mt-5 grid gap-3" onSubmit={props.onSubmit}>
        <Input className="h-11" value={props.examName} onChange={(event) => props.onExamNameChange(event.target.value)} placeholder="考试名称" disabled={props.pending} required />
        <div className="af-content-grid-three grid gap-3">
          <Input className="h-11" type="datetime-local" value={props.examDate} onChange={(event) => props.onExamDateChange(event.target.value)} disabled={props.pending} required />
          <Input className="h-11" type="number" min={30} max={720} value={props.targetDurationMinutes} onChange={(event) => props.onTargetDurationChange(Number(event.target.value))} aria-label="目标用时" disabled={props.pending} />
          <Input className="h-11" value={props.targetScore} onChange={(event) => props.onTargetScoreChange(event.target.value)} placeholder="目标总分" disabled={props.pending} />
        </div>
        <label className="flex items-center gap-2 rounded-[var(--af-radius-control)] border border-[var(--af-border)] bg-[var(--af-surface-raised)] px-3 py-3 text-sm text-zinc-200">
          <Checkbox checked={props.firstSynchronized} onChange={(event) => props.onFirstSynchronizedChange(event.target.checked)} disabled={props.pending} />
          标记为首次同步自测
        </label>
        <Button variant="primary" size="lg" className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50" type="submit" loading={props.pending} loadingLabel="创建中...">
          <Plus className="h-4 w-4" aria-hidden="true" />新建
        </Button>
      </form>
      {props.error ? <Alert tone="danger" className="mt-3">{props.error}</Alert> : null}
      <ExamHistory exams={props.exams} tasks={props.tasks} />
    </SectionSurface>
  );
}

function ExamHistory({ exams, tasks }: { exams: SimulationExamDto[]; tasks: StudyTaskDto[] }) {
  return (
    <>
      <div className="mt-6 grid gap-3">
        <h3 className="font-medium text-white">结构化模拟考试</h3>
        {exams.length === 0 ? <p className="rounded-md border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-400">还没有结构化模拟考试记录。</p> : null}
        {exams.map((exam) => (
          <Surface as="article" key={exam.id} tone="raised" padding="sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm text-zinc-400">{formatDateTime(exam.examDate)}{exam.isFirstSynchronized ? " / 同步自测" : ""}</p>
                <h3 className="mt-1 font-medium text-white">{exam.name}</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  总分 {formatMaybeNumber(exam.actualScore)} / {formatMaybeNumber(exam.targetScore)} · 用时 {exam.actualDurationMinutes ?? "-"} / {exam.targetDurationMinutes ?? "-"} 分 · 空题 {exam.blankQuestionCount}
                </p>
              </div>
              <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300">{exam.subjectResults.length} 科</span>
            </div>
            {exam.subjectResults.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {exam.subjectResults.map((result) => (
                  <p key={result.id} className="rounded-md border border-white/10 px-3 py-2 text-xs leading-5 text-zinc-300">
                    {result.subjectName}：{formatMaybeNumber(result.actualScore)} / {formatMaybeNumber(result.targetScore)} · {result.durationMinutes ?? "-"} 分 · 空题 {result.blankQuestionCount}
                  </p>
                ))}
              </div>
            ) : null}
            {exam.reviewText ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{exam.reviewText}</p> : null}
          </Surface>
        ))}
      </div>
      {tasks.length > 0 ? (
        <div className="mt-6 grid gap-3">
          <h3 className="font-medium text-white">旧任务型模拟（只读）</h3>
          {tasks.map((task) => (
            <Surface as="article" key={task.id} tone="raised" padding="sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm text-zinc-400">{task.subjectName}</p>
                  <h3 className="mt-1 font-medium text-white">{task.title}</h3>
                  <p className="mt-1 text-xs text-zinc-500">{formatDateTime(task.plannedDate)} / {formatTaskStatus(task.status)}</p>
                  {task.syllabusNodeTitle ? <p className="mt-1 text-xs text-teal-200">节点：{task.syllabusNodeTitle}</p> : null}
                </div>
                <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300">{task.actualMinutes || task.estimatedMinutes} 分</span>
              </div>
              {task.reviewText ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{task.reviewText}</p> : null}
            </Surface>
          ))}
        </div>
      ) : null}
    </>
  );
}

interface SimulationResultSectionProps {
  exams: SimulationExamDto[];
  subjects: SubjectDto[];
  selectedExamId: string;
  selectedSubjectId: string;
  targetScore: string;
  actualScore: string;
  durationMinutes: number;
  blankCount: number;
  lossReason: string;
  mindset: string;
  summary: string;
  pending: boolean;
  error: string | null;
  onExamChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  onTargetScoreChange: (value: string) => void;
  onActualScoreChange: (value: string) => void;
  onDurationChange: (value: number) => void;
  onBlankCountChange: (value: number) => void;
  onLossReasonChange: (value: string) => void;
  onMindsetChange: (value: string) => void;
  onSummaryChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function SimulationResultSection(props: SimulationResultSectionProps) {
  return (
    <SectionSurface>
      <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-amber-300" aria-hidden="true" /><h2 className="text-lg font-semibold text-white">保存结构化模拟结果</h2></div>
      <form className="mt-5 grid gap-3" onSubmit={props.onSubmit}>
        <Select className="h-11" value={props.selectedExamId} onChange={(event) => props.onExamChange(event.target.value)} disabled={props.pending} required>
          {props.exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.name} / {formatDate(exam.examDate)}</option>)}
        </Select>
        <Select className="h-11" value={props.selectedSubjectId} onChange={(event) => props.onSubjectChange(event.target.value)} disabled={props.pending} required>
          {props.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
        </Select>
        <div className="af-content-grid-three grid gap-3">
          <Input className="h-11" value={props.targetScore} onChange={(event) => props.onTargetScoreChange(event.target.value)} placeholder="科目目标分" disabled={props.pending} />
          <Input className="h-11" value={props.actualScore} onChange={(event) => props.onActualScoreChange(event.target.value)} placeholder="科目实际分" disabled={props.pending} />
          <Input className="h-11" type="number" min={0} max={300} value={props.blankCount} onChange={(event) => props.onBlankCountChange(Number(event.target.value))} aria-label="空题数量" disabled={props.pending} />
        </div>
        <Input className="h-11" type="number" min={0} max={720} value={props.durationMinutes} onChange={(event) => props.onDurationChange(Number(event.target.value))} aria-label="实际用时" disabled={props.pending} />
        <Textarea controlHeight="md" value={props.lossReason} onChange={(event) => props.onLossReasonChange(event.target.value)} placeholder="失分原因" disabled={props.pending} />
        <Textarea controlHeight="md" value={props.mindset} onChange={(event) => props.onMindsetChange(event.target.value)} placeholder="心态记录" disabled={props.pending} />
        <Textarea controlHeight="md" className="min-h-28" value={props.summary} onChange={(event) => props.onSummaryChange(event.target.value)} placeholder="考后总结" disabled={props.pending} required />
        <Button variant="primary" size="lg" className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-amber-300 px-4 font-medium text-[#17110a] disabled:cursor-not-allowed disabled:opacity-50" type="submit" loading={props.pending} loadingLabel="保存中..." disabled={props.exams.length === 0 || props.subjects.length === 0}>
          <Save className="h-4 w-4" aria-hidden="true" />保存结果
        </Button>
      </form>
      {props.error ? <Alert tone="danger" className="mt-3">{props.error}</Alert> : null}
    </SectionSurface>
  );
}

export function SimulationDiarySection(props: {
  value: string;
  pending: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <SectionSurface>
      <h2 className="text-lg font-semibold text-white">第一次全真自测阶段日记</h2>
      <form className="mt-5 grid gap-3" onSubmit={props.onSubmit}>
        <Textarea controlHeight="lg" value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder="自测后写下分数、心态、暴露问题和下一阶段判断" disabled={props.pending} required />
        <Button variant="primary" size="lg" className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50" type="submit" loading={props.pending} loadingLabel="保存中...">
          <Save className="h-4 w-4" aria-hidden="true" />保存阶段日记
        </Button>
      </form>
      {props.error ? <Alert tone="danger" className="mt-3">{props.error}</Alert> : null}
    </SectionSurface>
  );
}
