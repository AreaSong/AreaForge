export type ImportedSyllabusNodeKind = "chapter" | "topic" | "problem_type";

export interface ParseSyllabusMarkdownInput {
  markdown: string;
  maxLines?: number;
  maxDepth?: number;
  maxTitleLength?: number;
}

export interface ParsedSyllabusNode {
  title: string;
  depth: number;
  kind: ImportedSyllabusNodeKind;
  sourceLine: number;
}

export interface ParsedSyllabusMarkdown {
  nodes: ParsedSyllabusNode[];
  ignoredLines: number[];
  errors: string[];
}

type ParsedLineResult = { node: ParsedSyllabusNode } | { error: string } | null;

export function parseSyllabusMarkdown(input: ParseSyllabusMarkdownInput): ParsedSyllabusMarkdown {
  const maxLines = input.maxLines ?? 120;
  const maxDepth = input.maxDepth ?? 5;
  const maxTitleLength = input.maxTitleLength ?? 120;
  const lines = input.markdown.replace(/\r\n/g, "\n").split("\n");
  const nodes: ParsedSyllabusNode[] = [];
  const ignoredLines: number[] = [];
  const errors: string[] = [];
  let currentHeadingDepth: number | null = null;

  if (lines.length > maxLines) {
    errors.push(`最多只能导入 ${maxLines} 行 Markdown。`);
    return { nodes, ignoredLines, errors };
  }

  for (const [index, rawLine] of lines.entries()) {
    const sourceLine = index + 1;
    const line = rawLine.trimEnd();
    if (line.trim().length === 0) continue;

    const heading = parseHeadingLine(line, sourceLine, maxDepth, maxTitleLength);
    if (heading) {
      if ("error" in heading) {
        errors.push(heading.error);
        continue;
      }
      currentHeadingDepth = heading.node.depth;
      nodes.push(heading.node);
      continue;
    }

    const list = parseListLine(line, sourceLine, currentHeadingDepth, maxDepth, maxTitleLength);
    if (list) {
      if ("error" in list) {
        errors.push(list.error);
        continue;
      }
      nodes.push(list.node);
      continue;
    }

    ignoredLines.push(sourceLine);
  }

  if (nodes.length === 0 && errors.length === 0) {
    errors.push("没有识别到可导入的标题或列表项。");
  }

  return { nodes, ignoredLines, errors };
}

function parseHeadingLine(
  line: string,
  sourceLine: number,
  maxDepth: number,
  maxTitleLength: number,
): ParsedLineResult {
  const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
  if (!match) return null;

  const depth = match[1].length - 1;
  return createParsedNode(match[2], depth, sourceLine, maxDepth, maxTitleLength);
}

function parseListLine(
  line: string,
  sourceLine: number,
  currentHeadingDepth: number | null,
  maxDepth: number,
  maxTitleLength: number,
): ParsedLineResult {
  const match = /^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
  if (!match) return null;

  const indentDepth = Math.floor(match[1].replace(/\t/g, "  ").length / 2);
  const depth = currentHeadingDepth == null ? indentDepth : currentHeadingDepth + 1 + indentDepth;
  return createParsedNode(match[2], depth, sourceLine, maxDepth, maxTitleLength);
}

function createParsedNode(
  rawTitle: string,
  depth: number,
  sourceLine: number,
  maxDepth: number,
  maxTitleLength: number,
): Exclude<ParsedLineResult, null> {
  const title = normalizeMarkdownTitle(rawTitle);
  if (depth > maxDepth) {
    return { error: `第 ${sourceLine} 行层级过深，最多支持 ${maxDepth + 1} 层。` };
  }
  if (title.length === 0) {
    return { error: `第 ${sourceLine} 行标题为空。` };
  }
  if (title.length > maxTitleLength) {
    return { error: `第 ${sourceLine} 行标题超过 ${maxTitleLength} 个字符。` };
  }

  return {
    node: {
      title,
      depth,
      kind: kindFromDepth(depth),
      sourceLine,
    },
  };
}

function normalizeMarkdownTitle(value: string): string {
  return value
    .trim()
    .replace(/^\[[ xX]\]\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function kindFromDepth(depth: number): ImportedSyllabusNodeKind {
  if (depth <= 0) return "chapter";
  if (depth === 1) return "topic";
  return "problem_type";
}
