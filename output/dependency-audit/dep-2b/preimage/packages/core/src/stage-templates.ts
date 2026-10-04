/**
 * 阶段模板只是可编辑的表单起点。选择模板不会直接创建 StagePlan，
 * Web 表单只会复制字段，仍需用户显式提交。
 */
export const STAGE_TEMPLATE_CATALOG_VERSION = "2026-09-05";

export const STAGE_PLAN_MODES = ["maintain", "recovery", "strengthen", "sprint"] as const;

export type StagePlanMode = (typeof STAGE_PLAN_MODES)[number];

export interface StageTemplate {
  id: string;
  version: string;
  name: string;
  description: string;
  goal: string;
  mode: StagePlanMode;
  durationDays: number;
}

const stageTemplates: readonly StageTemplate[] = [
  {
    id: "foundation-awakening",
    version: "1.0.0",
    name: "基础唤醒期",
    description: "先建立科目、考纲和稳定行动节奏。",
    goal: "完成基础范围梳理，并形成可以持续执行的学习节奏。",
    mode: "maintain",
    durationDays: 42,
  },
  {
    id: "baseline-calibration",
    version: "1.0.0",
    name: "第一次同步自测",
    description: "用一场真实节奏的模拟获得可量化基线。",
    goal: "完成同步自测、结构化失分记录和阶段复盘。",
    mode: "strengthen",
    durationDays: 14,
  },
  {
    id: "review-rebuild",
    version: "1.0.0",
    name: "复盘重建期",
    description: "根据真实失分重新确定投入和补救顺序。",
    goal: "处理主要失分来源，并把补救动作转入可执行计划。",
    mode: "recovery",
    durationDays: 28,
  },
  {
    id: "systematic-strengthening",
    version: "1.0.0",
    name: "系统强化期",
    description: "围绕薄弱知识点持续练习和复测。",
    goal: "让主要薄弱知识点形成可复核的掌握证据。",
    mode: "strengthen",
    durationDays: 56,
  },
  {
    id: "past-paper-topics",
    version: "1.0.0",
    name: "真题专题期",
    description: "按题型、真题和证据校准解题稳定性。",
    goal: "完成核心题型训练，并降低重复失分。",
    mode: "strengthen",
    durationDays: 42,
  },
  {
    id: "sprint-simulation",
    version: "1.0.0",
    name: "冲刺模拟期",
    description: "在用户确认的目标日期前集中模拟与收口。",
    goal: "稳定考试节奏，压缩高频失分并完成最终复测。",
    mode: "sprint",
    durationDays: 30,
  },
];

export function listStageTemplates(): readonly StageTemplate[] {
  return stageTemplates;
}

export function getStageTemplate(templateId: string): StageTemplate | null {
  return stageTemplates.find((template) => template.id === templateId) ?? null;
}
