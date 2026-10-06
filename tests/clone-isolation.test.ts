import { expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, editCard, setBlocked, moveCard, archiveCard, deleteCard, updateColumn, deleteColumn, cloneWorkspace, validateWorkspace, type Workspace } from "../src/model";
import { defaultEffort, setCardSprint, closeSprint } from "../src/planning";
import { addRule, applyAutomation, runOverdueRule, runAutoArchive, setAutoArchiveDays } from "../src/automation";
import { startTimer, stopTimer, addManualEntry } from "../src/time-tracking";
import { generateRecurrences } from "../src/recurring";
import { generateDueReminders } from "../src/notifications";

// Session.change copies cards shallowly, so every mutator must replace nested card data rather than
// write into it. Each case mutates a copy and requires the original to come out byte-identical.
function rich(): Workspace {
  const w = createWorkspace();
  w.members.push({ id: "m2", name: "Robin", color: "#445566" });
  const p = createProject(w, "Isolation");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const cols = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  const a = createCard(w, cols[1]!.id, "Subtasks and effort", "bottom", {
    subtasks: [{ id: "s1", title: "one", done: false, position: 0 }, { id: "s2", title: "two", done: false, position: 1 }],
    effort: defaultEffort(), dueDate: "2020-01-01", assignees: ["m2"], watchers: ["m2"],
  });
  setBlocked(w, a.id, "waiting on hardware");
  const b = createCard(w, cols[0]!.id, "Recurring", "bottom", { recurrence: { frequency: "daily", columnId: cols[0]!.id, next: "2020-01-01" } });
  createCard(w, cols[2]!.id, "Neighbour", "top");
  addManualEntry(w, b.id, "2026-01-01T09:00:00.000Z", "2026-01-01T10:00:00.000Z", "bench");
  addRule(w, board.id, { kind: "enter-check-subtasks", enabled: true, columnId: cols[3]!.id } as never);
  addRule(w, board.id, { kind: "overdue-label", enabled: true, labelName: "late" } as never);
  setAutoArchiveDays(w, board.id, 1);
  return validateWorkspace(w);
}

const cases: [string, (w: Workspace, ids: { a: string; b: string; cols: string[]; project: string }) => unknown][] = [
  ["edit subtasks", (w, { a }) => editCard(w, a, { subtasks: w.cards.find(c => c.id === a)!.subtasks.map(s => ({ ...s, done: true })) })],
  ["block reason", (w, { a }) => setBlocked(w, a, "new reason")],
  ["move into rule column", (w, { a, cols }) => applyAutomation(w, x => moveCard(x, a, cols[3]!, 0))],
  ["move to done", (w, { a, cols }) => moveCard(w, a, cols[4]!, 0)],
  ["archive", (w, { a }) => archiveCard(w, a, true)],
  ["delete", (w, { a }) => deleteCard(w, a)],
  ["column done flag", (w, { cols }) => updateColumn(w, cols[1]!, { done: true })],
  ["delete column", (w, { cols }) => deleteColumn(w, cols[1]!, cols[0]!)],
  ["sprint assign", (w, { a }) => setCardSprint(w, a, 1)],
  ["sprint close", (w, { a, project }) => { setCardSprint(w, a, 1); closeSprint(w, project, 1, "done"); }],
  ["timer", (w, { b }) => { startTimer(w, b); stopTimer(w, b); }],
  ["recurrence", w => generateRecurrences(w, new Date("2020-01-03T12:00:00Z"))],
  ["overdue rule", w => runOverdueRule(w, new Date("2026-10-06T12:00:00Z"))],
  ["auto-archive", w => runAutoArchive(w, new Date("2030-01-01T12:00:00Z"))],
  ["due reminders", w => generateDueReminders(w, new Date("2019-12-31T12:00:00Z"))],
];

for (const [name, op] of cases) {
  test(`clone isolation: ${name} leaves the original workspace untouched`, () => {
    const original = rich();
    const project = original.projects[0]!.id;
    const cols = original.columns.filter(c => original.boards.some(b => b.id === c.boardId && b.projectId === project)).sort((x, y) => x.position - y.position).map(c => c.id);
    const ids = { a: original.cards.find(c => c.title === "Subtasks and effort")!.id, b: original.cards.find(c => c.title === "Recurring")!.id, cols, project };
    const before = JSON.stringify(original);
    const next = cloneWorkspace(original);
    op(next, ids);
    expect(JSON.stringify(next)).not.toBe(before);
    expect(JSON.stringify(original)).toBe(before);
  });
}
