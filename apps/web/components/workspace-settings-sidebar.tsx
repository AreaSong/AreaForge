import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import type { ExamWorkspaceDto } from "@/lib/contracts";

export function WorkspaceSettingsSidebar(props: {
  setupMode: boolean;
  step: "goal" | "takeover";
  activeId: string | null;
  activeWorkspace: ExamWorkspaceDto | null;
  activeSubjectCount: number;
  workspaces: ExamWorkspaceDto[];
  pending: boolean;
  onActivate: (workspace: ExamWorkspaceDto) => void;
}) {
  if (props.setupMode || !props.activeId) {
    return (
      <aside className="space-y-5">
        <Card variant="master" className="space-y-4">
          <CardHeader className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-teal-300">配置流程</span>
            <CardTitle className="text-base">建立备考目标</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 text-sm">
            <ol className="space-y-2">
              <li className={`flex items-center gap-2.5 rounded-xl border p-2.5 transition-colors ${props.step === "goal" ? "border-teal-400/40 bg-teal-500/10 text-teal-200" : "border-white/5 bg-white/[0.02] text-zinc-400"}`}>
                <span className="grid size-6 place-items-center rounded-full border border-current text-xs font-semibold">1</span>
                <span className="text-xs font-medium">考试目标与首批科目</span>
              </li>
              <li className={`flex items-center gap-2.5 rounded-xl border p-2.5 transition-colors ${props.step === "takeover" ? "border-teal-400/40 bg-teal-500/10 text-teal-200" : "border-white/5 bg-white/[0.02] text-zinc-400"}`}>
                <span className="grid size-6 place-items-center rounded-full border border-current text-xs font-semibold">2</span>
                <span className="text-xs font-medium">已有数据处理方式</span>
              </li>
            </ol>
            <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-relaxed text-amber-200">
              完成前不会创建工作区，也不会移动任何已有学习数据。
            </div>
          </CardContent>
        </Card>
      </aside>
    );
  }

  return (
    <aside className="space-y-5">
      {props.activeWorkspace ? (
        <Card variant="master" className="space-y-4">
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-teal-300">当前工作区</span>
              <Badge tone="success">生效中</Badge>
            </div>
            <CardTitle className="text-lg">{props.activeWorkspace.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 text-sm">
            <div className="space-y-2 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs text-zinc-300">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">目标考试日</span>
                <span className="font-medium text-white">{props.activeWorkspace.targetExamDate ? props.activeWorkspace.targetExamDate.slice(0, 10) : "未设置"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">使用中科目</span>
                <span className="font-medium text-teal-300">{props.activeSubjectCount} 个</span>
              </div>
              {props.activeWorkspace.stageSummary ? (
                <div className="border-t border-white/5 pt-2 text-zinc-400">
                  <span className="mb-1 block text-zinc-500">阶段摘要</span>
                  <p className="line-clamp-3 leading-relaxed">{props.activeWorkspace.stageSummary}</p>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card variant="subtle" className="space-y-3">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">其他工作区</CardTitle>
            <Badge>{props.workspaces.length} 个</Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0 text-xs">
          <ul className="space-y-2">
            {props.workspaces.map((workspace) => (
              <li key={workspace.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-2">
                <span className="truncate font-medium text-zinc-300">{workspace.name}</span>
                {workspace.id !== props.activeId ? (
                  <Button type="button" size="sm" variant="secondary" disabled={props.pending} onClick={() => props.onActivate(workspace)}>设为当前</Button>
                ) : <Badge tone="success">使用中</Badge>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </aside>
  );
}
