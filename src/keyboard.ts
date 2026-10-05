export interface OrderableColumn { id: string; position: number }
export interface OrderableCard { id: string; columnId: string; position: number }

// Visual order: columns left to right by position, cards within each column top to bottom by position.
export function visualOrder(columns: OrderableColumn[], cards: OrderableCard[]): string[] {
  const order = columns.slice().sort((a, b) => a.position - b.position).map(c => c.id);
  return order.flatMap(columnId => cards.filter(c => c.columnId === columnId).sort((a, b) => a.position - b.position).map(c => c.id));
}
export function adjacentColumn(columns: OrderableColumn[], columnId: string, direction: 1 | -1): string | null {
  const sorted = columns.slice().sort((a, b) => a.position - b.position);
  const index = sorted.findIndex(c => c.id === columnId); if (index < 0) return null;
  return sorted[index + direction]?.id ?? null;
}
// Clamped at either end rather than wrapping, and starts at the first/last card when nothing is focused yet.
export function neighbor(order: string[], current: string | null, direction: 1 | -1): string | null {
  if (!order.length) return null;
  if (!current) return direction === 1 ? order[0]! : order[order.length - 1]!;
  const index = order.indexOf(current); if (index < 0) return direction === 1 ? order[0]! : order[order.length - 1]!;
  return order[index + direction] ?? current;
}

export const shortcuts: { keys: string; description: string }[] = [
  { keys: "n", description: "New card, in the focused card's column or the first column" },
  { keys: "/", description: "Focus search" },
  { keys: "e", description: "Open the focused card" },
  { keys: "← / →", description: "Move the focused card to the previous or next column" },
  { keys: "j / k", description: "Move focus down or up through cards" },
  { keys: "?", description: "Show this cheatsheet" },
  { keys: "Ctrl+K / Cmd+K", description: "Open the command palette" },
  { keys: "Ctrl+Z / Cmd+Z", description: "Undo the last change" },
  { keys: "Escape", description: "Close a dialog or inline input" },
];
