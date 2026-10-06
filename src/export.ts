import { toCsv, BOARD_CSV_COLUMNS } from "./csv";
import type { Workspace } from "./model";

function boardCards(w: Workspace, boardId: string) {
  const columns = w.columns.filter(c => c.boardId === boardId).sort((a, b) => a.position - b.position);
  const columnName = new Map(columns.map(c => [c.id, c.name]));
  const cards = w.cards.filter(c => columnName.has(c.columnId));
  return { columns, columnName, cards };
}

// Uses exactly the importer's column set (src/csv.ts BOARD_CSV_COLUMNS) so an exported file
// re-imports to the same titles, columns, labels, priorities, due dates and estimates.
export function exportCsv(w: Workspace, boardId: string): string {
  const project = w.projects.find(p => p.id === w.boards.find(b => b.id === boardId)?.projectId);
  const { columnName, cards } = boardCards(w, boardId);
  const rows = cards.map(c => ({
    title: c.title, description: c.description, column: columnName.get(c.columnId) ?? "",
    labels: c.labels.map(id => project?.labels.find(l => l.id === id)?.name).filter((n): n is string => !!n).join(";"),
    priority: c.priority, due: c.dueDate ?? "", estimate: c.estimate === null ? "" : String(c.estimate),
  }));
  return toCsv(BOARD_CSV_COLUMNS, rows);
}

function cardLine(c: { title: string; priority: string; dueDate: string | null; estimate: number | null; labels: string[] }, labelNames: string[]): string {
  const bits = [`priority: ${c.priority}`];
  if (c.dueDate) bits.push(`due: ${c.dueDate}`);
  if (c.estimate !== null) bits.push(`estimate: ${c.estimate}`);
  if (labelNames.length) bits.push(`labels: ${labelNames.join(", ")}`);
  return `- **${c.title}** — ${bits.join(", ")}`;
}

// A readable document, not a data interchange format: board name, one heading per column, one
// bullet per card. CSV (above) is what round-trips; this is for a person to read.
export function exportMarkdown(w: Workspace, boardId: string): string {
  const board = w.boards.find(b => b.id === boardId);
  const project = w.projects.find(p => p.id === board?.projectId);
  const { columns, cards } = boardCards(w, boardId);
  const lines = [`# ${board?.name ?? "Board"}`, ""];
  for (const column of columns) {
    lines.push(`## ${column.name}`, "");
    const columnCards = cards.filter(c => c.columnId === column.id);
    if (!columnCards.length) lines.push("_No cards._", "");
    for (const card of columnCards) {
      const labelNames = card.labels.map(id => project?.labels.find(l => l.id === id)?.name).filter((n): n is string => !!n);
      lines.push(cardLine(card, labelNames));
    }
    if (columnCards.length) lines.push("");
  }
  return lines.join("\n");
}
