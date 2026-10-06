import { expect, test } from "bun:test";
import {
  createWorkspace, createProject, createCard, editCard, archiveCard, moveCard, moveCardInLane, moveCardToBoard,
  deleteColumn, addColumn, addBoard, undoWorkspace, validateWorkspace, resolveLabels, type Workspace,
} from "../src/model";
import {
  addRule, toggleRule, deleteRule, setAutoArchiveDays, runEntryRules, applyAutomation,
  hasOverdueWork, runOverdueRule, hasAutoArchiveWork, runAutoArchive, hasDueAutomation,
  DEFAULT_OVERDUE_LABEL, type Rule,
} from "../src/automation";

function fixture() {
  const w = createWorkspace(); const p = createProject(w, "Automation");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const columns = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  const [backlog, todo, inProgress, review, done] = columns;
  return { w, p, board, backlog: backlog!, todo: todo!, inProgress: inProgress!, review: review!, done: done! };
}

// --- R41 rule kind 1: entering a column checks all subtasks ---------------------------------------

test("Automation: entering the rule's column marks every subtask done, logged in plain words", () => {
  const { w, board, backlog, review } = fixture();
  addRule(w, board.id, { kind: "enter-check-subtasks", enabled: true, columnId: review.id });
  const card = createCard(w, backlog.id, "Ship it", "bottom", { subtasks: [{ id: "s1", title: "Write tests", done: false, position: 0 }, { id: "s2", title: "Review", done: false, position: 1 }] });
  applyAutomation(w, w2 => moveCard(w2, card.id, review.id, 0));
  const after = w.cards.find(c => c.id === card.id)!;
  expect(after.subtasks.every(s => s.done)).toBe(true);
  const actions = w.activities.filter(a => a.cardId === card.id).map(a => a.action);
  expect(actions).toEqual(["create", "move", "rule: entering Review checks all subtasks"]);
});

test("Automation: a disabled check-subtasks rule never fires", () => {
  const { w, board, backlog, review } = fixture();
  const rule = addRule(w, board.id, { kind: "enter-check-subtasks", enabled: true, columnId: review.id });
  toggleRule(w, board.id, rule.id, false);
  const card = createCard(w, backlog.id, "Ship it", "bottom", { subtasks: [{ id: "s1", title: "Write tests", done: false, position: 0 }] });
  applyAutomation(w, w2 => moveCard(w2, card.id, review.id, 0));
  expect(w.cards.find(c => c.id === card.id)!.subtasks.every(s => !s.done)).toBe(true);
  expect(w.activities.filter(a => a.cardId === card.id).map(a => a.action)).toEqual(["create", "move"]);
});

test("Automation: check-subtasks is idempotent -- no subtasks, or already-done subtasks, produce no rule activity", () => {
  const { w, board, backlog, review } = fixture();
  addRule(w, board.id, { kind: "enter-check-subtasks", enabled: true, columnId: review.id });
  const card = createCard(w, backlog.id, "No subtasks", "bottom");
  applyAutomation(w, w2 => moveCard(w2, card.id, review.id, 0));
  expect(w.activities.filter(a => a.cardId === card.id).map(a => a.action)).toEqual(["create", "move"]);
});

// --- R41 rule kind 3: entering a column assigns a member -------------------------------------------

test("Automation: entering the rule's column assigns the configured member, logged with their name", () => {
  const { w, board, backlog, review } = fixture();
  const robin = { id: "robin", name: "Robin", color: "#112233" }; w.members.push(robin);
  addRule(w, board.id, { kind: "enter-assign-member", enabled: true, columnId: review.id, memberId: robin.id });
  const card = createCard(w, backlog.id, "Review me", "bottom");
  applyAutomation(w, w2 => moveCard(w2, card.id, review.id, 0));
  const after = w.cards.find(c => c.id === card.id)!;
  expect(after.assignees).toEqual([robin.id]);
  expect(w.activities.filter(a => a.cardId === card.id).map(a => a.action)).toEqual(["create", "move", "rule: entering Review assigns Robin"]);
});

