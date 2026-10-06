import { expect, test } from "bun:test";
import { createWorkspace, createProject, addColumn, deleteColumn, updateColumn, moveCardToBoard, addBoard, createCard, moveCard, editCard, archiveCard, deleteCard, undoWorkspace, type Activity, type Card, type Workspace } from "../src/model";
import { cfdSeries, cfdBands, sliceCfdRange } from "../src/cfd";
import { cardTimes, percentile, summarizeDistribution, boardCycleStats, firstColumnId } from "../src/cycletime";
import { weeklyThroughput } from "../src/throughput";

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

// ---------- R34: cumulative flow diagram ----------

function freshBoard() {
  const w = createWorkspace();
  const p = createProject(w, "P");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const cols = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  return { w, board, cols };
}

test("cfd: a board with no cards ever on it returns an empty series", () => {
  const { w, board } = freshBoard();
  expect(cfdSeries(w, board.id, new Date(2026, 0, 10))).toEqual([]);
});

test("cfd: a card's daily state is read off its latest Activity entry at or before day end", () => {
  const { w, board, cols } = freshBoard();
  const created = baseCard({ id: "a", createdAt: T(1), columnId: cols[0]!.id });
  const moved = { ...created, columnId: cols[1]!.id };
  w.activities = [activity("a", "create", null, created, T(1)), activity("a", "move", created, moved, T(3))];
  const series = cfdSeries(w, board.id, new Date(2026, 0, 4));
  const byDate = new Map(series.map(p => [p.date, p]));
  expect(byDate.get(D(1))!.byColumn[cols[0]!.id]).toBe(1);
  expect(byDate.get(D(2))!.byColumn[cols[0]!.id]).toBe(1);
  expect(byDate.get(D(3))!.byColumn[cols[1]!.id]).toBe(1);
  expect(byDate.get(D(3))!.byColumn[cols[0]!.id]).toBeUndefined();
  expect(byDate.get(D(4))!.byColumn[cols[1]!.id]).toBe(1);
});

test("cfd: pre-log state (first entry already has a before) is dated from createdAt, never earlier", () => {
  const { w, board, cols } = freshBoard();
  const before = baseCard({ id: "b", createdAt: T(1), columnId: cols[0]!.id });
  const after = { ...before, columnId: cols[1]!.id };
  w.activities = [activity("b", "move", before, after, T(5))];
  const series = cfdSeries(w, board.id, new Date(2026, 0, 6));
  expect(series[0]!.date).toBe(D(1)); // not 1970, not any earlier than createdAt
  expect(series.find(p => p.date === D(1))!.byColumn[cols[0]!.id]).toBe(1);
});

test("cfd: an entry stamped before the card's create entry (clock skew) never stretches the series wildly", () => {
  const { w, board, cols } = freshBoard();
  const created = baseCard({ id: "c", createdAt: T(6), columnId: cols[0]!.id });
  const moved = { ...created, columnId: cols[1]!.id };
  w.cards = [structuredClone(moved)];
  // A skewed follow-up entry claims to have happened before the card's own create entry.
  w.activities = [activity("c", "create", null, created, T(6)), activity("c", "move", created, moved, T(3))];
  const series = cfdSeries(w, board.id, new Date(2026, 0, 7));
  expect(series[0]!.date >= D(3)).toBe(true); // not 1970, not unboundedly early
  expect(series.length).toBeLessThanOrEqual(5);
});

test("cfd: a deleted column's cards fall into the Removed columns band for the days they sat there", () => {
  const { w, board, cols } = freshBoard();
  const extra = addColumn(w, board.id, "Extra");
  const created = baseCard({ id: "d", createdAt: T(1), columnId: extra.id });
  const movedOut = { ...created, columnId: cols[0]!.id };
  w.cards = [movedOut];
  w.activities = [activity("d", "create", null, created, T(1)), activity("d", "move", created, movedOut, T(3))];
  deleteColumn(w, extra.id); // card already moved out, column now empty and deletable
  const series = cfdSeries(w, board.id, new Date(2026, 0, 4));
  const day2 = series.find(p => p.date === D(2))!;
  expect(day2.removed).toBe(1);
  const day4 = series.find(p => p.date === D(4))!;
  expect(day4.removed).toBe(0);
  expect(day4.byColumn[cols[0]!.id]).toBe(1);
});

