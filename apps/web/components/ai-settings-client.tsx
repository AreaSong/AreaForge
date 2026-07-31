"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { AiDraftPanel } from "@/components/ai-draft-panel";
import { Modal } from "@/components/ui/overlays";
import type { AiProviderPreferenceDto } from "@/lib/study/ai-provider-preference";

export function AiSettingsClient(props: {
  userId: string;
  aiEnabled: boolean;
  modelConfigured: boolean;
  bindingSecretConfigured: boolean;
  initialExternalProviderEnabled: boolean;
}) {
  const [externalProviderEnabled, setExternalProviderEnabled] = useState(
    props.initialExternalProviderEnabled,
  );
  const [savedExternalProviderEnabled, setSavedExternalProviderEnabled] = useState(
    props.initialExternalProviderEnabled,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [pending, startTransition] = useTransition();
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const restoreSaveFocusRef = useRef(false);
  const changed = externalProviderEnabled !== savedExternalProviderEnabled;
  const providerReady = props.aiEnabled && props.modelConfigured;
  const externalProviderActive = providerReady && savedExternalProviderEnabled;

  useEffect(() => {
    if (confirmOpen || pending || !restoreSaveFocusRef.current) return;
    restoreSaveFocusRef.current = false;
    saveButtonRef.current?.focus();
  }, [confirmOpen, pending]);

  function closeConfirmModal() {
    restoreSaveFocusRef.current = true;
    setConfirmOpen(false);
  }

  async function saveConfirmedPreference() {
    setError(null);
    setMessage(null);
    setReauthRequired(false);
    try {
      const response = await fetch("/api/ai/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalProviderEnabled }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { preference?: AiProviderPreferenceDto; error?: string }
        | null;
      if (response.status === 401) {
        closeConfirmModal();
        setError("登录已过期，AI 设置尚未保存。重新登录后请显式重试。");
        setReauthRequired(true);
        return;
      }
      if (!response.ok || !isAiProviderPreference(payload?.preference)) {
        closeConfirmModal();
        setError(payload?.error ?? "AI 设置保存失败，请显式重试。");
        return;
      }
      setExternalProviderEnabled(payload.preference.externalProviderEnabled);
      setSavedExternalProviderEnabled(payload.preference.externalProviderEnabled);
      closeConfirmModal();
      setMessage(payload.preference.externalProviderEnabled
        ? "AI 设置已保存：当前浏览器允许显式外部 Provider 请求。"
        : "AI 设置已保存：当前浏览器仅使用本地规则 fallback。");
    } catch {
      closeConfirmModal();
      setError("网络不可用，AI 设置尚未保存；恢复网络后请显式重试。");
    }
  }

  return (
    <>
    <div className="space-y-6">
      <section
        className="space-y-4 rounded-lg border border-white/10 p-4"
        aria-labelledby="ai-provider-preference-title"
      >
        <div>
          <h2 id="ai-provider-preference-title" className="text-base font-medium text-white">外部 Provider</h2>
          <p id="ai-provider-preference-scope" className="mt-1 text-sm text-zinc-400">
            当前浏览器偏好；清除浏览器数据后恢复为关闭。
          </p>
        </div>
        <label className="flex items-start gap-3 text-sm text-zinc-200">
          <input
            type="checkbox"
            role="switch"
            aria-describedby="ai-provider-preference-scope"
            checked={externalProviderEnabled}
            onChange={(event) => {
              setExternalProviderEnabled(event.target.checked);
              setMessage(null);
              setError(null);
              setReauthRequired(false);
            }}
            className="mt-0.5 h-4 w-4 accent-teal-400"
          />
          <span>
            允许显式 AI 操作调用外部 Provider
            <span className="mt-1 block text-xs text-zinc-500">
              仍须系统开关、Provider 配置和各路径既有的显式确认条件同时满足。
            </span>
          </span>
        </label>
        <p className="text-sm text-zinc-300">
          当前有效状态：{externalProviderActive
            ? "外部 Provider 可用于已确认的显式请求"
            : savedExternalProviderEnabled && !providerReady
              ? "偏好已开启，但系统或 Provider 尚不可用"
              : "仅使用本地规则 fallback"}
        </p>
        <dl className="grid gap-3 border-t border-white/10 pt-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-zinc-500">AI_ENABLED</dt>
            <dd className="mt-1 text-white">{props.aiEnabled ? "开启" : "关闭（本地 fallback）"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Provider 配置</dt>
            <dd className="mt-1 text-white">{props.modelConfigured ? "已配置" : "未完整配置"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Payload Binding</dt>
            <dd className="mt-1 text-white">
              {props.bindingSecretConfigured ? "服务端已配置" : "缺失/过短（四类草稿外呼不可用）"}
            </dd>
          </div>
        </dl>
        <p className="text-sm text-zinc-400">
          隐私边界：不发送附件、未选择正文、完整动机封存或复盘正文；不保存 prompt/raw response。
        </p>
        {error ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-red-300">{error}</p>
            {reauthRequired ? (
              <Link
                href="/login?returnTo=%2Fsettings%2Fai"
                target="_blank"
                rel="noopener noreferrer"
                prefetch={false}
                className="inline-flex min-h-10 items-center rounded-md border border-white/10 px-3 text-sm text-zinc-200"
              >
                在新标签页重新登录
              </Link>
            ) : null}
          </div>
        ) : null}
        {message ? <p role="status" className="text-sm text-emerald-300">{message}</p> : null}
        <button
          ref={saveButtonRef}
          type="button"
          disabled={pending}
          aria-disabled={!changed || pending}
          className="h-10 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          onClick={() => {
            if (!changed || pending) return;
            setConfirmOpen(true);
          }}
        >
          保存 AI 设置
        </button>
      </section>
      <AiDraftDemo userId={props.userId} />
    </div>
    <Modal
      open={confirmOpen}
      title={externalProviderEnabled ? "确认开启外部 Provider" : "确认关闭外部 Provider"}
      onClose={pending ? undefined : closeConfirmModal}
      allowEscape={!pending}
    >
      <div className="space-y-4 text-sm text-zinc-300">
        <p>
          {externalProviderEnabled
            ? "开启后，只有你主动触发的 AI 请求才可能调用已配置的外部 Provider；四类文本草稿仍须先确认发送预览。"
            : "关闭后，当前浏览器的 AI 请求将使用本地规则 fallback，不调用外部 Provider。"}
        </p>
        <p className="text-zinc-500">
          本次设置不改变允许字段，不发送附件、未选择正文、完整动机封存或完整复盘正文。
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            className="h-10 rounded-md border border-white/10 px-4 text-zinc-200 disabled:opacity-50"
            onClick={closeConfirmModal}
          >
            取消
          </button>
          <button
            type="button"
            disabled={pending}
            className="h-10 rounded-md bg-teal-500/90 px-4 font-medium text-black disabled:opacity-50"
            onClick={() => startTransition(saveConfirmedPreference)}
          >
            {pending ? "保存中..." : externalProviderEnabled ? "确认开启并保存" : "确认关闭并保存"}
          </button>
        </div>
      </div>
    </Modal>
    </>
  );
}

function isAiProviderPreference(value: unknown): value is AiProviderPreferenceDto {
  if (!value || typeof value !== "object") return false;
  const preference = value as Partial<AiProviderPreferenceDto>;
  return typeof preference.externalProviderEnabled === "boolean"
    && preference.scope === "current_browser";
}

function AiDraftDemo({ userId }: { userId: string }) {
  const [endpoint, setEndpoint] = useState<"learning-tree" | "knowledge-card" | "plan" | "motivation">(
    "motivation",
  );
  return (
    <div className="space-y-3 rounded-lg border border-white/10 p-4">
      <h3 className="text-lg font-medium text-white">上下文 AI 草稿</h3>
      <label className="block text-sm text-zinc-400">
        用途
        <select
          className="mt-1 h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-white"
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value as typeof endpoint)}
        >
          <option value="motivation">motivation</option>
          <option value="learning-tree">learning-tree</option>
          <option value="knowledge-card">knowledge-card</option>
          <option value="plan">plan</option>
        </select>
      </label>
      <AiDraftPanel key={endpoint} endpoint={endpoint} userId={userId} />
    </div>
  );
}
