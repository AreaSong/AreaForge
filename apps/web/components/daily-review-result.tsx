import { ArrowRight, CheckCircle2 } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import type { PlanInboxItemDto } from "@/lib/contracts";
import type { DailyReviewDto } from "@/lib/contracts";

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
        ? "已进入投入草稿，补全科目和时长后即可转为正式任务。"
        : "已保存，正在等待收件箱结果同步。";
  const returnTo = "/roadmap/reviews/daily";
  return (
    <section className="border-y border-emerald-400/25 bg-emerald-500/[0.05] py-5" aria-label="复盘完成结果">
      <div className="af-action-grid grid gap-4">
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
        <div className="af-action-cluster">
          <ButtonLink href="/today" variant="secondary">返回今日</ButtonLink>
          {convertedTaskId ? (
            <ButtonLink href={withReturnTo(`/roadmap/allocation/tasks/${convertedTaskId}`, returnTo)} variant="primary">
              打开明日任务 <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
          ) : props.inboxItem ? (
      <ButtonLink href={withReturnTo(`/roadmap/allocation/drafts/${props.inboxItem.id}`, returnTo)} variant="primary">
              {props.inboxItem.status === "DISMISSED" ? "查看计划草稿" : "补全明日任务"}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
          ) : (
      <ButtonLink href={withReturnTo("/roadmap/allocation/drafts", returnTo)} variant="primary">查看投入草稿</ButtonLink>
          )}
        </div>
      </div>
    </section>
  );
}
