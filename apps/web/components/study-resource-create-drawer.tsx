"use client";

import { FileUp, Link2 } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Drawer } from "@/components/ui/overlays";
import {
  resourceCategories,
  statusLabel,
  type UploadItem,
} from "@/components/study-resource-workbench-support";

export function StudyResourceCreateDrawer(props: {
  open: boolean;
  mode: "files" | "link";
  subjects: Array<{ id: string; name: string }>;
  subjectId: string;
  category: string;
  tags: string;
  linkTitle: string;
  linkUrl: string;
  uploads: UploadItem[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onModeChange: (mode: "files" | "link") => void;
  onSubjectChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onLinkTitleChange: (value: string) => void;
  onLinkUrlChange: (value: string) => void;
  onSelectFiles: (files: FileList | null) => void;
  onUpload: () => void;
  onOpenDuplicates: () => void;
  onCreateLink: () => void;
}) {
  return (
    <Drawer open={props.open} title="添加资料" onClose={props.onClose}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-1 rounded-md border border-white/10 p-1" role="group" aria-label="资料创建方式">
          <ModeButton active={props.mode === "files"} onClick={() => props.onModeChange("files")}><FileUp size={16} aria-hidden />文件</ModeButton>
          <ModeButton active={props.mode === "link"} onClick={() => props.onModeChange("link")}><Link2 size={16} aria-hidden />HTTPS 外链</ModeButton>
        </div>
        <div className="grid gap-4">
          <CreateField label="科目">
            <select className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm" value={props.subjectId} onChange={(event) => props.onSubjectChange(event.target.value)}>
              <option value="">暂不选择科目</option>
              {props.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
          </CreateField>
          <CreateField label="资料类型">
            <select className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm" value={props.category} onChange={(event) => props.onCategoryChange(event.target.value)}>
              {resourceCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </CreateField>
          <CreateField label="标签"><input className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm" value={props.tags} onChange={(event) => props.onTagsChange(event.target.value)} placeholder="逗号分隔" /></CreateField>
        </div>
        {props.mode === "files" ? (
          <div className="space-y-3 border-t border-white/10 pt-4">
            <label className={buttonClassName({ variant: "secondary", className: "cursor-pointer" })}>
              <FileUp size={16} aria-hidden />选择 1-5 个文件
              <input className="sr-only" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.zip,.md,application/pdf,image/png,image/jpeg,image/webp,application/zip,text/markdown" onChange={(event) => props.onSelectFiles(event.target.files)} />
            </label>
            {props.uploads.length ? <ul className="space-y-2">{props.uploads.map((item) => <UploadResult key={item.key} item={item} />)}</ul> : null}
            {props.uploads.some((item) => item.status === "ready") ? <Button type="button" variant="primary" size="lg" loading={props.pending} onClick={props.onUpload}>上传并逐项检查</Button> : null}
            {props.uploads.some((item) => item.status === "duplicate") ? <Button type="button" variant="secondary" disabled={props.pending} onClick={props.onOpenDuplicates}>处理重复项</Button> : null}
          </div>
        ) : (
          <div className="space-y-4 border-t border-white/10 pt-4">
            <CreateField label="标题"><input className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm" value={props.linkTitle} onChange={(event) => props.onLinkTitleChange(event.target.value)} /></CreateField>
            <CreateField label="HTTPS 地址"><input className="h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-sm" value={props.linkUrl} onChange={(event) => props.onLinkUrlChange(event.target.value)} placeholder="https://" /></CreateField>
            <Button type="button" variant="primary" size="lg" loading={props.pending} disabled={!props.linkTitle.trim() || !props.linkUrl.trim()} onClick={props.onCreateLink}><Link2 size={16} aria-hidden />创建外链资料</Button>
          </div>
        )}
        {props.error ? <Alert tone="danger" role="alert">{props.error}</Alert> : null}
      </div>
    </Drawer>
  );
}

function ModeButton(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={props.active} onClick={props.onClick} className={`inline-flex h-9 items-center justify-center gap-2 rounded text-sm ${props.active ? "bg-white/10 text-white" : "text-zinc-400"}`}>{props.children}</button>;
}

function CreateField(props: { label: string; children: React.ReactNode }) {
  return <label className="text-sm text-zinc-400"><span>{props.label}</span><span className="mt-1 block">{props.children}</span></label>;
}

function UploadResult({ item }: { item: UploadItem }) {
  return (
    <li className="rounded-md border border-white/10 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="truncate text-zinc-200">{item.originalName}</span>
        <span className={item.status === "failed" ? "text-rose-300" : item.status === "done" ? "text-emerald-300" : item.status === "duplicate" ? "text-amber-200" : "text-zinc-500"}>{statusLabel(item)}</span>
      </div>
      {item.status === "duplicate" ? <p className="mt-2 text-xs text-amber-200">待确认复用、副本或跳过</p> : null}
      {item.error ? <p className="mt-2 text-xs text-rose-300">{item.error}</p> : null}
    </li>
  );
}
