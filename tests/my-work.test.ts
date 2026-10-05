import { expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, editCard, moveCard, addBoard, createCardFromTemplate, saveCardTemplate } from "../src/model";
import { myWork } from "../src/my-work";

function fixture() {
  const w = createWorkspace(); const me = w.settings.actorId;
  const p = createProject(w, "Release");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const columns = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  return { w, me, p, columns, first: columns[0]!, done: columns[4]! };
}
const assign = (w: ReturnType<typeof createWorkspace>, cardId: string, memberId: string) => editCard(w, cardId, { assignees: [memberId] });

test("My work: groups by Overdue, Today, This week, Later and No date, excluding archived and unassigned cards", () => {
  const { w, me, first } = fixture();
  const today = new Date("2026-06-10T12:00:00"); // a Wednesday
  const overdue = createCard(w, first.id, "Overdue", "bottom"); assign(w, overdue.id, me); editCard(w, overdue.id, { dueDate: "2026-06-08" });
  const dueToday = createCard(w, first.id, "Today", "bottom"); assign(w, dueToday.id, me); editCard(w, dueToday.id, { dueDate: "2026-06-10" });
  const thisWeek = createCard(w, first.id, "This week", "bottom"); assign(w, thisWeek.id, me); editCard(w, thisWeek.id, { dueDate: "2026-06-12" });
  const later = createCard(w, first.id, "Later", "bottom"); assign(w, later.id, me); editCard(w, later.id, { dueDate: "2026-07-01" });
  const noDate = createCard(w, first.id, "No date", "bottom"); assign(w, noDate.id, me);
  const unassigned = createCard(w, first.id, "Not mine", "bottom");
  const archived = createCard(w, first.id, "Archived but mine", "bottom"); assign(w, archived.id, me); editCard(w, archived.id, { dueDate: "2026-06-08" });
  w.cards.find(c => c.id === archived.id)!.archived = true;

  const groups = myWork(w, me, today);
  expect(groups.overdue.map(r => r.card.id)).toEqual([overdue.id]);
  expect(groups.today.map(r => r.card.id)).toEqual([dueToday.id]);
  expect(groups.week.map(r => r.card.id)).toEqual([thisWeek.id]);
  expect(groups.later.map(r => r.card.id)).toEqual([later.id]);
  expect(groups.none.map(r => r.card.id)).toEqual([noDate.id]);
  expect(groups.done).toEqual([]);
  const allIds = [...groups.overdue, ...groups.today, ...groups.week, ...groups.later, ...groups.none].map(r => r.card.id);
  expect(allIds).not.toContain(unassigned.id);
  expect(allIds).not.toContain(archived.id);
});

test("My work: a completed card goes to the Done group, not Overdue, even with a past due date", () => {
  const { w, me, first, done } = fixture();
  const card = createCard(w, first.id, "Finished late", "bottom"); assign(w, card.id, me); editCard(w, card.id, { dueDate: "2026-01-01" });
  moveCard(w, card.id, done.id, 0);
  const groups = myWork(w, me, new Date("2026-06-10T12:00:00"));
  expect(groups.done.map(r => r.card.id)).toEqual([card.id]);
  expect(groups.overdue).toEqual([]);
});

test("My work: rows carry the card's actual project, column and board, across every project", () => {
  const { w, me, p, first } = fixture();
  const second = createProject(w, "Other");
  const secondColumn = w.columns.find(c => c.boardId === w.boards.find(b => b.projectId === second.id)!.id)!;
  const here = createCard(w, first.id, "Here", "bottom"); assign(w, here.id, me);
  const there = createCard(w, secondColumn.id, "There", "bottom"); assign(w, there.id, me);
  const groups = myWork(w, me, new Date("2026-06-10T12:00:00"));
  const rows = [...groups.none];
  const hereRow = rows.find(r => r.card.id === here.id)!;
  const thereRow = rows.find(r => r.card.id === there.id)!;
  expect(hereRow.project.id).toBe(p.id);
  expect(thereRow.project.id).toBe(second.id);
  expect(hereRow.column.id).toBe(first.id);
  expect(thereRow.column.id).toBe(secondColumn.id);
});

test("My work: a card on a project's second board is included", () => {
  const { w, me, p, first } = fixture();
  const second = addBoard(w, p.id, "Backend");
  const secondColumn = w.columns.find(c => c.boardId === second.id)!;
  const onFirstBoard = createCard(w, first.id, "Board one", "bottom"); assign(w, onFirstBoard.id, me);
  const onSecondBoard = createCard(w, secondColumn.id, "Board two", "bottom"); assign(w, onSecondBoard.id, me);
  const groups = myWork(w, me, new Date("2026-06-10T12:00:00"));
  const ids = groups.none.map(r => r.card.id);
  expect(ids).toContain(onFirstBoard.id);
  expect(ids).toContain(onSecondBoard.id);
});

test("My work: injecting a fixed 'today' makes the grouping deterministic regardless of the real clock", () => {
  const { w, me, first } = fixture();
  const card = createCard(w, first.id, "Fixed", "bottom"); assign(w, card.id, me); editCard(w, card.id, { dueDate: "2020-01-01" });
  expect(myWork(w, me, new Date("2020-01-02T12:00:00")).overdue.map(r => r.card.id)).toEqual([card.id]);
  expect(myWork(w, me, new Date("2019-12-01T12:00:00")).later.map(r => r.card.id)).toEqual([card.id]);
});

test("Templates: creating a card from a template keeps it assignable, so it can appear in My work once assigned", () => {
  const { w, me, first } = fixture();
  const source = createCard(w, first.id, "Source", "bottom");
  const template = saveCardTemplate(w, source.id, "T");
  const created = createCardFromTemplate(w, first.id, template.id);
  assign(w, created.id, me);
  const groups = myWork(w, me, new Date("2026-06-10T12:00:00"));
  expect(groups.none.map(r => r.card.id)).toContain(created.id);
});
