"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowDown, ArrowUp, Pencil, Power } from "lucide-react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/page";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type {
  MotivationItemDto,
  MotivationVaultField,
} from "@/lib/study/motivation-library-service";
import type { MotivationVaultDto } from "@/lib/study/types";

type MotivationType = MotivationItemDto["type"];

interface MotivationLibraryDraft {
  type: MotivationType;
  title: string;
  body: string;
  externalUrl: string;
  vaultField: MotivationVaultField | "";
  tags: string;
}

interface MutationConflict {
  action: "patch" | "archive";
  baseline: MotivationItemDto;
  changes: Partial<MotivationItemDto>;
  latest: MotivationItemDto;
  conflictFields: string[];
}

interface RetryMutation {
  action: "patch" | "archive";
  item: MotivationItemDto;
  changes: Partial<MotivationItemDto>;
}

interface ReorderConflict {
  submittedIds: string[];
  latest: MotivationItemDto[];
}

const emptyDraft: MotivationLibraryDraft = {
  type: "QUOTE",
  title: "",
  body: "",
  externalUrl: "",
  vaultField: "",
  tags: "",
};

const typeLabels: Record<MotivationType, string> = {
  QUOTE: "语录",
  VIDEO_LINK: "HTTPS 视频链接",
  VAULT_EXCERPT: "动机封存摘录",
};

const vaultFieldLabels: Record<MotivationVaultField, string> = {
  whyStarted: "为什么开始",
  neverReturnTo: "不想回去的状态",
  futureSelf: "未来的自己",
  messageToFuture: "给未来的话",
  firstSimulationDiary: "首次模考日记",
};

