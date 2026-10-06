import { expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, editCard, moveCard, migrateWorkspace, validateWorkspace, undoWorkspace, type Activity, type Card, type Workspace } from "../src/model";
import { defaultEffort, defaultPlanning, sprintBoard, sprintLoads, estimateProject, setSprintOverride, cardSprintNumber, setCardSprint, sprintWindow, sprintAnchorDate, setSprintMeta, closeSprint, sprintBurnup, validateSprints } from "../src/planning";

function fixture() {
  const w = createWorkspace(); const p = createProject(w, "FPGA");
  const c = createCard(w, w.columns[0]!.id, "Register bank", "bottom");
  return { w, p, c };
}

// --- Migration: every existing sprint shape (numbered allocations, overrides, direct capacity)
// keeps validating and computing the exact same numbers with none of this release's new fields set.
test("migration: numbered allocations, overrides and direct capacity validate and compute unchanged with no new fields present", () => {
  const { w, p, c } = fixture();
  p.planning = defaultPlanning(); p.planning.capacityMode = "direct"; p.planning.directCapacity = 8; p.planning.sprintWeeks = 2;
  editCard(w, c.id, { effort: { ...defaultEffort("csr"), sprint: 1 } });
  const other = createCard(w, w.columns[0]!.id, "Second", "bottom");
  editCard(w, other.id, { effort: { ...defaultEffort("fsm"), sprint: 2 } });
  setSprintOverride(w, p.id, 2, 3);
  expect(p.sprints).toBeUndefined();
  expect(c.sprint).toBeUndefined();
  const text = JSON.stringify(w);
  const reloaded = migrateWorkspace(JSON.parse(text));
  expect(JSON.stringify(reloaded)).toBe(text);
  const valid = validateWorkspace(JSON.parse(JSON.stringify(reloaded)));
  expect(JSON.stringify(valid)).toBe(text);
  const loads = sprintLoads(reloaded, p.id);
  expect(loads.map(l => l.sprint)).toEqual([1, 2]);
  const board = sprintBoard(reloaded, p.id);
  expect(board.sprints.map(s => s.sprint)).toEqual([1, 2]);
  expect(board.sprints[1]!.capacitySource).toBe("overridden");
  expect(estimateProject(reloaded, p.id).capacity).toBeCloseTo(8);
});

// --- Any card, not only IED-estimated ones, can be in a sprint.
test("a card with no IED effort can be assigned to a sprint, and shows up as a sprint member", () => {
  const { w, p } = fixture();
  const plain = createCard(w, w.columns[0]!.id, "Write the README", "bottom");
  expect(() => setCardSprint(w, plain.id, 3)).not.toThrow();
  expect(cardSprintNumber(w.cards.find(c => c.id === plain.id)!)).toBe(3);
  validateWorkspace(w); // structurally and relationally valid
  const board = sprintBoard(w, p.id);
  const group = board.sprints.find(s => s.sprint === 3)!;
  expect(group.cards.map(c => c.card.id)).toEqual([plain.id]);
  expect(group.cards[0]!.estimate).toBeUndefined();
  expect(group.unestimated).toBe(1);
  expect(group.verdict).toBe("not quotable");
  // It must never appear in "unassigned" -- that list is scoped to estimated cards without a sprint.
  expect(board.unassigned).toEqual([]);
});

test("setCardSprint on an estimated card still writes effort.sprint, not the top-level field -- one source of truth per card", () => {
  const { w, c } = fixture();
  editCard(w, c.id, { effort: defaultEffort("csr") });
  setCardSprint(w, c.id, 4);
  const reloaded = w.cards.find(x => x.id === c.id)!;
  expect(reloaded.effort!.sprint).toBe(4);
  expect(reloaded.sprint).toBeUndefined();
  expect(cardSprintNumber(reloaded)).toBe(4);
});

