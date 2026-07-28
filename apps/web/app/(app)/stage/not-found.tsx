import { WorkbenchNotFound } from "@/components/workbench-not-found";

export default function StageNotFound() {
  return (
    <WorkbenchNotFound
      title="阶段记录不存在"
      description="这条阶段或模拟记录已不可用，当前阶段计划没有被修改。"
      href="/stage/overview"
      linkLabel="返回阶段工作台"
    />
  );
}
