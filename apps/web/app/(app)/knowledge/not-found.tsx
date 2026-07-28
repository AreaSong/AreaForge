import { WorkbenchNotFound } from "@/components/workbench-not-found";

export default function KnowledgeNotFound() {
  return (
    <WorkbenchNotFound
      title="知识内容不存在"
      description="这条知识记录可能已归档、被移除，或不属于当前工作区。"
      href="/knowledge/canvas"
      linkLabel="返回知识工作台"
    />
  );
}
