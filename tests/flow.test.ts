import { expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, editCard, deleteCard, updateColumn, setBlocked, children, epicProgress, waitingOn, blocks, matches, encodeFilters, decodeFilters, emptyFilters, validateWorkspace, undoWorkspace, type Filters } from "../src/model";

function fixture() {
  const w = createWorkspace(); const p = createProject(w, "Release");
  const columns = w.columns.filter(c => c.boardId === w.boards.find(b => b.projectId === p.id)!.id);
  return { w, p, columns, first: columns[0]!, done: columns[4]! };
}

test("WIP limits: updateColumn accepts a positive integer or clears it, and rejects zero/negative/non-integer", () => {
  const { w, first } = fixture();
  updateColumn(w, first.id, { wipLimit: 3 });
  expect(w.columns.find(c => c.id === first.id)!.wipLimit).toBe(3);
  updateColumn(w, first.id, { wipLimit: null });
  expect(w.columns.find(c => c.id === first.id)!.wipLimit).toBeNull();
  expect(() => updateColumn(w, first.id, { wipLimit: 0 })).toThrow();
  expect(() => updateColumn(w, first.id, { wipLimit: -1 })).toThrow();
  expect(() => updateColumn(w, first.id, { wipLimit: 1.5 })).toThrow();
  expect(validateWorkspace(w)).toEqual(w);
});

test("WIP limits: structural validation rejects a zero or negative stored limit", () => {
  const { w, first } = fixture();
  updateColumn(w, first.id, { wipLimit: 2 });
  const bad = structuredClone(w); bad.columns.find(c => c.id === first.id)!.wipLimit = 0;
  expect(() => validateWorkspace(bad)).toThrow();
});

test("Blocked: setBlocked requires a nonempty reason, clears through the mutation path and round-trips the filter", () => {
  const { w, first, p } = fixture();
  const card = createCard(w, first.id, "Work", "bottom");
  expect(() => setBlocked(w, card.id, "")).toThrow();
  expect(() => setBlocked(w, card.id, "   ")).toThrow();
  setBlocked(w, card.id, "Waiting on vendor part");
  expect(w.cards.find(c => c.id === card.id)!.blocked).toEqual({ reason: "Waiting on vendor part", since: expect.any(String) as unknown as string });
  expect(w.activities.at(-1)!.action).toBe("edit");
  const f: Filters = { ...emptyFilters, project: p.id, blocked: "yes" };
  expect(matches(card, f)).toBe(true);
  expect(decodeFilters(encodeFilters(f))).toEqual(f);
  const before = structuredClone(w);
  setBlocked(w, card.id, null);
  expect(w.cards.find(c => c.id === card.id)!.blocked).toBeUndefined();
  undoWorkspace(w, before);
  expect(w.cards.find(c => c.id === card.id)!.blocked).toBeTruthy();
  expect(validateWorkspace(w)).toEqual(w);
});

test("Blocked: structural validation requires a nonempty reason and a valid timestamp, including in history", () => {
  const { w, first } = fixture();
  const card = createCard(w, first.id, "Work", "bottom");
  setBlocked(w, card.id, "Reason");
  const badReason = structuredClone(w); badReason.cards[0]!.blocked!.reason = "";
  expect(() => validateWorkspace(badReason)).toThrow();
  const badTimestamp = structuredClone(w); badTimestamp.cards[0]!.blocked!.since = "not-a-date";
  expect(() => validateWorkspace(badTimestamp)).toThrow();
  const badHistory = structuredClone(w); badHistory.activities.find(a => a.after?.blocked)!.after!.blocked!.reason = "" as string;
  expect(() => validateWorkspace(badHistory)).toThrow();
});

test("Dependencies: self-reference, duplicates, unknown and cross-project references are rejected on live cards", () => {
  const { w, first, p } = fixture();
  const a = createCard(w, first.id, "A", "bottom");
  const b = createCard(w, first.id, "B", "bottom");
  editCard(w, a.id, { blockedBy: [b.id] });
  expect(validateWorkspace(w)).toEqual(w);
  const selfRef = structuredClone(w); selfRef.cards.find(c => c.id === a.id)!.blockedBy = [a.id];
  expect(() => validateWorkspace(selfRef)).toThrow();
  const dup = structuredClone(w); dup.cards.find(c => c.id === a.id)!.blockedBy = [b.id, b.id];
  expect(() => validateWorkspace(dup)).toThrow();
  const unknown = structuredClone(w); unknown.cards.find(c => c.id === a.id)!.blockedBy = ["nonexistent"];
  expect(() => validateWorkspace(unknown)).toThrow();
  const other = createProject(w, "Other"); const otherCol = w.columns.find(c => c.boardId === w.boards.find(bd => bd.projectId === other.id)!.id)!;
  const otherCard = createCard(w, otherCol.id, "Foreign", "bottom");
  const crossProject = structuredClone(w); crossProject.cards.find(c => c.id === a.id)!.blockedBy = [otherCard.id];
  expect(() => validateWorkspace(crossProject)).toThrow();
});