test("validateSprints rejects duplicate numbers, non-integers and a start date after the end date", () => {
  expect(() => validateSprints([{ number: 1 }, { number: 1 }])).toThrow();
  expect(() => validateSprints([{ number: 1.5 }])).toThrow();
  expect(() => validateSprints([{ number: 1, startDate: "2026-02-10", endDate: "2026-02-01" }])).toThrow();
  expect(() => validateSprints([{ number: 1, startDate: "not-a-date" }])).toThrow();
  expect(() => validateSprints([{ number: 1, name: "Sprint zero", startDate: "2026-01-01", endDate: "2026-01-14" }])).not.toThrow();
});

test("a card.sprint value of zero or a fraction is rejected the same way effort.sprint already is", () => {
  const { w, p } = fixture();
  const plain = createCard(w, w.columns[0]!.id, "Plain", "bottom");
  expect(() => setCardSprint(w, plain.id, 0)).toThrow();
  editCard(w, plain.id, { sprint: 1.5 });
  expect(() => validateWorkspace(w)).toThrow();
  void p;
});

// --- Sensible, editable, consecutive default windows, anchored on a stable, pure function of data.
test("sprintWindow: sprint N defaults to anchor + (N-1) x sprintWeeks; an explicit date always wins for that sprint only", () => {
  const anchor = "2026-03-02"; // a Monday
  const w1 = sprintWindow([], 2, 1, anchor);
  expect(w1.startDate).toBe("2026-03-02"); expect(w1.endDate).toBe("2026-03-15"); expect(w1.explicitDates).toBe(false);
  const w2 = sprintWindow([], 2, 2, anchor);
  expect(w2.startDate).toBe("2026-03-16"); expect(w2.endDate).toBe("2026-03-29");
  const w3 = sprintWindow([], 2, 3, anchor);
  expect(w3.startDate).toBe("2026-03-30"); expect(w3.endDate).toBe("2026-04-12");
  // Sprint 3's own explicit dates win for sprint 3 only -- sprint 2 and sprint 4 keep deriving
  // straight from the one fixed anchor, not from sprint 3's edited dates.
  const metas = [{ number: 3, startDate: "2026-05-01", endDate: "2026-05-14" }];
  const explicit = sprintWindow(metas, 2, 3, anchor);
  expect(explicit).toEqual({ number: 3, name: "", startDate: "2026-05-01", endDate: "2026-05-14", scope: "", closedAt: null, completedSummary: "", explicitDates: true });
  const stillDefault2 = sprintWindow(metas, 2, 2, anchor);
  expect(stillDefault2.startDate).toBe("2026-03-16"); expect(stillDefault2.endDate).toBe("2026-03-29");
  const stillDefault4 = sprintWindow(metas, 2, 4, anchor);
  expect(stillDefault4.startDate).toBe("2026-04-13"); expect(stillDefault4.endDate).toBe("2026-04-26");
});

// --- The anchor itself: stable (a pure function of data, never of "today" once a card has ever
// carried a sprint number), plausible (the Monday on or before the earliest such createdAt).
test("sprintAnchorDate: the Monday on or before the earliest createdAt among cards that have ever carried a sprint number", () => {
  const { w, p } = fixture(); // "Register bank" card created just now, no sprint yet
  const early = createCard(w, w.columns[0]!.id, "Early card", "bottom");
  w.cards.find(c => c.id === early.id)!.createdAt = "2026-01-07T09:00:00.000Z"; // a Wednesday
  editCard(w, early.id, { sprint: 1 });
  const later = createCard(w, w.columns[0]!.id, "Later card", "bottom");
  w.cards.find(c => c.id === later.id)!.createdAt = "2026-02-01T09:00:00.000Z";
  editCard(w, later.id, { sprint: 1 });
  expect(sprintAnchorDate(w, p.id, new Date(2026, 9, 6))).toBe("2026-01-05"); // Monday of early's week
});

