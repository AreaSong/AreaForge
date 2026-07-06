"use client";

import { Archive, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { MotivationVaultDto } from "@/lib/study/types";

interface MotivationVaultFormProps {
  vault: MotivationVaultDto | null;
}

export function MotivationVaultForm({ vault }: MotivationVaultFormProps) {
  const router = useRouter();
  const [whyStarted, setWhyStarted] = useState(vault?.whyStarted ?? "");
  const [neverReturnTo, setNeverReturnTo] = useState(vault?.neverReturnTo ?? "");
  const [futureSelf, setFutureSelf] = useState(vault?.futureSelf ?? "");
  const [messageToFuture, setMessageToFuture] = useState(vault?.messageToFuture ?? "");
  const [firstSimulationDiary, setFirstSimulationDiary] = useState(vault?.firstSimulationDiary ?? "");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(vault?.updatedAt ?? null);
  const [isPending, startTransition] = useTransition();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/motivation-vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        whyStarted,
        neverReturnTo,
        futureSelf,
        messageToFuture,
        firstSimulationDiary,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "保存动机档案失败");
      return;
    }

    const body = (await response.json()) as { vault: MotivationVaultDto };
    setSavedAt(body.vault.updatedAt);
    startTransition(() => router.refresh());
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
      <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
        <div className="flex items-center gap-2">
          <Archive className="h-5 w-5 text-teal-300" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-white">动机封存</h2>
        </div>

        <form className="mt-5 grid gap-3" onSubmit={submit}>
          <MotivationTextarea
            label="为什么开始"
            value={whyStarted}
            onChange={setWhyStarted}
            placeholder="写下开始这场长期备考的真实原因"
          />
          <MotivationTextarea
            label="最不想回到什么状态"
            value={neverReturnTo}
            onChange={setNeverReturnTo}
            placeholder="记录那个必须远离的状态"
          />
          <MotivationTextarea
            label="想成为怎样的人"
            value={futureSelf}
            onChange={setFutureSelf}
            placeholder="描述长期训练后你要变成的人"
          />
          <MotivationTextarea
            label="给未来自己的话"
            value={messageToFuture}
            onChange={setMessageToFuture}
            placeholder="留给未来某个失守或冲刺时刻的自己"
          />
          <MotivationTextarea
            label="第一次全真自测后的阶段日记"
            value={firstSimulationDiary}
            onChange={setFirstSimulationDiary}
            placeholder="第一次全真自测后再回来补这一段"
          />
          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={isPending}
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            保存封存内容
          </button>
        </form>

        {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}
        {savedAt ? (
          <p className="mt-4 text-sm text-zinc-500">上次封存：{new Date(savedAt).toLocaleString("zh-CN")}</p>
        ) : null}
      </section>

      <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
        <p className="text-sm text-zinc-400">唤醒原则</p>
        <h2 className="mt-1 text-xl font-semibold text-white">只在关键节点出现</h2>
        <div className="mt-5 grid gap-3">
          <Principle title="连续失守" body="当连续性断裂时，只短暂回看一次原因，然后回到恢复任务。" />
          <Principle title="重大复盘" body="当复盘暴露结构性问题时，用动机校准方向，不用它替代行动。" />
          <Principle title="全真自测" body="第一次全真自测前后，用它确认这次模拟的意义和下一阶段压力。" />
          <Principle title="危险期" body="风险等级升高时唤醒底层理由，但不把敏感内容放到首页常驻展示。" />
        </div>
      </section>
    </div>
  );
}

function MotivationTextarea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="grid gap-2 text-sm text-zinc-300">
      <span>{label}</span>
      <textarea
        className="min-h-24 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function Principle({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-md border border-white/10 bg-[#151a20] p-4">
      <h3 className="font-medium text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{body}</p>
    </article>
  );
}