test("cfd: a card moved to another board stops counting here from the move day, and never counts there before it", () => {
  const { w, board, cols } = freshBoard();
  const otherBoard = addBoard(w, w.projects[0]!.id, "Other");
  const otherCols = w.columns.filter(c => c.boardId === otherBoard.id).sort((a, b) => a.position - b.position);
  const created = baseCard({ id: "e", createdAt: T(1), columnId: cols[0]!.id });
  w.cards = [structuredClone(created)];
  w.activities = [activity("e", "create", null, created, T(1))];
  moveCardToBoard(w, "e", otherBoard.id); // happens "now" in the fixture's terms; use a later day to read it

  // Re-stamp the move's own audit entry to day 3 so the series has distinguishable before/after days.
  const moveEntry = w.activities.find(a => a.action === "move")!; moveEntry.timestamp = T(3);
  const card = w.cards.find(c => c.id === "e")!; card.updatedAt = T(3);

  const seriesHere = cfdSeries(w, board.id, new Date(2026, 0, 5));
  const seriesThere = cfdSeries(w, otherBoard.id, new Date(2026, 0, 5));
  expect(seriesHere.find(p => p.date === D(1))!.byColumn[cols[0]!.id]).toBe(1);
  expect(seriesHere.find(p => p.date === D(4))!.byColumn[cols[0]!.id]).toBeUndefined();
  expect(seriesHere.find(p => p.date === D(4))!.removed).toBe(0); // moved, not removed
  expect(seriesThere.find(p => p.date === D(1))).toBeUndefined(); // not on the other board yet
  expect(seriesThere.find(p => p.date === D(4))!.byColumn[otherCols[0]!.id]).toBe(1);
});

test("cfd: undo restores the prior column by appending a new entry, replaying as a normal state change", () => {
  const { w, board, cols } = freshBoard();
  const created = baseCard({ id: "f", createdAt: T(1), columnId: cols[0]!.id });
  w.cards = [structuredClone(created)];
  w.activities = [activity("f", "create", null, created, T(1))];
  const before = structuredClone(w);
  moveCard(w, "f", cols[1]!.id, 0);
  w.activities.at(-1)!.timestamp = T(3);
  const afterMoveState = structuredClone(w);
  undoWorkspace(w, before);
  w.activities.at(-1)!.timestamp = T(5);

  const series = cfdSeries(w, board.id, new Date(2026, 0, 6));
  expect(series.find(p => p.date === D(2))!.byColumn[cols[0]!.id]).toBe(1);
  expect(series.find(p => p.date === D(4))!.byColumn[cols[1]!.id]).toBe(1);
  expect(series.find(p => p.date === D(6))!.byColumn[cols[0]!.id]).toBe(1);
  void afterMoveState;
});

test("cfd: the last day equals the live, non-deleted per-column counts (archived included)", () => {
  const { w, board, cols } = freshBoard();
  createCard(w, cols[0]!.id, "One", "bottom");
  const two = createCard(w, cols[0]!.id, "Two", "bottom");
  archiveCard(w, two.id, true);
  const three = createCard(w, cols[0]!.id, "Three", "bottom");
  moveCard(w, three.id, cols[1]!.id, 0);
  const toDelete = createCard(w, cols[0]!.id, "Gone", "bottom");
  deleteCard(w, toDelete.id);

  const series = cfdSeries(w, board.id, new Date());
  const last = series.at(-1)!;
  expect(last.byColumn[cols[0]!.id]).toBe(2); // One + archived Two
  expect(last.byColumn[cols[1]!.id]).toBe(1); // Three
  expect(Object.values(last.byColumn).reduce((a, b) => a + b, 0) + last.removed).toBe(3);
});

