import { expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, editCard, archiveCard, deleteCard, undoWorkspace, validateWorkspace, addMilestone, editMilestone, deleteMilestone, matches, encodeFilters, decodeFilters, emptyFilters, type Filters } from "../src/model";
import { defaultEffort, defaultPlanning, type Effort } from "../src/planning";
import { summarizeMilestones, daysUntil, workingDaysThrough } from "../src/milestones";

function fixture() {
  const w = createWorkspace(); const p = createProject(w, "Release");
  const columns = w.columns.filter(c => c.boardId === w.boards.find(b => b.projectId === p.id)!.id);
  return { w, p, columns, first: columns[0]!, done: columns[4]! };
}
function calcFixture() {
  const { w, p, columns } = fixture(); p.planning = defaultPlanning();
  return { w, p, todo: columns[1]!, done: columns[4]! };
}
function effort(lo: number, hi: number): Effort { const e = defaultEffort(); e.rtl = [lo, hi]; e.verification = [0, 0]; e.other = [0, 0]; return e; }

test("milestones: add, rename, re-date and delete unassigns through the normal card-mutation path; undo restores both", () => {
  const { w, p, first } = fixture();
  const m = addMilestone(w, p.id, "Beta", "2026-03-01", "Ship beta");
  const card = createCard(w, first.id, "Work", "bottom");
  editCard(w, card.id, { milestoneId: m.id });
  editMilestone(w, p.id, m.id, { name: "Beta 2", date: "2026-03-15" });
  expect(w.projects[0]!.milestones).toEqual([{ id: m.id, name: "Beta 2", date: "2026-03-15", description: "Ship beta" }]);
  const before = structuredClone(w);
  deleteMilestone(w, p.id, m.id);
  expect(w.projects[0]!.milestones).toEqual([]);
  expect(w.cards.find(c => c.id === card.id)!.milestoneId).toBeUndefined();
  expect(w.activities.at(-1)!.action).toBe("edit");
  undoWorkspace(w, before);
  expect(w.projects[0]!.milestones).toHaveLength(1);
  expect(w.cards.find(c => c.id === card.id)!.milestoneId).toBe(m.id);
  expect(validateWorkspace(w)).toEqual(w);
});

test("milestones: unknown or cross-project card references are rejected on live cards", () => {
  const { w, p, first } = fixture();
  const m = addMilestone(w, p.id, "Beta", "2026-03-01");
  const card = createCard(w, first.id, "Work", "bottom");
  editCard(w, card.id, { milestoneId: m.id });
  expect(validateWorkspace(w)).toEqual(w);
  const other = createProject(w, "Other");
  const otherMilestone = addMilestone(w, other.id, "Gamma", "2026-04-01");
  const unknown = structuredClone(w); unknown.cards[0]!.milestoneId = "nonexistent";
  expect(() => validateWorkspace(unknown)).toThrow();
  const crossLive = structuredClone(w); crossLive.cards[0]!.milestoneId = otherMilestone.id;
  expect(() => validateWorkspace(crossLive)).toThrow();
});

test("milestones: activity history only re-validates milestoneId structurally, so a later milestone delete cannot strand old history", () => {
  const { w, p, first } = fixture();
  const m = addMilestone(w, p.id, "Beta", "2026-03-01");
  const card = createCard(w, first.id, "Work", "bottom");
  editCard(w, card.id, { milestoneId: m.id });
  deleteMilestone(w, p.id, m.id);
  expect(validateWorkspace(w)).toEqual(w);
  expect(w.activities.some(a => a.before?.milestoneId === m.id)).toBe(true);
  const malformed = structuredClone(w); malformed.activities.find(a => a.before?.milestoneId === m.id)!.before!.milestoneId = 7 as unknown as string;
  expect(() => validateWorkspace(malformed)).toThrow();
});

test("milestones: invalid dates are rejected on write and on structural validation", () => {
  const { w, p } = fixture();
  expect(() => addMilestone(w, p.id, "Beta", "2026-13-40")).toThrow();
  const m = addMilestone(w, p.id, "Beta", "2026-03-01");
  expect(() => editMilestone(w, p.id, m.id, { date: "not-a-date" })).toThrow();
  const bad = structuredClone(w); bad.projects[0]!.milestones![0]!.date = "2026-02-30";
  expect(() => validateWorkspace(bad)).toThrow();
});