test("Automation: entering the rule's column twice with the already-assigned member fires only once", () => {
  const { w, board, backlog, todo, review } = fixture();
  const robin = { id: "robin", name: "Robin", color: "#112233" }; w.members.push(robin);
  addRule(w, board.id, { kind: "enter-assign-member", enabled: true, columnId: review.id, memberId: robin.id });
  const card = createCard(w, backlog.id, "Review me", "bottom");
  applyAutomation(w, w2 => moveCard(w2, card.id, review.id, 0));
  applyAutomation(w, w2 => moveCard(w2, card.id, todo.id, 0)); // leaves Review
  applyAutomation(w, w2 => moveCard(w2, card.id, review.id, 0)); // re-enters Review, already assigned
  const assignActions = w.activities.filter(a => a.cardId === card.id && a.action.includes("assigns"));
  expect(assignActions.length).toBe(1);
});

test("Automation: a disabled assign-member rule never fires", () => {
  const { w, board, backlog, review } = fixture();
  const robin = { id: "robin", name: "Robin", color: "#112233" }; w.members.push(robin);
  const rule = addRule(w, board.id, { kind: "enter-assign-member", enabled: true, columnId: review.id, memberId: robin.id });
  toggleRule(w, board.id, rule.id, false);
  const card = createCard(w, backlog.id, "Review me", "bottom");
  applyAutomation(w, w2 => moveCard(w2, card.id, review.id, 0));
  expect(w.cards.find(c => c.id === card.id)!.assignees).toEqual([]);
});

// --- Entering by every move path reachable from the model -------------------------------------------

test("Automation: entering fires via moveCard, moveCardInLane, moveCardToBoard, quick-create, bulk move, and column-delete relocation", () => {
  const { w, p, board, backlog, review } = fixture();
  addRule(w, board.id, { kind: "enter-check-subtasks", enabled: true, columnId: review.id });
  const subtask = () => [{ id: "s1", title: "Task", done: false, position: 0 }];

  const viaMove = createCard(w, backlog.id, "Via move", "bottom", { subtasks: subtask() });
  applyAutomation(w, w2 => moveCard(w2, viaMove.id, review.id, 0));
  expect(w.cards.find(c => c.id === viaMove.id)!.subtasks[0]!.done).toBe(true);

  const viaLane = createCard(w, backlog.id, "Via lane", "bottom", { subtasks: subtask() });
  applyAutomation(w, w2 => moveCardInLane(w2, viaLane.id, review.id, 0, "none", "none", "none"));
  expect(w.cards.find(c => c.id === viaLane.id)!.subtasks[0]!.done).toBe(true);

  // Direct creation into the rule's column (what a quick-add typed straight into Review does) must
  // fire too -- "entering" covers a brand-new card, not only a move.
  let quickAddId = "";
  applyAutomation(w, w2 => { quickAddId = createCard(w2, review.id, "Via quick-add", "bottom", subtaskPatch()).id; });
  expect(w.cards.find(c => c.id === quickAddId)!.subtasks[0]!.done).toBe(true);

  const second = addBoard(w, p.id, "Second board");
  const secondColumns = w.columns.filter(c => c.boardId === second.id).sort((a, b) => a.position - b.position);
  addRule(w, second.id, { kind: "enter-check-subtasks", enabled: true, columnId: secondColumns[0]!.id });
  const viaBoardMove = createCard(w, backlog.id, "Via board move", "bottom", { subtasks: subtask() });
  applyAutomation(w, w2 => moveCardToBoard(w2, viaBoardMove.id, second.id));
  expect(w.cards.find(c => c.id === viaBoardMove.id)!.subtasks[0]!.done).toBe(true);

  const bulkA = createCard(w, backlog.id, "Bulk A", "bottom", { subtasks: subtask() });
  const bulkB = createCard(w, backlog.id, "Bulk B", "bottom", { subtasks: subtask() });
  applyAutomation(w, w2 => { moveCard(w2, bulkA.id, review.id, 0); moveCard(w2, bulkB.id, review.id, 0); });
  expect(w.cards.find(c => c.id === bulkA.id)!.subtasks[0]!.done).toBe(true);
  expect(w.cards.find(c => c.id === bulkB.id)!.subtasks[0]!.done).toBe(true);

  const extra = addColumn(w, board.id, "Extra");
  const relocated = createCard(w, extra.id, "Relocated", "bottom", { subtasks: subtask() });
  applyAutomation(w, w2 => deleteColumn(w2, extra.id, review.id));
  expect(w.cards.find(c => c.id === relocated.id)!.subtasks[0]!.done).toBe(true);
  expect(validateWorkspace(w)).toEqual(w);
});
function subtaskPatch() { return { subtasks: [{ id: "s1", title: "Task", done: false, position: 0 }] }; }

