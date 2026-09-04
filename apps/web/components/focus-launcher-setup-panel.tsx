import { BookOpen, ListTodo, Play } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { SubjectTileGrid } from "@/components/focus-launcher-views";
import type { StudyTaskDto, SubjectDto } from "@/lib/contracts";

export function FocusLauncherSetupPanel(props: {
  subjects: SubjectDto[];
  subjectId: string;
  selectedSubject: SubjectDto | null;
  relatedSubjectTasks: StudyTaskDto[];
  taskId: string;
  tasks: StudyTaskDto[];
  commandMode?: "now";
  commandText?: string;
  error: string | null;
  startBusy: boolean;
  conflictDialog: ReactNode;
  onSubjectSelect: (subjectId: string) => void;
  onTaskSelect: (taskId: string) => void;
  onStart: () => void;
}) {
  return (
    <aside className="af-focus-config flex min-h-[32rem] flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-[var(--af-surface-subtle)] p-4 sm:p-5 lg:p-6">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1 focus-scrollbar">
        <div>
          <div className="flex items-center gap-2 text-teal-300">
            <BookOpen className="size-4 sm:size-5" aria-hidden="true" />
            <span className="text-[11px] sm:text-xs font-medium uppercase tracking-wider">Focus Setup</span>
          </div>
          <h1 className="mt-2 text-xl sm:text-2xl font-semibold text-white">今天先学什么？</h1>
          <p className="mt-1 text-xs sm:text-sm leading-relaxed text-zinc-400">
            科目是开始学习的唯一必选项。具体学了什么，结束后再按实际情况沉淀。
          </p>
          {props.commandMode === "now" ? (
            <p className="mt-2 rounded-md bg-teal-500/10 border border-teal-500/20 px-3 py-1.5 text-xs text-teal-200">
              已识别“立即开始”命令{props.commandText ? `：${props.commandText}` : ""}，选定科目后即刻启动计时。
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="focus-subject-select" className="text-xs sm:text-sm font-medium text-zinc-300">
              选择科目 <span className="text-[11px] sm:text-xs text-zinc-500">(按数字键 1-{Math.min(props.subjects.length, 9)} 快捷选择)</span>
            </label>
          </div>
          <SubjectTileGrid
            subjects={props.subjects}
            subjectId={props.subjectId}
            onSelect={props.onSubjectSelect}
            tasks={props.tasks}
          />
          <Select
            id="focus-subject-select"
            value={props.subjectId}
            onChange={(event) => props.onSubjectSelect(event.target.value)}
            className="sr-only"
            disabled={!props.subjects.length}
            aria-label="科目"
          >
            <option value="">选择科目</option>
            {props.subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>{subject.name}</option>
            ))}
          </Select>
        </div>
        {props.selectedSubject && props.relatedSubjectTasks.length > 0 ? (
          <div className="space-y-2">
            <label htmlFor="focus-task-select" className="text-xs sm:text-sm font-medium text-zinc-300">
              关联任务 <span className="text-zinc-500">（可选）</span>
            </label>
            <Select
              id="focus-task-select"
              value={props.taskId}
              onChange={(event) => props.onTaskSelect(event.target.value)}
              aria-label="关联任务"
            >
              <option value="">自由学习，结束时再归档内容</option>
              {props.relatedSubjectTasks.map((task) => (
                <option key={task.id} value={task.id}>{task.title}</option>
              ))}
            </Select>
          </div>
        ) : null}
        {props.selectedSubject && props.relatedSubjectTasks.length > 0 ? (
          <div className="rounded-xl border border-white/10 bg-[var(--af-surface)] p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
              <ListTodo className="size-3.5 text-teal-300" aria-hidden="true" />
              <span>今日待办参考 ({props.relatedSubjectTasks.length})</span>
            </div>
            <ul className="mt-2 space-y-1">
              {props.relatedSubjectTasks.slice(0, 3).map((task) => (
                <li key={task.id} className="flex items-center justify-between text-xs text-zinc-400">
                  <span className="truncate pr-2">• {task.title}</span>
                  {task.estimatedMinutes ? <span className="shrink-0 text-zinc-500">{task.estimatedMinutes}m</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {!props.subjects.length ? (
          <Alert tone="warning" title="还没有可用科目">
            先到设置 → 考试与科目添加至少一个科目。
          </Alert>
        ) : null}
        {props.error ? <Alert tone="danger">{props.error}</Alert> : null}
      </div>
      <div className="shrink-0 pt-3 space-y-2 border-t border-white/5">
        <Button
          type="button"
          variant="primary"
          size="lg"
          className={`w-full h-11 sm:h-12 text-sm sm:text-base font-medium transition-all duration-200 ${
            props.selectedSubject
              ? "hover:scale-[1.01] active:scale-[0.98] shadow-[0_0_24px_rgba(45,212,191,0.25)] hover:shadow-[0_0_36px_rgba(45,212,191,0.45)] ring-1 ring-teal-400/40"
              : "shadow-[0_0_16px_rgba(45,212,191,0.1)]"
          }`}
          onClick={props.onStart}
          loading={props.startBusy}
          disabled={!props.subjects.length || !props.subjectId}
        >
          <Play className="size-4 fill-current transition-transform group-hover:scale-110" aria-hidden="true" />
          {props.selectedSubject ? `开始【${props.selectedSubject.name}】专注` : "开始学习"}
        </Button>
        <p className="text-center text-[11px] sm:text-xs leading-normal text-zinc-500">
          多标签页与设备自动单实例互斥 · 离开页面计时后台继续
        </p>
      </div>
      {props.conflictDialog}
    </aside>
  );
}