test("milestones: optional fields leave old workspaces byte-for-byte unchanged", () => {
  const { w, first } = fixture();
  createCard(w, first.id, "Plain", "bottom");
  const text = JSON.stringify(w);
  expect(JSON.stringify(validateWorkspace(JSON.parse(text)))).toBe(text);
  expect(w.projects[0]!.milestones).toBeUndefined();
  expect(w.cards[0]!.milestoneId).toBeUndefined();
});

test("milestones: filter matches by milestoneId and round-trips through the fragment", () => {
  const { w, p, first } = fixture();
  const m = addMilestone(w, p.id, "Beta", "2026-03-01");
  const card = createCard(w, first.id, "Work", "bottom"); editCard(w, card.id, { milestoneId: m.id });
  const other = createCard(w, first.id, "Other", "bottom");
  const f: Filters = { ...emptyFilters, project: p.id, milestone: m.id };
  expect(matches(card, f)).toBe(true);
  expect(matches(other, f)).toBe(false);
  expect(decodeFilters(encodeFilters(f))).toEqual(f);
});

test("milestones calc: done/total, remaining range and own unestimated count, with archived kept in scope", () => {
  const { w, p, done, todo } = calcFixture();
  const m = addMilestone(w, p.id, "M1", "2026-10-09");
  const a = createCard(w, todo.id, "A", "bottom"); editCard(w, a.id, { milestoneId: m.id, effort: effort(2, 3) });
  const b = createCard(w, done.id, "B", "bottom"); editCard(w, b.id, { milestoneId: m.id, effort: effort(5, 5) });
  const c = createCard(w, todo.id, "C", "bottom"); editCard(w, c.id, { milestoneId: m.id }); archiveCard(w, c.id, true);
  const [s] = summarizeMilestones(w, p.id, new Date("2026-10-05T12:00:00"));
  expect(s!.totalCards).toBe(3);
  expect(s!.doneCards).toBe(1);
  expect(s!.remaining).toEqual([2, 3]);
  expect(s!.unestimatedCount).toBe(1);
  expect(s!.daysRemaining).toBe(4);
  deleteCard(w, c.id);
  const [s2] = summarizeMilestones(w, p.id, new Date("2026-10-05T12:00:00"));
  expect(s2!.totalCards).toBe(2);
  expect(s2!.unestimatedCount).toBe(0);
});

test("milestones calc: working-day capacity window skips weekends and is zero once overdue", () => {
  const today = new Date("2026-10-05T12:00:00");
  expect(workingDaysThrough(today, "2026-10-05")).toBe(1);
  expect(workingDaysThrough(today, "2026-10-09")).toBe(5);
  expect(workingDaysThrough(today, "2026-10-12")).toBe(6);
  expect(workingDaysThrough(today, "2026-10-01")).toBe(0);
  expect(daysUntil("2026-10-09", today)).toBe(4);
  expect(daysUntil("2026-09-28", today)).toBe(-7);
});

test("milestones calc: fit verdicts compare the remaining range against capacity to the date", () => {
  const { w, p, todo } = calcFixture();
  const m = addMilestone(w, p.id, "M", "2026-10-09"); // capacity 0.5525 * 5 = 2.7625
  const a = createCard(w, todo.id, "A", "bottom"); editCard(w, a.id, { milestoneId: m.id, effort: effort(1, 1) });
  const today = new Date("2026-10-05T12:00:00");
  expect(summarizeMilestones(w, p.id, today)[0]!.verdict).toBe("Fits");
  editCard(w, a.id, { effort: effort(2, 3.5) });
  expect(summarizeMilestones(w, p.id, today)[0]!.verdict).toBe("At risk");
  editCard(w, a.id, { effort: effort(3, 4) });
  expect(summarizeMilestones(w, p.id, today)[0]!.verdict).toBe("Does not fit");
});