export function MotivationLibraryClient(props: {
  userId: string;
  initialItems: MotivationItemDto[];
  vault: MotivationVaultDto | null;
}) {
  const draftKey = `areaforge.motivation-library.draft.${props.userId}`;
  const [items, setItems] = useState(props.initialItems);
  const [draft, setDraft] = useState<MotivationLibraryDraft>(emptyDraft);
  const [draftReady, setDraftReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<MotivationLibraryDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<MutationConflict | null>(null);
  const [retryMutation, setRetryMutation] = useState<RetryMutation | null>(null);
  const [reorderConflict, setReorderConflict] = useState<ReorderConflict | null>(null);

  const activeItems = useMemo(
    () => items.filter((item) => !item.archivedAt).sort(compareItems),
    [items],
  );
  const archivedItems = useMemo(
    () => items.filter((item) => Boolean(item.archivedAt)).sort(compareItems),
    [items],
  );
  const vaultOptions = useMemo(() => motivationVaultOptions(props.vault), [props.vault]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const restored = loadPrivateBusinessDraft(draftKey, LONG_PRIVATE_DRAFT_TTL_MS, isMotivationLibraryDraft);
      if (restored) setDraft(restored);
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey]);

  useEffect(() => {
    if (!draftReady) return;
    if (isEmptyDraft(draft)) removePrivateBusinessDraft(draftKey);
    else savePrivateBusinessDraft(draftKey, draft);
  }, [draft, draftKey, draftReady]);

  async function createItem() {
    setError(null);
    setMessage(null);
    const selectedVault = draft.vaultField ? vaultOptions.find((entry) => entry.field === draft.vaultField) : null;
    const commandPayload = {
      type: draft.type,
      title: draft.title.trim(),
      body: draft.type === "QUOTE" ? draft.body.trim() : draft.type === "VAULT_EXCERPT" ? selectedVault?.text : undefined,
      externalUrl: draft.type === "VIDEO_LINK" ? draft.externalUrl.trim() : undefined,
      vaultSourceId: draft.type === "VAULT_EXCERPT" ? props.vault?.id : undefined,
      vaultField: draft.type === "VAULT_EXCERPT" ? draft.vaultField : undefined,
      tags: parseTags(draft.tags),
      sortOrder: activeItems.length,
    };
    const commandScope = `motivation-item:${props.userId}:create`;
    setCreating(true);
    try {
      const response = await fetch("/api/motivation/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...commandPayload,
          idempotencyKey: getOrCreateIdempotencyKey(commandScope, "motivation-item", commandPayload),
        }),
      });
      const payload = await readItemResponse(response);
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok || !payload.item) {
        setError(payload.error ?? "创建失败，草稿已保留");
        return;
      }
      setItems((current) => [...current, payload.item!]);
      completeIdempotentCommand(commandScope);
      setDraft(emptyDraft);
      removePrivateBusinessDraft(draftKey);
      setMessage("内容已创建");
    } catch {
      setError("网络不可用，草稿已保留；恢复网络后请显式重试。");
    } finally {
      setCreating(false);
    }
  }

  async function patchItem(item: MotivationItemDto, changes: Partial<MotivationItemDto>) {
    setError(null);
    setMessage(null);
    setBusyItemId(item.id);
    try {
      const response = await fetch(`/api/motivation/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: item.revision, ...changes }),
      });
      const payload = await readItemResponse(response);
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok || !payload.item) {
        if (response.status === 409 && isMotivationItem(payload.latest)) {
          setConflict({
            action: "patch",
            baseline: item,
            changes,
            latest: payload.latest,
            conflictFields: payload.conflictFields ?? ["revision"],
          });
          return;
        }
        setError(payload.error ?? "更新失败");
        return;
      }
      adoptItem(payload.item);
      setRetryMutation(null);
      setEditingId(null);
      setMessage("内容已更新");
    } catch {
      setError("网络不可用，未执行更新；本地输入仍保留。");
    } finally {
      setBusyItemId(null);
    }
  }

  async function archiveItem(item: MotivationItemDto) {
    setError(null);
    setMessage(null);
    setBusyItemId(item.id);
    try {
      const response = await fetch(`/api/motivation/items/${item.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: item.revision }),
      });
      const payload = await readItemResponse(response);
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok || !payload.item) {
        if (response.status === 409 && isMotivationItem(payload.latest)) {
          setConflict({
            action: "archive",
            baseline: item,
            changes: {},
            latest: payload.latest,
            conflictFields: payload.conflictFields ?? ["revision", "archivedAt"],
          });
          return;
        }
        setError(payload.error ?? "归档失败");
        return;
      }
      adoptItem(payload.item);
      setRetryMutation(null);
      setMessage("内容已归档");
    } catch {
      setError("网络不可用，未执行归档。");
    } finally {
      setBusyItemId(null);
    }
  }

  async function moveItem(index: number, delta: -1 | 1, base = activeItems) {
    const target = index + delta;
    if (!base[index] || target < 0 || target >= base.length) return;
    const reordered = [...base];
    [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
    await submitOrder(reordered, reordered.map((item) => item.id));
  }

  async function submitOrder(order: MotivationItemDto[], submittedIds: string[]) {
    setError(null);
    setMessage(null);
    setBusyItemId("reorder");
    try {
      const response = await fetch("/api/motivation/items/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: order.map((item) => ({ id: item.id, expectedRevision: item.revision })) }),
      });
      const payload = await response.json().catch(() => null) as {
        items?: MotivationItemDto[];
        latest?: MotivationItemDto[];
        error?: string;
      } | null;
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok || !payload?.items) {
        if (response.status === 409 && Array.isArray(payload?.latest)) {
          setReorderConflict({ submittedIds, latest: payload.latest.filter(isMotivationItem) });
          return;
        }
        setError(payload?.error ?? "排序失败");
        return;
      }
      setItems((current) => [...payload.items!, ...current.filter((item) => item.archivedAt)]);
      setReorderConflict(null);
      setMessage("顺序已保存");
    } catch {
      setError("网络不可用，排序未保存。");
    } finally {
      setBusyItemId(null);
    }
  }

  function beginEdit(item: MotivationItemDto) {
    setEditingId(item.id);
    setEditDraft({
      type: item.type,
      title: item.title,
      body: item.body ?? "",
      externalUrl: item.externalUrl ?? "",
      vaultField: "",
      tags: item.tags.join(", "),
    });
  }

  function saveEdit(item: MotivationItemDto) {
    const changes: Partial<MotivationItemDto> = {
      title: editDraft.title.trim(),
      tags: parseTags(editDraft.tags),
    };
    if (item.type === "QUOTE") changes.body = editDraft.body.trim();
    if (item.type === "VIDEO_LINK") changes.externalUrl = editDraft.externalUrl.trim();
    void patchItem(item, changes);
  }

  function adoptItem(item: MotivationItemDto) {
    setItems((current) => current.map((row) => row.id === item.id ? item : row));
  }

  const canCreate = Boolean(
    draft.title.trim()
    && (draft.type === "QUOTE" ? draft.body.trim()
      : draft.type === "VIDEO_LINK" ? isHttpsUrl(draft.externalUrl)
        : draft.vaultField && vaultOptions.some((entry) => entry.field === draft.vaultField)),
  );

  return (
    <>
      <section className="space-y-5 border-t border-white/10 pt-6">
        <SectionHeader
          title="动机内容库"
          description="管理可在提醒和关键节点展示的语录、HTTPS 视频链接或你明确选择的封存摘录。"
          meta={<span className="text-xs text-zinc-500">{activeItems.length} 条启用内容</span>}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-zinc-400">内容类型</span>
            <select className="h-10 w-full rounded-md border border-white/10 bg-[#0d1117] px-3" value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as MotivationType }))}>
              {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <TextInput label="标题" value={draft.title} onChange={(title) => setDraft((current) => ({ ...current, title }))} />
          {draft.type === "QUOTE" ? <TextArea label="语录正文" value={draft.body} onChange={(body) => setDraft((current) => ({ ...current, body }))} /> : null}
          {draft.type === "VIDEO_LINK" ? <TextInput label="HTTPS 链接" value={draft.externalUrl} onChange={(externalUrl) => setDraft((current) => ({ ...current, externalUrl }))} /> : null}
          {draft.type === "VAULT_EXCERPT" ? (
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="text-zinc-400">显式选择封存内容</span>
              <select className="h-10 w-full rounded-md border border-white/10 bg-[#0d1117] px-3" value={draft.vaultField} onChange={(event) => setDraft((current) => ({ ...current, vaultField: event.target.value as MotivationVaultField | "" }))}>
                <option value="">请选择非空字段</option>
                {vaultOptions.map((entry) => <option key={entry.field} value={entry.field}>{entry.label}</option>)}
              </select>
            </label>
          ) : null}
          <TextInput label="标签（逗号分隔）" value={draft.tags} onChange={(tags) => setDraft((current) => ({ ...current, tags }))} />
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {message ? <Alert tone="success">{message}</Alert> : null}
        <Button type="button" disabled={creating || !canCreate} variant="primary" loading={creating} loadingLabel="正在添加" onClick={() => void createItem()}>
          添加内容
        </Button>

        {retryMutation ? (
          <div className="rounded-md border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-50">
            <p>已加载服务端最新基线并保留本地操作，不会自动重放。</p>
            <button type="button" className="mt-2 h-9 rounded-md bg-amber-200 px-3 text-black" onClick={() => retryMutation.action === "archive" ? void archiveItem(retryMutation.item) : void patchItem(retryMutation.item, retryMutation.changes)}>再次提交</button>
          </div>
        ) : null}

        {reorderConflict ? (
          <div className="rounded-md border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-50">
            <p>内容顺序已在其他页面变化。请选择服务端顺序，或按本地顺序重新基于最新版本提交。</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="h-9 rounded-md border border-white/10 px-3" onClick={() => { setItems((current) => [...reorderConflict.latest, ...current.filter((item) => item.archivedAt)]); setReorderConflict(null); }}>采用服务端</button>
              <button type="button" className="h-9 rounded-md bg-amber-200 px-3 text-black" onClick={() => { const desired = reorderConflict.submittedIds.map((id) => reorderConflict.latest.find((item) => item.id === id)).filter(isMotivationItem); void submitOrder(desired, reorderConflict.submittedIds); }}>重新提交本地顺序</button>
            </div>
          </div>
        ) : null}

        <ItemList
          title="当前内容"
          items={activeItems}
          busyItemId={busyItemId}
          editingId={editingId}
          editDraft={editDraft}
          onEditDraft={setEditDraft}
          onBeginEdit={beginEdit}
          onCancelEdit={() => setEditingId(null)}
          onSaveEdit={saveEdit}
          onToggle={(item) => void patchItem(item, { enabled: !item.enabled })}
          onArchive={(item) => void archiveItem(item)}
          onMove={(index, delta) => void moveItem(index, delta)}
        />

        {archivedItems.length ? (
          <details className="border-t border-white/10 pt-4">
            <summary className="cursor-pointer text-sm text-zinc-300">已归档（{archivedItems.length}）</summary>
            <ul className="mt-3 space-y-2">{archivedItems.map((item) => <ReadOnlyItem key={item.id} item={item} />)}</ul>
          </details>
        ) : null}
      </section>
      <ConflictResolutionModal
        open={conflict !== null}
        title="动机内容已在其他页面更新"
        description="本地操作和服务端最新值都已保留。请选择服务端，或以最新 revision 为基线后明确再次提交。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={conflict ? [
          { field: "revision", label: "版本", baseline: conflict.baseline.revision, local: conflict.baseline.revision, server: conflict.latest.revision },
          { field: "title", label: "标题", baseline: conflict.baseline.title, local: conflict.changes.title ?? conflict.baseline.title, server: conflict.latest.title },
          { field: "enabled", label: "启用状态", baseline: conflict.baseline.enabled, local: conflict.changes.enabled ?? conflict.baseline.enabled, server: conflict.latest.enabled },
        ] : []}
        onAdoptServer={() => {
          if (!conflict) return;
          adoptItem(conflict.latest);
          setConflict(null);
          setRetryMutation(null);
        }}
        onManualMerge={() => {
          if (!conflict) return;
          adoptItem(conflict.latest);
          setRetryMutation({ action: conflict.action, item: conflict.latest, changes: conflict.changes });
          setConflict(null);
        }}
      />
    </>
  );
}

