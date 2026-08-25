import { ArrowRight } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { Checkbox } from "@/components/ui/field";
import { SectionHeader } from "@/components/ui/page";
import {
  remediationInboxStatusLabel,
  simulationLossReasons,
} from "@/components/simulation-detail-drafts";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import type { SimulationExamDto, SimulationRemediationDto } from "@/lib/contracts";

interface SimulationRemediationSectionProps {
  examStatus: SimulationExamDto["status"];
  remediations: SimulationRemediationDto[];
  selectedOriginKeys: string[];
  receipt: { created: number; reused: number } | null;
  busy: boolean;
  returnTo: string;
  embeddedInWorkbench?: boolean;
  readyForConfirmation: boolean;
  hasStructuredResults: boolean;
  onSelectionChange: (update: (keys: string[]) => string[]) => void;
  onAdd: () => void;
}

export function SimulationRemediationSection(props: SimulationRemediationSectionProps) {
  if (props.examStatus !== "CONFIRMED") {
    return (
      <Alert
        tone={props.readyForConfirmation ? "info" : "warning"}
        title={props.readyForConfirmation
          ? "结果已完整，等待确认中心处理"
          : props.hasStructuredResults
            ? "下一步：补齐并保存复盘"
            : "下一步：录入分科成绩"}
      >
        {props.readyForConfirmation
          ? "结果、失分、个人反馈和复盘已保存。请进入确认中心完成最终确认，确认后考试事实才会冻结。"
          : props.hasStructuredResults
            ? "保存完整结果后，系统会把本场模拟送入确认中心；确认后成绩与失分才会变为只读。"
            : "先保存分科结果；每项分数按 0.5 分步进。"}
      </Alert>
    );
  }

  const pending = props.remediations.filter((item) => !item.inboxItemId);
  return (
    <section className="space-y-4 border-b border-white/10 pb-5">
      <SectionHeader
        title="选择补救动作"
        description="考试事实已经冻结。只选择需要进入计划的补救，系统不会自动创建正式任务。"
        meta={<Badge tone="success">事实已确认</Badge>}
      />
      {props.remediations.length > 0 ? (
        <div className="af-content-grid-two grid gap-2">
          {props.remediations.map((item) => (
            <label key={item.originKey} className="flex min-w-0 items-start gap-3 border border-white/10 p-3 text-sm hover:border-white/20">
              <Checkbox
                className="mt-1"
                disabled={Boolean(item.inboxItemId)}
                checked={Boolean(item.inboxItemId) || props.selectedOriginKeys.includes(item.originKey)}
                onChange={(event) => props.onSelectionChange((keys) => event.target.checked
                  ? Array.from(new Set([...keys, item.originKey]))
                  : keys.filter((key) => key !== item.originKey))}
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-white">
                  {item.subjectName} · {simulationLossReasons.find((reason) => reason.value === item.reason)?.label}
                  {item.inboxStatus ? (
                    <Badge tone={item.inboxStatus === "CONVERTED" ? "success" : item.inboxStatus === "DISMISSED" ? "neutral" : "info"}>
                      {remediationInboxStatusLabel(item.inboxStatus)}
                    </Badge>
                  ) : null}
                </span>
                <span className="mt-1 block text-xs text-zinc-500">
                  {item.lostScore} 分{item.syllabusNodeTitle ? ` · ${item.syllabusNodeTitle}` : ""}
                </span>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <Alert tone="success" title="没有待安排的结构化补救">考试事实已完成，可回到阶段概览判断是否需要调整下一阶段。</Alert>
      )}
      <RemediationActions {...props} pendingCount={pending.length} />
    </section>
  );
}

function SimulationLinks({ returnTo, primaryLabel }: { returnTo: string; primaryLabel: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ButtonLink href={withReturnTo("/roadmap/allocation/drafts", returnTo)} variant="primary" size="sm">{primaryLabel}<ArrowRight size={15} /></ButtonLink>
      <ButtonLink href={withReturnTo("/roadmap/stages", returnTo)} variant="secondary" size="sm">重新评估阶段</ButtonLink>
    </div>
  );
}

function RemediationActions(props: SimulationRemediationSectionProps & { pendingCount: number }) {
  if (props.receipt) {
    return (
      <Alert tone="success" title="补救已送入投入草稿" action={<SimulationLinks returnTo={props.returnTo} primaryLabel="处理收件箱" />}>
        新建 {props.receipt.created} 项，复用已有 {props.receipt.reused} 项；仍需在收件箱中补全日期并显式转为任务。
      </Alert>
    );
  }
  if (props.pendingCount > 0) {
    return (
      <div className="af-action-cluster">
        <Button type="button" variant="primary" size="lg" loading={props.busy} loadingLabel="送入中..." disabled={props.selectedOriginKeys.length === 0} onClick={props.onAdd}>将选中补救送入收件箱</Button>
        {!props.embeddedInWorkbench ? <ButtonLink href={withReturnTo("/roadmap/stages", props.returnTo)} variant="ghost" size="lg">返回阶段总览</ButtonLink> : null}
      </div>
    );
  }
  if (props.remediations.length > 0) {
    return (
      <Alert tone="success" title="补救均已处理" action={<SimulationLinks returnTo={props.returnTo} primaryLabel="查看投入草稿" />}>
        已入箱、已忽略或已转换的补救不会重复提交。
      </Alert>
    );
  }
  return <ButtonLink href={withReturnTo("/roadmap/stages", props.returnTo)} variant="ghost" size="lg">返回阶段总览</ButtonLink>;
}
