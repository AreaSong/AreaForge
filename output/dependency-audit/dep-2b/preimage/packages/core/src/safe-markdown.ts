import { unified } from "unified";
import remarkParse from "remark-parse";
import { canonicalizeHttpsUrl } from "./learning-tree-url";

export type SafeMarkdownNode =
  | { type: "text"; value: string }
  | { type: "paragraph"; children: SafeMarkdownNode[] }
  | { type: "heading"; depth: number; children: SafeMarkdownNode[] }
  | { type: "blockquote"; children: SafeMarkdownNode[] }
  | { type: "list"; ordered: boolean; children: SafeMarkdownNode[] }
  | { type: "listItem"; children: SafeMarkdownNode[] }
  | { type: "strong" | "emphasis"; children: SafeMarkdownNode[] }
  | { type: "inlineCode" | "code"; value: string; language?: string }
  | { type: "link"; url: string; children: SafeMarkdownNode[] }
  | { type: "break" };

type MdastLike = {
  type?: string;
  value?: string;
  depth?: number;
  ordered?: boolean;
  lang?: string | null;
  url?: string;
  alt?: string | null;
  children?: MdastLike[];
};

export function parseSafeMarkdown(markdown: string): SafeMarkdownNode[] {
  const root = unified().use(remarkParse).parse(markdown) as MdastLike;
  return projectChildren(root.children ?? []);
}

function projectChildren(nodes: MdastLike[]): SafeMarkdownNode[] {
  return nodes.flatMap(projectNode);
}

function projectNode(node: MdastLike): SafeMarkdownNode[] {
  const children = () => projectChildren(node.children ?? []);
  switch (node.type) {
    case "text":
      return node.value ? [{ type: "text", value: node.value }] : [];
    case "paragraph":
      return [{ type: "paragraph", children: children() }];
    case "heading":
      return [{ type: "heading", depth: clampHeading(node.depth), children: children() }];
    case "blockquote":
      return [{ type: "blockquote", children: children() }];
    case "list":
      return [{ type: "list", ordered: Boolean(node.ordered), children: children() }];
    case "listItem":
      return [{ type: "listItem", children: children() }];
    case "strong":
    case "emphasis":
      return [{ type: node.type, children: children() }];
    case "inlineCode":
      return [{ type: "inlineCode", value: node.value ?? "" }];
    case "code":
      return [{ type: "code", value: node.value ?? "", language: safeLanguage(node.lang) }];
    case "link": {
      const url = safeLink(node.url);
      return url ? [{ type: "link", url, children: children() }] : children();
    }
    case "image":
      return node.alt ? [{ type: "text", value: node.alt }] : [];
    case "break":
      return [{ type: "break" }];
    case "root":
      return children();
    case "html":
    case "definition":
    case "yaml":
    case "toml":
      return [];
    default:
      return children();
  }
}

function safeLink(value: string | undefined): string | null {
  if (!value) return null;
  const result = canonicalizeHttpsUrl(value);
  return result.ok ? result.url : null;
}

function safeLanguage(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-z0-9_+-]{1,32}$/.test(normalized) ? normalized : undefined;
}

function clampHeading(value: number | undefined): number {
  return Math.max(1, Math.min(6, Number.isInteger(value) ? value! : 2));
}