test("sprintAnchorDate is stable: it does not move when a card is reassigned away from every sprint, or closed out", () => {
  const { w, p } = fixture();
  const card = createCard(w, w.columns[0]!.id, "Card", "bottom");
  w.cards.find(c => c.id === card.id)!.createdAt = "2026-01-07T09:00:00.000Z";
  editCard(w, card.id, { sprint: 1 });
  const anchorBefore = sprintAnchorDate(w, p.id, new Date(2026, 9, 6));
  editCard(w, card.id, { sprint: undefined }); // reassigned away from every sprint
  expect(sprintAnchorDate(w, p.id, new Date(2026, 9, 6))).toBe(anchorBefore); // history still counts
});

test("sprintAnchorDate falls back to the Monday of today's week only when no card has ever carried a sprint number", () => {
  const { w, p } = fixture(); // no card ever assigned a sprint
  expect(sprintAnchorDate(w, p.id, new Date(2026, 9, 6))).toBe("2026-10-05"); // Tuesday 10/6 -> Monday 10/5
  expect(sprintAnchorDate(w, p.id, new Date(2026, 9, 11))).toBe("2026-10-05"); // Sunday 10/11 -> same week's Monday
});

test("setSprintMeta persists name, dates and scope per sprint number, validated and sorted", () => {
  const { w, p } = fixture();
  setSprintMeta(w, p.id, 2, { name: "Bring-up", startDate: "2026-01-05", endDate: "2026-01-18", scope: "Get the board talking" });
  setSprintMeta(w, p.id, 1, { name: "Kickoff" });
  expect(p.sprints!.map(s => s.number)).toEqual([1, 2]);
  expect(p.sprints!.find(s => s.number === 2)).toMatchObject({ name: "Bring-up", startDate: "2026-01-05", endDate: "2026-01-18", scope: "Get the board talking" });
  expect(() => setSprintMeta(w, p.id, 2, { startDate: "2026-02-01" })).toThrow(); // now after stored endDate
  expect(() => setSprintMeta(w, p.id, 0, { name: "x" })).toThrow();
  validateWorkspace(w);
});

// --- Close-out: unfinished cards move to the next sprint (created if needed), the sprint is closed
// with what was completed, and the whole change is one undoable step.
test("closeSprint moves only unfinished cards to the next sprint, creates it if needed, and marks the closed sprint", () => {
  const { w, p } = fixture();
  const done = createCard(w, w.columns[0]!.id, "Shipped", "bottom");
  editCard(w, done.id, { sprint: 1 });
  const doneColumn = w.columns.find(c => c.boardId === w.columns[0]!.boardId && c.done)!;
  moveCard(w, done.id, doneColumn.id, 0);
  const open1 = createCard(w, w.columns[0]!.id, "Still open", "bottom");
  editCard(w, open1.id, { sprint: 1 });
  const estimatedOpen = createCard(w, w.columns[0]!.id, "Estimated, still open", "bottom");
  editCard(w, estimatedOpen.id, { effort: { ...defaultEffort("csr"), sprint: 1 } });

  const result = closeSprint(w, p.id, 1, "Shipped the register bank.");
  expect(result).toEqual({ moved: 2, completed: 1 });

  expect(cardSprintNumber(w.cards.find(c => c.id === done.id)!)).toBe(1);
  expect(cardSprintNumber(w.cards.find(c => c.id === open1.id)!)).toBe(2);
  expect(cardSprintNumber(w.cards.find(c => c.id === estimatedOpen.id)!)).toBe(2);

  const sprint1 = p.sprints!.find(s => s.number === 1)!;
  expect(sprint1.closedAt).not.toBeNull();
  expect(sprint1.completedSummary).toBe("Shipped the register bank.");
  expect(p.sprints!.some(s => s.number === 2)).toBe(true); // created even though nothing had touched it yet

  expect(() => closeSprint(w, p.id, 1, "again")).toThrow();
  validateWorkspace(w);
});

