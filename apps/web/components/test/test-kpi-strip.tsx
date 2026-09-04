"use client";

import { AlertCircle, Award, CheckCircle2, Flame, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MiniSparkline, StatusDot } from "@/components/ui/micro-charts";
import type { TestKpis } from "./test-support";

export interface TestKpiStripProps {
  kpis: TestKpis;
  className?: string;
}

export function TestKpiStrip({ kpis, className = "" }: TestKpiStripProps) {
  const isScorePositive = (kpis.avgScoreDelta ?? 0) >= 0;

  return (
    <div className={`@container ${className}`.trim()}>
      <div className="grid grid-cols-2 gap-2.5 @[36rem]:grid-cols-3 @[58rem]:grid-cols-5">
        {/* 1. 模考场次 */}
        <Card
          variant="master"
          className="p-3.5 bg-[#0e1619]/90 border border-white/10 transition-all hover:border-white/20"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-zinc-400">模考场次</span>
            <StatusDot
              status={kpis.confirmedSimulationsCount > 0 ? "success" : "idle"}
              size="xs"
              title={kpis.confirmedSimulationsCount > 0 ? "有已确认模考" : "待录入模考"}
            />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-white">
              {kpis.totalSimulations}
              <span className="ml-1 text-xs font-normal text-zinc-500">场</span>
            </span>
            <span className="text-[11px] font-mono text-zinc-400">
              已确认 <strong className="text-teal-300 font-semibold">{kpis.confirmedSimulationsCount}</strong>
            </span>
          </div>
          <div className="mt-2 text-[10px] text-zinc-500 flex items-center justify-between">
            <span>未收口草稿: {kpis.draftSimulationsCount}</span>
            <span className="font-mono text-zinc-400">{kpis.totalSimulations > 0 ? "全真自测" : "暂无"}</span>
          </div>
        </Card>

        {/* 2. 模考平均分 & 走势 */}
        <Card
          variant="master"
          className="p-3.5 bg-[#0e1619]/90 border border-white/10 transition-all hover:border-white/20"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-zinc-400">模考平均分</span>
            {kpis.avgScoreDelta !== null ? (
              <span
                className={`inline-flex items-center gap-0.5 text-[10px] font-mono font-medium ${
                  isScorePositive ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {isScorePositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {isScorePositive ? `+${kpis.avgScoreDelta}` : kpis.avgScoreDelta}
              </span>
            ) : (
              <span className="text-[10px] text-zinc-500">基准</span>
            )}
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-white">
              {kpis.avgActualScore !== null ? kpis.avgActualScore : "--"}
              <span className="ml-1 text-xs font-normal text-zinc-500">分</span>
            </span>
            {kpis.avgTargetScore !== null ? (
              <span className="text-[11px] font-mono text-zinc-400">
                目标 {kpis.avgTargetScore}
              </span>
            ) : null}
          </div>
          <div className="mt-1.5 flex min-h-[18px] items-center justify-between gap-2">
            {kpis.scoreTrajectory.length > 0 ? (
              <div className="w-20">
                <MiniSparkline
                  data={kpis.scoreTrajectory}
                  targetValue={kpis.avgTargetScore ?? undefined}
                  width={80}
                  height={18}
                  color="#2dd4bf"
                  showLastPoint={false}
                  showTarget={false}
                />
              </div>
            ) : <span className="text-[10px] text-zinc-600">暂无成绩样本</span>}
            <span className="text-[10px] font-mono text-zinc-500">
              {kpis.scoreTrajectory.length > 1
                ? "历次走势"
                : kpis.scoreTrajectory.length === 1 ? "首场数据" : "暂无走势"}
            </span>
          </div>
        </Card>

        {/* 3. 专项复测通过率 */}
        <Card
          variant="master"
          className="p-3.5 bg-[#0e1619]/90 border border-white/10 transition-all hover:border-white/20"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-zinc-400">复测通过率</span>
            <StatusDot
              status={
                kpis.retestPassRate === null
                  ? "idle"
                  : kpis.retestPassRate >= 80
                    ? "success"
                    : kpis.retestPassRate >= 60
                      ? "warning"
                      : "danger"
              }
              size="xs"
            />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-white">
              {kpis.retestPassRate !== null ? `${kpis.retestPassRate}%` : "--"}
            </span>
            <span className="text-[11px] font-mono text-zinc-400">
              已结项 <strong className="text-teal-300 font-semibold">{kpis.closedRetestsCount}</strong>
            </span>
          </div>
          <div className="mt-2 text-[10px] text-zinc-500 flex items-center justify-between">
            <span>总复测: {kpis.totalRetests} 项</span>
            <span className="text-zinc-400">知识掌握验证</span>
          </div>
        </Card>

        {/* 4. 待处理检验负荷 */}
        <Card
          variant="master"
          className="p-3.5 bg-[#0e1619]/90 border border-white/10 transition-all hover:border-white/20"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-zinc-400">待办检验队列</span>
            {kpis.pendingTotalLoad > 0 ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400">
                <Flame size={12} className="animate-pulse" />
                待执行
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400">
                <CheckCircle2 size={12} />
                已清空
              </span>
            )}
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span
              className={`text-2xl font-bold font-mono tracking-tight ${
                kpis.pendingTotalLoad > 0 ? "text-amber-300" : "text-emerald-300"
              }`}
            >
              {kpis.pendingTotalLoad}
              <span className="ml-1 text-xs font-normal text-zinc-500">项</span>
            </span>
            <span className="text-[11px] font-mono text-zinc-400">
              复测 <strong className="text-white font-semibold">{kpis.openRetestsCount}</strong>
            </span>
          </div>
          <div className="mt-2 text-[10px] text-zinc-500 flex items-center justify-between">
            <span>未收口模考: {kpis.draftSimulationsCount}</span>
            <span className="text-amber-400/80">{kpis.pendingTotalLoad > 0 ? "即时处理" : "状态良好"}</span>
          </div>
        </Card>

        {/* 5. 累计模考失分 */}
        <Card
          variant="master"
          className="col-span-2 @[36rem]:col-span-1 p-3.5 bg-[#0e1619]/90 border border-white/10 transition-all hover:border-white/20"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-zinc-400">累计模考失分</span>
            <span className="inline-flex items-center gap-0.5 text-[10px] text-rose-400 font-mono">
              <AlertCircle size={12} />
              丢分溯源
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-rose-300">
              {kpis.cumulativeLostScore == null ? "--" : `-${kpis.cumulativeLostScore}`}
              <span className="ml-1 text-xs font-normal text-zinc-500">分</span>
            </span>
            <span className="text-[11px] font-mono text-zinc-400">
              全科目
            </span>
          </div>
          <div className="mt-2 text-[10px] text-zinc-500 flex items-center justify-between">
            <span>{kpis.cumulativeLostScore == null ? "暂无失分样本" : "薄弱点定位"}</span>
            {kpis.cumulativeLostScore == null
              ? <span className="text-zinc-500">完成模考后生成</span>
              : <span className="text-teal-400 font-medium">查看排行榜 ↓</span>}
          </div>
        </Card>
      </div>
    </div>
  );
}
