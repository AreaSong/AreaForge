"use client";

import React from "react";
import { ArrowRight, ClipboardCheck, FileCheck2, Plus, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { TestKpiStrip } from "./test-kpi-strip";
import { TestMockExamTrend } from "./test-mock-exam-trend";
import { TestPendingQueue } from "./test-pending-queue";
import { TestWeakLossRanking } from "./test-weak-loss-ranking";
import type {
  LossReasonDistributionSummary,
  MockExamTrendSummary,
  PendingTestQueueItem,
  TestKpis,
  WeakModuleLossRankItem,
} from "./test-support";

export interface TestCommandDeckProps {
  kpis: TestKpis;
  trend: MockExamTrendSummary;
  rankings: WeakModuleLossRankItem[];
  distribution: LossReasonDistributionSummary;
  queue: PendingTestQueueItem[];
  openRetestsCount: number;
  unfinishedSimulationsCount: number;
  className?: string;
}

export function TestCommandDeck({
  kpis,
  trend,
  rankings,
  distribution,
  queue,
  openRetestsCount,
  unfinishedSimulationsCount,
  className = "",
}: TestCommandDeckProps) {
  return (
    <div className={`space-y-5 ${className}`.trim()}>
      {/* 1. Top High-Density 5-KPI Strip */}
      <section aria-label="检验关键指标总览">
        <TestKpiStrip kpis={kpis} />
      </section>

      {/* 2. Hero Command Section: Mock Exam Trendline & Today's Pending Test Queue */}
      <section
        className="grid grid-cols-1 gap-4 xl:grid-cols-12"
        aria-label="得分轨迹与待测队列"
      >
        <TestMockExamTrend
          trend={trend}
          className="xl:col-span-7"
        />
        <TestPendingQueue
          queue={queue}
          className="xl:col-span-5"
        />
      </section>

      {/* 3. Analytics Section: Weak Module Loss Ranking & Loss Reason Distribution */}
      <section aria-label="薄弱模块与失分归因分析">
        <TestWeakLossRanking
          rankings={rankings}
          distribution={distribution}
        />
      </section>
    </div>
  );
}

export function TestGatewayCard(props: {
  href: string;
  title: string;
  description: string;
  count: number;
  countLabel: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={props.href} className="group block">
      <Card
        variant="master"
        className="flex min-h-32 flex-col justify-between p-4 transition-all hover:border-teal-400/40 hover:shadow-[0_0_20px_rgba(45,212,191,0.15)] bg-[#0e1619]/90 border border-white/10"
      >
        <div className="flex items-start justify-between gap-4">
          <span className="text-teal-300">{props.icon}</span>
          <Badge tone={props.count > 0 ? "warning" : "neutral"} className="font-mono">
            {props.count} {props.countLabel}
          </Badge>
        </div>
        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-white group-hover:text-teal-200">{props.title}</h3>
            <p className="mt-0.5 text-xs leading-5 text-zinc-400">{props.description}</p>
          </div>
          <ArrowRight
            className="mb-0.5 shrink-0 text-zinc-500 transition-colors group-hover:text-teal-300 group-hover:translate-x-0.5"
            size={16}
            aria-hidden="true"
          />
        </div>
      </Card>
    </Link>
  );
}