test("closing a sprint with nothing unfinished still closes it and still creates the next sprint", () => {
  const { w, p } = fixture();
  const card = createCard(w, w.columns[0]!.id, "Already shipped", "bottom");
  editCard(w, card.id, { sprint: 5 });
  const doneColumn = w.columns.find(c => c.boardId === w.columns[0]!.boardId && c.done)!;
  moveCard(w, card.id, doneColumn.id, 0);
  const result = closeSprint(w, p.id, 5, "Nothing left over.");
  expect(result).toEqual({ moved: 0, completed: 1 });
  expect(p.sprints!.some(s => s.number === 6)).toBe(true);
  expect(cardSprintNumber(w.cards.find(c => c.id === card.id)!)).toBe(5); // a completed card is not moved
});

test("closing a sprint is one undoable change covering both the moved cards and the sprint's own closed state", () => {
  const { w, p } = fixture();
  const open = createCard(w, w.columns[0]!.id, "Open card", "bottom");
  editCard(w, open.id, { sprint: 7 });
  const before = structuredClone(w);
  closeSprint(w, p.id, 7, "Done for now.");
  expect(cardSprintNumber(w.cards.find(c => c.id === open.id)!)).toBe(8);
  expect(p.sprints!.find(s => s.number === 7)!.closedAt).not.toBeNull();
  undoWorkspace(w, before);
  expect(cardSprintNumber(w.cards.find(c => c.id === open.id)!)).toBe(7);
  const restoredProject = w.projects.find(x => x.id === p.id)!;
  expect(restoredProject.sprints ?? []).toEqual([]);
});

// --- Burnup, generalised from the milestone engine rather than copied.
function baseCard(overrides: Partial<Card> & { id: string; createdAt: string; columnId: string }): Card {
  return {
    position: 0, title: "Card", description: "", priority: "none", dueDate: null, estimate: null,
    labels: [], assignees: [], subtasks: [], comments: [], attachments: [], links: [],
    updatedAt: overrides.createdAt, completedAt: null, archived: false, ...overrides,
  };
}
function activity(cardId: string, action: string, before: Card | null, after: Card | null, timestamp: string): Activity {
  return { id: crypto.randomUUID(), cardId, actor: "me", action, before, after, timestamp };
}
const T = (day: number): string => new Date(2026, 3, day, 12).toISOString();
const D = (day: number): string => new Date(2026, 3, day).toLocaleDateString("en-CA");

test("sprintBurnup: the x-axis is the sprint's own window, not the data's -- it starts at startDate even when the first card joins later, and card history before start counts as the state at the start", () => {
  const { w, p } = fixture();
  const column = w.columns.find(c => c.boardId === w.columns[0]!.boardId)!.id;
  // The card was already carrying sprint 9 two days before the sprint's own declared start (4/1) --
  // that earlier assignment must count as the day-one state, not be invisible or reset to zero.
  const created = baseCard({ id: "a", createdAt: T(1) /* 4/1 */, columnId: column });
  const assigned = { ...created, sprint: 9 }; // happens 3/30, before the window
  w.activities = [
    activity("a", "create", null, created, new Date(2026, 2, 30, 12).toISOString()),
    activity("a", "edit", created, assigned, new Date(2026, 2, 30, 13).toISOString()),
  ];
  w.cards = [assigned];
  const series = sprintBurnup(w, p.id, 9, "2026-04-01", "2026-04-14", true, new Date(2026, 3, 20));
  expect(series.map(pt => pt.date)).toEqual(Array.from({ length: 14 }, (_, i) => D(i + 1)));
  expect(series.every(pt => pt.scope === 1)).toBe(true); // already in scope from day one of the window
});

