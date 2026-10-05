import { expect, test } from "bun:test";
import { parseQuickAdd } from "../src/quickadd";

const members = [{ id: "m-paulo", name: "Paulo Ficagna" }, { id: "m-alex", name: "Alex Park" }, { id: "m-al", name: "Al Green" }];
const milestones = [{ id: "ms-q1", name: "Q1 launch" }, { id: "ms-q2", name: "Q2 launch" }];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const iso = (d: Date) => d.toLocaleDateString("en-CA");
const addDays = (d: Date, n: number) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };

test("quick-add: extracts a label, assignee, priority and due date, leaving a clean title", () => {
  const today = new Date(2026, 0, 15);
  const target = addDays(today, 1); const weekday = WEEKDAYS[target.getDay()]!;
  const result = parseQuickAdd(`Fix login #bug @paulo !high ^${weekday}`, { members }, today);
  expect(result.title).toBe("Fix login");
  expect(result.labelNames).toEqual(["bug"]);
  expect(result.assigneeIds).toEqual(["m-paulo"]);
  expect(result.priority).toBe("high");
  expect(result.dueDate).toBe(iso(target));
});

test("quick-add: tokens can appear anywhere in the input and multiple labels accumulate", () => {
  const result = parseQuickAdd("#urgent-work Ship it #bug", { members }, new Date(2026, 0, 1));
  expect(result.title).toBe("Ship it");
  expect(result.labelNames).toEqual(["urgent-work", "bug"]);
});

test("quick-add: !! maps to urgent priority", () => {
  const result = parseQuickAdd("Deploy now !!", { members }, new Date(2026, 0, 1));
  expect(result.priority).toBe("urgent");
  expect(result.title).toBe("Deploy now");
});

test("quick-add: ^today and ^tomorrow resolve relative to the injected clock", () => {
  const today = new Date(2026, 0, 15);
  expect(parseQuickAdd("A ^today", { members }, today).dueDate).toBe("2026-01-15");
  expect(parseQuickAdd("A ^tomorrow", { members }, today).dueDate).toBe("2026-01-16");
});

test("quick-add: a weekday name resolves to its next occurrence, excluding today itself", () => {
  const today = new Date(2026, 0, 15); const todayName = WEEKDAYS[today.getDay()]!;
  const result = parseQuickAdd(`A ^${todayName}`, { members }, today);
  expect(result.dueDate).toBe(iso(addDays(today, 7)));
});

test("quick-add: an explicit ISO date is accepted; an invalid one is left untouched in the title", () => {
  const today = new Date(2026, 0, 1);
  expect(parseQuickAdd("A ^2026-03-05", { members }, today).dueDate).toBe("2026-03-05");
  const bad = parseQuickAdd("A ^2026-13-40", { members }, today);
  expect(bad.dueDate).toBeUndefined();
  expect(bad.title).toBe("A ^2026-13-40");
});

test("quick-add: an unknown member, unknown priority word and unresolved date token all stay in the title", () => {
  const today = new Date(2026, 0, 1);
  const r = parseQuickAdd("A @nobody !whenever ^someday", { members }, today);
  expect(r.assigneeIds).toEqual([]);
  expect(r.priority).toBeUndefined();
  expect(r.dueDate).toBeUndefined();
  expect(r.title).toBe("A @nobody !whenever ^someday");
});

test("quick-add: assignee matches by case-insensitive first-name prefix, only when unique", () => {
  const today = new Date(2026, 0, 1);
  expect(parseQuickAdd("A @PAU", { members }, today).assigneeIds).toEqual(["m-paulo"]);
  const ambiguous = parseQuickAdd("A @al", { members }, today);
  expect(ambiguous.assigneeIds).toEqual([]);
  expect(ambiguous.title).toBe("A @al");
});

test("quick-add: a milestone token matches a project milestone by unique name prefix", () => {
  const today = new Date(2026, 0, 1);
  const r = parseQuickAdd("A ~Q1", { members, milestones }, today);
  expect(r.milestoneId).toBe("ms-q1");
  const ambiguous = parseQuickAdd("A ~Q", { members, milestones }, today);
  expect(ambiguous.milestoneId).toBeUndefined();
  expect(ambiguous.title).toBe("A ~Q");
});

test("quick-add: milestones are left unresolved when the project has none configured", () => {
  const r = parseQuickAdd("A ~Q1", { members }, new Date(2026, 0, 1));
  expect(r.milestoneId).toBeUndefined();
  expect(r.title).toBe("A ~Q1");
});

test("quick-add: a title with no tokens is returned unchanged", () => {
  expect(parseQuickAdd("Just a plain title", { members: [] }, new Date()).title).toBe("Just a plain title");
});

test("quick-add: an empty token (bare punctuation) is left as a literal word", () => {
  const r = parseQuickAdd("Fix # @ ! ^ ~ login", { members }, new Date(2026, 0, 1));
  expect(r.title).toBe("Fix # @ ! ^ ~ login");
  expect(r.labelNames).toEqual([]);
});
