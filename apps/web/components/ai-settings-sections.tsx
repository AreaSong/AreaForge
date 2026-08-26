import Link from "next/link";
import { forwardRef, useState } from "react";
import { Bot, CheckCircle2, KeyRound, Lock, ShieldCheck, Sparkles, Trash2, Zap } from "lucide-react";
import { AiDraftPanel } from "@/components/ai-draft-panel";
import { providerSourceLabel } from "@/components/ai-settings-model";
import { Button } from "@/components/ui/button";
import { Card, SectionCard } from "@/components/ui/card";
import { Checkbox, Input, Select } from "@/components/ui/field";
import { Metric } from "@/components/ui/metric";
import type { AiProviderCredentialStatus, AiRuntimeSettingStatus } from "@/lib/contracts";

interface ProviderSectionProps {
  status: AiProviderCredentialStatus;
  baseUrl: string;
  model: string;
  apiKey: string;
  configChanged: boolean;
  pending: boolean;
  testPending: boolean;
  error: string | null;
  message: string | null;
  testError: string | null;
  testMessage: string | null;
  onBaseUrlChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onSave: () => void;
  onTest: () => void;
  onDelete: () => void;
}

export function AiProviderSettingsSection(props: ProviderSectionProps) {
  return (
    <SectionCard variant="master" className="space-y-5" aria-labelledby="ai-account-provider-title">
      <div>
        <h2 id="ai-account-provider-title" className="text-base font-semibold text-white flex items-center gap-2">
          <KeyRound className="size-4 text-teal-300" />
          <span>账户 Provider 配置</span>
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          配置归属于当前账户。API Key 只在提交时使用，服务端加密保存，永远不会回显；留空表示更新地址或模型时保留已存密钥。
        </p>
      </div>

      <div className="af-metric-grid-four grid gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs">
        <Metric label="当前来源" value={providerSourceLabel(props.status.source)} layout="compact" valueSize="sm" />
        <Metric label="有效状态" value={props.status.effectiveConfigured ? "已配置" : "未配置"} layout="compact" valueSize="sm" />
        <Metric label="密钥状态" value={props.status.apiKeyConfigured ? "已保存（不回显）" : "未配置"} layout="compact" valueSize="sm" />
        <Metric label="加密主密钥" value={props.status.encryptionConfigured ? "可用" : "未配置"} layout="compact" valueSize="sm" />
      </div>

      <div className="af-content-grid-two grid gap-4">
        <label className="block text-sm font-medium text-zinc-300">
          <span>Base URL</span>
          <Input
            value={props.baseUrl}
            onChange={(event) => props.onBaseUrlChange(event.target.value)}
            placeholder="https://your-relay.example.com/v1"
            inputMode="url"
            autoComplete="url"
            className="mt-1.5"
          />
        </label>
        <label className="block text-sm font-medium text-zinc-300">
          <span>Model</span>
          <Input
            value={props.model}
            onChange={(event) => props.onModelChange(event.target.value)}
            placeholder="模型名称"
            autoComplete="off"
            className="mt-1.5"
          />
        </label>
        <label className="af-content-span-all block text-sm font-medium text-zinc-300">
          <span>API Key</span>
          <Input
            type="password"
            value={props.apiKey}
            onChange={(event) => props.onApiKeyChange(event.target.value)}
            placeholder={props.status.accountConfigured
              ? "已保存，留空以保留当前密钥"
              : props.status.apiKeyConfigured
                ? "当前来自部署环境；输入密钥以保存账户配置"
                : "输入 Provider 密钥"}
            autoComplete="new-password"
            className="mt-1.5"
          />
        </label>
      </div>

      {props.error ? <p role="alert" className="text-xs text-rose-300">{props.error}</p> : null}
      {props.message ? <p role="status" className="text-xs text-emerald-300">{props.message}</p> : null}
      {props.testError ? <p role="alert" className="text-xs text-rose-300">{props.testError}</p> : null}
      {props.testMessage ? <p role="status" className="text-xs text-emerald-300">{props.testMessage}</p> : null}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button
          type="button"
          variant="primary"
          disabled={!props.configChanged || props.pending || props.testPending}
          loading={props.pending}
          loadingLabel="保存中..."
          onClick={props.onSave}
        >
          保存 Provider 配置
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!props.status.effectiveConfigured || props.pending || props.testPending}
          loading={props.testPending}
          loadingLabel="测试中..."
          onClick={props.onTest}
        >
          测试连接
        </Button>
        {props.status.accountConfigured ? (
          <Button
            type="button"
            variant="danger"
            disabled={props.pending || props.testPending}
            onClick={props.onDelete}
          >
            <Trash2 className="size-4" />
            删除账户配置
          </Button>
        ) : null}
      </div>

      <p className="text-xs text-zinc-500">
        生产环境仅允许 HTTPS 且拒绝本机、私网和云元数据地址；开发环境可使用本地 Provider。测试只发送合成连接上下文，不保存模型响应。
      </p>
    </SectionCard>
  );
}

