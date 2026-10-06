import { expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, validateWorkspace, undoWorkspace } from "../src/model";
import { startTimer, stopTimer, addManualEntry, deleteEntry, totalTrackedMs, formatDuration, runningEntry } from "../src/time-tracking";

function fixture() {
  const w = createWorkspace(); const p = createProject(w, "Time tracking");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const column = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position)[0]!;
  const card = createCard(w, column.id, "Card", "bottom");
  return { w, card };
}

test("Time tracking: starting a timer adds a running entry (end null), and a second start is rejected", () => {
  const { w, card } = fixture();
  startTimer(w, card.id);
  const stored = w.cards.find(c => c.id === card.id)!;
  expect(stored.timeEntries?.length).toBe(1);
  expect(stored.timeEntries![0]!.end).toBeNull();
  expect(runningEntry(stored.timeEntries!)).toBeDefined();
  expect(() => startTimer(w, card.id)).toThrow();
  expect(validateWorkspace(w)).toEqual(w);
});

test("Time tracking: stopping a timer sets its end and the duration becomes finite", () => {
  const { w, card } = fixture();
  startTimer(w, card.id);
  const started = w.cards.find(c => c.id === card.id)!.timeEntries![0]!;
  started.start = new Date(Date.now() - 60_000).toISOString(); // backdate so stop produces a positive duration
  stopTimer(w, card.id);
  const stored = w.cards.find(c => c.id === card.id)!;
  expect(stored.timeEntries![0]!.end).not.toBeNull();
  expect(totalTrackedMs(stored.timeEntries!)).toBeGreaterThanOrEqual(60_000 - 1000);
  expect(() => stopTimer(w, card.id)).toThrow(); // nothing running anymore
  expect(validateWorkspace(w)).toEqual(w);
});

test("Time tracking: a manual entry with end before start is rejected", () => {
  const { w, card } = fixture();
  const start = new Date("2026-01-01T10:00:00.000Z").toISOString();
  const end = new Date("2026-01-01T09:00:00.000Z").toISOString();
  expect(() => addManualEntry(w, card.id, start, end)).toThrow();
});

test("Time tracking: a manual entry equal to start and end (zero duration) is rejected as a negative/non-positive duration", () => {
  const { w, card } = fixture();
  const t = new Date("2026-01-01T10:00:00.000Z").toISOString();
  expect(() => addManualEntry(w, card.id, t, t)).toThrow();
});

test("Time tracking: overlapping manual entries on the same card are rejected", () => {
  const { w, card } = fixture();
  addManualEntry(w, card.id, "2026-01-01T09:00:00.000Z", "2026-01-01T10:00:00.000Z", "First");
  expect(() => addManualEntry(w, card.id, "2026-01-01T09:30:00.000Z", "2026-01-01T10:30:00.000Z", "Overlaps")).toThrow();
  // Back-to-back (end === next start) is allowed, not an overlap.
  addManualEntry(w, card.id, "2026-01-01T10:00:00.000Z", "2026-01-01T11:00:00.000Z", "Back to back");
  const stored = w.cards.find(c => c.id === card.id)!;
  expect(stored.timeEntries?.length).toBe(2);
  expect(validateWorkspace(w)).toEqual(w);
});

test("Time tracking: overlapping entries on different cards are unaffected", () => {
  const { w, card } = fixture();
  const other = createCard(w, card.columnId, "Other", "bottom");
  addManualEntry(w, card.id, "2026-01-01T09:00:00.000Z", "2026-01-01T10:00:00.000Z");
  expect(() => addManualEntry(w, other.id, "2026-01-01T09:00:00.000Z", "2026-01-01T10:00:00.000Z")).not.toThrow();
});

test("Time tracking: totalTrackedMs sums completed entries and ignores nothing, deleteEntry removes one", () => {
  const { w, card } = fixture();
  addManualEntry(w, card.id, "2026-01-01T09:00:00.000Z", "2026-01-01T10:00:00.000Z"); // 1h
  addManualEntry(w, card.id, "2026-01-01T11:00:00.000Z", "2026-01-01T11:30:00.000Z"); // 30m
  const stored = w.cards.find(c => c.id === card.id)!;
  expect(totalTrackedMs(stored.timeEntries!)).toBe(90 * 60_000);
  deleteEntry(w, card.id, stored.timeEntries![0]!.id);
  const after = w.cards.find(c => c.id === card.id)!;
  expect(after.timeEntries?.length).toBe(1);
  expect(totalTrackedMs(after.timeEntries!)).toBe(30 * 60_000);
});

test("Time tracking: a running entry's open duration counts toward the total using the given 'now'", () => {
  const { w, card } = fixture();
  startTimer(w, card.id);
  const stored = w.cards.find(c => c.id === card.id)!;
  const start = new Date(stored.timeEntries![0]!.start).getTime();
  expect(totalTrackedMs(stored.timeEntries!, start + 5 * 60_000)).toBe(5 * 60_000);
});

test("Time tracking: formatDuration renders hours and minutes, and bare minutes under an hour", () => {
  expect(formatDuration(45 * 60_000)).toBe("45m");
  expect(formatDuration(90 * 60_000)).toBe("1h 30m");
  expect(formatDuration(120 * 60_000)).toBe("2h 0m");
  expect(formatDuration(0)).toBe("0m");
});

test("Time tracking: entries are card mutations -- Activity records them and undo reverts them", () => {
  const { w, card } = fixture();
  const before = structuredClone(w);
  addManualEntry(w, card.id, "2026-01-01T09:00:00.000Z", "2026-01-01T10:00:00.000Z", "Worked");
  expect(w.activities.at(-1)!.cardId).toBe(card.id);
  expect(w.activities.at(-1)!.after!.timeEntries?.length).toBe(1);
  undoWorkspace(w, before);
  expect(w.cards.find(c => c.id === card.id)!.timeEntries ?? []).toEqual([]);
});

test("Time tracking: structural validation rejects a stored card with two running entries or a negative-duration entry", () => {
  const { w, card } = fixture();
  const twoRunning = structuredClone(w);
  twoRunning.cards.find(c => c.id === card.id)!.timeEntries = [
    { id: "a", start: new Date().toISOString(), end: null },
    { id: "b", start: new Date().toISOString(), end: null },
  ];
  expect(() => validateWorkspace(twoRunning)).toThrow();

  const negative = structuredClone(w);
  negative.cards.find(c => c.id === card.id)!.timeEntries = [
    { id: "a", start: "2026-01-01T10:00:00.000Z", end: "2026-01-01T09:00:00.000Z" },
  ];
  expect(() => validateWorkspace(negative)).toThrow();
});

test("Time tracking: an untouched workspace carries no timeEntries key and loads byte-for-byte unchanged", () => {
  const { w, card } = fixture();
  const text = JSON.stringify(w);
  expect(JSON.stringify(validateWorkspace(JSON.parse(text)))).toBe(text);
  expect(w.cards.find(c => c.id === card.id)!.timeEntries).toBeUndefined();
});