test("cfd: band order puts done columns at the bottom, Removed columns at the very bottom", () => {
  const { w, board, cols } = freshBoard();
  const bands = cfdBands(w.columns.filter(c => c.boardId === board.id));
  expect(bands[0]!.key).toBe("removed");
  const doneIndex = bands.findIndex(b => b.columnId === cols.at(-1)!.id); // default last column is done
  expect(doneIndex).toBeGreaterThan(0);
  expect(doneIndex).toBeLessThan(bands.length - 1);
});

test("cfd: sliceCfdRange keeps only the trailing N days, and 'all' (null) keeps everything", () => {
  const points = Array.from({ length: 40 }, (_, i) => ({ date: D(i + 1), byColumn: {}, removed: 0 }));
  expect(sliceCfdRange(points, 14).length).toBe(14);
  expect(sliceCfdRange(points, 14).at(-1)).toEqual(points.at(-1));
  expect(sliceCfdRange(points, null)).toEqual(points);
  expect(sliceCfdRange(points, 90).length).toBe(40); // range longer than history keeps everything
});

// ---------- R35: lead and cycle time ----------

test("cycle time: a card created directly outside the first column starts its cycle at creation", () => {
  const { cols } = freshBoard();
  const columns = cols;
  const card = baseCard({ id: "g", createdAt: T(2), columnId: columns[2]!.id, completedAt: T(10) });
  const t = cardTimes(card, [], columns, new Date(2026, 0, 10));
  expect(t.leadDays).toBeCloseTo(8, 5);
  expect(t.cycleDays).toBeCloseTo(8, 5); // same instant: never left the first column, falls back to createdAt
});

test("cycle time: a card that left the first column starts its cycle at the first exit, not creation", () => {
  const { cols } = freshBoard();
  const created = baseCard({ id: "h", createdAt: T(1), columnId: cols[0]!.id });
  const moved = { ...created, columnId: cols[2]!.id }; // skipped a column
  const done = { ...moved, columnId: cols.at(-1)!.id, completedAt: T(9) };
  const activities: Activity[] = [
    activity("h", "create", null, created, T(1)),
    activity("h", "move", created, moved, T(3)),
    activity("h", "move", moved, done, T(9)),
  ];
  const card = { ...done };
  const t = cardTimes(card, activities, cols, new Date(2026, 0, 9));
  expect(t.leadDays).toBeCloseTo(8, 5); // T(9)-T(1)
  expect(t.cycleDays).toBeCloseTo(6, 5); // T(9)-T(3), the first exit from the first column
});

test("cycle time: a reopened-then-recompleted card uses the latest completion (its current completedAt)", () => {
  const { cols } = freshBoard();
  const created = baseCard({ id: "i", createdAt: T(1), columnId: cols[0]!.id });
  const left = { ...created, columnId: cols[1]!.id };
  const completedOnce = { ...left, columnId: cols.at(-1)!.id, completedAt: T(5) };
  const reopened = { ...completedOnce, columnId: cols[1]!.id, completedAt: null };
  const completedAgain = { ...reopened, columnId: cols.at(-1)!.id, completedAt: T(9) };
  const activities: Activity[] = [
    activity("i", "create", null, created, T(1)),
    activity("i", "move", created, left, T(2)),
    activity("i", "move", left, completedOnce, T(5)),
    activity("i", "move", completedOnce, reopened, T(6)),
    activity("i", "move", reopened, completedAgain, T(9)),
  ];
  const t = cardTimes(completedAgain, activities, cols, new Date(2026, 0, 9));
  expect(t.leadDays).toBeCloseTo(8, 5); // T(9) - T(1)
  expect(t.cycleDays).toBeCloseTo(7, 5); // T(9) - T(2), the FIRST exit from the first column
});

test("cycle time: a card with no history at all falls back to createdAt/completedAt", () => {
  const { cols } = freshBoard();
  const card = baseCard({ id: "j", createdAt: T(1), columnId: cols.at(-1)!.id, completedAt: T(6) });
  const t = cardTimes(card, [], cols, new Date(2026, 0, 6));
  expect(t.leadDays).toBeCloseTo(5, 5);
  expect(t.cycleDays).toBeCloseTo(5, 5);
});