interface RuntimePreferenceSectionProps {
  runtimeStatus: AiRuntimeSettingStatus;
  runtimeEnabled: boolean;
  runtimeChanged: boolean;
  runtimePending: boolean;
  runtimeError: string | null;
  runtimeMessage: string | null;
  bindingSecretConfigured: boolean;
  externalProviderEnabled: boolean;
  externalProviderActive: boolean;
  providerReady: boolean;
  savedExternalProviderEnabled: boolean;
  preferenceChanged: boolean;
  preferencePending: boolean;
  error: string | null;
  message: string | null;
  reauthRequired: boolean;
  onRuntimeEnabledChange: (value: boolean) => void;
  onOpenRuntimeConfirm: () => void;
  onExternalProviderEnabledChange: (value: boolean) => void;
  onOpenPreferenceConfirm: () => void;
}

export const AiRuntimePreferenceSection = forwardRef<HTMLButtonElement, RuntimePreferenceSectionProps>(
  function AiRuntimePreferenceSection(props, saveButtonRef) {
    return (
      <SectionCard variant="master" className="space-y-5" aria-labelledby="ai-runtime-setting-title ai-provider-preference-title">
        <div>
          <h2 id="ai-runtime-setting-title" className="text-base font-semibold text-white flex items-center gap-2">
            <Zap className="size-4 text-teal-300" />
            <span>全局 AI 服务闸门</span>
          </h2>
          <p className="mt-1 text-xs text-zinc-400">这个开关对所有 AI 请求生效。服务端环境闸门仍保留为紧急关闭开关，网页不能绕过。</p>
        </div>

        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-3">
          <SwitchField
            checked={props.runtimeEnabled}
            disabled={!props.runtimeStatus.serverEnabled || props.runtimePending}
            title="允许显式 AI 请求使用外部 Provider"
            description={props.runtimeStatus.serverEnabled
              ? "开启后仍须当前浏览器授权、Provider 配置和各路径的显式确认。"
              : "服务端硬闸门当前关闭；需要部署环境开启 AI_ENABLED 后才能打开。"}
            onChange={props.onRuntimeEnabledChange}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/5">
            <span className="text-xs text-zinc-400">
              当前状态：{props.runtimeStatus.effectiveEnabled ? "全局已启用，可继续按路径确认" : props.runtimeStatus.serverEnabled ? "Web 全局开关已关闭" : "服务端硬闸门已关闭"}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!props.runtimeChanged || !props.runtimeStatus.serverEnabled || props.runtimePending}
              loading={props.runtimePending}
              loadingLabel="保存中..."
              onClick={props.onOpenRuntimeConfirm}
            >
              保存全局开关
            </Button>
          </div>
        </div>

        {props.runtimeError ? <p role="alert" className="text-xs text-rose-300">{props.runtimeError}</p> : null}
        {props.runtimeMessage ? <p role="status" className="text-xs text-emerald-300">{props.runtimeMessage}</p> : null}

        <div className="af-metric-grid-four grid gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs">
          <Metric label="AI_ENABLED（服务端硬闸门）" value={props.runtimeStatus.serverEnabled ? "开启" : "关闭"} layout="compact" valueSize="sm" />
          <Metric label="Web 全局开关" value={props.runtimeStatus.webEnabled ? "开启" : "关闭"} layout="compact" valueSize="sm" />
          <Metric label="生效状态" value={props.runtimeStatus.effectiveEnabled ? "可进入外部闸门" : "仅本地 fallback"} layout="compact" valueSize="sm" />
          <Metric label="Payload Binding" value={props.bindingSecretConfigured ? "服务端已配置" : "缺失/过短（外呼不可用）"} layout="compact" valueSize="sm" />
        </div>

        <div className="pt-2 border-t border-white/5 space-y-3">
          <div>
            <h3 id="ai-provider-preference-title" className="text-sm font-semibold text-white">当前浏览器授权</h3>
            <p id="ai-provider-preference-scope" className="mt-0.5 text-xs text-zinc-400">当前浏览器偏好；清除浏览器数据后恢复为关闭。</p>
          </div>
          <SwitchField
            checked={props.externalProviderEnabled}
            description="仍须全局 AI 开关、Provider 配置和各路径既有的显式确认条件同时满足。"
            title="允许显式 AI 操作调用外部 Provider"
            describedBy="ai-provider-preference-scope"
            onChange={props.onExternalProviderEnabledChange}
          />
          <p className="text-xs text-zinc-400">
            当前有效状态：{props.externalProviderActive
              ? "外部 Provider 可用于已确认的显式请求"
              : props.savedExternalProviderEnabled && !props.providerReady
                ? "偏好已开启，但系统或 Provider 尚不可用"
                : "仅使用本地规则 fallback"}
          </p>
          <p className="text-xs text-zinc-400">隐私边界：不发送附件、未选择正文、完整动机封存或复盘正文；不保存 prompt/raw response。</p>
        </div>

        {props.error ? (
          <div className="space-y-2">
            <p role="alert" className="text-xs text-rose-300">{props.error}</p>
            {props.reauthRequired ? (
              <Link href="/login?returnTo=%2Fsettings%2Fai" target="_blank" rel="noopener noreferrer" prefetch={false} className="inline-flex min-h-9 items-center rounded-xl border border-white/10 px-3 text-xs text-zinc-200 hover:bg-white/5">
                在新标签页重新登录
              </Link>
            ) : null}
          </div>
        ) : null}
        {props.message ? <p role="status" className="text-xs text-emerald-300">{props.message}</p> : null}

        <div className="pt-2">
          <Button
            ref={saveButtonRef}
            type="button"
            variant="primary"
            disabled={props.preferencePending}
            aria-disabled={!props.preferenceChanged || props.preferencePending}
            onClick={props.onOpenPreferenceConfirm}
          >
            保存 AI 设置
          </Button>
        </div>
      </SectionCard>
    );
  },
);

