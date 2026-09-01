import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { StudyResourceCreateDrawer } from "@/components/study-resource-create-drawer";
import { StudyResourceList } from "@/components/study-resource-list";
import {
  uploadResolutionComparisons,
  type UploadItem,
} from "@/components/study-resource-workbench-support";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/feedback";
import { Drawer } from "@/components/ui/overlays";
import { PageFrame, PageHeader, Toolbar } from "@/components/ui/page";
import type { LinkResourceCreateController } from "@/components/use-link-resource-create";
import type { StudyResourceDraftController } from "@/components/use-study-resource-draft";
import type { StudyResourceListController } from "@/components/use-study-resource-list-controller";
import type { StudyResourceUploadController } from "@/components/use-study-resource-upload-workflow";
import type { StudyResourceDto, StudyResourceEditorOptionsDto } from "@/lib/contracts";

export function StudyResourceWorkbenchView(props: {
  resources: StudyResourceDto[];
  archivedResources: StudyResourceDto[];
  options: StudyResourceEditorOptionsDto;
  initialSubjectId?: string;
  initialQuery?: string;
  draft: StudyResourceDraftController;
  upload: StudyResourceUploadController;
  link: LinkResourceCreateController;
  list: StudyResourceListController;
}) {
  const { draft, upload, link, list } = props;
  const unresolvedUploads = upload.uploads.filter((item) => item.status !== "done");
  const createPending = draft.mode === "files" ? upload.pending : link.pending;
  const createError = draft.mode === "files" ? upload.error : link.error;

  return (
    <PageFrame variant="dashboard-wide" className="space-y-5">
      <PageHeader
        title="资料"
        eyebrow="知识工作台"
        description={`${props.resources.length} 份当前资料${props.archivedResources.length ? ` · ${props.archivedResources.length} 份已归档` : ""}`}
      />
      {unresolvedUploads.length ? (
        <Alert
          tone="warning"
          title={upload.recoveredPending ? "已恢复未完成的资料处理" : "有未完成的资料处理"}
          action={<Button type="button" size="sm" disabled={upload.locked} onClick={upload.continuePendingUpload}>继续处理</Button>}
        >
          {upload.hasDuplicateUpload ? "需要确认复用、保留副本或跳过。" : `${unresolvedUploads.length} 个文件仍待完成。`}
        </Alert>
      ) : null}
      <Toolbar label="资料筛选">
        <label className="flex min-w-0 items-center gap-2 text-sm text-zinc-400">
          <span className="shrink-0">科目</span>
          <Select
            aria-label="筛选资料科目"
            className="h-10 !w-auto min-w-0 rounded-md border border-white/10 bg-[#151a20] px-3 text-sm text-zinc-200"
            value={props.initialSubjectId ?? ""}
            onChange={(event) => list.updateSubjectFilter(event.target.value)}
          >
            <option value="">全部科目</option>
            {props.options.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </Select>
        </label>
        {props.initialQuery ? <Badge tone="info">搜索：{props.initialQuery}</Badge> : null}
        {props.initialSubjectId ? <Button type="button" size="sm" variant="ghost" onClick={list.clearSubjectFilter}>清除筛选</Button> : null}
      </Toolbar>
      <StudyResourceList title="当前资料" resources={props.resources} subjects={props.options.subjects} />
      {props.archivedResources.length ? (
        <details className="border-t border-white/10 pt-5">
          <summary className="cursor-pointer text-sm text-zinc-300">已归档资料（{props.archivedResources.length}）</summary>
          <div className="mt-4"><StudyResourceList title="已归档" resources={props.archivedResources} subjects={props.options.subjects} /></div>
        </details>
      ) : null}
      <StudyResourceCreateDrawer
        open={draft.createOpen}
        mode={draft.mode}
        subjects={props.options.subjects}
        subjectId={draft.subjectId}
        category={draft.category}
        tags={draft.tags}
        linkTitle={draft.linkTitle}
        linkUrl={draft.linkUrl}
        uploads={upload.uploads}
        pending={createPending}
        locked={upload.locked || link.pending}
        error={createError}
        onClose={() => {
          if (!upload.locked && !link.pending) draft.setCreateOpen(false);
        }}
        onModeChange={draft.setMode}
        onSubjectChange={draft.changeSubject}
        onCategoryChange={draft.setCategory}
        onTagsChange={draft.setTags}
        onLinkTitleChange={draft.setLinkTitle}
        onLinkUrlChange={draft.setLinkUrl}
        onSelectFiles={upload.selectFiles}
        onUpload={upload.uploadBatch}
        onOpenDuplicates={upload.openDuplicates}
        onCreateLink={link.createLink}
      />
      <Drawer open={upload.duplicateDrawerOpen} title="处理重复资料" onClose={upload.closeDuplicates}>
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">同一批次的重复项在这里一次处理；跳过会清理本次上传的临时文件。</p>
          <ul className="space-y-3">
            {upload.uploads.filter((item) => item.status === "duplicate").map((item) => (
              <li key={item.key} className="space-y-2 rounded-md border border-white/10 p-3">
                <p className="truncate text-sm text-zinc-100">{item.originalName}</p>
                <Select
                  aria-label={`${item.originalName}重复处理`}
                  className="h-9 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-sm"
                  disabled={upload.locked}
                  value={item.decision}
                  onChange={(event) => upload.updateDecision(item.key, event.target.value as UploadItem["decision"])}
                >
                  <option value="reuse">复用已有资料</option>
                  <option value="copy">上传为副本</option>
                  <option value="skip">跳过</option>
                </Select>
                {item.decision === "reuse" ? (
                  <Select
                    aria-label={`${item.originalName}复用目标`}
                    className="h-9 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-sm"
                    disabled={upload.locked}
                    value={item.reuseResourceId}
                    onChange={(event) => upload.updateReuseResource(item.key, event.target.value)}
                  >
                    {item.staging?.duplicates.map((row) => <option key={row.resourceId} value={row.resourceId}>{row.title}</option>)}
                  </Select>
                ) : null}
              </li>
            ))}
          </ul>
          <Button type="button" variant="primary" disabled={upload.pending || !upload.hasDuplicateUpload} onClick={upload.resolveDuplicates} className="h-10 w-full rounded-md bg-teal-500 px-4 text-sm font-medium text-black disabled:opacity-50">应用全部决策</Button>
        </div>
      </Drawer>
      <ConflictResolutionModal
        open={upload.conflictOpen && Boolean(upload.resolutionConflict)}
        title="处理资料上传终态冲突"
        description="该上传已由另一页面或先前请求完成。当前决策与首次提交快照仍保留，系统不会自动重放或覆盖。"
        conflictFields={upload.resolutionConflict?.conflictFields ?? []}
        comparisons={upload.resolutionConflict && upload.localConflictRequest
          ? uploadResolutionComparisons(upload.resolutionConflict, upload.localConflictRequest)
          : []}
        onClose={upload.closeConflict}
        onAdoptServer={upload.adoptResolvedUpload}
        onManualMerge={upload.mergeResolvedUploadBaseline}
        adoptLabel="接受服务端已完成终态"
        mergeLabel="以服务端终态为基线再检查"
      />
    </PageFrame>
  );
}
