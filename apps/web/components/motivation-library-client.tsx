"use client";

import { useEffect, useState, useTransition } from "react";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { MotivationItemDto } from "@/lib/study/motivation-library-service";

interface MotivationLibraryDraft {
  title: string;
  body: string;
}

export function MotivationLibraryClient(props: { userId: string; initialItems: MotivationItemDto[] }) {
  const draftKey = `areaforge.motivation-library.draft.${props.userId}`;
  const [items, setItems] = useState(props.initialItems);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const draft = loadPrivateBusinessDraft(draftKey, LONG_PRIVATE_DRAFT_TTL_MS, isMotivationLibraryDraft);
    if (draft) {
      setTitle(draft.title);
      setBody(draft.body);
    }
    setDraftReady(true);
  }, [draftKey]);

  useEffect(() => {
    if (!draftReady) return;
    savePrivateBusinessDraft<MotivationLibraryDraft>(draftKey, { title, body });
  }, [body, draftKey, draftReady, title]);

  async function createQuote() {
    setError(null);
    try {
      const response = await fetch("/api/motivation/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "QUOTE", title, body }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { item?: MotivationItemDto; error?: string }
        | null;
      if (response.status === 401) {
        setError("登录已过期，草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok || !payload?.item) {
        setError(payload?.error ?? "创建失败，草稿已保留");
        return;
      }
      setItems((prev) => [...prev, payload.item!]);
      setTitle("");
      setBody("");
      removePrivateBusinessDraft(draftKey);
    } catch {
      setError("网络不可用，草稿已保留；恢复网络后请显式重试。");
    }
  }

  async function toggleEnabled(item: MotivationItemDto) {
    setError(null);
    try {
      const response = await fetch(`/api/motivation/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: item.revision, enabled: !item.enabled }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { item?: MotivationItemDto; latest?: MotivationItemDto; conflictFields?: string[]; error?: string }
        | null;
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok || !payload?.item) {
        if (response.status === 409 && payload?.latest) {
          setItems((prev) => prev.map((row) => row.id === item.id ? payload.latest! : row));
          setError(`内容已在其他页面更新；已载入最新状态（冲突字段：${payload.conflictFields?.join("、") ?? "revision"}），请确认后重试。`);
          return;
        }
        setError(payload?.error ?? "更新失败");
        return;
      }
      setItems((prev) => prev.map((row) => (row.id === item.id ? payload.item! : row)));
    } catch {
      setError("网络不可用，未执行更新；恢复网络后请显式重试。");
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-white/10 p-4">
      <h3 className="text-lg font-medium text-white">动机内容库</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-zinc-400">语录标题</span>
          <input
            className="h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-white"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-zinc-400">语录正文</span>
          <textarea
            className="min-h-24 w-full rounded-md border border-white/10 bg-transparent px-3 py-2 text-white"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
      </div>
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
      <button
        type="button"
        disabled={pending || !title.trim() || !body.trim()}
        className="h-10 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:opacity-50"
        onClick={() => startTransition(() => void createQuote())}
      >
        添加语录
      </button>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-3 rounded-md border border-white/5 p-3">
            <div>
              <p className="text-sm font-medium text-white">{item.title}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {item.type}
                {item.enabled ? " · 启用" : " · 停用"}
              </p>
              {item.body ? <p className="mt-2 text-sm text-zinc-300">{item.body}</p> : null}
            </div>
            <button
              type="button"
              className="shrink-0 text-xs text-teal-300 hover:underline"
              onClick={() => void toggleEnabled(item)}
            >
              {item.enabled ? "停用" : "启用"}
            </button>
          </li>
        ))}
        {items.length === 0 ? <li className="text-sm text-zinc-500">还没有内容。先添加一条语录。</li> : null}
      </ul>
    </div>
  );
}

function isMotivationLibraryDraft(value: unknown): value is MotivationLibraryDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<MotivationLibraryDraft>;
  return typeof draft.title === "string" && typeof draft.body === "string";
}
