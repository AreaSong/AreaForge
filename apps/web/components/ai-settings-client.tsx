"use client";

import { useState } from "react";
import { AiDraftPanel } from "@/components/ai-draft-panel";

export function AiSettingsClient(props: {
  aiEnabled: boolean;
  modelConfigured: boolean;
  bindingSecretConfigured: boolean;
}) {
  return (
    <div className="space-y-6">
      <dl className="grid gap-3 rounded-lg border border-white/10 p-4 text-sm sm:grid-cols-3">
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
      <AiDraftDemo />
    </div>
  );
}

function AiDraftDemo() {
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
      <AiDraftPanel key={endpoint} endpoint={endpoint} />
    </div>
  );
}