function ItemList(props: {
  title: string;
  items: MotivationItemDto[];
  busyItemId: string | null;
  editingId: string | null;
  editDraft: MotivationLibraryDraft;
  onEditDraft: (draft: MotivationLibraryDraft) => void;
  onBeginEdit: (item: MotivationItemDto) => void;
  onCancelEdit: () => void;
  onSaveEdit: (item: MotivationItemDto) => void;
  onToggle: (item: MotivationItemDto) => void;
  onArchive: (item: MotivationItemDto) => void;
  onMove: (index: number, delta: -1 | 1) => void;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-zinc-300">{props.title}</h3>
      <ul className="space-y-2">
        {props.items.map((item, index) => (
          <li key={item.id} className="rounded-md border border-white/5 p-3">
            {props.editingId === item.id ? (
              <div className="grid gap-3">
                <TextInput label="标题" value={props.editDraft.title} onChange={(title) => props.onEditDraft({ ...props.editDraft, title })} />
                {item.type === "QUOTE" ? <TextArea label="正文" value={props.editDraft.body} onChange={(body) => props.onEditDraft({ ...props.editDraft, body })} /> : null}
                {item.type === "VIDEO_LINK" ? <TextInput label="HTTPS 链接" value={props.editDraft.externalUrl} onChange={(externalUrl) => props.onEditDraft({ ...props.editDraft, externalUrl })} /> : null}
                <TextInput label="标签（逗号分隔）" value={props.editDraft.tags} onChange={(tags) => props.onEditDraft({ ...props.editDraft, tags })} />
                <div className="flex gap-2"><button type="button" className="h-9 rounded-md bg-teal-500 px-3 text-sm text-black" disabled={props.busyItemId !== null} onClick={() => props.onSaveEdit(item)}>保存</button><button type="button" className="h-9 rounded-md border border-white/10 px-3 text-sm" onClick={props.onCancelEdit}>取消</button></div>
              </div>
            ) : (
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0"><ReadOnlyContent item={item} /></div>
                <div className="flex flex-wrap gap-1 sm:shrink-0 sm:justify-end">
                  <IconButton label="上移" disabled={index === 0 || props.busyItemId !== null} onClick={() => props.onMove(index, -1)}><ArrowUp size={16} /></IconButton>
                  <IconButton label="下移" disabled={index === props.items.length - 1 || props.busyItemId !== null} onClick={() => props.onMove(index, 1)}><ArrowDown size={16} /></IconButton>
                  <IconButton label="编辑" disabled={props.busyItemId !== null} onClick={() => props.onBeginEdit(item)}><Pencil size={16} /></IconButton>
                  <IconButton label={item.enabled ? "停用" : "启用"} disabled={props.busyItemId !== null} onClick={() => props.onToggle(item)}><Power size={16} /></IconButton>
                  <IconButton label="归档" disabled={props.busyItemId !== null} onClick={() => props.onArchive(item)}><Archive size={16} /></IconButton>
                </div>
              </div>
            )}
          </li>
        ))}
        {!props.items.length ? <li className="text-sm text-zinc-500">还没有内容。</li> : null}
      </ul>
    </section>
  );
}

