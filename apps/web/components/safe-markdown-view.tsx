import type { SafeMarkdownNode } from "@areaforge/core";

export function SafeMarkdownView({ nodes }: { nodes: SafeMarkdownNode[] }) {
  return <div className="space-y-3 text-sm leading-7 text-zinc-200">{renderNodes(nodes, "root")}</div>;
}

function renderNodes(nodes: SafeMarkdownNode[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, index) => renderNode(node, `${keyPrefix}-${index}`));
}

function renderNode(node: SafeMarkdownNode, key: string): React.ReactNode {
  switch (node.type) {
    case "text": return node.value;
    case "paragraph": return <p key={key}>{renderNodes(node.children, key)}</p>;
    case "heading": {
      const content = renderNodes(node.children, key);
      if (node.depth === 1) return <h2 key={key} className="text-xl font-semibold text-white">{content}</h2>;
      if (node.depth === 2) return <h3 key={key} className="text-lg font-semibold text-white">{content}</h3>;
      if (node.depth === 3) return <h4 key={key} className="text-base font-medium text-white">{content}</h4>;
      if (node.depth === 4) return <h5 key={key} className="text-sm font-medium text-white">{content}</h5>;
      return <h6 key={key} className="text-sm font-medium text-zinc-100">{content}</h6>;
    }
    case "blockquote": return <blockquote key={key} className="border-l-2 border-teal-400/40 pl-3 text-zinc-400">{renderNodes(node.children, key)}</blockquote>;
    case "list": {
      const List = node.ordered ? "ol" : "ul";
      return <List key={key} className={`space-y-1 pl-6 ${node.ordered ? "list-decimal" : "list-disc"}`}>{renderNodes(node.children, key)}</List>;
    }
    case "listItem": return <li key={key}>{renderNodes(node.children, key)}</li>;
    case "strong": return <strong key={key} className="font-semibold text-white">{renderNodes(node.children, key)}</strong>;
    case "emphasis": return <em key={key}>{renderNodes(node.children, key)}</em>;
    case "inlineCode": return <code key={key} className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs">{node.value}</code>;
    case "code": return <pre key={key} className="overflow-auto rounded-md border border-white/10 bg-black/30 p-3"><code data-language={node.language}>{node.value}</code></pre>;
    case "link": return <a key={key} href={node.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="text-teal-300 underline">{renderNodes(node.children, key)}</a>;
    case "break": return <br key={key} />;
  }
}
