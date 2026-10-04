"use client";

import { updateMistakeLinks, type UpdateMistakeLinksInput, type UpdateMistakeLinksResponse } from "@/lib/api/mistakes";
import Link from "next/link";
import { useState } from "react";
import { Save } from "lucide-react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { Alert } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type { MistakeDto } from "@/lib/contracts";

interface LinkOption {
  id: string;
  title: string;
}

interface MistakeLinksConflict {
  command: UpdateMistakeLinksInput;
  latest: MistakeDto | null;
  conflictFields: string[];
}

export function MistakeLinksPanel(props: {
  mistake: MistakeDto;
  noteOptions: LinkOption[];
  resourceOptions: LinkOption[];
  readOnly: boolean;
  onSaved: (mistake: MistakeDto) => void;
}) {
  const [baselineMistake, setBaselineMistake] = useState(props.mistake);
  const [initialNoteIds, setInitialNoteIds] = useState(() => props.mistake.noteLinks.map((link) => link.noteId));
  const [initialResourceIds, setInitialResourceIds] = useState(() => props.mistake.resourceLinks.map((link) => link.resourceId));
  const [noteIds, setNoteIds] = useState(initialNoteIds);
  const [resourceIds, setResourceIds] = useState(initialResourceIds);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<MistakeLinksConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);

  const dirty = !sameIds(noteIds, initialNoteIds) || !sameIds(resourceIds, initialResourceIds);

  async function saveLinks() {
    if (pending || props.readOnly || !dirty) return;
    if (conflict) {
      setConflictOpen(true);
      return;
    }
    await submitLinks({
      expectedUpdatedAt: baselineMistake.updatedAt,
      noteIds: [...noteIds],
      resourceIds: [...resourceIds],
    });
  }

  async function submitLinks(command: UpdateMistakeLinksInput) {
    setPending(true);
    setError(null);
    try {
      const response = await updateMistakeLinks(props.mistake.id, command);
      const body = response.body as (UpdateMistakeLinksResponse & { latest?: MistakeDto }) | null;
      if (isUnauthorized(response)) {
        setError("登录已过期，关联输入仍保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok || !body?.mistake) {
        if (isConflict(response)) {
          setConflict({
            command: freezeLinksCommand(command),
            latest: isMistakeDtoSnapshot(body?.latest) ? body.latest : null,
            conflictFields: body?.conflictFields ?? ["updatedAt", "noteIds", "resourceIds"],
          });
          setConflictOpen(true);
        }
        setError(body?.error ?? "保存关联失败，本地选择仍保留；请处理冲突后显式重试。");
        return;
      }
      adoptBaseline(body.mistake);
      setConflict(null);
      setConflictOpen(false);
      props.onSaved(body.mistake);
    } catch {
      setError("网络不可用，关联输入仍保留；恢复网络后请显式重试。");
    } finally {
      setPending(false);
    }
  }

  function adoptBaseline(next: MistakeDto, keepLocal = false) {
    const nextNoteIds = next.noteLinks.map((link) => link.noteId);
    const nextResourceIds = next.resourceLinks.map((link) => link.resourceId);
    setBaselineMistake(next);
    setInitialNoteIds(nextNoteIds);
    setInitialResourceIds(nextResourceIds);
    if (!keepLocal) {
      setNoteIds(nextNoteIds);
      setResourceIds(nextResourceIds);
    }
  }

  function adoptServerVersion() {
    if (!conflict) return;
    setConflictOpen(false);
    setConflict(null);
    if (!conflict.latest) {
      setError("服务端没有可采用的关联版本，请刷新后确认当前状态。");
      return;
    }
    adoptBaseline(conflict.latest);
    props.onSaved(conflict.latest);
    setError("已采用服务端最新关联，本地输入没有自动重放。");
  }

  function prepareRetry() {
    setConflictOpen(false);
    if (conflict) {
      if (conflict.latest) {
        adoptBaseline(conflict.latest, true);
      }
      setError("本地关联选择已保留，请检查后点击“保留输入并重试”；系统不会自动重放。");
    }
  }

  function retryOnLatest() {
    if (!conflict || pending) return;
    const command = {
      expectedUpdatedAt: conflict.latest?.updatedAt ?? conflict.command.expectedUpdatedAt,
      noteIds: [...noteIds],
      resourceIds: [...resourceIds],
    };
    setConflict(null);
    setConflictOpen(false);
    void submitLinks(command);
  }

  return (
    <section className="space-y-3 border-t border-white/10 pt-5" aria-labelledby="mistake-links-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs text-zinc-500">学习上下文</p><h2 id="mistake-links-heading" className="mt-1 text-lg font-medium text-white">关联笔记与资料</h2></div>
        {!props.readOnly ? <Button type="button" variant="ghost" disabled={!dirty || pending} onClick={() => void saveLinks()} className="inline-flex h-10 items-center gap-2 rounded-md border border-teal-300/30 px-3 text-sm text-teal-100 disabled:opacity-40"><Save size={16} aria-hidden />{pending ? "保存中" : "保存关联"}</Button> : null}
      </div>

      <AssociationSummary mistake={baselineMistake} />
      {!props.readOnly ? <div className="af-content-grid-two grid gap-4">
        <OptionGroup label="笔记" options={props.noteOptions} values={noteIds} onChange={setNoteIds} />
        <OptionGroup label="学习资料" options={props.resourceOptions} values={resourceIds} onChange={setResourceIds} />
      </div> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {conflict && !conflictOpen ? <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setConflictOpen(true)}>处理关联冲突</Button>
        <Button type="button" variant="ghost" size="sm" onClick={retryOnLatest}>保留输入并重试</Button>
      </div> : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="处理错题关联冲突"
        description="错题已在其他页面或设备更新。本地笔记与资料选择仍保留，系统不会自动覆盖或重放。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={conflict ? linksConflictComparisons(conflict) : []}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptServerVersion}
        onManualMerge={prepareRetry}
        mergeLabel="保留输入并重试"
      />
    </section>
  );
}

function AssociationSummary({ mistake }: { mistake: MistakeDto }) {
  if (!mistake.noteLinks.length && !mistake.resourceLinks.length) return <p className="text-sm text-zinc-400">尚未关联笔记或学习资料。</p>;
  return <div className="flex flex-wrap gap-2 text-sm">
    {mistake.noteLinks.map((link) => <Link key={link.id} href={`/knowledge/cards/${link.noteId}`} className="rounded-md border border-white/10 px-2 py-1 text-teal-200">笔记 · {link.title}</Link>)}
    {mistake.resourceLinks.map((link) => <Link key={link.id} href={`/knowledge/resources/${link.resourceId}`} className="rounded-md border border-white/10 px-2 py-1 text-teal-200">资料 · {link.title}</Link>)}
  </div>;
}

function OptionGroup(props: { label: string; options: LinkOption[]; values: string[]; onChange: (values: string[]) => void }) {
  return <fieldset className="space-y-2 rounded-md border border-white/10 p-3"><legend className="px-1 text-sm text-zinc-300">{props.label}</legend>
    {props.options.length ? <div className="max-h-44 space-y-1 overflow-auto">{props.options.map((option) => <label key={option.id} className="flex items-start gap-2 py-1 text-sm text-zinc-300"><Checkbox checked={props.values.includes(option.id)} onChange={(event) => props.onChange(event.target.checked ? [...props.values, option.id] : props.values.filter((id) => id !== option.id))} /><span className="break-words">{option.title}</span></label>)}</div> : <p className="text-sm text-zinc-500">暂无可关联内容。</p>}
  </fieldset>;
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id) => right.includes(id));
}

function freezeLinksCommand(command: UpdateMistakeLinksInput): UpdateMistakeLinksInput {
  return { ...command, noteIds: [...command.noteIds], resourceIds: [...command.resourceIds] };
}

function linksConflictComparisons(conflict: MistakeLinksConflict) {
  return [
    { field: "updatedAt", label: "错题更新时间", local: conflict.command.expectedUpdatedAt, server: conflict.latest?.updatedAt ?? "未知" },
    { field: "noteIds", label: "关联笔记", local: conflict.command.noteIds, server: conflict.latest?.noteLinks.map((link) => link.noteId) ?? "服务端未返回" },
    { field: "resourceIds", label: "关联资料", local: conflict.command.resourceIds, server: conflict.latest?.resourceLinks.map((link) => link.resourceId) ?? "服务端未返回" },
  ];
}

function isMistakeDtoSnapshot(value: unknown): value is MistakeDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const mistake = value as Partial<MistakeDto>;
  return typeof mistake.id === "string"
    && typeof mistake.updatedAt === "string"
    && Array.isArray(mistake.noteLinks)
    && Array.isArray(mistake.resourceLinks);
}
