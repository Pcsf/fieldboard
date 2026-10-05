import { describe, expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, editCard, addMilestone } from "../src/model";
import { monthGrid, weekGrid, startOfWeek, addMonths, addWeeks, weekdayLabels, cardsByDay, milestonesByDay, noDueDateCards } from "../src/calendar-view";

function fixture() {
  const w = createWorkspace();
  const p = createProject(w, "Release");
  const col = w.columns.find(c => c.boardId === w.boards.find(b => b.projectId === p.id)!.id)!;
  return { w, p, col };
}

describe("monthGrid", () => {
  test("every week is Monday-first regardless of where the 1st falls", () => {
    // 2026-02-01 is a Sunday.
    const weeks = monthGrid(2026, 1);
    expect(weeks[0]![0]!.date).toBe("2026-01-26"); // the Monday before Feb 1
    for (const week of weeks) expect(new Date(`${week[0]!.date}T12:00:00`).getDay()).toBe(1);
  });
  test("February 2026 (not a leap year) covers all 28 days, in-month only", () => {
    const weeks = monthGrid(2026, 1);
    const inMonth = weeks.flat().filter(c => c.inMonth);
    expect(inMonth.length).toBe(28);
    expect(inMonth[0]!.date).toBe("2026-02-01"); expect(inMonth.at(-1)!.date).toBe("2026-02-28");
  });
  test("February 2024 (a leap year) covers 29 days", () => {
    const weeks = monthGrid(2024, 1);
    expect(weeks.flat().filter(c => c.inMonth).length).toBe(29);
  });
  test("February 2028 (a leap year) covers 29 days", () => {
    const weeks = monthGrid(2028, 1);
    expect(weeks.flat().filter(c => c.inMonth).length).toBe(29);
  });
  test("January spans exactly five Monday-first weeks for 2026", () => {
    const weeks = monthGrid(2026, 0);
    expect(weeks.length).toBe(5);
    expect(weeks[0]![0]!.date).toBe("2025-12-29"); expect(weeks.at(-1)!.at(-1)!.date).toBe("2026-02-01");
  });
  test("marks today, and only today, as isToday", () => {
    const weeks = monthGrid(2026, 1, new Date(2026, 1, 15));
    const flagged = weeks.flat().filter(c => c.isToday);
    expect(flagged.map(c => c.date)).toEqual(["2026-02-15"]);
  });
});

describe("weekGrid", () => {
  test("returns the 7 days of the Monday-first week containing the anchor", () => {
    const week = weekGrid(new Date(2026, 1, 15)); // a Sunday
    expect(week).toHaveLength(7);
    expect(week[0]!.date).toBe("2026-02-09"); expect(week[6]!.date).toBe("2026-02-15");
  });
});

describe("navigation helpers", () => {
  test("addMonths/addWeeks move the anchor and startOfWeek always lands on a Monday", () => {
    expect(addMonths(new Date(2026, 0, 31), 1).getMonth()).toBe(1);
    const nextWeek = addWeeks(new Date(2026, 1, 15), 1);
    expect(nextWeek.getDate()).toBe(22);
    expect(startOfWeek(new Date(2026, 1, 15)).getDay()).toBe(1);
  });
});

test("weekdayLabels: Monday-first, 7 distinct labels in the given locale", () => {
  const labels = weekdayLabels("en-US");
  expect(labels).toHaveLength(7);
  expect(labels[0]).toBe("Mon"); expect(labels[6]).toBe("Sun");
});

test("cardsByDay groups by due date and sorts each day alphabetically", () => {
  const { w, col } = fixture();
  const b = createCard(w, col.id, "Bravo", "bottom"); editCard(w, b.id, { dueDate: "2026-03-10" });
  const a = createCard(w, col.id, "Alpha", "bottom"); editCard(w, a.id, { dueDate: "2026-03-10" });
  createCard(w, col.id, "No date", "bottom");
  const byDay = cardsByDay(w.cards);
  expect(byDay.get("2026-03-10")!.map(c => c.title)).toEqual(["Alpha", "Bravo"]);
  expect(byDay.has("2026-03-11")).toBe(false);
});

test("milestonesByDay groups project milestones by their date", () => {
  const { w, p } = fixture();
  const m1 = addMilestone(w, p.id, "Beta", "2026-04-01");
  const m2 = addMilestone(w, p.id, "Beta2", "2026-04-01");
  const byDay = milestonesByDay([m1, m2]);
  expect(byDay.get("2026-04-01")!.map(m => m.id)).toEqual([m1.id, m2.id]);
});

test("noDueDateCards keeps only undated cards, sorted by title", () => {
  const { w, col } = fixture();
  const dated = createCard(w, col.id, "Dated", "bottom"); editCard(w, dated.id, { dueDate: "2026-03-10" });
  createCard(w, col.id, "Zeta", "bottom"); createCard(w, col.id, "Amber", "bottom");
  expect(noDueDateCards(w.cards).map(c => c.title)).toEqual(["Amber", "Zeta"]);
});
