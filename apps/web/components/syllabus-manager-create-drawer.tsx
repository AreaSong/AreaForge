import type { SyllabusManagerController } from "@/components/syllabus-manager-controller";
import { StatusOptions } from "@/components/syllabus-manager-labels";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Drawer } from "@/components/ui/overlays";
import type { SyllabusNodeKindDto, SyllabusNodeStatusDto } from "@/lib/contracts";
import { Plus } from "lucide-react";

export function SyllabusManagerCreateDrawer({
  controller,
}: {
  controller: SyllabusManagerController;
}) {
  const { runtime, workbench, create } = controller;
  const { state, actions } = create;
  const busy = runtime.pendingCommand !== null;

  return (
    <Drawer open={state.createOpen} title="新增考纲节点" onClose={() => actions.setCreateOpen(false)}>
      <form className="grid min-w-0 gap-3" onSubmit={actions.submitCreate}>
        <label className="grid min-w-0 gap-2 text-sm text-zinc-300">
          科目
          <Select value={workbench.subjectId} onChange={(event) => actions.changeSubject(event.target.value)} required disabled={busy}>
            {workbench.subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>{subject.name}</option>
            ))}
          </Select>
        </label>

        <label className="grid min-w-0 gap-2 text-sm text-zinc-300">
          父节点
          <Select value={state.parentId} onChange={(event) => actions.setParentId(event.target.value)} disabled={busy}>
            <option value="">作为根节点</option>
            {workbench.parentOptions.map((node) => (
              <option key={node.id} value={node.id}>{"  ".repeat(node.depth)}{node.title}</option>
            ))}
          </Select>
        </label>

        <Input
          value={state.title}
          onChange={(event) => actions.setTitle(event.target.value)}
          placeholder="章节、知识点或题型名称"
          required
          disabled={busy}
        />

        <div className="af-content-grid-three grid min-w-0 gap-3">
          <Select value={state.kind} onChange={(event) => actions.setKind(event.target.value as SyllabusNodeKindDto)} disabled={busy}>
            <option value="subject">科目</option>
            <option value="chapter">章节</option>
            <option value="topic">知识点</option>
            <option value="problem_type">题型专题</option>
          </Select>
          <Select value={state.status} onChange={(event) => actions.setStatus(event.target.value as SyllabusNodeStatusDto)} disabled={busy}>
            <StatusOptions />
          </Select>
          <Input
            type="number"
            min={0}
            max={100000}
            value={state.targetMinutes}
            onChange={(event) => actions.setTargetMinutes(Number(event.target.value))}
            aria-label="目标分钟"
            disabled={busy}
          />
        </div>

        <Button type="submit" variant="primary" size="lg" disabled={runtime.isPending || busy || !workbench.subjectId}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          写入考纲
        </Button>
      </form>

      {runtime.error ? <p className="mt-4 text-sm text-red-200">{runtime.error}</p> : null}

      <div className="mt-6 border-t border-white/10 pt-5">
        <h3 className="text-sm font-medium text-zinc-100">Markdown 导入</h3>
        <form className="mt-3 grid min-w-0 gap-3" onSubmit={actions.submitImport}>
          <Textarea
            controlHeight="lg"
            value={state.importMarkdown}
            onChange={(event) => actions.setImportMarkdown(event.target.value)}
            placeholder={"# 第一章\n## 极限\n- 极限定义\n  - 夹逼准则"}
            required
            disabled={busy}
          />
          <Button
            type="submit"
            variant="secondary"
            size="lg"
            disabled={runtime.isPending || busy || !workbench.subjectId || state.importMarkdown.trim().length === 0}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            导入节点
          </Button>
        </form>
        {state.importNotice ? <p className="mt-3 text-sm text-teal-200">{state.importNotice}</p> : null}
      </div>
    </Drawer>
  );
}
