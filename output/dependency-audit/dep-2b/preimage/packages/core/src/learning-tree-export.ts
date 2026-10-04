import { LEARNING_TREE_PROTOCOL, type LearningTreeScope } from "./learning-tree-protocol";

export interface LearningTreeExportNode {
  stableKey: string;
  title: string;
  depth: number;
  archived?: boolean;
  sortOrder?: number;
  status?: string;
  children?: LearningTreeExportNode[];
}

export interface LearningTreeExportSubject {
  stableKey: string;
  title: string;
  groupKey?: string;
  nodes: LearningTreeExportNode[];
  cards?: LearningTreeExportCard[];
  resources?: LearningTreeExportResource[];
  plans?: LearningTreeExportPlan[];
}

export interface LearningTreeExportCard {
  stableKey: string;
  title: string;
  kind: string;
  subjectKey: string;
  primaryNode?: string;
  relatedNodes?: string[];
  bodyMarkdown: string;
}

export interface LearningTreeExportResource {
  stableKey: string;
  title: string;
  subjectKey: string;
  url: string;
}

export interface LearningTreeExportPlan {
  stableKey: string;
  title: string;
  subjectKey: string;
  milestoneKey?: string;
  durationMinutes?: number;
  dependsOn?: string;
  dependencyType?: string;
}

export interface LearningTreeExportGroup {
  stableKey: string;
  title: string;
}

export interface LearningTreeExportInput {
  scope: LearningTreeScope;
  workspaceKey: string;
  subjectKey?: string;
  rootNodeKey?: string;
  rootParentNodeKey?: string;
  groups?: LearningTreeExportGroup[];
  subjects: LearningTreeExportSubject[];
}

export function exportLearningTreeMarkdown(input: LearningTreeExportInput): string {
  const lines: string[] = ["---"];
  lines.push(`protocol: ${LEARNING_TREE_PROTOCOL}`);
  lines.push(`scope: ${input.scope}`);
  lines.push(`workspaceKey: ${input.workspaceKey}`);
  if (input.subjectKey) lines.push(`subjectKey: ${input.subjectKey}`);
  if (input.rootNodeKey) lines.push(`rootNodeKey: ${input.rootNodeKey}`);
  if (input.rootParentNodeKey) lines.push(`rootParentNodeKey: ${input.rootParentNodeKey}`);
  lines.push("---", "");

  if (input.scope === "global") {
    for (const group of input.groups ?? []) {
      lines.push(`::af-group{#${group.stableKey} title="${escapeAttr(group.title)}"}`, "");
    }
  }

  for (const subject of input.subjects) {
    if (input.scope === "global") {
      const group = subject.groupKey ? ` group="${escapeAttr(subject.groupKey)}"` : "";
      lines.push(`::af-subject{#${subject.stableKey} title="${escapeAttr(subject.title)}"${group}}`, "");
    }
    for (const node of subject.nodes) {
      writeNode(lines, node);
    }
    for (const card of subject.cards ?? []) {
      writeCard(lines, card);
    }
    for (const resource of subject.resources ?? []) {
      writeResource(lines, resource);
    }
    for (const plan of subject.plans ?? []) {
      writePlan(lines, plan);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function writeCard(lines: string[], card: LearningTreeExportCard): void {
  const related = card.relatedNodes?.length ? ` relatedNodes="${escapeAttr(card.relatedNodes.join(","))}"` : "";
  const primary = card.primaryNode ? ` primaryNode="${escapeAttr(card.primaryNode)}"` : "";
  lines.push(
    `:::af-card{#${card.stableKey} kind="${escapeAttr(card.kind)}" title="${escapeAttr(card.title)}" subjectKey="${escapeAttr(card.subjectKey)}"${primary}${related}}`,
  );
  if (card.bodyMarkdown.trim()) lines.push(card.bodyMarkdown.trimEnd());
  lines.push(":::", "");
}

function writeResource(lines: string[], resource: LearningTreeExportResource): void {
  lines.push(
    `::af-resource{#${resource.stableKey} kind="LINK" subjectKey="${escapeAttr(resource.subjectKey)}" title="${escapeAttr(resource.title)}" url="${escapeAttr(resource.url)}"}`,
    "",
  );
}

function writePlan(lines: string[], plan: LearningTreeExportPlan): void {
  const attrs = [
    `#${plan.stableKey}`,
    `subjectKey="${escapeAttr(plan.subjectKey)}"`,
    `title="${escapeAttr(plan.title)}"`,
  ];
  if (plan.milestoneKey) attrs.push(`milestoneKey="${escapeAttr(plan.milestoneKey)}"`);
  if (plan.durationMinutes != null) attrs.push(`durationMinutes="${plan.durationMinutes}"`);
  if (plan.dependsOn) attrs.push(`dependsOn="${escapeAttr(plan.dependsOn)}"`);
  if (plan.dependencyType) attrs.push(`dependencyType="${escapeAttr(plan.dependencyType)}"`);
  lines.push(`::af-plan{${attrs.join(" ")}}`, "");
}

function writeNode(lines: string[], node: LearningTreeExportNode): void {
  lines.push(`${"#".repeat(node.depth)} ${node.title}`);
  const attrs = [`#${node.stableKey}`];
  if (node.archived) attrs.push('archived="true"');
  if (node.sortOrder !== undefined) attrs.push(`sortOrder="${node.sortOrder}"`);
  if (node.status) attrs.push(`status="${escapeAttr(node.status)}"`);
  lines.push(`::af-node{${attrs.join(" ")}}`, "");
  for (const child of node.children ?? []) {
    writeNode(lines, child);
  }
}

function escapeAttr(value: string): string {
  return value.replaceAll('"', '\\"');
}