test("milestones calc: withholds the verdict when planning is not enabled or scope is unestimated", () => {
  const w = createWorkspace(); const p = createProject(w, "No planning");
  const m = addMilestone(w, p.id, "M", "2026-10-09");
  const today = new Date("2026-10-05T12:00:00");
  expect(summarizeMilestones(w, p.id, today)[0]!.verdict).toBe("Planning not enabled");
  p.planning = defaultPlanning();
  const todo = w.columns.find(c => c.boardId === w.boards[0]!.id && !c.done)!;
  const card = createCard(w, todo.id, "Unsized", "bottom"); editCard(w, card.id, { milestoneId: m.id });
  expect(summarizeMilestones(w, p.id, today)[0]!.verdict).toBe("1 unestimated card — no verdict");
});

test("milestones calc: a milestone's verdict uses the cumulative remaining effort of every milestone on or before its date", () => {
  const { w, p, todo } = calcFixture();
  const m1 = addMilestone(w, p.id, "M1", "2026-10-09"); // capacity 2.7625
  const m2 = addMilestone(w, p.id, "M2", "2026-10-12"); // capacity 3.315
  const a = createCard(w, todo.id, "A", "bottom"); editCard(w, a.id, { milestoneId: m1.id, effort: effort(1, 1) });
  const b = createCard(w, todo.id, "B", "bottom"); editCard(w, b.id, { milestoneId: m2.id, effort: effort(1, 1) });
  const today = new Date("2026-10-05T12:00:00");
  let [s1, s2] = summarizeMilestones(w, p.id, today);
  expect(s1!.verdict).toBe("Fits"); expect(s2!.verdict).toBe("Fits");
  editCard(w, b.id, { effort: effort(3, 3) }); // cumulative for m2 becomes 1 + 3 = 4 > 3.315
  [s1, s2] = summarizeMilestones(w, p.id, today);
  expect(s1!.verdict).toBe("Fits");
  expect(s2!.verdict).toBe("Does not fit");
});

test("milestones calc: an upstream unestimated card withholds the verdict for every later milestone", () => {
  const { w, p, todo } = calcFixture();
  const m1 = addMilestone(w, p.id, "M1", "2026-10-09");
  const m2 = addMilestone(w, p.id, "M2", "2026-10-12");
  const a = createCard(w, todo.id, "A", "bottom"); editCard(w, a.id, { milestoneId: m1.id });
  const b = createCard(w, todo.id, "B", "bottom"); editCard(w, b.id, { milestoneId: m2.id, effort: effort(1, 1) });
  const today = new Date("2026-10-05T12:00:00");
  const [s1, s2] = summarizeMilestones(w, p.id, today);
  expect(s1!.verdict).toBe("1 unestimated card — no verdict");
  expect(s2!.verdict).toBe("1 unestimated card — no verdict");
  expect(s2!.unestimatedCount).toBe(0);
});

test("milestones calc: an overdue milestone with nothing left still fits", () => {
  const { w, p, done } = calcFixture();
  const m = addMilestone(w, p.id, "M", "2026-09-28");
  const a = createCard(w, done.id, "A", "bottom"); editCard(w, a.id, { milestoneId: m.id, effort: effort(1, 1) });
  const [s] = summarizeMilestones(w, p.id, new Date("2026-10-05T12:00:00"));
  expect(s!.verdict).toBe("Fits");
  expect(s!.doneCards).toBe(1); expect(s!.totalCards).toBe(1);
  expect(s!.daysRemaining).toBeLessThan(0);
});

test("milestones calc: the fit check includes module contingency, like sprint loads", () => {
  const { w, p, todo } = calcFixture();
  const m = addMilestone(w, p.id, "M", "2026-10-09"); // capacity 2.7625; 2.4 IED × 1.25 contingency = 3.0
  const a = createCard(w, todo.id, "A", "bottom"); editCard(w, a.id, { milestoneId: m.id, effort: effort(2.4, 2.4) });
  const [s] = summarizeMilestones(w, p.id, new Date("2026-10-05T12:00:00"));
  expect(s!.remaining).toEqual([2.4, 2.4]);
  expect(s!.verdict).toBe("Does not fit");
});
