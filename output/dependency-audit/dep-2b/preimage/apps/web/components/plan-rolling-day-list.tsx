import { Plus } from "lucide-react";
import { ListDetailLink } from "@/components/list-return-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
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
    <Card variant="master" className="p-5 space-y-4" aria-labelledby="selected-day-heading">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="selected-day-heading" className="text-base font-semibold text-white">{props.date ? formatPlanDay(props.date) : "当日"}任务</h2>
          <p className="mt-0.5 text-xs text-zinc-400">{props.tasks.length} 项正式任务</p>
        </div>
        {props.onCreate ? (
          <Button type="button" variant="secondary" size="sm" onClick={props.onCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            安排任务
          </Button>
        ) : null}
      </div>
      {props.tasks.length ? (
        <div className="space-y-2.5">
          {props.tasks.map((task) => (
            <Card
              key={task.id}
              variant="subtle"
              className={`p-3.5 transition-all duration-200 hover:border-teal-400/30 ${
                props.detailTaskId === task.id ? "border-teal-400/50 bg-teal-400/5 shadow-[0_0_12px_rgba(45,212,191,0.1)]" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <ListDetailLink
                    href={props.mobileHref(task.id)}
                    desktopHref={props.desktopHref(task.id)}
                    focusId={`plan-task-${props.date ?? "undated"}-${task.id}`}
                    className="block break-words text-sm font-medium text-white hover:text-teal-300"
                  >
                    {task.title}
                  </ListDetailLink>
                  <p className="mt-1 text-xs text-zinc-400">{task.subjectName} · {task.estimatedMinutes} 分</p>
                </div>
                <Badge tone={task.status === "done" ? "success" : task.status === "in_progress" ? "info" : "neutral"}>
                  {formatTaskStatus(task.status)}
                </Badge>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card variant="subtle" className="flex items-center justify-between gap-3 p-4">
          <p className="text-sm text-zinc-400">这一天还没有任务</p>
          {props.onCreate ? (
            <Button type="button" variant="ghost" size="sm" className="text-teal-300" onClick={props.onCreate}>
              安排任务
            </Button>
          ) : null}
        </Card>
      )}
    </Card>
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
