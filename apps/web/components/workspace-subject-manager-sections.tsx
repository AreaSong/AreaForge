import { useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { ColorSwatches } from "@/components/ui/color-swatches";
import { Input, Select } from "@/components/ui/field";
import type { SubjectGroupDto, WorkspaceSubjectDto } from "@/lib/contracts";

export const subjectColors = ["#35d7c5", "#22c55e", "#f59e0b", "#3b82f6", "#ef4444", "#a78bfa"];

export function SubjectRow(props: {
  subject: WorkspaceSubjectDto;
  groups: SubjectGroupDto[];
  activeGroups: SubjectGroupDto[];
  editing: boolean;
  pending: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onMove: (move: "UP" | "DOWN") => void;
  onArchive: () => void;
}) {
  const [name, setName] = useState(props.subject.name);
  const [color, setColor] = useState(props.subject.color);
  const [groupId, setGroupId] = useState(() => (
    props.activeGroups.some((group) => group.id === props.subject.groupId)
      ? props.subject.groupId ?? ""
      : ""
  ));
  const effectiveGroupId = props.activeGroups.some((group) => group.id === groupId) ? groupId : "";

  if (props.editing) {
    return (
      <div className="space-y-3 p-3">
        <div className="af-content-grid-two grid gap-3">
          <label className="text-sm text-zinc-400">名称<Input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 bg-[#151a20] px-3 text-white" /></label>
          <label className="text-sm text-zinc-400">分组<Select value={effectiveGroupId} onChange={(event) => setGroupId(event.target.value)} className="mt-1 bg-[#151a20] px-3 text-white"><option value="">不分组</option>{props.activeGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Palette size={16} className="text-zinc-500" aria-hidden="true" />
            <ColorSwatches colors={subjectColors} value={color} onChange={setColor} label="科目颜色" />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={props.pending} onClick={props.onCancel}><X size={15} aria-hidden="true" />取消</Button>
            <Button type="button" variant="primary" size="sm" disabled={props.pending || !name.trim()} onClick={() => void props.onSave({ name, color, groupId: effectiveGroupId || null })}><Save size={15} aria-hidden="true" />保存</Button>
          </div>
        </div>
      </div>
    );
  }

  const group = props.groups.find((item) => item.id === props.subject.groupId);
  return (
    <div className="flex flex-wrap items-center gap-3 p-3">
      <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: props.subject.color }} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium text-zinc-100">{props.subject.name}</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {group ? `${group.name}${group.archivedAt ? " · 已归档" : ""}` : "未分组"}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <IconButton label={`${props.subject.name}上移`} disabled={props.pending || !props.canMoveUp} onClick={() => props.onMove("UP")}><ArrowUp size={15} /></IconButton>
        <IconButton label={`${props.subject.name}下移`} disabled={props.pending || !props.canMoveDown} onClick={() => props.onMove("DOWN")}><ArrowDown size={15} /></IconButton>
        <IconButton label={`编辑${props.subject.name}`} disabled={props.pending} onClick={props.onEdit}><Pencil size={15} /></IconButton>
        <IconButton label={`归档${props.subject.name}`} disabled={props.pending} onClick={props.onArchive}><Archive size={15} /></IconButton>
      </div>
    </div>
  );
}

export function GroupManager(props: {
  groups: SubjectGroupDto[];
  pending: boolean;
  newName: string;
  newKey: string;
  onNameChange: (value: string) => void;
  onKeyChange: (value: string) => void;
  onAdd: () => void;
  onUpdate: (group: SubjectGroupDto, patch: Record<string, unknown>, success: string) => Promise<boolean>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const activeGroupIds = props.groups.filter((group) => !group.archivedAt).map((group) => group.id);

  return (
    <details className="rounded-md border border-white/10 p-3">
      <summary className="cursor-pointer text-sm font-medium text-zinc-300">管理分组（{props.groups.filter((group) => !group.archivedAt).length}）</summary>
      <div className="mt-4 space-y-4">
        <ul className="divide-y divide-white/10">
          {props.groups.map((group) => (
            <li key={group.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
              {editingId === group.id ? (
                <label className="min-w-0 flex-1 text-xs text-zinc-500">
                  分组名称
                  <Input
                    autoFocus
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    className="mt-1 h-9 w-full max-w-sm bg-[#151a20] px-3 text-sm text-white"
                  />
                </label>
              ) : (
                <span className={group.archivedAt ? "text-zinc-600" : "text-zinc-300"}>{group.name}{group.archivedAt ? " · 已归档" : ""}</span>
              )}
              <div className="flex gap-1">
                {editingId === group.id ? (
                  <>
                    <IconButton label="取消改名" disabled={props.pending} onClick={() => setEditingId(null)}><X size={15} /></IconButton>
                    <IconButton
                      label="保存分组名称"
                      disabled={props.pending || !editingName.trim()}
                      onClick={() => void props.onUpdate(group, { name: editingName }, "分组名称已保存。").then((saved) => {
                        if (saved) setEditingId(null);
                      })}
                    ><Save size={15} /></IconButton>
                  </>
                ) : (
                  <>
                    <IconButton label={`编辑${group.name}`} disabled={props.pending || Boolean(group.archivedAt)} onClick={() => { setEditingId(group.id); setEditingName(group.name); }}><Pencil size={15} /></IconButton>
                    <IconButton label={`${group.name}上移`} disabled={props.pending || Boolean(group.archivedAt) || activeGroupIds[0] === group.id} onClick={() => void props.onUpdate(group, { move: "UP" }, "分组顺序已更新。")}><ArrowUp size={15} /></IconButton>
                    <IconButton label={`${group.name}下移`} disabled={props.pending || Boolean(group.archivedAt) || activeGroupIds.at(-1) === group.id} onClick={() => void props.onUpdate(group, { move: "DOWN" }, "分组顺序已更新。")}><ArrowDown size={15} /></IconButton>
                    <IconButton label={group.archivedAt ? `恢复${group.name}` : `归档${group.name}`} disabled={props.pending} onClick={() => void props.onUpdate(group, { archived: !group.archivedAt }, group.archivedAt ? "分组已恢复。" : "分组已归档。")}>
                      {group.archivedAt ? <RotateCcw size={15} /> : <Archive size={15} />}
                    </IconButton>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="af-action-grid grid gap-2">
          <Input value={props.newName} onChange={(event) => props.onNameChange(event.target.value)} placeholder="新分组名称" className="bg-[#151a20] px-3 text-sm text-white" />
          <Button type="button" disabled={props.pending || !props.newName.trim()} onClick={props.onAdd}><Plus size={15} aria-hidden="true" />添加分组</Button>
          <details className="af-content-span-all text-xs text-zinc-500"><summary className="cursor-pointer">高级选项</summary><label className="mt-2 block max-w-md">内部标识<Input value={props.newKey} onChange={(event) => props.onKeyChange(event.target.value)} className="mt-1 h-9 bg-[#151a20] px-3" /></label></details>
        </div>
      </div>
    </details>
  );
}

export function subjectErrorMessage(code: string | undefined, fallback: string): string {
  if (code === "WORKSPACE_REVISION_CONFLICT") return "工作区刚刚发生变化，页面已刷新；请检查后再次提交。";
  if (code === "WORKSPACE_ACTIVE_SUBJECT_REQUIRED") return "至少需要保留一个使用中的科目。";
  if (code === "ACTIVE_SESSION_BLOCKS_SUBJECT_ARCHIVE") return "这个科目仍有进行中的计时，请先结束计时。";
  if (code === "SUBJECT_GROUP_NOT_FOUND") return "所选分组已不可用，请刷新后重新选择。";
  if (code === "SUBJECT_STABLE_KEY_ALREADY_EXISTS") return "该科目内部标识已存在，请修改后重试。";
  if (code === "SUBJECT_GROUP_STABLE_KEY_ALREADY_EXISTS") return "该分组内部标识已存在，请修改后重试。";
  if (code === "INTERNAL_ERROR") return "保存失败，请刷新后重试；若持续出现，请通过支持入口反馈。";
  return fallback;
}