// --- Loop guard: rule effects cannot retrigger entry rules -------------------------------------------

test("Automation: two rules on the same entry column both fire exactly once and never loop", () => {
  const { w, board, backlog, review } = fixture();
  const robin = { id: "robin", name: "Robin", color: "#112233" }; w.members.push(robin);
  addRule(w, board.id, { kind: "enter-check-subtasks", enabled: true, columnId: review.id });
  addRule(w, board.id, { kind: "enter-assign-member", enabled: true, columnId: review.id, memberId: robin.id });
  const card = createCard(w, backlog.id, "Dual rule", "bottom", { subtasks: [{ id: "s1", title: "Task", done: false, position: 0 }] });
  applyAutomation(w, w2 => moveCard(w2, card.id, review.id, 0));
  const countAfterFirst = w.activities.filter(a => a.cardId === card.id).length;
  // A second, idle pass over the same already-settled state must add nothing: the rules' own effects
  // (checking subtasks, assigning a member) never touch columnId, so there is nothing left to retrigger.
  applyAutomation(w, () => {});
  expect(w.activities.filter(a => a.cardId === card.id).length).toBe(countAfterFirst);
  expect(countAfterFirst).toBe(4); // create, move, checks-subtasks, assigns -- each exactly once
});

// --- Undo: a rule effect joins the triggering change's undo step -------------------------------------

test("Automation: undoing the triggering move also undoes its rule effect, as one step", () => {
  const { w, board, backlog, review } = fixture();
  const robin = { id: "robin", name: "Robin", color: "#112233" }; w.members.push(robin);
  addRule(w, board.id, { kind: "enter-assign-member", enabled: true, columnId: review.id, memberId: robin.id });
  const card = createCard(w, backlog.id, "Undo me", "bottom");
  const before = structuredClone(w);
  applyAutomation(w, w2 => moveCard(w2, card.id, review.id, 0));
  expect(w.cards.find(c => c.id === card.id)!.columnId).toBe(review.id);
  expect(w.cards.find(c => c.id === card.id)!.assignees).toEqual([robin.id]);
  undoWorkspace(w, before);
  const reverted = w.cards.find(c => c.id === card.id)!;
  expect(reverted.columnId).toBe(backlog.id);
  expect(reverted.assignees).toEqual([]);
});

// --- R41 rule kind 2: overdue adds a label, idempotent, never done/archived ---------------------------

test("Automation: an overdue card gets the configured label, creating it in the project if missing", () => {
  const { w, board, p, backlog } = fixture();
  addRule(w, board.id, { kind: "overdue-label", enabled: true, labelName: DEFAULT_OVERDUE_LABEL });
  const card = createCard(w, backlog.id, "Late task", "bottom", { dueDate: "2026-01-01" });
  const now = new Date("2026-01-05T09:00:00");
  expect(hasOverdueWork(w, now)).toBe(true);
  expect(runOverdueRule(w, now)).toBe(1);
  const label = p.labels.find(l => l.name === DEFAULT_OVERDUE_LABEL);
  expect(label).toBeTruthy();
  expect(w.cards.find(c => c.id === card.id)!.labels).toEqual([label!.id]);
  expect(w.activities.some(a => a.cardId === card.id && a.action === `rule: overdue adds label ${DEFAULT_OVERDUE_LABEL}`)).toBe(true);
});

