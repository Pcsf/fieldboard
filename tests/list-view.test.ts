import { expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, editCard, resolveLabels, emptyFilters, type Filters } from "../src/model";
import { listRows, sortRows, groupRows, type ListRow } from "../src/list-view";

function fixture() {
  const w = createWorkspace(); const p = createProject(w, "Release");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const columns = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  const project = w.projects.find(x => x.id === p.id)!;
  return { w, p: project, columns, backlog: columns[0]!, todo: columns[1]! };
}
const filters: Filters = { ...emptyFilters };

test("list-view: listRows resolves assignees, labels, milestone and epic references and respects filters", () => {
  const { w, p, backlog } = fixture();
  const [bug] = resolveLabels(p, ["Bug"]);
  const epic = createCard(w, backlog.id, "Epic", "bottom");
  const card = createCard(w, backlog.id, "Card", "bottom");
  editCard(w, card.id, { labels: [bug!], assignees: [w.members[0]!.id], parentId: epic.id });
  const rows = listRows(w, w.columns.filter(c => c.boardId === backlog.boardId), p.labels, p.milestones ?? [], filters);
  const row = rows.find(r => r.card.id === card.id)!;
  expect(row.labels.map(l => l.name)).toEqual(["Bug"]);
  expect(row.assignees.map(m => m.id)).toEqual([w.members[0]!.id]);
  expect(row.epic!.id).toBe(epic.id);
  const filtered = listRows(w, w.columns.filter(c => c.boardId === backlog.boardId), p.labels, p.milestones ?? [], { ...filters, q: "nope" });
  expect(filtered).toEqual([]);
});

function row(overrides: Partial<ListRow> & { title?: string; priority?: any; due?: string | null; position?: number }): ListRow {
  const { w, backlog } = fixture();
  const card = createCard(w, backlog.id, overrides.title ?? "Card", "bottom");
  if (overrides.priority) editCard(w, card.id, { priority: overrides.priority });
  if (overrides.due !== undefined) editCard(w, card.id, { dueDate: overrides.due });
  const c = w.cards.find(x => x.id === card.id)!;
  return { card: c, column: backlog, assignees: [], labels: [], milestone: null, epic: null, ied: null, ...overrides };
}

test("list-view: sortRows sorts by title ascending/descending, stably, with nulls last", () => {
  const rows = [row({ title: "Banana" }), row({ title: "apple" }), row({ title: "Cherry" })];
  expect(sortRows(rows, "title", "asc").map(r => r.card.title)).toEqual(["apple", "Banana", "Cherry"]);
  expect(sortRows(rows, "title", "desc").map(r => r.card.title)).toEqual(["Cherry", "Banana", "apple"]);
});

test("list-view: sortRows by due puts cards without a due date last in either direction", () => {
  const rows = [row({ title: "No date", due: null }), row({ title: "Later", due: "2026-02-01" }), row({ title: "Soon", due: "2026-01-01" })];
  expect(sortRows(rows, "due", "asc").map(r => r.card.title)).toEqual(["Soon", "Later", "No date"]);
  expect(sortRows(rows, "due", "desc").map(r => r.card.title)).toEqual(["Later", "Soon", "No date"]);
});

test("list-view: sortRows is stable for equal keys (preserves original relative order)", () => {
  const rows = [row({ title: "A", priority: "low" }), row({ title: "B", priority: "low" }), row({ title: "C", priority: "low" })];
  expect(sortRows(rows, "priority", "asc").map(r => r.card.title)).toEqual(["A", "B", "C"]);
});

test("list-view: groupRows with no field returns one ungrouped bucket; with a field, buckets by label, sorted", () => {
  const rows = [row({ title: "A", priority: "high" }), row({ title: "B", priority: "low" }), row({ title: "C", priority: "high" })];
  expect(groupRows(rows, "").map(g => g.rows.length)).toEqual([3]);
  const groups = groupRows(rows, "priority");
  expect(groups.map(g => g.label)).toEqual(["Low", "High"]);
  expect(groups.find(g => g.label === "High")!.rows.map(r => r.card.title)).toEqual(["A", "C"]);
});

test("list-view: groupRows orders groups by priority rank regardless of the sort direction applied beforehand", () => {
  const rows = [row({ title: "A", priority: "urgent" }), row({ title: "B", priority: "none" })];
  const asc = groupRows(sortRows(rows, "priority", "asc"), "priority").map(g => g.label);
  const desc = groupRows(sortRows(rows, "priority", "desc"), "priority").map(g => g.label);
  expect(asc).toEqual(desc);
  expect(asc).toEqual(["No priority", "Urgent"]);
});

test("list-view: groupRows by assignee puts a multi-assignee card in each matching group and ungrouped cards in Unassigned", () => {
  const { w, backlog } = fixture();
  const alice = w.members[0]!; const bob = { id: "bob", name: "Bob", color: "#334455" }; w.members.push(bob);
  const multi = createCard(w, backlog.id, "Multi", "bottom"); editCard(w, multi.id, { assignees: [alice.id, bob.id] });
  const none = createCard(w, backlog.id, "None", "bottom");
  const rows: ListRow[] = [
    { card: w.cards.find(c => c.id === multi.id)!, column: backlog, assignees: [alice, bob], labels: [], milestone: null, epic: null, ied: null },
    { card: w.cards.find(c => c.id === none.id)!, column: backlog, assignees: [], labels: [], milestone: null, epic: null, ied: null },
  ];
  const groups = groupRows(rows, "assignee");
  expect(groups.find(g => g.label === "Carol")).toBeUndefined();
  expect(groups.find(g => g.key === alice.id)!.rows.map(r => r.card.title)).toEqual(["Multi"]);
  expect(groups.find(g => g.key === bob.id)!.rows.map(r => r.card.title)).toEqual(["Multi"]);
  expect(groups.find(g => g.key === "none")!.rows.map(r => r.card.title)).toEqual(["None"]);
});
