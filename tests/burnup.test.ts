import { expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, editCard, archiveCard, addMilestone, type Activity, type Card, type Workspace } from "../src/model";
import { defaultEffort, type Effort } from "../src/planning";
import { summarizeMilestones } from "../src/milestones";
import { milestoneBurnup, burnupAxisTicks } from "../src/burnup";

const MS = "m1";
const T = (day: number, hour = 12): string => new Date(2026, 0, day, hour).toISOString();
const D = (day: number): string => new Date(2026, 0, day).toLocaleDateString("en-CA");

function baseCard(overrides: Partial<Card> & { id: string; createdAt: string }): Card {
  return {
    columnId: "col", position: 0, title: "Card", description: "", priority: "none", dueDate: null, estimate: null,
    labels: [], assignees: [], subtasks: [], comments: [], attachments: [], links: [],
    updatedAt: overrides.createdAt, completedAt: null, archived: false, ...overrides,
  };
}
function activity(cardId: string, action: string, before: Card | null, after: Card | null, timestamp: string): Activity {
  return { id: crypto.randomUUID(), cardId, actor: "me", action, before, after, timestamp };
}
function emptyWorkspace(): Workspace { const w = createWorkspace(); w.cards = []; w.activities = []; return w; }

test("burnup: a milestone with no cards ever assigned returns an empty series, no crash", () => {
  const w = emptyWorkspace();
  expect(milestoneBurnup(w, MS, new Date(2026, 0, 10))).toEqual([]);
});

test("burnup: assign then unassign — scope enters on the assign day and leaves on the unassign day, not creation day", () => {
  const w = emptyWorkspace();
  const created = baseCard({ id: "a", createdAt: T(1) });
  const assigned = { ...created, milestoneId: MS };
  const unassigned = { ...assigned, milestoneId: undefined };
  w.activities = [
    activity("a", "create", null, created, T(1)),
    activity("a", "edit", created, assigned, T(3)),
    activity("a", "edit", assigned, unassigned, T(5)),
  ];
  const series = milestoneBurnup(w, MS, new Date(2026, 0, 7));
  expect(series.map(p => p.date)).toEqual([D(3), D(4), D(5), D(6), D(7)]);
  expect(series.map(p => p.scope)).toEqual([1, 1, 0, 0, 0]);
  expect(series.every(p => p.done === 0)).toBe(true);
});

test("burnup: an archived card stays in scope — archived does not drop it", () => {
  const w = emptyWorkspace();
  const created = baseCard({ id: "b", createdAt: T(2), milestoneId: MS });
  const archived = { ...created, archived: true };
  w.activities = [
    activity("b", "create", null, created, T(2)),
    activity("b", "archive", created, archived, T(4)),
  ];
  const series = milestoneBurnup(w, MS, new Date(2026, 0, 5));
  expect(series.map(p => p.scope)).toEqual([1, 1, 1, 1]); // days 2,3,4,5
  expect(series.map(p => p.date)).toEqual([D(2), D(3), D(4), D(5)]);
});

test("burnup: a deleted card leaves scope on its delete day and never counts before it existed", () => {
  const w = emptyWorkspace();
  const created = baseCard({ id: "c", createdAt: T(2), milestoneId: MS });
  w.activities = [
    activity("c", "create", null, created, T(2)),
    activity("c", "delete", created, null, T(4)),
  ];
  const series = milestoneBurnup(w, MS, new Date(2026, 0, 6));
  expect(series.map(p => p.date)).toEqual([D(2), D(3), D(4), D(5), D(6)]);
  expect(series.map(p => p.scope)).toEqual([1, 1, 0, 0, 0]);
});

test("burnup: undo reverts a completion by appending a new entry, not by rewriting history", () => {
  const w = emptyWorkspace();
  const created = baseCard({ id: "d", createdAt: T(2), milestoneId: MS });
  const completed = { ...created, completedAt: T(4) };
  w.activities = [
    activity("d", "create", null, created, T(2)),
    activity("d", "move", created, completed, T(4)),
    activity("d", "undo", completed, created, T(8)), // undo reverts the completion
  ];
  const series = milestoneBurnup(w, MS, new Date(2026, 0, 9));
  const byDate = new Map(series.map(p => [p.date, p]));
  expect(byDate.get(D(3))!.scope).toBe(1); expect(byDate.get(D(3))!.done).toBe(0);
  expect(byDate.get(D(4))!.done).toBe(1); expect(byDate.get(D(7))!.done).toBe(1); // stays done through day 7
  expect(byDate.get(D(8))!.done).toBe(0); expect(byDate.get(D(8))!.scope).toBe(1); // undone, still in scope
  expect(byDate.get(D(9))!.done).toBe(0);
});

test("burnup: a column done-flag toggle completes every card in it, same as moving a card", () => {
  const w = emptyWorkspace();
  const created = baseCard({ id: "e", createdAt: T(2), milestoneId: MS, columnId: "col-x" });
  const completed = { ...created, completedAt: T(5) };
  w.activities = [
    activity("e", "create", null, created, T(2)),
    activity("e", "column edit", created, completed, T(5)),
  ];
  const series = milestoneBurnup(w, MS, new Date(2026, 0, 6));
  const byDate = new Map(series.map(p => [p.date, p]));
  expect(byDate.get(D(4))!.done).toBe(0); expect(byDate.get(D(5))!.done).toBe(1); expect(byDate.get(D(6))!.done).toBe(1);
});

