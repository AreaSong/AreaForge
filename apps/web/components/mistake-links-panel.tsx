"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Save } from "lucide-react";
import { Alert } from "@/components/ui/feedback";
import type { MistakeDto } from "@/lib/study/types";

interface LinkOption {
  id: string;
  title: string;
}

export function MistakeLinksPanel(props: {
  mistake: MistakeDto;
  noteOptions: LinkOption[];
  resourceOptions: LinkOption[];
  readOnly: boolean;
  onSaved: (mistake: MistakeDto) => void;
}) {
  const initialNoteIds = useMemo(() => props.mistake.noteLinks.map((link) => link.noteId), [props.mistake.noteLinks]);
  const initialResourceIds = useMemo(() => props.mistake.resourceLinks.map((link) => link.resourceId), [props.mistake.resourceLinks]);
  const [noteIds, setNoteIds] = useState(initialNoteIds);
  const [resourceIds, setResourceIds] = useState(initialResourceIds);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = !sameIds(noteIds, initialNoteIds) || !sameIds(resourceIds, initialResourceIds);

  async function saveLinks() {
    if (pending || props.readOnly || !dirty) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/mistakes/${props.mistake.id}/links`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: props.mistake.updatedAt, noteIds, resourceIds }),
      });
      const body = await response.json().catch(() => null) as { mistake?: MistakeDto; error?: string } | null;
      if (!response.ok || !body?.mistake) throw new Error(body?.error ?? "保存关联失败，请刷新后重试。");
      props.onSaved(body.mistake);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存关联失败，请刷新后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-3 border-t border-white/10 pt-5" aria-labelledby="mistake-links-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs text-zinc-500">学习上下文</p><h2 id="mistake-links-heading" className="mt-1 text-lg font-medium text-white">关联笔记与资料</h2></div>
        {!props.readOnly ? <button type="button" disabled={!dirty || pending} onClick={() => void saveLinks()} className="inline-flex h-10 items-center gap-2 rounded-md border border-teal-300/30 px-3 text-sm text-teal-100 disabled:opacity-40"><Save size={16} aria-hidden />{pending ? "保存中" : "保存关联"}</button> : null}
      </div>

      <AssociationSummary mistake={props.mistake} />
      {!props.readOnly ? <div className="grid gap-4 md:grid-cols-2">
        <OptionGroup label="笔记" options={props.noteOptions} values={noteIds} onChange={setNoteIds} />
        <OptionGroup label="学习资料" options={props.resourceOptions} values={resourceIds} onChange={setResourceIds} />
      </div> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
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
    {props.options.length ? <div className="max-h-44 space-y-1 overflow-auto">{props.options.map((option) => <label key={option.id} className="flex items-start gap-2 py-1 text-sm text-zinc-300"><input type="checkbox" checked={props.values.includes(option.id)} onChange={(event) => props.onChange(event.target.checked ? [...props.values, option.id] : props.values.filter((id) => id !== option.id))} /><span className="break-words">{option.title}</span></label>)}</div> : <p className="text-sm text-zinc-500">暂无可关联内容。</p>}
  </fieldset>;
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id) => right.includes(id));
}
