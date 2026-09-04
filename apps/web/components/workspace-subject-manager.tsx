"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ChevronDown,
  Plus,
  RotateCcw,
} from "lucide-react";
import { Modal } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { Card, SectionCard } from "@/components/ui/card";
import { ColorSwatches } from "@/components/ui/color-swatches";
import { Input, Select } from "@/components/ui/field";
import { classifyApiFailure } from "@/lib/client/api-errors";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type {
  ExamWorkspaceDto,
  SubjectDuplicateSetDto,
  SubjectGroupDto,
  WorkspaceSubjectDto,
} from "@/lib/contracts";
import { nextAvailableGeneratedKey } from "@/lib/workspace/first-use";
import {
  createSubjectGroup,
  createWorkspaceSubject,
  updateSubjectGroup,
  updateWorkspaceSubject,
  type WorkspaceMutationResponse,
} from "@/lib/api/workspace";
import {
  GroupManager,
  subjectColors,
  subjectErrorMessage,
  SubjectRow,
} from "@/components/workspace-subject-manager-sections";
import { SubjectDuplicatePreview } from "@/components/subject-duplicate-preview";

export function WorkspaceSubjectManager(props: {
  workspace: ExamWorkspaceDto;
  subjects: WorkspaceSubjectDto[];
  groups: SubjectGroupDto[];
  duplicateSets: SubjectDuplicateSetDto[];
}) {
  const router = useRouter();
  const [localRevision, setLocalRevision] = useState({
    workspaceId: props.workspace.id,
    value: props.workspace.revision,
  });
  const revision = localRevision.workspaceId === props.workspace.id
    ? Math.max(localRevision.value, props.workspace.revision)
    : props.workspace.revision;
  const setRevision = (value: number) => setLocalRevision({ workspaceId: props.workspace.id, value });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [archiveSubject, setArchiveSubject] = useState<WorkspaceSubjectDto | null>(null);
  const [archiveGroup, setArchiveGroup] = useState<SubjectGroupDto | null>(null);
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
      const result = await createWorkspaceSubject(props.workspace.id, {
        stableKey: newSubjectKey,
        name: newSubjectName,
        color: newSubjectColor,
        groupId: newSubjectGroupId || null,
        expectedWorkspaceRevision: Math.max(revision, props.workspace.revision),
      });
      if (!result.ok) {
        const failure = classifyApiFailure(result);
        if (failure.kind === "unauthorized") return redirectToLoginWithCurrentLocation();
        absorbLatestRevision(result.body, failure);
        setError(subjectErrorMessage(failure.code ?? undefined, "添加科目失败，请检查名称和内部标识"));
        return;
      }
      if (result.body?.workspace) setRevision(result.body.workspace.revision);
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
      const result = await updateWorkspaceSubject(props.workspace.id, subject.id, {
        expectedWorkspaceRevision: Math.max(revision, props.workspace.revision),
        ...patch,
      });
      if (!result.ok) {
        const failure = classifyApiFailure(result);
        if (failure.kind === "unauthorized") {
          redirectToLoginWithCurrentLocation();
          return false;
        }
        absorbLatestRevision(result.body, failure);
        setError(subjectErrorMessage(failure.code ?? undefined, "科目更新失败"));
        return false;
      }
      if (result.body?.workspace) setRevision(result.body.workspace.revision);
      const lifecycle = result.body?.lifecycle;
      if (patch.archived === false && lifecycle) {
        const resumed = lifecycle.resumedReviewScheduleCount ?? 0;
        const remaining = lifecycle.remainingPausedReviewScheduleCount ?? 0;
        setNotice(remaining > 0
          ? `科目已恢复；有 ${remaining} 项复习排期需要重新安排日期。`
          : resumed > 0
            ? `科目已恢复，相关复习排期已恢复 ${resumed} 项。`
            : "科目已恢复，当前没有需要恢复的复习排期。");
      } else if (patch.archived === true && lifecycle) {
        setNotice(`科目已归档，相关复习排期已暂停 ${lifecycle.pausedReviewScheduleCount ?? 0} 项。`);
      } else {
        setNotice(success);
      }
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
      const result = await createSubjectGroup(props.workspace.id, {
        expectedWorkspaceRevision: Math.max(revision, props.workspace.revision),
        stableKey: newGroupKey,
        name: newGroupName,
      });
      if (!result.ok) {
        const failure = classifyApiFailure(result);
        if (failure.kind === "unauthorized") return redirectToLoginWithCurrentLocation();
        absorbLatestRevision(result.body, failure);
        setError(subjectErrorMessage(failure.code ?? undefined, "添加分组失败"));
        return;
      }
      if (result.body?.workspace) setRevision(result.body.workspace.revision);
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
      const result = await updateSubjectGroup(props.workspace.id, group.id, {
        expectedWorkspaceRevision: Math.max(revision, props.workspace.revision),
        ...patch,
      });
      if (!result.ok) {
        const failure = classifyApiFailure(result);
        if (failure.kind === "unauthorized") {
          redirectToLoginWithCurrentLocation();
          return false;
        }
        absorbLatestRevision(result.body, failure);
        setError(subjectErrorMessage(failure.code ?? undefined, "分组更新失败"));
        return false;
      }
      if (result.body?.workspace) setRevision(result.body.workspace.revision);
      const ungrouped = result.body?.lifecycle?.ungroupedSubjectCount ?? 0;
      setNotice(patch.archived === true
        ? `分组已归档，${ungrouped} 个科目已移至不分组。`
        : success);
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

  function absorbLatestRevision(
    body: WorkspaceMutationResponse | null,
    failure: ReturnType<typeof classifyApiFailure>,
  ) {
    if (body?.latest) setRevision(body.latest.revision);
    if (failure.code === "WORKSPACE_NOT_FOUND") {
      router.replace("/settings/exams");
      router.refresh();
      return;
    }
    if (failure.kind === "conflict" || failure.code === "WORKSPACE_REVISION_CONFLICT") router.refresh();
  }

  return (
    <SectionCard variant="master" className="space-y-5" aria-labelledby="subject-manager-title">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <h2 id="subject-manager-title" className="text-base font-semibold text-white">科目与分组</h2>
          <p className="mt-1 text-sm text-zinc-400">管理学习内容的归属。归档会保留历史记录，并暂停相关复习排期。</p>
        </div>
        <span className="text-xs font-medium text-teal-300 bg-teal-500/10 px-2.5 py-1 rounded-full border border-teal-500/20">
          {activeSubjects.length} 个使用中
        </span>
      </div>

      <div className="divide-y divide-white/10 rounded-xl border border-white/10 bg-white/[0.01]">
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

      <SubjectDuplicatePreview sets={props.duplicateSets} />

      <Card variant="subtle" className="af-form-action-grid grid gap-3 border-l-2 border-teal-400/40 p-4">
        <label className="text-sm text-zinc-300 font-medium">
          新科目名称
          <Input
            value={newSubjectName}
            onChange={(event) => setNewSubjectName(event.target.value)}
            placeholder="例如：线性代数"
            className="mt-1.5"
          />
        </label>
        <label className="text-sm text-zinc-300 font-medium">
          分组
          <Select
            value={newSubjectGroupId}
            onChange={(event) => setNewSubjectGroupId(event.target.value)}
            className="mt-1.5"
          >
            <option value="">不分组</option>
            {activeGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </Select>
        </label>
        <Button
          type="button"
          variant="primary"
          disabled={pending || !newSubjectName.trim()}
          onClick={() => void addSubject()}
          className="self-end"
        >
          <Plus size={16} aria-hidden="true" />添加科目
        </Button>
        <ColorSwatches colors={subjectColors} value={newSubjectColor} onChange={setNewSubjectColor} label="科目颜色" className="af-form-span-main" />
        <details className="af-content-span-all text-sm text-zinc-500">
          <summary className="inline-flex cursor-pointer items-center gap-1 hover:text-zinc-300 transition-colors">
            高级选项 <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <label className="mt-2 block max-w-md">
            内部标识
            <Input
              value={newSubjectKey}
              onChange={(event) => setNewSubjectKey(event.target.value)}
              className="mt-1 h-9 w-full text-sm"
            />
          </label>
        </details>
      </Card>

      <GroupManager
        groups={props.groups}
        pending={pending}
        newName={newGroupName}
        newKey={newGroupKey}
        onNameChange={setNewGroupName}
        onKeyChange={setNewGroupKey}
        onAdd={() => void addGroup()}
        onUpdate={updateGroup}
        onRequestArchive={setArchiveGroup}
      />

      {archivedSubjects.length > 0 ? (
        <details className="rounded-xl border border-white/10 bg-white/[0.01] p-3.5">
          <summary className="cursor-pointer text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
            已归档科目（{archivedSubjects.length}）
          </summary>
          <ul className="mt-3 space-y-2">
            {archivedSubjects.map((subject) => (
              <li key={subject.id} className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-500">
                <span className="min-w-0 flex-1 break-words">{subject.name}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => void updateSubject(subject, { archived: false }, "科目已恢复。")}
                >
                  <RotateCcw size={14} aria-hidden="true" />恢复
                </Button>
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
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setArchiveSubject(null)}>取消</Button>
            <Button
              type="button"
              variant="danger"
              disabled={pending || !archiveSubject}
              onClick={async () => {
                if (!archiveSubject) return;
                const archived = await updateSubject(archiveSubject, { archived: true }, "科目已归档。");
                if (archived) setArchiveSubject(null);
              }}
            >
              <Archive size={16} aria-hidden="true" />确认归档
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(archiveGroup)} title="归档分组" onClose={() => setArchiveGroup(null)} allowEscape={!pending}>
        <div className="space-y-4 text-sm text-zinc-300">
          <p>
            归档“{archiveGroup?.name}”后，分组内的
            {props.subjects.filter((subject) => subject.groupId === archiveGroup?.id).length} 个科目会移到“不分组”。
            科目和历史学习记录都会保留；恢复分组后不会自动重新关联。
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setArchiveGroup(null)}>取消</Button>
            <Button
              type="button"
              variant="danger"
              disabled={pending || !archiveGroup}
              onClick={async () => {
                if (!archiveGroup) return;
                const archived = await updateGroup(archiveGroup, { archived: true }, "分组已归档。");
                if (archived) setArchiveGroup(null);
              }}
            >
              <Archive size={16} aria-hidden="true" />确认归档
            </Button>
          </div>
        </div>
      </Modal>
    </SectionCard>
  );
}
