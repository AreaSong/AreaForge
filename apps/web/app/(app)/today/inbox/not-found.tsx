import { WorkbenchNotFound } from "@/components/workbench-not-found";

export default function PlanInboxNotFound() {
  return (
    <WorkbenchNotFound
      title="计划草稿不存在"
      description="这条收件箱记录已不可用，其他计划草稿和正式任务没有被修改。"
      href="/today/inbox"
      linkLabel="返回计划收件箱"
    />
  );
}
