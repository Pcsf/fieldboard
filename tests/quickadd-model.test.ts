import { expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, resolveLabels, undoWorkspace, validateWorkspace } from "../src/model";

function fixture() {
  const w = createWorkspace(); const p = createProject(w, "Release");
  const columns = w.columns.filter(c => c.boardId === w.boards.find(b => b.projectId === p.id)!.id);
  return { w, p, columns, first: columns[0]! };
}

test("createCard: an optional patch applies within the same creation mutation, producing exactly one Activity entry", () => {
  const { w, p, first } = fixture();
  const labelIds = resolveLabels(p, ["bug"]);
  const before = w.activities.length;
  const card = createCard(w, first.id, "Fix login", "bottom", { priority: "high", dueDate: "2026-02-01", labels: labelIds, assignees: [w.members[0]!.id] });
  expect(w.activities.length).toBe(before + 1);
  const entry = w.activities.at(-1)!;
  expect(entry.action).toBe("create");
  expect(entry.before).toBeNull();
  expect(entry.after).toEqual(w.cards.find(c => c.id === card.id)!);
  expect(card.priority).toBe("high");
  expect(card.dueDate).toBe("2026-02-01");
  expect(card.labels).toEqual(labelIds);
  expect(card.assignees).toEqual([w.members[0]!.id]);
  expect(validateWorkspace(w)).toEqual(w);
});

test("createCard: an empty patch behaves exactly like the previous no-patch signature", () => {
  const { w, first } = fixture();
  const card = createCard(w, first.id, "Plain", "bottom");
  expect(card.priority).toBe("none");
  expect(card.labels).toEqual([]);
  expect(card.assignees).toEqual([]);
  expect(card.dueDate).toBeNull();
});

test("resolveLabels: matches an existing project label case-insensitively instead of duplicating it", () => {
  const { w, p } = fixture();
  const first = resolveLabels(p, ["Bug"]);
  expect(p.labels.length).toBe(1);
  const second = resolveLabels(p, ["bug"]);
  expect(second).toEqual(first);
  expect(p.labels.length).toBe(1);
});

test("resolveLabels: trims and skips blank names, reusing a case-insensitive match instead of duplicating it", () => {
  const { p } = fixture();
  const ids = resolveLabels(p, [" Release ", "release", "Bug", "", "   "]);
  expect(new Set(ids).size).toBe(2);
  expect(p.labels.map(l => l.name).sort()).toEqual(["Bug", "Release"]);
});

test("createCard: undo removes the card and any label it created, in one step", () => {
  const { w, p, first } = fixture();
  const before = structuredClone(w);
  const labelIds = resolveLabels(w.projects.find(x => x.id === p.id)!, ["bug"]);
  createCard(w, first.id, "Fix login", "bottom", { labels: labelIds });
  expect(w.projects.find(x => x.id === p.id)!.labels.length).toBe(1);
  undoWorkspace(w, before);
  expect(w.cards.length).toBe(0);
  expect(w.projects.find(x => x.id === p.id)!.labels.length).toBe(0);
});