test("cycle time: an open card reports inProgressDays instead of lead/cycle", () => {
  const { cols } = freshBoard();
  const card = baseCard({ id: "k", createdAt: T(1), columnId: cols[0]!.id });
  const t = cardTimes(card, [], cols, new Date(2026, 0, 4));
  expect(t.leadDays).toBeNull(); expect(t.cycleDays).toBeNull();
  expect(t.inProgressDays).toBeCloseTo(2.5, 5); // Jan 1 12:00 -> Jan 4 00:00
});

test("percentile: known set [1..10] gives the standard interpolated median and 85th percentile", () => {
  const sorted = Array.from({ length: 10 }, (_, i) => i + 1);
  expect(percentile(sorted, 50)).toBeCloseTo(5.5, 5);
  expect(percentile(sorted, 85)).toBeCloseTo(8.65, 5);
});

test("summarizeDistribution: empty input reports zero count and null stats, not a crash", () => {
  expect(summarizeDistribution([])).toEqual({ count: 0, medianDays: null, p85Days: null, samples: [] });
});

test("firstColumnId: picks the column with the lowest current position", () => {
  const { cols } = freshBoard();
  const shuffled = cols.slice().reverse();
  expect(firstColumnId(shuffled)).toBe(cols[0]!.id);
});

test("boardCycleStats: only cards completed within the selected range contribute, by current completedAt", () => {
  const { cols } = freshBoard();
  const inRange = baseCard({ id: "m", createdAt: T(1), columnId: cols.at(-1)!.id, completedAt: T(9) });
  const outOfRange = baseCard({ id: "n", createdAt: T(1), columnId: cols.at(-1)!.id, completedAt: T(1) });
  const stats = boardCycleStats([inRange, outOfRange], new Map(), cols, 5, new Date(2026, 0, 10));
  expect(stats.lead.count).toBe(1);
  expect(stats.lead.medianDays).toBeCloseTo(8, 5);
});

// ---------- R36: throughput ----------

test("throughput: only the current completedAt counts, grouped into Monday-start local weeks", () => {
  const today = new Date(2026, 0, 14); // Wednesday
  const a = baseCard({ id: "o", createdAt: T(1), columnId: "done", completedAt: T(12) }); // Monday Jan 12
  const b = baseCard({ id: "p", createdAt: T(1), columnId: "done", completedAt: T(13) }); // Tuesday Jan 13, same week
  const weeks = weeklyThroughput([a, b], 12, today);
  expect(weeks).toHaveLength(12);
  expect(weeks.at(-1)!.weekStart).toBe(new Date(2026, 0, 12).toLocaleDateString("en-CA"));
  expect(weeks.at(-1)!.count).toBe(2);
  expect(weeks.at(-2)!.count).toBe(0);
});

test("throughput: a card whose completion was undone (completedAt cleared) does not count", () => {
  const today = new Date(2026, 0, 14);
  const card = baseCard({ id: "q", createdAt: T(1), columnId: "backlog", completedAt: null });
  const weeks = weeklyThroughput([card], 12, today);
  expect(weeks.reduce((sum, w) => sum + w.count, 0)).toBe(0);
});

test("throughput: a completion exactly 12 weeks ago still counts; 13 weeks ago falls outside the window", () => {
  const today = new Date(2026, 5, 15); // Monday
  const twelveWeeksAgo = new Date(today); twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 7 * 11);
  const thirteenWeeksAgo = new Date(today); thirteenWeeksAgo.setDate(thirteenWeeksAgo.getDate() - 7 * 12);
  const inWindow = baseCard({ id: "r", createdAt: T(1), columnId: "done", completedAt: twelveWeeksAgo.toISOString() });
  const outsideWindow = baseCard({ id: "s", createdAt: T(1), columnId: "done", completedAt: thirteenWeeksAgo.toISOString() });
  const weeks = weeklyThroughput([inWindow, outsideWindow], 12, today);
  expect(weeks[0]!.count).toBe(1);
  expect(weeks.reduce((sum, w) => sum + w.count, 0)).toBe(1);
});