function SwitchField(props: {
  checked: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  describedBy?: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 text-sm text-zinc-200 cursor-pointer">
      <Checkbox role="switch" aria-describedby={props.describedBy} checked={props.checked} disabled={props.disabled} onChange={(event) => props.onChange(event.target.checked)} className="mt-0.5" />
      <span>
        <strong className="block font-medium text-white">{props.title}</strong>
        <span className="mt-0.5 block text-xs text-zinc-500">{props.description}</span>
      </span>
    </label>
  );
}

export function AiDraftDemo({ userId }: { userId: string }) {
  const [endpoint, setEndpoint] = useState<"learning-tree" | "knowledge-card" | "plan" | "motivation">("motivation");
  return (
    <Card variant="subtle" className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-teal-300" />
        <h3 className="text-base font-semibold text-white">上下文 AI 草稿演示</h3>
      </div>
      <label className="block text-xs font-medium text-zinc-300">
        <span>草稿用途</span>
        <Select className="mt-1.5" value={endpoint} onChange={(event) => setEndpoint(event.target.value as typeof endpoint)}>
          <option value="motivation">motivation（动机草稿）</option>
          <option value="learning-tree">learning-tree（考纲知识树建议）</option>
          <option value="knowledge-card">knowledge-card（知识卡片解析）</option>
          <option value="plan">plan（任务与复习建议）</option>
        </Select>
      </label>
      <div className="pt-2 border-t border-white/5">
        <AiDraftPanel key={endpoint} endpoint={endpoint} userId={userId} />
      </div>
    </Card>
  );
}
