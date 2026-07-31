import { WorkbenchNotFound } from "@/components/workbench-not-found";

export default function TodayNotFound() {
  return (
    <WorkbenchNotFound
      title="行动记录不存在"
      description="这条任务或收件箱记录已不可用，其他今日行动没有被修改。"
      href="/today"
      linkLabel="返回今日行动中心"
    />
  );
}
