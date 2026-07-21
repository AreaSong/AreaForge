"use client";

import { useState, useTransition } from "react";

type Endpoint = "learning-tree" | "knowledge-card" | "plan" | "motivation";

export function AiDraftPanel(props: { endpoint: Endpoint; defaultText?: string }) {
  const [selectedText, setSelectedText] = useState(props.defaultText ?? "");
  const [tone, setTone] = useState<"CALM" | "DIRECT" | "BRIEF">("CALM");
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [draft, setDraft] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const disabled = !selectedText.trim();

  async function runPreview() {
    setError(null);
    setDraft(null);
    const body: Record<string, unknown> = {
      phase: "preview",
      selectedText,
    };
    if (props.endpoint === "motivation") body.tone = tone;
    if (props.endpoint === "learning-tree") body.scope = "global";
    if (props.endpoint === "knowledge-card") body.kind = "GENERAL";

    const response = await fetch(`/api/ai/drafts/${props.endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | { previewToken?: string; payloadPreview?: Record<string, unknown>; error?: string }
      | null;
    if (!response.ok || !payload?.previewToken) {
      setError(payload?.error ?? "预览失败");
      return;
    }
    setToken(payload.previewToken);
    setPreview(payload.payloadPreview ?? null);
  }

  async function runGenerate() {
    if (!token) return;
    setError(null);
    const body: Record<string, unknown> = {
      phase: "generate",
      previewToken: token,
      selectedText,
    };
    if (props.endpoint === "motivation") body.tone = tone;
    if (props.endpoint === "learning-tree") body.scope = "global";
    if (props.endpoint === "knowledge-card") body.kind = "GENERAL";

    const response = await fetch(`/api/ai/drafts/${props.endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | { draft?: unknown; error?: string; meta?: { reason?: string } }
      | null;
    if (!response.ok) {
      setError(payload?.error ?? "生成失败");
      return;
    }
    setDraft(payload?.draft ?? null);
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm text-zinc-400">
        选中文本（无选中则禁用）
        <textarea
          className="mt-1 min-h-24 w-full rounded-md border border-white/10 bg-transparent px-3 py-2 text-white"
          value={selectedText}
          onChange={(event) => setSelectedText(event.target.value)}
          placeholder="粘贴或输入本次要发送的选中文本"
        />
      </label>
      {props.endpoint === "motivation" ? (
        <label className="block text-sm text-zinc-400">
          语气
          <select
            className="mt-1 h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-white"
            value={tone}
            onChange={(event) => setTone(event.target.value as typeof tone)}
          >
            <option value="CALM">CALM</option>
            <option value="DIRECT">DIRECT</option>
            <option value="BRIEF">BRIEF</option>
          </select>
        </label>
      ) : null}
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || pending}
          className="h-10 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:opacity-50"
          onClick={() => startTransition(() => void runPreview())}
        >
          发送前预览
        </button>
        <button
          type="button"
          disabled={!token || pending}
          className="h-10 rounded-md border border-white/10 px-4 text-sm text-zinc-200 disabled:opacity-50"
          onClick={() => startTransition(() => void runGenerate())}
        >
          确认生成草稿
        </button>
      </div>
      {preview ? (
        <pre className="overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-xs text-zinc-300">
          {JSON.stringify(preview, null, 2)}
        </pre>
      ) : null}
      {draft ? (
        <pre className="overflow-auto rounded-md border border-teal-500/20 bg-black/30 p-3 text-xs text-zinc-200">
          {JSON.stringify(draft, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