test("Dependencies: a dependency cycle is rejected", () => {
  const { w, first } = fixture();
  const a = createCard(w, first.id, "A", "bottom");
  const b = createCard(w, first.id, "B", "bottom");
  const c = createCard(w, first.id, "C", "bottom");
  editCard(w, a.id, { blockedBy: [b.id] });
  editCard(w, b.id, { blockedBy: [c.id] });
  editCard(w, c.id, { blockedBy: [a.id] });
  expect(() => validateWorkspace(w)).toThrow();
});

test("Dependencies: an unfinished blocker shows on the dependent's face until it is done; blocks() lists dependents", () => {
  const { w, first, done } = fixture();
  const a = createCard(w, first.id, "A", "bottom");
  const b = createCard(w, first.id, "B", "bottom");
  editCard(w, a.id, { blockedBy: [b.id] });
  expect(waitingOn(w, w.cards.find(c => c.id === a.id)!).map(c => c.id)).toEqual([b.id]);
  expect(blocks(w, b.id).map(c => c.id)).toEqual([a.id]);
  const moved = structuredClone(w);
  // Moving the blocker to a done column clears the waiting indicator.
  moved.cards.find(c => c.id === b.id)!.columnId = done.id;
  moved.cards.find(c => c.id === b.id)!.completedAt = new Date().toISOString();
  expect(waitingOn(moved, moved.cards.find(c => c.id === a.id)!)).toEqual([]);
});

test("Dependencies: deleting a card removes it from every dependent's blockedBy through the mutation path", () => {
  const { w, first } = fixture();
  const a = createCard(w, first.id, "A", "bottom");
  const b = createCard(w, first.id, "B", "bottom");
  editCard(w, a.id, { blockedBy: [b.id] });
  deleteCard(w, b.id);
  expect(w.cards.find(c => c.id === a.id)!.blockedBy).toBeUndefined();
  expect(w.activities.some(a2 => a2.cardId === a.id && a2.action === "delete")).toBe(true);
  expect(validateWorkspace(w)).toEqual(w);
});

test("Epics: self-parent, unknown and cross-project parents are rejected, and a parent cycle is rejected", () => {
  const { w, first } = fixture();
  const a = createCard(w, first.id, "A", "bottom");
  const b = createCard(w, first.id, "B", "bottom");
  editCard(w, b.id, { parentId: a.id });
  expect(validateWorkspace(w)).toEqual(w);
  const selfRef = structuredClone(w); selfRef.cards.find(c => c.id === a.id)!.parentId = a.id;
  expect(() => validateWorkspace(selfRef)).toThrow();
  const unknown = structuredClone(w); unknown.cards.find(c => c.id === a.id)!.parentId = "nonexistent";
  expect(() => validateWorkspace(unknown)).toThrow();
  const other = createProject(w, "Other"); const otherCol = w.columns.find(c => c.boardId === w.boards.find(bd => bd.projectId === other.id)!.id)!;
  const otherCard = createCard(w, otherCol.id, "Foreign", "bottom");
  const crossProject = structuredClone(w); crossProject.cards.find(c => c.id === a.id)!.parentId = otherCard.id;
  expect(() => validateWorkspace(crossProject)).toThrow();
  const cycle = structuredClone(w); cycle.cards.find(c => c.id === a.id)!.parentId = b.id;
  expect(() => validateWorkspace(cycle)).toThrow();
});

test("Epics: aggregate child progress, epic filter and deleting a parent clears children's parentId", () => {
  const { w, first, done, p } = fixture();
  const epic = createCard(w, first.id, "Epic", "bottom");
  const kid1 = createCard(w, first.id, "Kid 1", "bottom"); editCard(w, kid1.id, { parentId: epic.id });
  const kid2 = createCard(w, done.id, "Kid 2", "bottom"); editCard(w, kid2.id, { parentId: epic.id });
  expect(epicProgress(w, epic.id)).toEqual({ done: 1, total: 2 });
  expect(children(w, epic.id).map(c => c.id).sort()).toEqual([kid1.id, kid2.id].sort());
  const f: Filters = { ...emptyFilters, project: p.id, epic: epic.id };
  expect(matches(w.cards.find(c => c.id === epic.id)!, f)).toBe(true);
  expect(matches(w.cards.find(c => c.id === kid1.id)!, f)).toBe(true);
  const other = createCard(w, first.id, "Unrelated", "bottom");
  expect(matches(other, f)).toBe(false);
  expect(decodeFilters(encodeFilters(f))).toEqual(f);
  deleteCard(w, epic.id);
  expect(w.cards.find(c => c.id === kid1.id)!.parentId).toBeUndefined();
  expect(w.cards.find(c => c.id === kid2.id)!.parentId).toBeUndefined();
  expect(validateWorkspace(w)).toEqual(w);
});

test("optional fields leave old workspaces byte-for-byte unchanged", () => {
  const { w, first } = fixture();
  createCard(w, first.id, "Plain", "bottom");
  const text = JSON.stringify(w);
  expect(JSON.stringify(validateWorkspace(JSON.parse(text)))).toBe(text);
  expect(w.cards[0]!.blocked).toBeUndefined();
  expect(w.cards[0]!.blockedBy).toBeUndefined();
  expect(w.cards[0]!.parentId).toBeUndefined();
});
