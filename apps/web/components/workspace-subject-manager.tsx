"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/overlays";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type {
  ExamWorkspaceDto,
  SubjectGroupDto,
  WorkspaceSubjectDto,
} from "@/lib/study/exam-workspace-service";
import { nextAvailableGeneratedKey } from "@/lib/study/workspace-first-use";

const subjectColors = ["#35d7c5", "#22c55e", "#f59e0b", "#3b82f6", "#ef4444", "#a78bfa"];

export function WorkspaceSubjectManager(props: {
  workspace: ExamWorkspaceDto;
  subjects: WorkspaceSubjectDto[];
  groups: SubjectGroupDto[];
}) {
  const router = useRouter();
  const [revision, setRevision] = useState(props.workspace.revision);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [archiveSubject, setArchiveSubject] = useState<WorkspaceSubjectDto | null>(null);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [createdSubjectKeys, setCreatedSubjectKeys] = useState<string[]>([]);
  const [newSubjectKey, setNewSubjectKey] = useState(() =>
    nextAvailableGeneratedKey("subject", props.subjects.map((subject) => subject.stableKey)),
  );
  const [newSubjectColor, setNewSubjectColor] = useState(subjectColors[0]!);
  const [newSubjectGroupId, setNewSubjectGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [createdGroupKeys, setCreatedGroupKeys] = useState<string[]>([]);
  const [newGroupKey, setNewGroupKey] = useState(() =>
    nextAvailableGeneratedKey("group", props.groups.map((group) => group.stableKey)),
  );

  const activeGroups = useMemo(
    () => props.groups.filter((group) => !group.archivedAt),
    [props.groups],
  );
  const activeSubjects = props.subjects.filter((subject) => !subject.archivedAt);
  const archivedSubjects = props.subjects.filter((subject) => subject.archivedAt);

  async function addSubject() {
    if (pending || !newSubjectName.trim()) return;
    setPending(true);
    clearFeedback();
    try {
      const response = await fetch(`/api/exam-workspaces/${props.workspace.id}/subjects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stableKey: newSubjectKey,
          name: newSubjectName,
          color: newSubjectColor,
          groupId: newSubjectGroupId || null,
          expectedWorkspaceRevision: Math.max(revision, props.workspace.revision),
        }),
      });
      if (response.status === 401) return redirectToLoginWithCurrentLocation();
      const body = await response.json().catch(() => null) as MutationResponse | null;
      if (!response.ok) {
        absorbLatestRevision(body);
        setError(subjectErrorMessage(body?.error, "添加科目失败，请检查名称和内部标识"));
        return;
      }
      setRevision((current) => current + 1);
      setNewSubjectName("");
      const createdKey = newSubjectKey.trim();
      setCreatedSubjectKeys((current) => [...current, createdKey]);
      setNewSubjectKey(nextAvailableGeneratedKey("subject", [
        ...props.subjects.map((subject) => subject.stableKey),
        ...createdSubjectKeys,
        createdKey,
      ]));
      setNotice("科目已添加。");
      router.refresh();
    } catch {
      setError("网络不可用，科目尚未添加。");
    } finally {
      setPending(false);
    }
  }

  async function updateSubject(subject: WorkspaceSubjectDto, patch: Record<string, unknown>, success: string) {
    if (pending) return false;
    setPending(true);
    clearFeedback();
    try {
      const response = await fetch(`/api/exam-workspaces/${props.workspace.id}/subjects/${subject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedWorkspaceRevision: Math.max(revision, props.workspace.revision), ...patch }),
      });
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return false;
      }
      const body = await response.json().catch(() => null) as MutationResponse | null;
      if (!response.ok) {
        absorbLatestRevision(body);
        setError(subjectErrorMessage(body?.error, "科目更新失败"));
        return false;
      }
      if (body?.workspace) setRevision(body.workspace.revision);
      setNotice(success);
      router.refresh();
      return true;
    } catch {
      setError("网络不可用，科目修改尚未保存。");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function addGroup() {
    if (pending || !newGroupName.trim()) return;
    setPending(true);
    clearFeedback();
    try {
      const response = await fetch(`/api/exam-workspaces/${props.workspace.id}/subject-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedWorkspaceRevision: Math.max(revision, props.workspace.revision),
          stableKey: newGroupKey,
          name: newGroupName,
        }),
      });
      if (response.status === 401) return redirectToLoginWithCurrentLocation();
      const body = await response.json().catch(() => null) as MutationResponse | null;
      if (!response.ok) {
        absorbLatestRevision(body);
        setError(subjectErrorMessage(body?.error, "添加分组失败"));
        return;
      }
      if (body?.workspace) setRevision(body.workspace.revision);
      setNewGroupName("");
      const createdKey = newGroupKey.trim();
      setCreatedGroupKeys((current) => [...current, createdKey]);
      setNewGroupKey(nextAvailableGeneratedKey("group", [
        ...props.groups.map((group) => group.stableKey),
        ...createdGroupKeys,
        createdKey,
      ]));
      setNotice("分组已添加。");
      router.refresh();
    } catch {
      setError("网络不可用，分组尚未添加。");
    } finally {
      setPending(false);
    }
  }

  async function updateGroup(group: SubjectGroupDto, patch: Record<string, unknown>, success: string) {
    if (pending) return false;
    setPending(true);
    clearFeedback();
    try {
      const response = await fetch(`/api/exam-workspaces/${props.workspace.id}/subject-groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedWorkspaceRevision: Math.max(revision, props.workspace.revision), ...patch }),
      });
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return false;
      }
      const body = await response.json().catch(() => null) as MutationResponse | null;
      if (!response.ok) {
        absorbLatestRevision(body);
        setError(subjectErrorMessage(body?.error, "分组更新失败"));
        return false;
      }
      if (body?.workspace) setRevision(body.workspace.revision);
      setNotice(success);
      router.refresh();
      return true;
    } catch {
      setError("网络不可用，分组修改尚未保存。");
      return false;
    } finally {
      setPending(false);
    }
  }

  function clearFeedback() {
    setError(null);
    setNotice(null);
  }

  function absorbLatestRevision(body: MutationResponse | null) {
    if (body?.latest) setRevision(body.latest.revision);
    if (body?.error === "WORKSPACE_REVISION_CONFLICT") router.refresh();
  }

  return (
    <section className="space-y-5" aria-labelledby="subject-manager-title">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <h2 id="subject-manager-title" className="text-base font-semibold text-white">科目与分组</h2>
          <p className="mt-1 text-sm text-zinc-400">管理学习内容的归属。归档会保留历史记录，并暂停相关复习排期。</p>
        </div>
        <span className="text-xs text-zinc-500">{activeSubjects.length} 个使用中</span>
      </div>

      <div className="divide-y divide-white/10 rounded-md border border-white/10">
        {activeSubjects.map((subject, index) => (
          <SubjectRow
            key={`${subject.id}:${subject.name}:${subject.color}:${subject.groupId ?? "none"}`}
            subject={subject}
            groups={props.groups}
            activeGroups={activeGroups}
            editing={editingSubjectId === subject.id}
            pending={pending}
            canMoveUp={index > 0}
            canMoveDown={index < activeSubjects.length - 1}
            onEdit={() => setEditingSubjectId(subject.id)}
            onCancel={() => setEditingSubjectId(null)}
            onSave={async (patch) => {
              const saved = await updateSubject(subject, patch, "科目修改已保存。");
              if (saved) setEditingSubjectId(null);
            }}
            onMove={(move) => void updateSubject(subject, { move }, "科目顺序已更新。")}
            onArchive={() => setArchiveSubject(subject)}
          />
        ))}
        {activeSubjects.length === 0 ? <p className="p-4 text-sm text-zinc-500">还没有可用科目。</p> : null}
      </div>

      <div className="grid gap-3 border-l-2 border-teal-400/40 pl-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_auto]">
        <label className="text-sm text-zinc-400">
          新科目名称
          <input
            value={newSubjectName}
            onChange={(event) => setNewSubjectName(event.target.value)}
            placeholder="例如：线性代数"
            className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-white"
          />
        </label>
        <label className="text-sm text-zinc-400">
          分组
          <select
            value={newSubjectGroupId}
            onChange={(event) => setNewSubjectGroupId(event.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-white"
          >
            <option value="">不分组</option>
            {activeGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>
        <button
          type="button"
          disabled={pending || !newSubjectName.trim()}
          onClick={() => void addSubject()}
          className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-md bg-teal-400 px-4 text-sm font-medium text-black disabled:opacity-50"
        >
          <Plus size={16} aria-hidden="true" />添加科目
        </button>
        <div className="flex flex-wrap gap-2 lg:col-span-2" aria-label="科目颜色">
          {subjectColors.map((color) => (
            <button
              key={color}
              type="button"
              className="relative h-7 w-7 rounded-md border border-white/20"
              style={{ backgroundColor: color }}
              aria-label={`选择颜色 ${color}`}
              aria-pressed={newSubjectColor === color}
              onClick={() => setNewSubjectColor(color)}
            >
              {newSubjectColor === color ? <Check className="absolute inset-0 m-auto text-black" size={15} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
        <details className="text-sm text-zinc-500 lg:col-span-3">
          <summary className="inline-flex cursor-pointer items-center gap-1">高级选项 <ChevronDown size={14} aria-hidden="true" /></summary>
          <label className="mt-2 block max-w-md">
            内部标识
            <input
              value={newSubjectKey}
              onChange={(event) => setNewSubjectKey(event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-zinc-300"
            />
          </label>
        </details>
      </div>

      <GroupManager
        groups={props.groups}
        pending={pending}
        newName={newGroupName}
        newKey={newGroupKey}
        onNameChange={setNewGroupName}
        onKeyChange={setNewGroupKey}
        onAdd={() => void addGroup()}
        onUpdate={updateGroup}
      />

      {archivedSubjects.length > 0 ? (
        <details className="rounded-md border border-white/10 p-3">
          <summary className="cursor-pointer text-sm text-zinc-400">已归档科目（{archivedSubjects.length}）</summary>
          <ul className="mt-3 space-y-2">
            {archivedSubjects.map((subject) => (
              <li key={subject.id} className="flex items-center justify-between gap-3 text-sm text-zinc-500">
                <span>{subject.name}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void updateSubject(subject, { archived: false }, "科目已恢复。")}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-zinc-200"
                >
                  <RotateCcw size={15} aria-hidden="true" />恢复
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {notice ? <p role="status" className="text-sm text-teal-200">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}

      <Modal open={Boolean(archiveSubject)} title="归档科目" onClose={() => setArchiveSubject(null)} allowEscape={!pending}>
        <div className="space-y-4 text-sm text-zinc-300">
          <p>归档“{archiveSubject?.name}”后，历史任务和学习记录会保留，但相关复习排期会暂停。</p>
          <div className="flex justify-end gap-2">
            <button type="button" disabled={pending} onClick={() => setArchiveSubject(null)} className="h-10 rounded-md border border-white/10 px-4">取消</button>
            <button
              type="button"
              disabled={pending || !archiveSubject}
              onClick={async () => {
                if (!archiveSubject) return;
                const archived = await updateSubject(archiveSubject, { archived: true }, "科目已归档。");
                if (archived) setArchiveSubject(null);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-amber-300 px-4 font-medium text-black disabled:opacity-50"
            >
              <Archive size={16} aria-hidden="true" />确认归档
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function SubjectRow(props: {
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
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-zinc-400">名称<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-white" /></label>
          <label className="text-sm text-zinc-400">分组<select value={effectiveGroupId} onChange={(event) => setGroupId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-white"><option value="">不分组</option>{props.activeGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2" aria-label="科目颜色">
            <Palette size={16} className="text-zinc-500" aria-hidden="true" />
            {subjectColors.map((candidate) => <button key={candidate} type="button" className="relative h-7 w-7 rounded-md border border-white/20" style={{ backgroundColor: candidate }} aria-label={`选择颜色 ${candidate}`} aria-pressed={color === candidate} onClick={() => setColor(candidate)}>{color === candidate ? <Check className="absolute inset-0 m-auto text-black" size={15} aria-hidden="true" /> : null}</button>)}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={props.pending} onClick={props.onCancel} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm"><X size={15} aria-hidden="true" />取消</button>
            <button type="button" disabled={props.pending || !name.trim()} onClick={() => void props.onSave({ name, color, groupId: effectiveGroupId || null })} className="inline-flex h-9 items-center gap-2 rounded-md bg-teal-400 px-3 text-sm font-medium text-black disabled:opacity-50"><Save size={15} aria-hidden="true" />保存</button>
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
        <p className="truncate text-sm font-medium text-zinc-100">{props.subject.name}</p>
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

function GroupManager(props: {
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
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    className="mt-1 h-9 w-full max-w-sm rounded-md border border-white/10 bg-[#151a20] px-3 text-sm text-white"
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
                    <IconButton label={group.archivedAt ? `恢复${group.name}` : `归档${group.name}`} disabled={props.pending} onClick={() => void props.onUpdate(group, { archived: !group.archivedAt }, group.archivedAt ? "分组已恢复。" : "分组已归档。")}>{group.archivedAt ? <RotateCcw size={15} /> : <Archive size={15} />}</IconButton>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input value={props.newName} onChange={(event) => props.onNameChange(event.target.value)} placeholder="新分组名称" className="h-10 rounded-md border border-white/10 bg-[#151a20] px-3 text-sm text-white" />
          <button type="button" disabled={props.pending || !props.newName.trim()} onClick={props.onAdd} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-4 text-sm text-zinc-100 disabled:opacity-50"><Plus size={15} aria-hidden="true" />添加分组</button>
          <details className="text-xs text-zinc-500 sm:col-span-2"><summary className="cursor-pointer">高级选项</summary><label className="mt-2 block max-w-md">内部标识<input value={props.newKey} onChange={(event) => props.onKeyChange(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-white/10 bg-[#151a20] px-3" /></label></details>
        </div>
      </div>
    </details>
  );
}

function IconButton(props: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" disabled={props.disabled} onClick={props.onClick} aria-label={props.label} title={props.label} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-40">{props.children}</button>;
}

interface MutationResponse {
  error?: string;
  workspace?: ExamWorkspaceDto;
  latest?: ExamWorkspaceDto;
}

function subjectErrorMessage(code: string | undefined, fallback: string): string {
  if (code === "WORKSPACE_REVISION_CONFLICT") return "工作区刚刚发生变化，页面已刷新；请检查后再次提交。";
  if (code === "WORKSPACE_ACTIVE_SUBJECT_REQUIRED") return "至少需要保留一个使用中的科目。";
  if (code === "ACTIVE_SESSION_BLOCKS_SUBJECT_ARCHIVE") return "这个科目仍有进行中的计时，请先结束计时。";
  if (code === "SUBJECT_GROUP_NOT_FOUND") return "所选分组已不可用，请刷新后重新选择。";
  if (code === "SUBJECT_STABLE_KEY_ALREADY_EXISTS") return "该科目内部标识已存在，请修改后重试。";
  if (code === "SUBJECT_GROUP_STABLE_KEY_ALREADY_EXISTS") return "该分组内部标识已存在，请修改后重试。";
  if (code === "INTERNAL_ERROR") return "保存失败，请刷新后重试；若持续出现，请通过支持入口反馈。";
  return fallback;
}
