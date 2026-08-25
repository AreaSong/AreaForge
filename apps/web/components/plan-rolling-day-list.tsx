import { Plus } from "lucide-react";
import { ListDetailLink } from "@/components/list-return-context";
import { Button } from "@/components/ui/button";
import type { PlanRollingDto } from "@/lib/contracts";
import {
  formatDateMonthDayPadded,
  formatTaskStatus,
  formatWeekday,
  shanghaiDateInputToIso,
} from "@/lib/formatters";

export function DayTaskList(props: {
  date?: string;
  tasks: PlanRollingDto["tasks"];
  detailTaskId?: string;
  desktopHref: (taskId: string) => string;
  mobileHref: (taskId: string) => string;
  onCreate?: () => void;
}) {
  return (
    <section className="border-y border-white/10 py-4" aria-labelledby="selected-day-heading">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="selected-day-heading" className="text-sm font-medium text-zinc-200">{props.date ? formatPlanDay(props.date) : "当日"}任务</h2>
          <p className="mt-1 text-xs text-zinc-500">{props.tasks.length} 项正式任务</p>
        </div>
        {props.tasks.length === 0 && props.onCreate ? (
          <Button type="button" variant="ghost" size="sm" onClick={props.onCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            安排任务
          </Button>
        ) : null}
      </div>
      {props.tasks.length ? (
        <ul className="mt-3 divide-y divide-white/10">
          {props.tasks.map((task) => (
            <li key={task.id} className={`py-3 first:pt-0 last:pb-0 ${props.detailTaskId === task.id ? "border-l-2 border-teal-400 pl-3" : ""}`}>
              <ListDetailLink
                href={props.mobileHref(task.id)}
                desktopHref={props.desktopHref(task.id)}
                focusId={`plan-task-${props.date ?? "undated"}-${task.id}`}
                className="block break-words text-sm font-medium text-white hover:text-teal-300"
              >
                {task.title}
              </ListDetailLink>
              <p className="mt-1 text-xs text-zinc-500">{task.subjectName} · {task.estimatedMinutes} 分 · {formatTaskStatus(task.status)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-dashed border-white/10 px-3 py-4">
          <p className="text-sm text-zinc-500">这一天还没有任务</p>
          {props.onCreate ? <Button type="button" variant="ghost" size="sm" className="!h-auto !border-0 !p-0 text-sm text-teal-300" onClick={props.onCreate}>安排任务</Button> : null}
        </div>
      )}
    </section>
  );
}

export function formatPlanDay(value: string): string {
  const date = new Date(shanghaiDateInputToIso(value));
  return `${value.slice(5)} ${formatWeekday(date)}`;
}

export function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return formatDateMonthDayPadded(date);
}
