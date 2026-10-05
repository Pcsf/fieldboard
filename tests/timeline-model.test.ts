import { describe, expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, editCard, addColumn, moveCard, type Card } from "../src/model";
import { layoutTimeline, axisTicks } from "../src/timeline-view";

function fixture() {
  const w = createWorkspace();
  const p = createProject(w, "Release");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const columns = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  return { w, p, columns, first: columns[0]!, second: columns[1]! };
}
function scheduled(w: ReturnType<typeof createWorkspace>, colId: string, title: string, start: string, due: string): Card {
  const c = createCard(w, colId, title, "bottom"); editCard(w, c.id, { startDate: start, dueDate: due }); return w.cards.find(x => x.id === c.id)!;
}
const today = new Date(2026, 2, 9); // 2026-03-09, a Monday

test("bars: start offset and span are measured in whole days on a Monday-aligned scale", () => {
  const { w, first } = fixture();
  scheduled(w, first.id, "A", "2026-03-09", "2026-03-11"); // 3-day bar starting on range's Monday
  const layout = layoutTimeline(w.cards, "column", w.columns, today);
  expect(layout.rangeStart).toBe("2026-03-09");
  const bar = layout.groups[0]!.bars[0]!;
  expect(bar.startOffset).toBe(0); expect(bar.span).toBe(3);
});

test("row order: bars within a group sort by start date, then title", () => {
  const { w, first } = fixture();
  scheduled(w, first.id, "Later", "2026-03-11", "2026-03-12");
  scheduled(w, first.id, "Earlier", "2026-03-09", "2026-03-09");
  const layout = layoutTimeline(w.cards, "column", w.columns, today);
  expect(layout.groups[0]!.bars.map(b => b.title)).toEqual(["Earlier", "Later"]);
  expect(layout.groups[0]!.bars.map(b => b.row)).toEqual([0, 1]);
});

test("grouping by column puts each column's scheduled cards in its own group, ordered by column position", () => {
  const { w, first, second } = fixture();
  scheduled(w, second.id, "In second", "2026-03-09", "2026-03-09");
  scheduled(w, first.id, "In first", "2026-03-09", "2026-03-09");
  const layout = layoutTimeline(w.cards, "column", w.columns, today);
  expect(layout.groups.map(g => g.label)).toEqual([first.name, second.name]);
});

test("grouping by epic separates a parent's children from unparented cards, 'No epic' last", () => {
  const { w, first } = fixture();
  const parent = scheduled(w, first.id, "Epic", "2026-03-09", "2026-03-09");
  const child = createCard(w, first.id, "Child", "bottom");
  editCard(w, child.id, { startDate: "2026-03-10", dueDate: "2026-03-10", parentId: parent.id });
  scheduled(w, first.id, "Loose", "2026-03-09", "2026-03-09");
  const layout = layoutTimeline(w.cards, "epic", w.columns, today);
  expect(layout.groups.map(g => g.label)).toEqual(["Epic", "No epic"]);
  expect(layout.groups[0]!.bars.map(b => b.title)).toEqual(["Epic", "Child"]);
});

test("cards with only one date, or neither, are listed as not scheduled rather than guessing the other", () => {
  const { w, first } = fixture();
  const onlyStart = createCard(w, first.id, "Only start", "bottom"); editCard(w, onlyStart.id, { startDate: "2026-03-09" });
  const onlyDue = createCard(w, first.id, "Only due", "bottom"); editCard(w, onlyDue.id, { dueDate: "2026-03-09" });
  createCard(w, first.id, "Neither", "bottom");
  const layout = layoutTimeline(w.cards, "column", w.columns, today);
  expect(layout.groups).toEqual([]);
  expect(layout.notScheduled.map(c => c.title).sort()).toEqual(["Neither", "Only due", "Only start"]);
});

test("arrow endpoints run from a blocker's bar end to the dependent's bar start, and flag the conflicting case", () => {
  const { w, first } = fixture();
  const blocker = scheduled(w, first.id, "Blocker", "2026-03-09", "2026-03-10"); // ends at offset 2 (exclusive)
  const onTime = createCard(w, first.id, "On time", "bottom");
  editCard(w, onTime.id, { startDate: "2026-03-11", dueDate: "2026-03-12", blockedBy: [blocker.id] });
  const early = createCard(w, first.id, "Starts early", "bottom");
  editCard(w, early.id, { startDate: "2026-03-09", dueDate: "2026-03-10", blockedBy: [blocker.id] });
  const layout = layoutTimeline(w.cards, "column", w.columns, today);
  expect(layout.arrows).toHaveLength(2);
  const toOnTime = layout.arrows.find(a => a.toCardId === onTime.id)!;
  expect(toOnTime.fromOffset).toBe(2); expect(toOnTime.toOffset).toBe(2); expect(toOnTime.conflict).toBe(false);
  const toEarly = layout.arrows.find(a => a.toCardId === early.id)!;
  expect(toEarly.conflict).toBe(true);
});

test("a blocker reference to a card without both dates draws no arrow", () => {
  const { w, first } = fixture();
  const unscheduledBlocker = createCard(w, first.id, "No dates", "bottom");
  const dependent = scheduled(w, first.id, "Dependent", "2026-03-09", "2026-03-10");
  editCard(w, dependent.id, { blockedBy: [unscheduledBlocker.id] });
  const layout = layoutTimeline(w.cards, "column", w.columns, today);
  expect(layout.arrows).toEqual([]);
});

test("today's offset is reported, and the range covers today even when no card is scheduled near it", () => {
  const { w, first } = fixture();
  scheduled(w, first.id, "Far future", "2026-06-01", "2026-06-02");
  const layout = layoutTimeline(w.cards, "column", w.columns, today);
  expect(layout.todayOffset).toBe(0);
  expect(layout.rangeStart).toBe("2026-03-09");
});

test("an empty scheduled set still reports a 7-day range anchored on today's week", () => {
  const { w } = fixture();
  const layout = layoutTimeline(w.cards, "column", w.columns, today);
  expect(layout.days).toBe(7); expect(layout.groups).toEqual([]); expect(layout.todayOffset).toBe(0);
});

test("moving a card to a different column reassigns its timeline group under 'column' grouping", () => {
  const { w, first, second } = fixture();
  const c = scheduled(w, first.id, "Movable", "2026-03-09", "2026-03-09");
  moveCard(w, c.id, second.id, 0);
  const layout = layoutTimeline(w.cards, "column", w.columns, today);
  expect(layout.groups.map(g => g.label)).toEqual([second.name]);
});

describe("axisTicks", () => {
  test("every week boundary gets a full weekday+day+month label, regardless of density", () => {
    const ticks = axisTicks("2026-03-09", 14, "en-US"); // a 2-week range starting on a Monday
    const weekTicks = ticks.filter(t => t.week);
    expect(weekTicks.map(t => t.offset)).toEqual([0, 7]);
    for (const t of weekTicks) { expect(t.label).toMatch(/Mon/); expect(t.label).toMatch(/Mar/); }
  });
  test("a short range labels every day", () => {
    const ticks = axisTicks("2026-03-09", 10, "en-US");
    expect(ticks.map(t => t.offset)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  test("a dense range thins day ticks but never drops a week boundary", () => {
    const ticks = axisTicks("2026-01-05", 84, "en-US"); // 12 weeks
    expect(ticks.filter(t => t.week)).toHaveLength(12);
    expect(ticks.length).toBeLessThan(84); // thinned, not one per day
  });
});