test("Automation: a disabled overdue rule never fires", () => {
  const { w, board, backlog } = fixture();
  const rule = addRule(w, board.id, { kind: "overdue-label", enabled: true, labelName: DEFAULT_OVERDUE_LABEL });
  toggleRule(w, board.id, rule.id, false);
  createCard(w, backlog.id, "Late task", "bottom", { dueDate: "2026-01-01" });
  const now = new Date("2026-01-05T09:00:00");
  expect(hasOverdueWork(w, now)).toBe(false);
  expect(runOverdueRule(w, now)).toBe(0);
});

test("Automation: overdue-label is idempotent -- a card already carrying the label gets nothing, no duplicate Activity", () => {
  const { w, board, backlog } = fixture();
  addRule(w, board.id, { kind: "overdue-label", enabled: true, labelName: DEFAULT_OVERDUE_LABEL });
  const card = createCard(w, backlog.id, "Late task", "bottom", { dueDate: "2026-01-01" });
  const now = new Date("2026-01-05T09:00:00");
  runOverdueRule(w, now);
  const countAfterFirst = w.activities.filter(a => a.cardId === card.id).length;
  expect(hasOverdueWork(w, now)).toBe(false);
  expect(runOverdueRule(w, now)).toBe(0);
  expect(w.activities.filter(a => a.cardId === card.id).length).toBe(countAfterFirst);
});

test("Automation: overdue-label never fires for a done or archived card", () => {
  const { w, board, backlog, done } = fixture();
  addRule(w, board.id, { kind: "overdue-label", enabled: true, labelName: DEFAULT_OVERDUE_LABEL });
  const doneCard = createCard(w, done.id, "Finished late", "bottom", { dueDate: "2026-01-01" });
  const archivedCard = createCard(w, backlog.id, "Archived late", "bottom", { dueDate: "2026-01-01" });
  archiveCard(w, archivedCard.id, true);
  const now = new Date("2026-01-05T09:00:00");
  expect(hasOverdueWork(w, now)).toBe(false);
  expect(runOverdueRule(w, now)).toBe(0);
  expect(w.cards.find(c => c.id === doneCard.id)!.labels).toEqual([]);
  expect(w.cards.find(c => c.id === archivedCard.id)!.labels).toEqual([]);
});

test("Automation: overdue-label respects a due date of exactly today (not yet overdue)", () => {
  const { w, board, backlog } = fixture();
  addRule(w, board.id, { kind: "overdue-label", enabled: true, labelName: DEFAULT_OVERDUE_LABEL });
  const now = new Date("2026-01-05T09:00:00");
  createCard(w, backlog.id, "Due today", "bottom", { dueDate: "2026-01-05" });
  expect(hasOverdueWork(w, now)).toBe(false);
  expect(runOverdueRule(w, now)).toBe(0);
});

// --- R42 auto-archive: done + N days, idempotent, boundary day, restore resets the clock --------------

test("Automation: a done card older than N days is archived on the schedule, logged in plain words", () => {
  const { w, board, done } = fixture();
  setAutoArchiveDays(w, board.id, 14);
  const card = createCard(w, done.id, "Old and done", "bottom");
  const completedAt = new Date(Date.now() - 20 * 86_400_000).toISOString();
  w.cards.find(c => c.id === card.id)!.completedAt = completedAt;
  const now = new Date();
  expect(hasAutoArchiveWork(w, now)).toBe(true);
  expect(runAutoArchive(w, now)).toBe(1);
  expect(w.cards.find(c => c.id === card.id)!.archived).toBe(true);
  expect(w.activities.some(a => a.cardId === card.id && a.action === "auto-archive after 14 days")).toBe(true);
});

