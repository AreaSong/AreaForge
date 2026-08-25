export function focusKnowledgeCanvasNode(nodeId: string) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)
        ?.focus({ preventScroll: true });
    });
  });
}
