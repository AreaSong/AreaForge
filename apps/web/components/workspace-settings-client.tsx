"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";
import { useQuickReviewActivityGuard } from "@/components/quick-review-activity-guard";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/feedback";
import { PageHeader, SectionHeader } from "@/components/ui/page";
import { WorkspaceSubjectManager } from "@/components/workspace-subject-manager";
import { WorkspaceSetupSection } from "@/components/workspace-setup-section";
import { WorkspaceSettingsSidebar } from "@/components/workspace-settings-sidebar";
import {
  isExamWorkspaceDto,
  isWorkspaceEditDraft,
  isWorkspaceSetupDraft,
  toWorkspaceEditDraft,
  workspaceEditDraftsEqual,
  type WorkspaceConflict,
  type WorkspaceEditDraft,
  type WorkspaceSetupDraft,
} from "@/components/workspace-settings-support";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { mutationFeedback } from "@/lib/client/mutation-feedback";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type {
  ExamWorkspaceDto,
  SubjectDuplicateSetDto,
  SubjectMergeOperationDto,
  SubjectGroupDto,
  TakeoverPreviewDto,
  WorkspaceSubjectDto,
} from "@/lib/contracts";
import {
  buildFirstUseGroups,
  buildFirstUseSubjectsFromDraft,
  canProceedFromFirstUseRows,
  canUseTakeoverPreview,
  hasConfiguredFirstUseRows,
  type FirstUseGroupDraft,
  type FirstUseSubjectDraft,
  validateFirstUseRows,
  workspaceSetupErrorMessage,
} from "@/lib/workspace/first-use";
import {
  activateExamWorkspace,
  createExamWorkspace,
  updateExamWorkspace,
} from "@/lib/api/workspace";
import {
  isoToShanghaiDateInput,
  isShanghaiDateInputError,
  shanghaiDateInputToIso,
} from "@/lib/formatters";

