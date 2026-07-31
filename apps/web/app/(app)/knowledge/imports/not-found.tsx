import { WorkbenchNotFound } from "@/components/workbench-not-found";

export default function LearningTreeImportNotFound() {
  return (
    <WorkbenchNotFound
      title="导入记录不存在"
      description="这次导入可能已归档、不可访问，或不属于当前考试工作区。"
      href="/knowledge/imports"
      linkLabel="返回导入工作台"
    />
  );
}
