import { expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, editCard, moveCard, undoWorkspace, updateColumn, saveBoardTemplate, createBoardFromTemplate, validateWorkspace } from "../src/model";
import { columnEntryIndex, extendColumnEntryIndex, cardAgeDays } from "../src/aging";

function fixture() {
  const w = createWorkspace(); const p = createProject(w, "Flow");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const columns = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  return { w, p, board, columns, first: columns[0]!, second: columns[1]!, done: columns[4]! };
}
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

test("Aging: updateColumn accepts a positive integer or clears agingDays, and rejects zero/negative/non-integer", () => {
  const { w, first } = fixture();
  updateColumn(w, first.id, { agingDays: 7 });
  expect(w.columns.find(c => c.id === first.id)!.agingDays).toBe(7);
  updateColumn(w, first.id, { agingDays: null });
  expect(w.columns.find(c => c.id === first.id)!.agingDays).toBeNull();
  expect(() => updateColumn(w, first.id, { agingDays: 0 })).toThrow();
  expect(() => updateColumn(w, first.id, { agingDays: -1 })).toThrow();
  expect(() => updateColumn(w, first.id, { agingDays: 1.5 })).toThrow();
  expect(validateWorkspace(w)).toEqual(w);
});

test("Aging: structural validation rejects a zero or negative stored threshold", () => {
  const { w, first } = fixture();
  updateColumn(w, first.id, { agingDays: 5 });
  const bad = structuredClone(w); bad.columns.find(c => c.id === first.id)!.agingDays = 0;
  expect(() => validateWorkspace(bad)).toThrow();
  const fractional = structuredClone(w); fractional.columns.find(c => c.id === first.id)!.agingDays = 1.5;
  expect(() => validateWorkspace(fractional)).toThrow();
});

test("Aging: board templates capture and reproduce the threshold", () => {
  const { w, p, board, columns } = fixture();
  updateColumn(w, columns[0]!.id, { agingDays: 7 });
  const bt = saveBoardTemplate(w, board.id, "Standard flow");
  expect(bt.columns[0]!.agingDays).toBe(7);
  expect(bt.columns.slice(1).every(c => c.agingDays === undefined)).toBe(true);
  const created = createBoardFromTemplate(w, p.id, bt.id, "From template");
  const createdColumns = w.columns.filter(c => c.boardId === created.id).sort((a, b) => a.position - b.position);
  expect(createdColumns[0]!.agingDays).toBe(7);
  expect(createdColumns.slice(1).every(c => c.agingDays === undefined)).toBe(true);
  expect(validateWorkspace(w)).toEqual(w);
});

test("Aging: an untouched workspace's columns carry no agingDays key and load byte-for-byte unchanged", () => {
  const { w, first } = fixture();
  createCard(w, first.id, "Plain", "bottom");
  const text = JSON.stringify(w);
  expect(JSON.stringify(validateWorkspace(JSON.parse(text)))).toBe(text);
  expect(w.columns.every(c => c.agingDays === undefined)).toBe(true);
});

test("Aging: cardAgeDays uses createdAt when no Activity entry exists for the card", () => {
  const card = { id: "x", columnId: "c1", createdAt: daysAgo(5) };
  expect(cardAgeDays(card, new Map())).toBe(5);
});

test("Aging: cardAgeDays floors partial days", () => {
  const card = { id: "x", columnId: "c1", createdAt: daysAgo(2.9) };
  expect(cardAgeDays(card, new Map())).toBe(2);
});

test("Aging: an edit that leaves the column unchanged never resets the age", () => {
  const { w, first } = fixture();
  const card = createCard(w, first.id, "Card", "bottom");
  w.activities[0]!.timestamp = daysAgo(10); card.createdAt = daysAgo(10);
  editCard(w, card.id, { description: "Updated" });
  w.activities.at(-1)!.timestamp = daysAgo(1);
  const index = columnEntryIndex(w.activities);
  expect(cardAgeDays(w.cards.find(c => c.id === card.id)!, index)).toBe(10);
});

test("Aging: moving out and back resets the age to the return move", () => {
  const { w, first, second } = fixture();
  const card = createCard(w, first.id, "Card", "bottom");
  w.activities[0]!.timestamp = daysAgo(20); card.createdAt = daysAgo(20);
  moveCard(w, card.id, second.id, 0); w.activities.at(-1)!.timestamp = daysAgo(15);
  moveCard(w, card.id, first.id, 0); w.activities.at(-1)!.timestamp = daysAgo(3);
  const index = columnEntryIndex(w.activities);
  expect(cardAgeDays(w.cards.find(c => c.id === card.id)!, index)).toBe(3);
});

test("Aging: undoing a move counts as entering the column", () => {
  const { w, first, second } = fixture();
  const card = createCard(w, first.id, "Card", "bottom");
  w.activities[0]!.timestamp = daysAgo(8); card.createdAt = daysAgo(8);
  const before = structuredClone(w);
  moveCard(w, card.id, second.id, 0); w.activities.at(-1)!.timestamp = daysAgo(1);
  undoWorkspace(w, before);
  w.activities.at(-1)!.timestamp = daysAgo(0);
  const restored = w.cards.find(c => c.id === card.id)!;
  expect(restored.columnId).toBe(first.id);
  const index = columnEntryIndex(w.activities);
  expect(cardAgeDays(restored, index)).toBe(0);
});

test("Aging: a card with history in a different column than it now sits in falls back to createdAt", () => {
  const card = { id: "x", columnId: "target", createdAt: daysAgo(4) };
  const index = new Map([["x", { columnId: "other", timestamp: daysAgo(99) }]]);
  expect(cardAgeDays(card, index)).toBe(4);
});

test("Aging: extendColumnEntryIndex incrementally matches a full rebuild", () => {
  const { w, first, second } = fixture();
  createCard(w, first.id, "A", "bottom");
  const a = w.cards[0]!;
  moveCard(w, a.id, second.id, 0);
  createCard(w, first.id, "B", "bottom");
  const full = columnEntryIndex(w.activities);
  const incremental = extendColumnEntryIndex(new Map(), w.activities.slice(0, 2), 0);
  extendColumnEntryIndex(incremental, w.activities, 2);
  expect(incremental).toEqual(full);
});
