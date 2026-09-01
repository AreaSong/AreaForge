import { AlertTriangle, CheckCircle2, FileText, Pencil, Target, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getReturnContextLabel } from "@/lib/navigation/return-context";
import type { TaskStatusDto } from "@/lib/contracts";
import { formatTaskStatus } from "@/lib/formatters";

export type FocusEvidenceType = "note" | "mistake" | "retest";

export interface FocusEvidenceReceipt {
  evidenceType: FocusEvidenceType;
  evidenceId: string;
  label: string;
}

export function EvidenceWorkspace(props: {
  activeType: FocusEvidenceType;
  canRetest: boolean;
  receipts: FocusEvidenceReceipt[];
  editingReceiptId?: string | null;
  onEditReceipt?: (receipt: FocusEvidenceReceipt) => void;
  onDeleteReceipt?: (receipt: FocusEvidenceReceipt) => void;
  onTypeChange: (value: FocusEvidenceType) => void;
  onComplete: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-white/10 bg-[var(--af-canvas)] animate-[fade-in_0.2s_ease-out]">
      {/* Left Column: Evidence Types & Live Receipts Sidebar */}
      <aside className="w-full lg:w-84 xl:w-96 shrink-0 bg-white/[0.015] p-6 sm:p-8 flex flex-col justify-between h-full overflow-y-auto">
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-teal-300">
            <span className="flex size-2 rounded-full bg-teal-400" />
            证据接力 · 沉淀可复用资产
          </div>

          <div>
            <h1 className="break-words text-xl sm:text-2xl font-bold tracking-tight text-white">
              为本次学习留下可复用证据
            </h1>
            <p className="mt-1 text-xs text-zinc-400">选择要沉淀的认知形态：</p>
          </div>

          {/* Type Selector Buttons */}
          <div className="grid gap-2.5">
            <EvidenceTypeButton
              active={props.activeType === "note"}
              icon={<FileText />}
              label="知识卡片"
              description="沉淀核心概念、推导、方法或例题"
              onClick={() => props.onTypeChange("note")}
            />
            <EvidenceTypeButton
              active={props.activeType === "mistake"}
              icon={<AlertTriangle />}
              label="错题记录"
              description="记录做错的题目、错因与正确思路"
              onClick={() => props.onTypeChange("mistake")}
            />
            <EvidenceTypeButton
              active={props.activeType === "retest"}
              disabled={!props.canRetest}
              icon={<Target />}
              label={props.canRetest ? "考纲复测" : "考纲复测（未关联节点）"}
              description="针对考纲节点进行即时掌握度检验"
              onClick={() => props.onTypeChange("retest")}
            />
          </div>

          {/* Receipts list */}
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 text-xs">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="font-semibold text-zinc-200">本次已保存证据</span>
              <span className="font-mono text-teal-300">{props.receipts.length} 条</span>
            </div>
            {props.receipts.length > 0 ? (
              <ul className="mt-3 space-y-2 border-t border-white/5 pt-2.5">
                {props.receipts.map((receipt) => {
                  const isEditing = props.editingReceiptId === receipt.evidenceId;
                  return (
                    <li
                      key={`${receipt.evidenceType}:${receipt.evidenceId}`}
                      className={`group flex items-center justify-between gap-2 rounded-xl border px-3 py-2 transition-all duration-200 ${
                        isEditing
                          ? "border-teal-500/40 bg-teal-500/10 text-teal-200 shadow-[0_0_12px_rgba(45,212,191,0.15)]"
                          : "border-white/5 bg-white/[0.02] text-zinc-300 hover:border-white/10 hover:bg-white/[0.04]"
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <CheckCircle2 className={`size-3.5 shrink-0 ${isEditing ? "text-teal-300" : "text-teal-400"}`} />
                        <span className="truncate text-xs font-medium">
                          {evidenceTypeLabel(receipt.evidenceType)} · {receipt.label}
                        </span>
                        {isEditing ? (
                          <span className="shrink-0 rounded bg-teal-400/20 px-1.5 py-0.5 text-[10px] font-medium text-teal-300">
                            修改中
                          </span>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {props.onEditReceipt && receipt.evidenceType !== "retest" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => props.onEditReceipt?.(receipt)}
                            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-all ${
                              isEditing
                                ? "bg-teal-400/30 text-teal-200 ring-1 ring-teal-400/50"
                                : "bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white"
                            }`}
                            title="更改此条证据"
                            aria-label={`更改证据 ${receipt.label}`}
                          >
                            <Pencil className="size-3 shrink-0" />
                            <span>更改</span>
                          </Button>
                        ) : null}

                        {props.onDeleteReceipt ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => props.onDeleteReceipt?.(receipt)}
                            className="inline-flex items-center gap-1 rounded-lg bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-500/25 hover:text-rose-200 transition-all"
                            title="删除此条证据"
                            aria-label={`删除证据 ${receipt.label}`}
                          >
                            <Trash2 className="size-3 shrink-0" />
                            <span>删除</span>
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-zinc-500">尚未保存证据，可在右侧录入。</p>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-teal-500/15 bg-teal-500/5 p-4 text-xs text-teal-200/80 leading-relaxed">
          <p className="font-semibold text-teal-300 flex items-center gap-1.5 mb-1">
            <span>💡</span> 证据的作用
          </p>
          这些证据将自动挂载到科目知识图谱中，并在后续「今日复习」和「专项复测」中按遗忘曲线精准推荐。
        </div>
      </aside>

      {/* Right Column: Form Container */}
      <section className="flex-1 p-6 sm:p-8 flex flex-col justify-between h-full overflow-y-auto">
        <div className="w-full flex-1 flex flex-col justify-between h-full">
          <div>{props.children}</div>

          {/* Bottom Actions: strictly pinned to bottom */}
          <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-3.5 mt-auto">
            <div className="text-xs text-zinc-500">
              {props.receipts.length > 0
                ? `已沉淀 ${props.receipts.length} 条证据，可继续录入或完成收口`
                : "如果本次学习没有新卡片或错题，可直接完成收口"}
            </div>

            <Button
              type="button"
              variant="primary"
              onClick={props.onComplete}
            >
              {props.receipts.length > 0 ? "完成证据接力" : "暂不沉淀，完成收口"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function CompleteWorkspace(props: {
  elapsedLabel: string;
  lowConversion: boolean;
  taskStatus: TaskStatusDto | null;
  returnTo: string;
  receipts: FocusEvidenceReceipt[];
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-white/10 bg-[var(--af-canvas)] animate-[fade-in_0.2s_ease-out]">
      {/* Left Column: Summary Sidebar */}
      <aside className="w-full lg:w-84 xl:w-96 shrink-0 bg-white/[0.015] p-6 sm:p-8 flex flex-col justify-between h-full overflow-y-auto">
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-teal-300">
            <span className="flex size-2 rounded-full bg-teal-400" />
            专注完成 · 成果锁定
          </div>

          <div>
            <span className="inline-flex items-center rounded-md border border-teal-500/20 bg-teal-500/10 px-2.5 py-1 text-xs font-medium text-teal-300">
              {props.lowConversion ? "低转化记录" : "有效沉淀事实"}
            </span>
            <h1 className="mt-3 break-words text-xl sm:text-2xl font-bold tracking-tight text-white">
              记录已经保存，可以离开专注流程
            </h1>
          </div>

          {/* Highlight Card */}
          <div className="rounded-2xl border border-teal-500/30 bg-teal-500/10 p-5 text-center shadow-[inset_0_0_24px_rgba(45,212,191,0.08)]">
            <p className="text-xs font-medium text-teal-200/90">本次实际专注时长</p>
            <p className="mt-2 font-mono text-4xl sm:text-5xl font-bold tracking-tight text-white tabular-nums">
              {props.elapsedLabel}
            </p>
            <p className="mt-1.5 text-xs text-teal-300/70">事实数据已沉淀到今日进度与成长档案</p>
          </div>

          <div className="space-y-3 rounded-2xl border border-white/5 bg-white/[0.02] p-4 text-xs">
            <SummaryFact label="转化结果" value={props.lowConversion ? "低转化" : "有效学习"} />
            <SummaryFact label="任务状态" value={taskStatusLabel(props.taskStatus)} />
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-teal-500/15 bg-teal-500/5 p-4 text-xs text-teal-200/80 leading-relaxed">
          <p className="font-semibold text-teal-300 flex items-center gap-1.5 mb-1">
            <span>🎉</span> 战果累积中
          </p>
          每一次真实的专注与收口，都在为你锻造不可动摇的备考护城河。
        </div>
      </aside>

      {/* Right Column: Evidence & Next Steps */}
      <section className="flex-1 p-6 sm:p-8 flex flex-col justify-between h-full overflow-y-auto">
        <div className="w-full flex-1 flex flex-col justify-between h-full">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3.5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-teal-300">收口报告</p>
                <h2 className="mt-0.5 text-lg sm:text-xl font-bold tracking-tight text-white">本次学习沉淀资产</h2>
              </div>
            </div>

            {props.receipts.length > 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-5 shadow-lg">
                <p className="text-xs font-semibold text-zinc-200 mb-3">本次新沉淀的复用证据 ({props.receipts.length})</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {props.receipts.map((receipt) => (
                    <div key={`${receipt.evidenceType}:${receipt.evidenceId}`} className="flex items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs text-zinc-200">
                      <CheckCircle2 className="size-4 text-teal-400 shrink-0" />
                      <span className="font-medium text-teal-300">{evidenceTypeLabel(receipt.evidenceType)}</span>
                      <span className="text-zinc-600">·</span>
                      <span className="truncate">{receipt.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-5 shadow-lg text-xs text-zinc-400">
                本次未录入额外卡片证据，基本专注事实与打分已完整沉淀。
              </div>
            )}
          </div>

          {/* Bottom Actions */}
          <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-3.5 mt-auto">
            {props.returnTo !== "/today" ? (
              <Link
                href={props.returnTo}
                className="inline-flex h-10 sm:h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 text-xs sm:text-sm font-medium text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
              >
                {getReturnContextLabel(props.returnTo, "返回原位置")}
              </Link>
            ) : <div />}

            <Link
              href="/today"
              className="inline-flex h-10 sm:h-11 items-center justify-center gap-2 rounded-xl bg-teal-400 px-8 text-xs sm:text-sm font-semibold text-[#061012] shadow-[0_0_20px_rgba(45,212,191,0.35)] transition-all hover:bg-teal-300 hover:shadow-[0_0_28px_rgba(45,212,191,0.5)] active:scale-[0.98]"
            >
              回到今日总览，查看下一行动
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function EvidenceTypeButton(props: {
  active: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="subtle"
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`group flex w-full !h-auto items-start justify-start gap-3 rounded-2xl border !p-3.5 text-left transition-all select-none ${
        props.active
          ? "!border-teal-400/80 !bg-teal-500/15 !text-white shadow-[0_0_16px_rgba(45,212,191,0.15)]"
          : "!border-white/10 !bg-white/[0.02] !text-zinc-300 hover:!border-white/20 hover:!bg-white/[0.05]"
      }`}
    >
      <span className={`mt-0.5 [&>svg]:size-4 shrink-0 ${props.active ? "text-teal-300" : "text-zinc-400 group-hover:text-zinc-200"}`}>
        {props.icon}
      </span>
      <div className="min-w-0">
        <p className={`text-xs font-semibold ${props.active ? "text-teal-200" : "text-zinc-200"}`}>{props.label}</p>
        {props.description ? <p className="mt-0.5 text-[11px] text-zinc-400 leading-normal">{props.description}</p> : null}
      </div>
    </Button>
  );
}

function evidenceTypeLabel(value: FocusEvidenceType) {
  if (value === "note") return "知识卡片";
  if (value === "mistake") return "错题";
  return "复测";
}

function SummaryFact(props: { label: string; value: string }) {
  return <div><dt className="text-zinc-500">{props.label}</dt><dd className="mt-1 font-medium text-zinc-100">{props.value}</dd></div>;
}

function taskStatusLabel(value: TaskStatusDto | null) {
  if (value === "in_progress") return "继续推进";
  return value ? formatTaskStatus(value) : "未关联任务";
}