function ReadOnlyItem({ item }: { item: MotivationItemDto }) {
  return <li className="rounded-md border border-white/5 p-3 opacity-70"><ReadOnlyContent item={item} /></li>;
}

function ReadOnlyContent({ item }: { item: MotivationItemDto }) {
  return <><p className="break-words text-sm font-medium text-white">{item.title}</p><p className="mt-1 text-xs text-zinc-500">{typeLabels[item.type]} · {item.enabled ? "启用" : "停用"}</p>{item.body ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-300">{item.body}</p> : null}{item.externalUrl ? <a className="mt-2 block break-all text-sm text-teal-300 hover:underline" href={item.externalUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">打开 HTTPS 视频链接</a> : null}{item.tags.length ? <p className="mt-2 text-xs text-zinc-500">{item.tags.join(" · ")}</p> : null}</>;
}

function IconButton(props: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={props.label} title={props.label} disabled={props.disabled} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-zinc-300 disabled:opacity-40" onClick={props.onClick}>{props.children}</button>;
}

function TextInput(props: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="space-y-1 text-sm"><span className="text-zinc-400">{props.label}</span><input className="h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-white" value={props.value} onChange={(event) => props.onChange(event.target.value)} /></label>;
}

function TextArea(props: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="space-y-1 text-sm sm:col-span-2"><span className="text-zinc-400">{props.label}</span><textarea className="min-h-24 w-full rounded-md border border-white/10 bg-transparent px-3 py-2 text-white" value={props.value} onChange={(event) => props.onChange(event.target.value)} /></label>;
}

