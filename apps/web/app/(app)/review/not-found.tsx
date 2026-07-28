import { WorkbenchNotFound } from "@/components/workbench-not-found";

export default function ReviewNotFound() {
  return (
    <WorkbenchNotFound
      title="复盘记录不存在"
      description="这条复盘或报告记录已不可用，当前报告列表仍可继续访问。"
      href="/review/reports"
      linkLabel="返回复盘工作台"
    />
  );
}