test("Automation: a done card exactly N days old (the boundary) is not yet archived", () => {
  const { w, board, done } = fixture();
  setAutoArchiveDays(w, board.id, 14);
  const now = new Date("2026-02-15T12:00:00Z");
  const card = createCard(w, done.id, "Boundary", "bottom");
  w.cards.find(c => c.id === card.id)!.completedAt = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  expect(hasAutoArchiveWork(w, now)).toBe(false);
  expect(runAutoArchive(w, now)).toBe(0);
  expect(w.cards.find(c => c.id === card.id)!.archived).toBe(false);
});

test("Automation: a not-done card, and a done card inside the window, are both left untouched", () => {
  const { w, board, backlog, done } = fixture();
  setAutoArchiveDays(w, board.id, 14);
  const now = new Date();
  const notDone = createCard(w, backlog.id, "Not done", "bottom");
  const recentlyDone = createCard(w, done.id, "Recently done", "bottom");
  w.cards.find(c => c.id === recentlyDone.id)!.completedAt = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  expect(hasAutoArchiveWork(w, now)).toBe(false);
  expect(runAutoArchive(w, now)).toBe(0);
  expect(w.cards.find(c => c.id === notDone.id)!.archived).toBe(false);
  expect(w.cards.find(c => c.id === recentlyDone.id)!.archived).toBe(false);
});

test("Automation: auto-archive is idempotent -- an already-archived card is left alone on the next pass", () => {
  const { w, board, done } = fixture();
  setAutoArchiveDays(w, board.id, 14);
  const card = createCard(w, done.id, "Old and done", "bottom");
  w.cards.find(c => c.id === card.id)!.completedAt = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const now = new Date();
  runAutoArchive(w, now);
  const countAfterFirst = w.activities.filter(a => a.cardId === card.id).length;
  expect(hasAutoArchiveWork(w, now)).toBe(false);
  expect(runAutoArchive(w, now)).toBe(0);
  expect(w.activities.filter(a => a.cardId === card.id).length).toBe(countAfterFirst);
});

test("Automation: restoring an auto-archived card resets the clock -- it is not re-archived until done again for N more days", () => {
  const { w, board, done } = fixture();
  setAutoArchiveDays(w, board.id, 14);
  const card = createCard(w, done.id, "Old and done", "bottom");
  const originalCompletedAt = new Date(Date.now() - 30 * 86_400_000).toISOString();
  w.cards.find(c => c.id === card.id)!.completedAt = originalCompletedAt;
  const now = new Date();
  runAutoArchive(w, now);
  expect(w.cards.find(c => c.id === card.id)!.archived).toBe(true);
  archiveCard(w, card.id, false); // restore, through the same archive dialog path
  const restored = w.cards.find(c => c.id === card.id)!;
  expect(restored.archived).toBe(false);
  // The clock resets via restoredAt, never by rewriting completedAt (see below).
  expect(restored.completedAt).toBe(originalCompletedAt);
  expect(new Date(restored.restoredAt!).getTime()).toBeGreaterThan(now.getTime() - 1000);
  // Immediately after restore, nothing re-archives it: the clock reads restoredAt, "now".
  expect(hasAutoArchiveWork(w, now)).toBe(false);
  expect(runAutoArchive(w, now)).toBe(0);
  expect(w.cards.find(c => c.id === card.id)!.archived).toBe(false);
});

test("Automation: restoring a done card leaves completedAt byte-identical -- only restoredAt changes", () => {
  const { w, done } = fixture();
  const card = createCard(w, done.id, "Completed in August", "bottom");
  const originalCompletedAt = "2026-08-15T09:30:00.000Z";
  w.cards.find(c => c.id === card.id)!.completedAt = originalCompletedAt;
  archiveCard(w, card.id, true);
  archiveCard(w, card.id, false);
  const restored = w.cards.find(c => c.id === card.id)!;
  expect(restored.completedAt).toBe(originalCompletedAt);
  expect(restored.restoredAt).toBeDefined();
  expect(validateWorkspace(w)).toEqual(w);
});