test("sprintBurnup is scoped to the right project even when a sprint of the same number exists elsewhere", () => {
  const { w, p } = fixture();
  const column = w.columns.find(c => c.boardId === w.columns[0]!.boardId)!.id;
  const otherProject = createProject(w, "Other");
  const otherColumn = w.columns.find(c => c.boardId === w.boards.find(b => b.projectId === otherProject.id)!.id)!;
  const created = baseCard({ id: "a", createdAt: T(1), columnId: column, sprint: 9 });
  w.activities = [activity("a", "create", null, created, T(1))];
  w.cards = [created];
  const otherCard = baseCard({ id: "b", createdAt: T(1), columnId: otherColumn.id, sprint: 9 });
  w.cards.push(otherCard); w.activities.push(activity("b", "create", null, otherCard, T(1)));
  const series = sprintBurnup(w, p.id, 9, "2026-04-01", "2026-04-07", false, new Date(2026, 3, 7));
  expect(series.every(pt => pt.scope === 1)).toBe(true); // not 2 -- the other project's card never counts
});

test("sprintBurnup: a closed sprint's window ends at its own end date even when today is much later", () => {
  const { w, p } = fixture();
  const column = w.columns[0]!.id;
  const card = baseCard({ id: "a", createdAt: T(1), columnId: column, sprint: 9 });
  w.cards = [card]; w.activities = [activity("a", "create", null, card, T(1))];
  const series = sprintBurnup(w, p.id, 9, "2026-04-01", "2026-04-07", true, new Date(2026, 9, 6));
  expect(series.map(pt => pt.date)).toEqual(Array.from({ length: 7 }, (_, i) => D(i + 1)));
  expect(series.at(-1)!.date).toBe(D(7)); // not extended to October
});

test("sprintBurnup: an open sprint extends past its end date to today once it has overrun", () => {
  const { w, p } = fixture();
  const column = w.columns[0]!.id;
  const card = baseCard({ id: "a", createdAt: T(1), columnId: column, sprint: 9 });
  w.cards = [card]; w.activities = [activity("a", "create", null, card, T(1))];
  const series = sprintBurnup(w, p.id, 9, "2026-04-01", "2026-04-07", false, new Date(2026, 3, 10));
  expect(series.map(pt => pt.date)).toEqual(Array.from({ length: 10 }, (_, i) => D(i + 1))); // through 4/10
});

test("sprintBurnup: an open sprint not yet at its end date still draws the full window, not cut short at today", () => {
  const { w, p } = fixture();
  const column = w.columns[0]!.id;
  const card = baseCard({ id: "a", createdAt: T(1), columnId: column, sprint: 9 });
  w.cards = [card]; w.activities = [activity("a", "create", null, card, T(1))];
  const series = sprintBurnup(w, p.id, 9, "2026-04-01", "2026-04-14", false, new Date(2026, 3, 5)); // today is day 5 of 14
  expect(series.length).toBe(14);
});

test("sprintBurnup: a single-day window still returns one point", () => {
  const { w, p } = fixture();
  const column = w.columns[0]!.id;
  const card = baseCard({ id: "a", createdAt: T(1), columnId: column, sprint: 9 });
  w.cards = [card]; w.activities = [activity("a", "create", null, card, T(1))];
  const series = sprintBurnup(w, p.id, 9, "2026-04-01", "2026-04-01", true, new Date(2026, 3, 1));
  expect(series).toEqual([{ date: D(1), scope: 1, done: 0 }]);
});

test("sprintBurnup's final point agrees with the live cards currently on that sprint", () => {
  const { w, p } = fixture();
  const column = w.columns[0]!.id; const doneColumn = w.columns.find(c => c.boardId === w.columns[0]!.boardId && c.done)!.id;
  const a = createCard(w, column, "A", "bottom"); editCard(w, a.id, { sprint: 11 });
  const b = createCard(w, doneColumn, "B", "bottom"); editCard(w, b.id, { sprint: 11 });
  const today = new Date(Date.now() + 5000);
  const window = sprintAnchorDate(w, p.id, today);
  const series = sprintBurnup(w, p.id, 11, window, window, false, today);
  const last = series.at(-1)!;
  expect(last.scope).toBe(2);
  expect(last.done).toBe(1);
});