export function WorkspaceSettingsClient(props: {
  userId: string;
  workspaces: ExamWorkspaceDto[];
  activeId: string | null;
  subjects: WorkspaceSubjectDto[];
  groups: SubjectGroupDto[];
  duplicateSets: SubjectDuplicateSetDto[];
  mergeOperations: SubjectMergeOperationDto[];
  takeover: TakeoverPreviewDto | null;
  setupMode: boolean;
}) {
  const router = useRouter();
  const { withActivityBarrier } = useQuickReviewActivityGuard();
  const setupDraftKey = `areaforge.workspace-setup.draft.${props.userId}`;
  const activeWorkspace = props.workspaces.find((workspace) => workspace.id === props.activeId) ?? null;
  const workspaceEditDraftKey = activeWorkspace
    ? `areaforge.workspace-edit.draft.${props.userId}.${activeWorkspace.id}`
    : null;
  const savedWorkspaceBaseline = useRef<WorkspaceEditDraft | null>(
    activeWorkspace ? toWorkspaceEditDraft(activeWorkspace) : null,
  );
  const [step, setStep] = useState<"goal" | "takeover">("goal");
  const [name, setName] = useState("考研工作区");
  const [stableKey, setStableKey] = useState("ws-primary");
  const [targetExamDate, setTargetExamDate] = useState("");
  const [setupSubjects, setSetupSubjects] = useState<FirstUseSubjectDraft[]>([]);
  const [setupGroups, setSetupGroups] = useState<FirstUseGroupDraft[]>([]);
  const [templateIds, setTemplateIds] = useState<string[]>([]);
  const [editName, setEditName] = useState(activeWorkspace?.name ?? "");
  const [editTargetDate, setEditTargetDate] = useState(
    activeWorkspace?.targetExamDate ? isoToShanghaiDateInput(activeWorkspace.targetExamDate) : "",
  );
  const [editStageSummary, setEditStageSummary] = useState(activeWorkspace?.stageSummary ?? "");
  const [workspaceDraftBaseRevision, setWorkspaceDraftBaseRevision] = useState(activeWorkspace?.revision ?? 1);
  const [workspaceDraftSourceKey, setWorkspaceDraftSourceKey] = useState<string | null>(null);
  const [workspaceConflict, setWorkspaceConflict] = useState<WorkspaceConflict | null>(null);
  const [workspaceMergeNotice, setWorkspaceMergeNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupDraftReady, setSetupDraftReady] = useState(false);

  const activeSubjects = props.subjects.filter((item) => !item.archivedAt);
  const hasNewSetupSubjects = hasConfiguredFirstUseRows({ subjects: setupSubjects });
  const canProceedFromSetup = canProceedFromFirstUseRows({
    subjects: setupSubjects,
    templateIds,
    eligibleTakeoverCount: props.takeover?.eligibleCount ?? 0,
  });

  useEffect(() => {
    if (!props.setupMode) return;
    const timer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraft(setupDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isWorkspaceSetupDraft);
      if (draft) {
        setStep(draft.step);
        setName(draft.name);
        setStableKey(draft.stableKey);
        setTargetExamDate(draft.targetExamDate);
        setSetupSubjects(draft.subjects);
        setSetupGroups(draft.groups);
        setTemplateIds(draft.templateIds);
      }
      setSetupDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [props.setupMode, setupDraftKey]);

  useEffect(() => {
    if (!props.setupMode || !setupDraftReady) return;
    savePrivateBusinessDraft<WorkspaceSetupDraft>(setupDraftKey, {
      schemaVersion: 2,
      step,
      name,
      stableKey,
      targetExamDate,
      subjects: setupSubjects,
      groups: setupGroups,
      templateIds,
    });
  }, [name, props.setupMode, setupDraftKey, setupDraftReady, setupGroups, setupSubjects, stableKey, step, targetExamDate, templateIds]);

  useEffect(() => {
    if (!activeWorkspace || !workspaceEditDraftKey || props.setupMode) return;
    const timer = window.setTimeout(() => {
      const baseline = toWorkspaceEditDraft(activeWorkspace);
      const draft = loadPrivateBusinessDraft(workspaceEditDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isWorkspaceEditDraft);
      const restored = draft ?? baseline;
      savedWorkspaceBaseline.current = baseline;
      setEditName(restored.name);
      setEditTargetDate(restored.targetExamDate);
      setEditStageSummary(restored.stageSummary);
      setWorkspaceDraftBaseRevision(restored.baseRevision);
      if (draft && draft.baseRevision !== activeWorkspace.revision) {
        setWorkspaceConflict({ latest: activeWorkspace, conflictFields: ["revision"] });
        setError("工作区已在其他页面更新；本地草稿仍保留，请比较后选择如何合并。");
      } else {
        setWorkspaceConflict(null);
        setError(null);
      }
      setWorkspaceDraftSourceKey(workspaceEditDraftKey);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeWorkspace, props.setupMode, workspaceEditDraftKey]);

  useEffect(() => {
    if (!activeWorkspace || !workspaceEditDraftKey || workspaceDraftSourceKey !== workspaceEditDraftKey) return;
    const draft: WorkspaceEditDraft = {
      name: editName,
      targetExamDate: editTargetDate,
      stageSummary: editStageSummary,
      baseRevision: workspaceDraftBaseRevision,
    };
    if (savedWorkspaceBaseline.current && workspaceEditDraftsEqual(draft, savedWorkspaceBaseline.current)) {
      removePrivateBusinessDraft(workspaceEditDraftKey);
      return;
    }
    savePrivateBusinessDraft(workspaceEditDraftKey, draft);
  }, [activeWorkspace, editName, editStageSummary, editTargetDate, workspaceDraftBaseRevision, workspaceDraftSourceKey, workspaceEditDraftKey]);

  async function completeFirstUseSetup(takeover: boolean) {
    if (pending) return;
    const rowsValidation = validateFirstUseRows({
      subjects: setupSubjects,
      groups: setupGroups,
      templateIds,
    });
    if (!rowsValidation.valid) {
      setStep("goal");
      setError(rowsValidation.issue);
      return;
    }
    if (!hasNewSetupSubjects && (!takeover || (props.takeover?.eligibleCount ?? 0) === 0)) {
      setStep("goal");
      setError("至少填写一个科目、勾选 408 四科，或沿用一个已有科目。");
      return;
    }
    if (takeover && !canUseTakeoverPreview(props.takeover)) {
      setError("旧数据预览暂时不可用，尚未创建工作区。请刷新后重试，或明确选择不沿用旧数据。");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const subjects = buildFirstUseSubjectsFromDraft({
        subjects: setupSubjects,
        templateIds,
        takeoverSubjects: takeover ? props.takeover?.eligibleSubjects ?? [] : [],
      });
      const groups = buildFirstUseGroups({ groups: setupGroups, subjects: setupSubjects, templateIds });
      const createResult = await createExamWorkspace({
        stableKey,
        name,
        targetExamDate: targetExamDate ? shanghaiDateInputToIso(targetExamDate) : null,
        activate: true,
        subjects: subjects.length > 0 ? subjects : undefined,
        groups: groups.length > 0 ? groups : undefined,
        takeoverSubjectIds: takeover ? props.takeover?.eligibleSubjectIds ?? [] : [],
      });
      if (isUnauthorized(createResult)) {
        setError("登录已过期，首次设置草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!createResult.ok || !createResult.body?.workspace) {
        setError(workspaceSetupErrorMessage(createResult.body?.error));
        return;
      }
      removePrivateBusinessDraft(setupDraftKey);
      router.replace("/today");
      router.refresh();
    } catch (caught) {
      setError(isShanghaiDateInputError(caught)
        ? "目标考试日期无效，请重新选择。"
        : "网络不可用，设置尚未保存，请恢复网络后重试");
    } finally {
      setPending(false);
    }
  }

  async function saveWorkspace() {
    if (!activeWorkspace || pending) return;
    setPending(true);
    setError(null);
    setWorkspaceMergeNotice(null);
    try {
      const result = await updateExamWorkspace(activeWorkspace.id, {
        expectedRevision: workspaceDraftBaseRevision,
        name: editName,
        targetExamDate: editTargetDate ? shanghaiDateInputToIso(editTargetDate) : null,
        stageSummary: editStageSummary || null,
      });
      if (isUnauthorized(result)) return redirectToLoginWithCurrentLocation();
      if (!result.ok) {
        if (isConflict(result) && isExamWorkspaceDto(result.body?.latest)) {
          setWorkspaceConflict({ latest: result.body.latest, conflictFields: result.body.conflictFields ?? ["revision"] });
          setError("工作区已在其他页面更新；本地草稿仍保留，请比较后选择如何合并。");
        } else {
          setError(mutationFeedback(result, "工作区保存失败，本地输入仍保留").message);
        }
        return;
      }
      const saved = isExamWorkspaceDto(result.body?.workspace) ? result.body.workspace : null;
      const baseline: WorkspaceEditDraft = {
        name: editName,
        targetExamDate: editTargetDate,
        stageSummary: editStageSummary,
        baseRevision: saved?.revision ?? workspaceDraftBaseRevision + 1,
      };
      savedWorkspaceBaseline.current = baseline;
      setWorkspaceDraftBaseRevision(baseline.baseRevision);
      setWorkspaceConflict(null);
      if (workspaceEditDraftKey) removePrivateBusinessDraft(workspaceEditDraftKey);
      setWorkspaceMergeNotice("工作区目标已保存。");
      router.refresh();
    } catch (caught) {
      setError(isShanghaiDateInputError(caught)
        ? "目标考试日期无效，请重新选择；当前输入仍保留。"
        : "网络不可用，工作区输入仍保留；恢复网络后请显式重试。");
    } finally {
      setPending(false);
    }
  }

  function adoptLatestWorkspace() {
    if (!workspaceConflict || !workspaceEditDraftKey) return;
    const latest = workspaceConflict.latest;
    const baseline = toWorkspaceEditDraft(latest);
    setEditName(baseline.name);
    setEditTargetDate(baseline.targetExamDate);
    setEditStageSummary(baseline.stageSummary);
    setWorkspaceDraftBaseRevision(baseline.baseRevision);
    savedWorkspaceBaseline.current = baseline;
    removePrivateBusinessDraft(workspaceEditDraftKey);
    setWorkspaceConflict(null);
    setError(null);
    setWorkspaceMergeNotice(`已采用服务端最新状态 r${latest.revision}。`);
    router.refresh();
  }

  function keepLocalWorkspaceDraft() {
    if (!workspaceConflict) return;
    const revision = workspaceConflict.latest.revision;
    setWorkspaceDraftBaseRevision(revision);
    setWorkspaceConflict(null);
    setError(null);
    setWorkspaceMergeNotice(`本地输入已保留，并改为基于服务端 r${revision}；请检查后再次点击保存。`);
  }

  async function activateWorkspace(workspace: ExamWorkspaceDto) {
    if (pending) return;
    await withActivityBarrier(() => runActivateWorkspace(workspace), { allowDiscard: false });
  }

  async function runActivateWorkspace(workspace: ExamWorkspaceDto) {
    setPending(true);
    setError(null);
    try {
      const result = await activateExamWorkspace(workspace.id, workspace.revision);
      if (isUnauthorized(result)) return redirectToLoginWithCurrentLocation();
      if (!result.ok) {
        setError(mutationFeedback(result, "切换工作区失败").message);
        return;
      }
      router.replace("/today");
      router.refresh();
    } catch {
      setError("网络不可用，工作区未切换；恢复网络后请显式重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={props.setupMode || !props.activeId ? "首次配置" : "设置 / 考试与科目"}
        title={props.setupMode || !props.activeId ? "建立考试工作区" : "考试与科目"}
        description={props.setupMode || !props.activeId
          ? "确认考试目标和首批科目，再决定是否沿用已有学习数据。"
          : "管理当前考试目标、科目归属和可切换的工作区。"}
        status={activeWorkspace && !props.setupMode ? (
          <div className="flex flex-wrap gap-2">
            <Badge tone="success">当前：{activeWorkspace.name}</Badge>
            <Badge>{activeSubjects.length} 个科目</Badge>
          </div>
        ) : undefined}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr] xl:grid-cols-[320px_1fr]">
        <WorkspaceSettingsSidebar
          setupMode={props.setupMode}
          step={step}
          activeId={props.activeId}
          activeWorkspace={activeWorkspace}
          activeSubjectCount={activeSubjects.length}
          workspaces={props.workspaces}
          pending={pending}
          onActivate={(workspace) => void activateWorkspace(workspace)}
        />

        <main className="space-y-6 min-w-0">
          {props.setupMode ? (
            <WorkspaceSetupSection
              step={step}
              setStep={setStep}
              name={name}
              setName={setName}
              stableKey={stableKey}
              setStableKey={setStableKey}
              targetExamDate={targetExamDate}
              setTargetExamDate={setTargetExamDate}
              subjects={setupSubjects}
              setSubjects={setSetupSubjects}
              groups={setupGroups}
              setGroups={setSetupGroups}
              templateIds={templateIds}
              setTemplateIds={setTemplateIds}
              takeover={props.takeover}
              canProceed={canProceedFromSetup}
              canCreateWithoutTakeover={hasNewSetupSubjects}
              pending={pending}
              onComplete={completeFirstUseSetup}
            />
          ) : null}

          {!props.setupMode && activeWorkspace ? (
            <>
              <SectionCard variant="master" className="space-y-5">
                <SectionHeader title="当前考试目标" description="调整名称、目标日期和当前阶段摘要。" />
                <div className="af-content-grid-two grid gap-4">
                  <label className="text-sm font-medium text-zinc-300">
                    名称
                    <Input className="mt-1.5" value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </label>
                  <label className="text-sm font-medium text-zinc-300">
                    目标考试日
                    <Input type="date" className="mt-1.5" value={editTargetDate} onChange={(e) => setEditTargetDate(e.target.value)} />
                  </label>
                </div>
                <label className="block text-sm font-medium text-zinc-300">
                  阶段摘要
                  <Textarea className="mt-1.5 min-h-20" value={editStageSummary} onChange={(e) => setEditStageSummary(e.target.value)} />
                </label>
                <div className="flex items-center gap-3">
                  <Button type="button" variant="primary" loading={pending} loadingLabel="保存中..." onClick={() => void saveWorkspace()}>
                    <Save className="size-4" />保存考试目标
                  </Button>
                  {workspaceMergeNotice ? <span className="text-sm text-teal-300" role="status">{workspaceMergeNotice}</span> : null}
                </div>

                {workspaceConflict ? (
                  <div className="space-y-2 rounded-xl border border-amber-300/40 bg-amber-300/10 p-3 text-sm text-amber-100" role="status">
                    <p className="font-semibold">服务端最新版本为 r{workspaceConflict.latest.revision}；冲突字段：{workspaceConflict.conflictFields.join("、")}。</p>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button type="button" variant="secondary" size="sm" onClick={adoptLatestWorkspace}>采用服务端最新状态</Button>
                      <Button type="button" variant="secondary" size="sm" onClick={keepLocalWorkspaceDraft}>保留本地输入并重新确认</Button>
                    </div>
                  </div>
                ) : null}
              </SectionCard>

              <WorkspaceSubjectManager
                workspace={activeWorkspace}
                subjects={props.subjects}
                groups={props.groups}
                duplicateSets={props.duplicateSets}
                mergeOperations={props.mergeOperations}
              />
            </>
          ) : null}

          {error ? <Alert tone="danger">{error}</Alert> : null}
        </main>
      </div>
    </div>
  );
}