test("Automation: hasDueAutomation combines the overdue and auto-archive checks", () => {
  const { w, board, backlog } = fixture();
  expect(hasDueAutomation(w)).toBe(false);
  addRule(w, board.id, { kind: "overdue-label", enabled: true, labelName: DEFAULT_OVERDUE_LABEL });
  createCard(w, backlog.id, "Late", "bottom", { dueDate: "2020-01-01" });
  expect(hasDueAutomation(w)).toBe(true);
});

// --- Rule CRUD -----------------------------------------------------------------------------------

test("Automation: a rule can be added, toggled off and on, and deleted", () => {
  const { w, board, review } = fixture();
  const rule = addRule(w, board.id, { kind: "enter-check-subtasks", enabled: true, columnId: review.id });
  expect(board.rules).toHaveLength(1);
  toggleRule(w, board.id, rule.id, false);
  expect(board.rules![0]!.enabled).toBe(false);
  toggleRule(w, board.id, rule.id, true);
  expect(board.rules![0]!.enabled).toBe(true);
  deleteRule(w, board.id, rule.id);
  expect(board.rules).toHaveLength(0);
});

test("Automation: setAutoArchiveDays accepts a positive integer or null, and rejects anything else", () => {
  const { w, board } = fixture();
  setAutoArchiveDays(w, board.id, 7);
  expect(board.autoArchiveDays).toBe(7);
  setAutoArchiveDays(w, board.id, null);
  expect(board.autoArchiveDays).toBe(null);
  expect(() => setAutoArchiveDays(w, board.id, 0)).toThrow();
  expect(() => setAutoArchiveDays(w, board.id, -1)).toThrow();
  expect(() => setAutoArchiveDays(w, board.id, 1.5)).toThrow();
});

// --- Validation ------------------------------------------------------------------------------------

test("Automation: structural validation rejects an unknown rule kind, a missing column, or a missing label name", () => {
  const { w, board } = fixture();
  const bad1 = structuredClone(w); bad1.boards.find(b => b.id === board.id)!.rules = [{ id: "r1", kind: "unknown" as any, enabled: true }] as unknown as Rule[];
  expect(() => validateWorkspace(bad1)).toThrow();
  const bad2 = structuredClone(w); bad2.boards.find(b => b.id === board.id)!.rules = [{ id: "r2", kind: "enter-check-subtasks", enabled: true, columnId: "" }] as unknown as Rule[];
  expect(() => validateWorkspace(bad2)).toThrow();
  const bad3 = structuredClone(w); bad3.boards.find(b => b.id === board.id)!.rules = [{ id: "r3", kind: "overdue-label", enabled: true, labelName: "" }] as unknown as Rule[];
  expect(() => validateWorkspace(bad3)).toThrow();
});

test("Automation: relational validation rejects a rule column from another board, and an unknown assignee", () => {
  const { w, p, board } = fixture();
  const other = addBoard(w, p.id, "Other board");
  const otherColumn = w.columns.find(c => c.boardId === other.id)!;
  const bad1 = structuredClone(w); bad1.boards.find(b => b.id === board.id)!.rules = [{ id: "r1", kind: "enter-check-subtasks", enabled: true, columnId: otherColumn.id }];
  expect(() => validateWorkspace(bad1)).toThrow();
  const bad2 = structuredClone(w); bad2.boards.find(b => b.id === board.id)!.rules = [{ id: "r2", kind: "enter-assign-member", enabled: true, columnId: board.id, memberId: "nope" }] as unknown as Rule[];
  expect(() => validateWorkspace(bad2)).toThrow();
});

test("Automation: an untouched workspace carries no rules or autoArchiveDays key and loads byte-for-byte unchanged", () => {
  const { w, backlog } = fixture();
  createCard(w, backlog.id, "Plain", "bottom");
  const text = JSON.stringify(w);
  expect(JSON.stringify(validateWorkspace(JSON.parse(text)))).toBe(text);
});

test("Automation: resolveLabels is reused to find-or-create the overdue label by name, case-insensitively", () => {
  const { w, p } = fixture();
  const existing = { id: "lbl1", name: "Late", color: "#667b68" }; p.labels.push(existing);
  expect(resolveLabels(p, ["late"])).toEqual([existing.id]);
});