async function readItemResponse(response: Response): Promise<{ item?: MotivationItemDto; latest?: MotivationItemDto; conflictFields?: string[]; error?: string }> {
  return await response.json().catch(() => ({})) as { item?: MotivationItemDto; latest?: MotivationItemDto; conflictFields?: string[]; error?: string };
}

function motivationVaultOptions(vault: MotivationVaultDto | null): Array<{ field: MotivationVaultField; label: string; text: string }> {
  if (!vault) return [];
  return (Object.keys(vaultFieldLabels) as MotivationVaultField[]).flatMap((field) => {
    const text = vault[field]?.trim();
    return text ? [{ field, label: vaultFieldLabels[field], text }] : [];
  });
}

function parseTags(value: string): string[] {
  return [...new Set(value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 12);
}

function compareItems(left: MotivationItemDto, right: MotivationItemDto): number {
  return left.sortOrder - right.sortOrder || right.updatedAt.localeCompare(left.updatedAt);
}

function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function isEmptyDraft(draft: MotivationLibraryDraft): boolean {
  return !draft.title && !draft.body && !draft.externalUrl && !draft.vaultField && !draft.tags && draft.type === "QUOTE";
}

function isMotivationLibraryDraft(value: unknown): value is MotivationLibraryDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<MotivationLibraryDraft>;
  return ["QUOTE", "VIDEO_LINK", "VAULT_EXCERPT"].includes(draft.type ?? "")
    && [draft.title, draft.body, draft.externalUrl, draft.tags].every((entry) => typeof entry === "string")
    && (draft.vaultField === "" || Object.hasOwn(vaultFieldLabels, draft.vaultField ?? ""));
}

function isMotivationItem(value: unknown): value is MotivationItemDto {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<MotivationItemDto>;
  return typeof item.id === "string" && typeof item.title === "string" && Number.isInteger(item.revision);
}