test("burnup: a card with no Activity entries uses its current fields, appearing at createdAt and completing at completedAt", () => {
  const w = emptyWorkspace();
  w.cards = [baseCard({ id: "f", createdAt: T(3), milestoneId: MS, completedAt: T(6) })];
  w.activities = [];
  const series = milestoneBurnup(w, MS, new Date(2026, 0, 7));
  expect(series.map(p => p.date)).toEqual([D(3), D(4), D(5), D(6), D(7)]);
  expect(series.map(p => p.scope)).toEqual([1, 1, 1, 1, 1]);
  expect(series.map(p => p.done)).toEqual([0, 0, 0, 1, 1]);
});

test("burnup: a card with no Activity entries and no completion stays undone through today", () => {
  const w = emptyWorkspace();
  w.cards = [baseCard({ id: "g", createdAt: T(5), milestoneId: MS, completedAt: null })];
  w.activities = [];
  const series = milestoneBurnup(w, MS, new Date(2026, 0, 6));
  expect(series.map(p => p.date)).toEqual([D(5), D(6)]);
  expect(series.every(p => p.scope === 1 && p.done === 0)).toBe(true);
});

function effort(lo: number, hi: number): Effort { const e = defaultEffort(); e.rtl = [lo, hi]; e.verification = [0, 0]; e.other = [0, 0]; return e; }

// R31: the series' last point must equal summarizeMilestones' doneCards/totalCards for the same
// milestone, across several differently-shaped fixtures (archived scope, unestimated, mixed done state).
test("burnup: today's point matches summarizeMilestones' doneCards/totalCards, across several fixtures", () => {
  const scenarios: ((w: Workspace, p: ReturnType<typeof createProject>, m: ReturnType<typeof addMilestone>, first: string, done: string) => void)[] = [
    (w, p, m, first, done) => {
      const a = createCard(w, first, "A", "bottom"); editCard(w, a.id, { milestoneId: m.id, effort: effort(1, 2) });
      const b = createCard(w, done, "B", "bottom"); editCard(w, b.id, { milestoneId: m.id });
    },
    (w, p, m, first, done) => {
      const a = createCard(w, first, "A", "bottom"); editCard(w, a.id, { milestoneId: m.id });
      archiveCard(w, a.id, true);
      const b = createCard(w, done, "B", "bottom"); editCard(w, b.id, { milestoneId: m.id });
      const c = createCard(w, done, "C", "bottom"); editCard(w, c.id, { milestoneId: m.id });
    },
    (w, p, m, first, done) => { /* no cards at all for this milestone */ },
  ];
  for (const scenario of scenarios) {
    const w = createWorkspace(); const p = createProject(w, "Release");
    const columns = w.columns.filter(c => c.boardId === w.boards.find(b => b.projectId === p.id)!.id);
    const m = addMilestone(w, p.id, "M", "2026-12-01");
    scenario(w, p, m, columns[0]!.id, columns[4]!.id);
    const today = new Date(Date.now() + 5000);
    const series = milestoneBurnup(w, m.id, today);
    const [row] = summarizeMilestones(w, p.id, today);
    if (!row || row.totalCards === 0) { expect(series).toEqual([]); continue; }
    const last = series.at(-1)!;
    expect(last.scope).toBe(row.totalCards);
    expect(last.done).toBe(row.doneCards);
  }
});

// Written alongside the width-aware axis (the reused timeline tick rule proved too dense on a
// non-scrolling, narrower chart) rather than strictly before it.
test("burnup: axis ticks cap at a fixed count regardless of the day span, and always label the last day", () => {
  const short = burnupAxisTicks("2026-01-01", 4, 5, "en-US");
  expect(short.map(t => t.offset)).toEqual([0, 1, 2, 3]);
  const long = burnupAxisTicks("2026-01-01", 90, 5, "en-US");
  expect(long.length).toBeLessThanOrEqual(6);
  expect(long.at(-1)!.offset).toBe(89);
  expect(long[0]!.offset).toBe(0);
});

test("burnup: an unaffected card's activity entries for a different milestone never produce a delta", () => {
  const w = emptyWorkspace();
  const created = baseCard({ id: "h", createdAt: T(2), milestoneId: "other-milestone" });
  w.activities = [activity("h", "create", null, created, T(2))];
  expect(milestoneBurnup(w, MS, new Date(2026, 0, 4))).toEqual([]);
});

test("burnup: a card whose history begins mid-life starts the series at its createdAt, not at the Unix epoch", () => {
  const w = emptyWorkspace();
  const preLog = baseCard({ id: "a", createdAt: T(2), milestoneId: MS });
  const done = { ...preLog, completedAt: T(4) };
  w.cards = [done];
  w.activities = [activity("a", "move", preLog, done, T(4))];
  const series = milestoneBurnup(w, MS, new Date(2026, 0, 5));
  expect(series.map(p => p.date)).toEqual([D(2), D(3), D(4), D(5)]);
  expect(series.map(p => p.done)).toEqual([0, 0, 1, 1]);
});

test("burnup: an entry stamped before the card's create entry (clock skew) never stretches the series past the card's own dates", () => {
  const w = emptyWorkspace();
  const created = baseCard({ id: "a", createdAt: T(6), milestoneId: MS });
  const shifted = { ...created, position: 1 };
  w.cards = [shifted];
  w.activities = [activity("a", "create", null, created, T(6)), activity("a", "move", created, shifted, T(3))];
  const series = milestoneBurnup(w, MS, new Date(2026, 0, 7));
  expect(series[0]!.date >= D(3)).toBe(true);
  expect(series.length).toBeLessThanOrEqual(5);
});
