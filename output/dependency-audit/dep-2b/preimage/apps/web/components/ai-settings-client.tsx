"use client";

import {
  deleteAiProvider,
  testAiProvider,
  updateAiPreference,
  updateAiProvider,
  updateAiRuntime,
} from "@/lib/api/ai";
import { useEffect, useRef, useState, useTransition } from "react";
import type { AiProviderCredentialStatus, AiProviderUpdateRequestDto } from "@/lib/contracts";
import type { AiRuntimeSettingStatus } from "@/lib/contracts";
import { classifyApiFailure } from "@/lib/client/api-errors";
import {
  AiDraftDemo,
  AiProviderSettingsSection,
  AiRuntimePreferenceSection,
} from "@/components/ai-settings-sections";
import { AiSettingsModals } from "@/components/ai-settings-modals";
import {
  isAiProviderCredentialStatus,
  isAiProviderPreference,
  isAiRuntimeSettingStatus,
} from "@/components/ai-settings-model";

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
      const result = await updateAiRuntime({ enabled: runtimeEnabled, expectedRevision: runtimeStatus.revision });
      const payload = result.body;
      if (!result.ok) {
        const failure = classifyApiFailure(result);
        setRuntimeError(failure.kind === "unauthorized"
          ? "登录已过期，全局 AI 设置尚未保存。重新登录后请显式重试。"
          : failure.code ?? "全局 AI 设置保存失败，请显式重试。");
        return;
      }
      if (!isAiRuntimeSettingStatus(payload?.runtime)) {
        setRuntimeError("全局 AI 设置保存失败，请显式重试。");
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
      const result = await updateAiPreference({ externalProviderEnabled });
      const payload = result.body;
      if (!result.ok) {
        const failure = classifyApiFailure(result);
        closeConfirmModal();
        setError(failure.kind === "unauthorized"
          ? "登录已过期，AI 设置尚未保存。重新登录后请显式重试。"
          : failure.code ?? "AI 设置保存失败，请显式重试。");
        if (failure.kind === "unauthorized") setReauthRequired(true);
        return;
      }
      if (!isAiProviderPreference(payload?.preference)) {
        closeConfirmModal();
        setError("AI 设置保存失败，请显式重试。");
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
      const body: AiProviderUpdateRequestDto = {
        baseUrl,
        model,
      };
      if (apiKey.trim()) body.apiKey = apiKey;
      if (providerStatus.accountConfigured && providerStatus.revision !== null) {
        body.expectedRevision = providerStatus.revision;
      }
      const result = await updateAiProvider(body);
      const payload = result.body;
      if (!result.ok) {
        const failure = classifyApiFailure(result);
        setProviderError(failure.kind === "unauthorized"
          ? "登录已过期，Provider 配置尚未保存。请重新登录后显式重试。"
          : failure.code ?? "Provider 配置保存失败，请检查地址、模型和密钥后重试。");
        return;
      }
      if (!isAiProviderCredentialStatus(payload?.provider)) {
        setProviderError("Provider 配置保存失败，请检查地址、模型和密钥后重试。");
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
      const result = await testAiProvider();
      const payload = result.body;
      if (!result.ok) {
        const failure = classifyApiFailure(result);
        setTestError(failure.code ?? "Provider 测试失败，请检查设置。");
        return;
      }
      if (!payload?.test) {
        setTestError("Provider 测试失败，请检查设置。");
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
      const result = await deleteAiProvider();
      const payload = result.body;
      if (!result.ok) {
        const failure = classifyApiFailure(result);
        setProviderError(failure.code ?? "Provider 配置删除失败，请显式重试。");
        return;
      }
      if (!isAiProviderCredentialStatus(payload?.provider)) {
        setProviderError("Provider 配置删除失败，请显式重试。");
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
        <AiProviderSettingsSection
          status={providerStatus}
          baseUrl={baseUrl}
          model={model}
          apiKey={apiKey}
          configChanged={providerConfigChanged}
          pending={providerPending}
          testPending={testPending}
          error={providerError}
          message={providerMessage}
          testError={testError}
          testMessage={testMessage}
          onBaseUrlChange={setBaseUrl}
          onModelChange={setModel}
          onApiKeyChange={setApiKey}
          onSave={() => void saveProviderConfiguration()}
          onTest={() => void testProviderConnection()}
          onDelete={() => setDeleteConfirmOpen(true)}
        />
        <AiRuntimePreferenceSection
          ref={saveButtonRef}
          runtimeStatus={runtimeStatus}
          runtimeEnabled={runtimeEnabled}
          runtimeChanged={runtimeChanged}
          runtimePending={runtimePending}
          runtimeError={runtimeError}
          runtimeMessage={runtimeMessage}
          bindingSecretConfigured={props.bindingSecretConfigured}
          externalProviderEnabled={externalProviderEnabled}
          externalProviderActive={externalProviderActive}
          providerReady={providerReady}
          savedExternalProviderEnabled={savedExternalProviderEnabled}
          preferenceChanged={changed}
          preferencePending={pending}
          error={error}
          message={message}
          reauthRequired={reauthRequired}
          onRuntimeEnabledChange={(enabled) => {
            setRuntimeEnabled(enabled);
            setRuntimeMessage(null);
            setRuntimeError(null);
          }}
          onOpenRuntimeConfirm={() => setRuntimeConfirmOpen(true)}
          onExternalProviderEnabledChange={(enabled) => {
            setExternalProviderEnabled(enabled);
            setMessage(null);
            setError(null);
            setReauthRequired(false);
          }}
          onOpenPreferenceConfirm={() => {
            if (!changed || pending) return;
            setConfirmOpen(true);
          }}
        />
        <AiDraftDemo userId={props.userId} />
      </div>
      <AiSettingsModals
        runtimeConfirmOpen={runtimeConfirmOpen}
        runtimeEnabled={runtimeEnabled}
        runtimePending={runtimePending}
        preferenceConfirmOpen={confirmOpen}
        externalProviderEnabled={externalProviderEnabled}
        preferencePending={pending}
        deleteConfirmOpen={deleteConfirmOpen}
        providerPending={providerPending}
        onCloseRuntime={() => setRuntimeConfirmOpen(false)}
        onSaveRuntime={() => void saveRuntimeSetting()}
        onClosePreference={closeConfirmModal}
        onSavePreference={() => startTransition(saveConfirmedPreference)}
        onCloseDelete={() => setDeleteConfirmOpen(false)}
        onDeleteProvider={() => void deleteProviderConfiguration()}
      />
    </>
  );
}
