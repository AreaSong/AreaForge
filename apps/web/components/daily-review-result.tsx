import { ArrowRight, CheckCircle2 } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { withReturnTo } from "@/lib/navigation/batch7";
import type { PlanInboxItemDto } from "@/lib/study/plan-inbox-service";
import type { DailyReviewDto } from "@/lib/study/types";

export function DailyReviewResult(props: {
  review: DailyReviewDto;
  inboxItem: PlanInboxItemDto | null;
}) {
  const convertedTaskId = props.inboxItem?.convertedTaskId;
  const resultCopy = convertedTaskId
    ? "已经转为明日正式任务。"
    : props.inboxItem?.status === "DISMISSED"
      ? "对应的计划草稿已忽略，可重新打开后继续处理。"
      : props.inboxItem
        ? "已进入计划收件箱，补全科目和时长后即可转为正式任务。"
        : "已保存，正在等待收件箱结果同步。";
  const returnTo = "/review/daily";
  return (
    <section className="border-y border-emerald-400/25 bg-emerald-500/[0.05] py-5" aria-label="复盘完成结果">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-emerald-200">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            <h2 className="font-medium">今日复盘已完成</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-300">
            明日最低行动“{props.review.tomorrowMinimum}”
            {resultCopy}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ButtonLink href="/today" variant="secondary">返回今日</ButtonLink>
          {convertedTaskId ? (
            <ButtonLink href={withReturnTo(`/plan/tasks/${convertedTaskId}`, returnTo)} variant="primary">
              打开明日任务 <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
          ) : props.inboxItem ? (
      <ButtonLink href={withReturnTo(`/plan/inbox/${props.inboxItem.id}`, returnTo)} variant="primary">
              {props.inboxItem.status === "DISMISSED" ? "查看计划草稿" : "补全明日任务"}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
          ) : (
      <ButtonLink href={withReturnTo("/plan/inbox", returnTo)} variant="primary">查看计划收件箱</ButtonLink>
          )}
        </div>
      </div>
    </section>
  );
}
