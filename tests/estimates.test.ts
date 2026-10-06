import { expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, editCard, archiveCard, validateWorkspace } from "../src/model";
import { sumEstimates, formatEstimateSum, estimateUnits } from "../src/estimates";

function fixture() {
  const w = createWorkspace(); const p = createProject(w, "Estimates");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const column = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position)[0]!;
  return { w, p, column };
}

test("Estimates: sumEstimates ignores null estimates", () => {
  const { w, column } = fixture();
  const a = createCard(w, column.id, "A", "bottom"); editCard(w, a.id, { estimate: 3 });
  createCard(w, column.id, "B", "bottom"); // no estimate
  const cards = w.cards.filter(c => c.columnId === column.id);
  expect(sumEstimates(cards)).toBe(3);
});

test("Estimates: sumEstimates excludes archived cards", () => {
  const { w, column } = fixture();
  const a = createCard(w, column.id, "A", "bottom"); editCard(w, a.id, { estimate: 5 });
  const b = createCard(w, column.id, "B", "bottom"); editCard(w, b.id, { estimate: 7 });
  archiveCard(w, b.id, true);
  const cards = w.cards.filter(c => c.columnId === column.id);
  expect(sumEstimates(cards)).toBe(5);
});

test("Estimates: sumEstimates adds decimals precisely", () => {
  const { w, column } = fixture();
  const a = createCard(w, column.id, "A", "bottom"); editCard(w, a.id, { estimate: 1.5 });
  const b = createCard(w, column.id, "B", "bottom"); editCard(w, b.id, { estimate: 2.25 });
  const cards = w.cards.filter(c => c.columnId === column.id);
  expect(sumEstimates(cards)).toBe(3.75);
});

test("Estimates: sumEstimates returns null when no card in the set has an estimate", () => {
  const { w, column } = fixture();
  createCard(w, column.id, "A", "bottom");
  const archived = createCard(w, column.id, "B", "bottom"); editCard(w, archived.id, { estimate: 9 }); archiveCard(w, archived.id, true);
  const cards = w.cards.filter(c => c.columnId === column.id);
  expect(sumEstimates(cards)).toBeNull();
});

test("Estimates: formatEstimateSum trims trailing zeros and labels the unit", () => {
  expect(formatEstimateSum(13, "points")).toBe("Σ 13 pts");
  expect(formatEstimateSum(7.5, "hours")).toBe("Σ 7.5 h");
  expect(formatEstimateSum(7.25, "hours")).toBe("Σ 7.25 h");
});

test("Estimates: a workspace's estimate unit defaults to points and accepts only the two known values", () => {
  const { w } = fixture();
  expect(w.settings.estimateUnit).toBeUndefined();
  w.settings.estimateUnit = "hours";
  expect(validateWorkspace(w)).toEqual(w);
  const bad = structuredClone(w); (bad.settings as { estimateUnit?: string }).estimateUnit = "days";
  expect(() => validateWorkspace(bad)).toThrow();
});

test("Estimates: an untouched workspace carries no estimateUnit key and loads byte-for-byte unchanged", () => {
  const { w, column } = fixture();
  createCard(w, column.id, "Plain", "bottom");
  const text = JSON.stringify(w);
  expect(JSON.stringify(validateWorkspace(JSON.parse(text)))).toBe(text);
  expect(w.settings.estimateUnit).toBeUndefined();
});

test("Estimates: estimateUnits lists exactly points and hours", () => {
  expect(estimateUnits).toEqual(["points", "hours"]);
});
