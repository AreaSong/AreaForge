import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { withReturnTo } from "@/lib/navigation/app-navigation";

export function LowConversionWorkspace(props: {
  reason: string;
  addedToInbox: boolean;
  returnTo: string;
  onSupplement: () => void;
  onAddToInbox: () => void;
  onAccept: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-white/10 bg-[var(--af-canvas)] animate-[fade-in_0.2s_ease-out]">
      {/* Left Column: Context Sidebar */}
      <aside className="w-full lg:w-84 xl:w-96 shrink-0 bg-white/[0.015] p-6 sm:p-8 flex flex-col justify-between h-full overflow-y-auto">
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
            <span className="flex size-2 rounded-full bg-amber-400" />
            转化诊断 · 诚实面对
          </div>
          <div>
            <span className="inline-flex items-center rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
              低转化记录
            </span>
            <h1 className="mt-3 break-words text-xl sm:text-2xl font-bold tracking-tight text-white">
              这段学习还缺少可验证产出
            </h1>
          </div>
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 shadow-[inset_0_0_24px_rgba(251,191,36,0.08)]">
            <div className="flex items-center gap-2 text-amber-200">
              <AlertTriangle className="size-5 shrink-0 text-amber-400" />
              <span className="text-xs font-semibold">诊断分析</span>
            </div>
            <p className="mt-2 text-xs sm:text-sm text-zinc-300 leading-relaxed">
              {props.reason}
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-amber-500/15 bg-amber-500/5 p-4 text-xs text-amber-200/80 leading-relaxed">
          <p className="font-semibold text-amber-300 flex items-center gap-1.5 mb-1">
            <span>💡</span> 为什么承认低转化很重要？
          </p>
          不把“坐在书桌前的时间”误当成“掌握了知识”。诚实标记能让系统在复习与规划中为你自动补齐薄弱环节。
        </div>
      </aside>

      {/* Right Column: Actions Workspace */}
      <section className="flex-1 p-6 sm:p-8 flex flex-col justify-between h-full overflow-y-auto">
        <div className="w-full flex-1 flex flex-col justify-between h-full">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3.5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">处置选项</p>
                <h2 className="mt-0.5 text-lg sm:text-xl font-bold tracking-tight text-white">选择下一步处理方式</h2>
                <p className="mt-0.5 text-xs text-zinc-400">你可以立刻补录一个产出要点，或者将这段未完成的投入存入规划草稿库。</p>
              </div>
            </div>

            <div className="grid gap-3.5 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-5 shadow-lg flex flex-col justify-between space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>📝</span> 补一个最小产出
                  </h3>
                  <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
                    哪怕只是一句话定义、一个推导要点或一个错因，只要写下来，就能将本次计时转为有效记录。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  fullWidth
                  onClick={props.onSupplement}
                  size="md"
                >
                  补一个最小产出
                </Button>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-5 shadow-lg flex flex-col justify-between space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>📥</span> 加入投入草稿箱
                  </h3>
                  <p className="mt-1.5 text-xs text-zinc-400 leading-relaxed">
                    将这段零散时间存入规划草稿箱，稍后在路线图规划中整合成正式的学习任务。
                  </p>
                </div>
                {props.addedToInbox ? (
                  <Link
                    href={withReturnTo("/roadmap/allocation/drafts", props.returnTo)}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-xs font-medium text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    查看投入草稿箱
                  </Link>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    fullWidth
                    onClick={props.onAddToInbox}
                    size="md"
                  >
                    加入投入草稿
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Bottom Actions */}
          <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-3.5 mt-auto">
            <Button
              type="button"
              variant="secondary"
              onClick={props.onAccept}
            >
              <span>承认低转化并直接结束</span>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
