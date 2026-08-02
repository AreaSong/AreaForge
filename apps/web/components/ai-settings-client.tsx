"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { AiDraftPanel } from "@/components/ai-draft-panel";
import { Modal } from "@/components/ui/overlays";
import type { AiProviderPreferenceDto } from "@/lib/study/ai-provider-preference";
import type { AiProviderCredentialStatus } from "@/lib/study/ai-provider-credential-service";
import type { AiRuntimeSettingStatus } from "@/lib/study/ai-runtime-setting-service";

export function AiSettingsClient(props: {
  userId: string;
  initialRuntimeStatus: AiRuntimeSettingStatus;
  bindingSecretConfigured: boolean;
  initialExternalProviderEnabled: boolean;
  initialProviderStatus: AiProviderCredentialStatus;
}) {
  const [providerStatus, setProviderStatus] = useState(props.initialProviderStatus);
  const [runtimeStatus, setRuntimeStatus] = useState(props.initialRuntimeStatus);
  const [runtimeEnabled, setRuntimeEnabled] = useState(props.initialRuntimeStatus.webEnabled);
  const [savedRuntimeEnabled, setSavedRuntimeEnabled] = useState(props.initialRuntimeStatus.webEnabled);
  const [baseUrl, setBaseUrl] = useState(props.initialProviderStatus.baseUrl ?? "");
  const [model, setModel] = useState(props.initialProviderStatus.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [savedBaseUrl, setSavedBaseUrl] = useState(props.initialProviderStatus.baseUrl ?? "");
  const [savedModel, setSavedModel] = useState(props.initialProviderStatus.model ?? "");
  const [externalProviderEnabled, setExternalProviderEnabled] = useState(
    props.initialExternalProviderEnabled,
  );
  const [savedExternalProviderEnabled, setSavedExternalProviderEnabled] = useState(
    props.initialExternalProviderEnabled,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providerMessage, setProviderMessage] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [providerPending, setProviderPending] = useState(false);
  const [testPending, setTestPending] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [runtimeConfirmOpen, setRuntimeConfirmOpen] = useState(false);
  const [runtimePending, setRuntimePending] = useState(false);
  const [runtimeMessage, setRuntimeMessage] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [reauthRequired, setReauthRequired] = useState(false);
  const [pending, startTransition] = useTransition();
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const restoreSaveFocusRef = useRef(false);
  const runtimeChanged = runtimeEnabled !== savedRuntimeEnabled;
  const changed = externalProviderEnabled !== savedExternalProviderEnabled;
  const providerConfigChanged = baseUrl !== savedBaseUrl || model !== savedModel || apiKey.trim().length > 0;
  const providerReady = runtimeStatus.effectiveEnabled && providerStatus.effectiveConfigured;
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

  async function saveRuntimeSetting() {
    setRuntimeError(null);
    setRuntimeMessage(null);
    setRuntimePending(true);
    try {
      const response = await fetch("/api/ai/runtime", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: runtimeEnabled, expectedRevision: runtimeStatus.revision }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { runtime?: AiRuntimeSettingStatus; error?: string }
        | null;
      if (response.status === 401) {
        setRuntimeError("登录已过期，全局 AI 设置尚未保存。重新登录后请显式重试。");
        return;
      }
      if (!response.ok || !isAiRuntimeSettingStatus(payload?.runtime)) {
        setRuntimeError(payload?.error ?? "全局 AI 设置保存失败，请显式重试。");
        return;
      }
      setRuntimeStatus(payload.runtime);
      setRuntimeEnabled(payload.runtime.webEnabled);
      setSavedRuntimeEnabled(payload.runtime.webEnabled);
      setRuntimeConfirmOpen(false);
      setRuntimeMessage(payload.runtime.webEnabled
        ? "全局 AI 开关已开启；仍需当前浏览器授权和 Provider 配置后才会外呼。"
        : "全局 AI 开关已关闭，所有 AI 请求将使用本地规则 fallback。");
    } catch {
      setRuntimeError("网络不可用，全局 AI 设置尚未保存；恢复网络后请显式重试。");
    } finally {
      setRuntimePending(false);
    }
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

  async function saveProviderConfiguration() {
    setProviderError(null);
    setProviderMessage(null);
    setTestError(null);
    setTestMessage(null);
    setProviderPending(true);
    try {
      const body: Record<string, unknown> = {
        baseUrl,
        model,
      };
      if (apiKey.trim()) body.apiKey = apiKey;
      if (providerStatus.accountConfigured && providerStatus.revision !== null) {
        body.expectedRevision = providerStatus.revision;
      }
      const response = await fetch("/api/ai/provider", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as { provider?: AiProviderCredentialStatus; error?: string } | null;
      if (response.status === 401) {
        setProviderError("登录已过期，Provider 配置尚未保存。请重新登录后显式重试。");
        return;
      }
      if (!response.ok || !isAiProviderCredentialStatus(payload?.provider)) {
        setProviderError(payload?.error ?? "Provider 配置保存失败，请检查地址、模型和密钥后重试。");
        return;
      }
      setProviderStatus(payload.provider);
      setBaseUrl(payload.provider.baseUrl ?? baseUrl);
      setModel(payload.provider.model ?? model);
      setSavedBaseUrl(payload.provider.baseUrl ?? baseUrl);
      setSavedModel(payload.provider.model ?? model);
      setApiKey("");
      setProviderMessage("Provider 配置已保存。密钥只保存在服务端密文中，不会回显。");
    } catch {
      setProviderError("网络不可用，Provider 配置尚未保存；恢复网络后请显式重试。");
    } finally {
      setProviderPending(false);
    }
  }

  async function testProviderConnection() {
    setTestError(null);
    setTestMessage(null);
    setTestPending(true);
    try {
      const response = await fetch("/api/ai/provider/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload = (await response.json().catch(() => null)) as {
        test?: { success?: boolean; reason?: string };
        error?: string;
      } | null;
      if (!response.ok || !payload?.test) {
        setTestError(payload?.error ?? "Provider 测试失败，请检查设置。");
        return;
      }
      if (payload.test.success) setTestMessage(payload.test.reason ?? "Provider 连接测试成功，响应未保存。");
      else setTestError(payload.test.reason ?? "Provider 连接失败，响应未保存。");
    } catch {
      setTestError("网络不可用，Provider 测试未完成。");
    } finally {
      setTestPending(false);
    }
  }

  async function deleteProviderConfiguration() {
    setProviderError(null);
    setProviderMessage(null);
    setProviderPending(true);
    try {
      const response = await fetch("/api/ai/provider", { method: "DELETE" });
      const payload = (await response.json().catch(() => null)) as { provider?: AiProviderCredentialStatus; error?: string } | null;
      if (!response.ok || !isAiProviderCredentialStatus(payload?.provider)) {
        setProviderError(payload?.error ?? "Provider 配置删除失败，请显式重试。");
        return;
      }
      setProviderStatus(payload.provider);
      setBaseUrl(payload.provider.baseUrl ?? "");
      setModel(payload.provider.model ?? "");
      setSavedBaseUrl(payload.provider.baseUrl ?? "");
      setSavedModel(payload.provider.model ?? "");
      setApiKey("");
      setDeleteConfirmOpen(false);
      setProviderMessage("当前账户 Provider 配置已删除。若部署环境仍有旧配置，将继续作为兼容回退。");
    } catch {
      setProviderError("网络不可用，Provider 配置尚未删除。");
    } finally {
      setProviderPending(false);
    }
  }

  return (
    <>
    <div className="space-y-6">
      <section
        className="space-y-4 rounded-lg border border-white/10 p-4"
        aria-labelledby="ai-account-provider-title"
      >
        <div>
          <h2 id="ai-account-provider-title" className="text-base font-medium text-white">账户 Provider 配置</h2>
          <p className="mt-1 text-sm text-zinc-400">
            配置归属于当前账户。API Key 只在提交时使用，服务端加密保存，永远不会回显；留空表示更新地址或模型时保留已存密钥。
          </p>
        </div>
        <dl className="grid gap-3 border-y border-white/10 py-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-zinc-500">当前来源</dt>
            <dd className="mt-1 text-white">{providerSourceLabel(providerStatus.source)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">有效状态</dt>
            <dd className="mt-1 text-white">{providerStatus.effectiveConfigured ? "已配置" : "未配置"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">密钥状态</dt>
            <dd className="mt-1 text-white">{providerStatus.apiKeyConfigured ? "已保存（不回显）" : "未配置"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">加密主密钥</dt>
            <dd className="mt-1 text-white">{providerStatus.encryptionConfigured ? "可用" : "未配置"}</dd>
          </div>
        </dl>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm text-zinc-300">
            Base URL
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://your-relay.example.com/v1"
              inputMode="url"
              autoComplete="url"
              className="mt-1 h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-white placeholder:text-zinc-600"
            />
          </label>
          <label className="block text-sm text-zinc-300">
            Model
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="模型名称"
              autoComplete="off"
              className="mt-1 h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-white placeholder:text-zinc-600"
            />
          </label>
          <label className="block text-sm text-zinc-300 md:col-span-2">
            API Key
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={providerStatus.accountConfigured
                ? "已保存，留空以保留当前密钥"
                : providerStatus.apiKeyConfigured
                  ? "当前来自部署环境；输入密钥以保存账户配置"
                  : "输入 Provider 密钥"}
              autoComplete="new-password"
              className="mt-1 h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-white placeholder:text-zinc-600"
            />
          </label>
        </div>
        {providerError ? <p role="alert" className="text-sm text-red-300">{providerError}</p> : null}
        {providerMessage ? <p role="status" className="text-sm text-emerald-300">{providerMessage}</p> : null}
        {testError ? <p role="alert" className="text-sm text-red-300">{testError}</p> : null}
        {testMessage ? <p role="status" className="text-sm text-emerald-300">{testMessage}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!providerConfigChanged || providerPending || testPending}
            onClick={() => void saveProviderConfiguration()}
            className="h-10 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            {providerPending ? "保存中..." : "保存 Provider 配置"}
          </button>
          <button
            type="button"
            disabled={!providerStatus.effectiveConfigured || providerPending || testPending}
            onClick={() => void testProviderConnection()}
            className="h-10 rounded-md border border-white/10 px-4 text-sm text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testPending ? "测试中..." : "测试连接"}
          </button>
          {providerStatus.accountConfigured ? (
            <button
              type="button"
              disabled={providerPending || testPending}
              onClick={() => setDeleteConfirmOpen(true)}
              className="h-10 rounded-md border border-red-400/30 px-4 text-sm text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              删除账户配置
            </button>
          ) : null}
        </div>
        <p className="text-xs text-zinc-500">
          生产环境仅允许 HTTPS 且拒绝本机、私网和云元数据地址；开发环境可使用本地 Provider。测试只发送合成连接上下文，不保存模型响应。
        </p>
      </section>
      <section
        className="space-y-4 rounded-lg border border-white/10 p-4"
        aria-labelledby="ai-runtime-setting-title ai-provider-preference-title"
      >
        <div>
          <h2 id="ai-runtime-setting-title" className="text-base font-medium text-white">全局 AI 服务</h2>
          <p className="mt-1 text-sm text-zinc-400">
            这个开关对所有 AI 请求生效。服务端环境闸门仍保留为紧急关闭开关，网页不能绕过。
          </p>
        </div>
        <label className="flex items-start gap-3 text-sm text-zinc-200">
          <input
            type="checkbox"
            role="switch"
            checked={runtimeEnabled}
            disabled={!runtimeStatus.serverEnabled || runtimePending}
            onChange={(event) => {
              setRuntimeEnabled(event.target.checked);
              setRuntimeMessage(null);
              setRuntimeError(null);
            }}
            className="mt-0.5 h-4 w-4 accent-teal-400"
          />
          <span>
            允许显式 AI 请求使用外部 Provider
            <span className="mt-1 block text-xs text-zinc-500">
              {runtimeStatus.serverEnabled
                ? "开启后仍须当前浏览器授权、Provider 配置和各路径的显式确认。"
                : "服务端硬闸门当前关闭；需要部署环境开启 AI_ENABLED 后才能打开。"}
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-zinc-300">
            当前状态：{runtimeStatus.effectiveEnabled ? "全局已启用，可继续按路径确认" : runtimeStatus.serverEnabled ? "Web 全局开关已关闭" : "服务端硬闸门已关闭"}
          </p>
          <button
            type="button"
            disabled={!runtimeChanged || !runtimeStatus.serverEnabled || runtimePending}
            onClick={() => setRuntimeConfirmOpen(true)}
            className="h-10 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            {runtimePending ? "保存中..." : "保存全局开关"}
          </button>
        </div>
        {runtimeError ? <p role="alert" className="text-sm text-red-300">{runtimeError}</p> : null}
        {runtimeMessage ? <p role="status" className="text-sm text-emerald-300">{runtimeMessage}</p> : null}
        <dl className="grid gap-3 border-y border-white/10 py-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-zinc-500">AI_ENABLED（服务端硬闸门）</dt>
            <dd className="mt-1 text-white">{runtimeStatus.serverEnabled ? "开启" : "关闭"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Web 全局开关</dt>
            <dd className="mt-1 text-white">{runtimeStatus.webEnabled ? "开启" : "关闭"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">生效状态</dt>
            <dd className="mt-1 text-white">{runtimeStatus.effectiveEnabled ? "可进入外部请求闸门" : "仅本地 fallback"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Payload Binding</dt>
            <dd className="mt-1 text-white">
              {props.bindingSecretConfigured ? "服务端已配置" : "缺失/过短（四类草稿外呼不可用）"}
            </dd>
          </div>
        </dl>
        <div>
          <h2 id="ai-provider-preference-title" className="text-base font-medium text-white">当前浏览器授权</h2>
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
              仍须全局 AI 开关、Provider 配置和各路径既有的显式确认条件同时满足。
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
      open={runtimeConfirmOpen}
      title={runtimeEnabled ? "确认开启全局 AI" : "确认关闭全局 AI"}
      onClose={runtimePending ? undefined : () => setRuntimeConfirmOpen(false)}
      allowEscape={!runtimePending}
    >
      <div className="space-y-4 text-sm text-zinc-300">
        <p>
          {runtimeEnabled
            ? "开启后，已获得浏览器授权的显式 AI 操作才可能访问账户 Provider；系统不会在页面加载、SSR 或后台任务中自动外呼。"
            : "关闭后，所有账户和浏览器的 AI 操作都会回退本地规则，不会访问外部 Provider。"}
        </p>
        <p className="text-zinc-500">
          不改变允许发送的字段，不发送附件、完整动机封存、完整复盘正文或未选择正文，也不保存 prompt/raw response。
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={runtimePending}
            className="h-10 rounded-md border border-white/10 px-4 text-zinc-200 disabled:opacity-50"
            onClick={() => setRuntimeConfirmOpen(false)}
          >
            取消
          </button>
          <button
            type="button"
            disabled={runtimePending}
            className="h-10 rounded-md bg-teal-500/90 px-4 font-medium text-black disabled:opacity-50"
            onClick={() => void saveRuntimeSetting()}
          >
            {runtimePending ? "保存中..." : runtimeEnabled ? "确认开启并保存" : "确认关闭并保存"}
          </button>
        </div>
      </div>
    </Modal>
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
    <Modal
      open={deleteConfirmOpen}
      title="确认删除账户 Provider 配置"
      onClose={providerPending ? undefined : () => setDeleteConfirmOpen(false)}
      allowEscape={!providerPending}
    >
      <div className="space-y-4 text-sm text-zinc-300">
        <p>删除后，当前账户配置会立即失效，API Key 密文记录会从当前数据库中删除；历史备份不会同步物理清除。</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={providerPending}
            className="h-10 rounded-md border border-white/10 px-4 text-zinc-200 disabled:opacity-50"
            onClick={() => setDeleteConfirmOpen(false)}
          >
            取消
          </button>
          <button
            type="button"
            disabled={providerPending}
            className="h-10 rounded-md bg-red-500/90 px-4 font-medium text-white disabled:opacity-50"
            onClick={() => void deleteProviderConfiguration()}
          >
            {providerPending ? "删除中..." : "确认删除"}
          </button>
        </div>
      </div>
    </Modal>
    </>
  );
}

function providerSourceLabel(source: AiProviderCredentialStatus["source"]): string {
  if (source === "account") return "当前账户";
  if (source === "environment") return "部署环境回退";
  return "未配置";
}

function isAiRuntimeSettingStatus(value: unknown): value is AiRuntimeSettingStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<AiRuntimeSettingStatus>;
  return typeof status.webEnabled === "boolean"
    && typeof status.serverEnabled === "boolean"
    && typeof status.effectiveEnabled === "boolean"
    && typeof status.revision === "number"
    && (status.updatedAt === null || typeof status.updatedAt === "string");
}

function isAiProviderCredentialStatus(value: unknown): value is AiProviderCredentialStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<AiProviderCredentialStatus>;
  return typeof status.accountConfigured === "boolean"
    && typeof status.effectiveConfigured === "boolean"
    && (status.source === "account" || status.source === "environment" || status.source === "none")
    && (status.baseUrl === null || typeof status.baseUrl === "string")
    && (status.model === null || typeof status.model === "string")
    && typeof status.apiKeyConfigured === "boolean"
    && typeof status.encryptionConfigured === "boolean"
    && typeof status.globalEnabled === "boolean";
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
