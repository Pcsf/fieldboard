import type { Card, Column, Project, Workspace } from "./model";

export interface MyWorkRow { card: Card; project: Project; column: Column }
export interface MyWorkGroups { overdue: MyWorkRow[]; today: MyWorkRow[]; week: MyWorkRow[]; later: MyWorkRow[]; none: MyWorkRow[]; done: MyWorkRow[] }

const byDue = (a: MyWorkRow, b: MyWorkRow) => (a.card.dueDate ?? "").localeCompare(b.card.dueDate ?? "") || a.card.title.localeCompare(b.card.title);
const byTitle = (a: MyWorkRow, b: MyWorkRow) => a.card.title.localeCompare(b.card.title);

// Done cards are grouped, not excluded, so completed assigned work stays visible and auditable.
export function myWork(w: Workspace, memberId: string, at = new Date()): MyWorkGroups {
  const groups: MyWorkGroups = { overdue: [], today: [], week: [], later: [], none: [], done: [] };
  const today = at.toLocaleDateString("en-CA");
  const weekStart = new Date(at); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
  for (const card of w.cards) {
    if (card.archived || !card.assignees.includes(memberId)) continue;
    const column = w.columns.find(c => c.id === card.columnId); if (!column) continue;
    const board = w.boards.find(b => b.id === column.boardId); if (!board) continue;
    const project = w.projects.find(p => p.id === board.projectId); if (!project) continue;
    const row: MyWorkRow = { card, project, column };
    if (card.completedAt) { groups.done.push(row); continue; }
    if (!card.dueDate) { groups.none.push(row); continue; }
    if (card.dueDate < today) groups.overdue.push(row);
    else if (card.dueDate === today) groups.today.push(row);
    else {
      const due = new Date(`${card.dueDate}T12:00:00`);
      (due >= weekStart && due < weekEnd ? groups.week : groups.later).push(row);
    }
  }
  groups.overdue.sort(byDue); groups.today.sort(byTitle); groups.week.sort(byDue); groups.later.sort(byDue); groups.none.sort(byTitle);
  groups.done.sort((a, b) => (b.card.completedAt ?? "").localeCompare(a.card.completedAt ?? ""));
  return groups;
}
