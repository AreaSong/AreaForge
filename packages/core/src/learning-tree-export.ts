import { LEARNING_TREE_PROTOCOL, type LearningTreeScope } from "./learning-tree-protocol";

export interface LearningTreeExportNode {
  stableKey: string;
  title: string;
  depth: number;
  archived?: boolean;
  children?: LearningTreeExportNode[];
}

export interface LearningTreeExportSubject {
  stableKey: string;
  title: string;
  groupKey?: string;
  nodes: LearningTreeExportNode[];
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
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function writeNode(lines: string[], node: LearningTreeExportNode): void {
  lines.push(`${"#".repeat(node.depth)} ${node.title}`);
  const attrs = [`#${node.stableKey}`];
  if (node.archived) attrs.push('archived="true"');
  lines.push(`::af-node{${attrs.join(" ")}}`, "");
  for (const child of node.children ?? []) {
    writeNode(lines, child);
  }
}

function escapeAttr(value: string): string {
  return value.replaceAll('"', '\\"');
}
