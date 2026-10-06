import { expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, editCard, archiveCard, deleteColumn, addColumn, deleteBoard, addBoard, validateWorkspace } from "../src/model";
import { nextOccurrence, dueOccurrences, generateRecurrences, hasDueRecurrences, todayCalendarDate, MAX_CATCHUP } from "../src/recurring";

function fixture() {
  const w = createWorkspace(); const p = createProject(w, "Recurring");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const columns = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  return { w, p, board, backlog: columns[0]!, todo: columns[1]! };
}

// --- Calendar-date arithmetic (no milliseconds, no DST, month-end clamping) ---

test("Recurring: daily and weekly advance by calendar days, never by milliseconds", () => {
  expect(nextOccurrence("2026-01-01", "daily")).toBe("2026-01-02");
  expect(nextOccurrence("2026-01-01", "weekly")).toBe("2026-01-08");
});

test("Recurring: a day advance across a DST transition date is still exactly one calendar day", () => {
  // 2026-03-29 is the EU spring-forward date; pure calendar-date arithmetic has nothing to shift.
  expect(nextOccurrence("2026-03-28", "daily")).toBe("2026-03-29");
  expect(nextOccurrence("2026-03-29", "daily")).toBe("2026-03-30");
  // 2026-10-25 is the EU fall-back date.
  expect(nextOccurrence("2026-10-24", "daily")).toBe("2026-10-25");
  expect(nextOccurrence("2026-10-25", "daily")).toBe("2026-10-26");
});

test("Recurring: monthly on the 31st clamps to the month's last day and returns to 31 when possible", () => {
  let d = "2026-01-31";
  d = nextOccurrence(d, "monthly"); expect(d).toBe("2026-02-28"); // Feb 2026 is not a leap year
  d = nextOccurrence(d, "monthly"); expect(d).toBe("2026-03-31"); // returns to 31
  d = nextOccurrence(d, "monthly"); expect(d).toBe("2026-04-30"); // April has 30 days
  d = nextOccurrence(d, "monthly"); expect(d).toBe("2026-05-31"); // returns to 31 again
});

test("Recurring: monthly across a leap day clamps to the 29th, not the 28th", () => {
  expect(nextOccurrence("2027-12-31", "monthly")).toBe("2028-01-31");
  expect(nextOccurrence("2028-01-31", "monthly")).toBe("2028-02-29"); // 2028 is a leap year
  expect(nextOccurrence("2028-02-29", "monthly")).toBe("2028-03-31"); // returns to 31
});

test("Recurring: a monthly recurrence on an ordinary day (15th) never clamps", () => {
  let d = "2026-01-15";
  for (let i = 0; i < 12; i++) d = nextOccurrence(d, "monthly");
  expect(d).toBe("2027-01-15");
});

// --- dueOccurrences: how many are due, where `next` lands, and the catch-up cap ---

test("Recurring: dueOccurrences counts zero and leaves next untouched when nothing is due yet", () => {
  const result = dueOccurrences({ frequency: "daily", columnId: "c1", next: "2026-06-01" }, "2026-05-30");
  expect(result).toEqual({ count: 0, next: "2026-06-01", capped: false });
});

test("Recurring: dueOccurrences counts exactly the missed daily occurrences and advances next past today", () => {
  const result = dueOccurrences({ frequency: "daily", columnId: "c1", next: "2026-06-01" }, "2026-06-04");
  expect(result).toEqual({ count: 4, next: "2026-06-05", capped: false }); // 1,2,3,4 all <= today; next becomes the 5th
});

test("Recurring: dueOccurrences caps the generated count and still advances next past today", () => {
  const result = dueOccurrences({ frequency: "daily", columnId: "c1", next: "2026-01-01" }, "2026-03-01", 10);
  expect(result.count).toBe(10);
  expect(result.capped).toBe(true);
  expect(result.next > "2026-03-01").toBe(true); // fast-forwarded past today despite the cap
});

// --- generateRecurrences: the full workspace-level pass (what the app calls on launch/timer) ---

test("Recurring: generateRecurrences creates one copy per missed daily occurrence in the chosen column", () => {
  const { w, backlog, todo } = fixture();
  const source = createCard(w, backlog.id, "Standup", "bottom");
  editCard(w, source.id, { recurrence: { frequency: "daily", columnId: todo.id, next: "2026-01-01" } });
  const today = "2026-01-03";
  const result = generateRecurrences(w, new Date(`${today}T09:00:00`));
  expect(result.created).toBe(3); // Jan 1, 2, 3 all due
  const spawned = w.cards.filter(c => c.id !== source.id);
  expect(spawned.length).toBe(3);
  expect(spawned.every(c => c.columnId === todo.id)).toBe(true);
  expect(w.cards.find(c => c.id === source.id)!.recurrence!.next).toBe("2026-01-04");
  expect(validateWorkspace(w)).toEqual(w);
});

test("Recurring: a copy carries title, description, labels, priority, assignees and unchecked subtasks, nothing else", () => {
  const { w, p, backlog, todo } = fixture();
  const source = createCard(w, backlog.id, "Weekly review", "bottom");
  editCard(w, source.id, {
    description: "Check the board", priority: "high",
    labels: [p.labels[0]?.id ?? ""].filter(Boolean),
    subtasks: [{ id: "s1", title: "Open the board", done: true, position: 0 }],
    comments: [{ id: "c1", author: w.settings.actorId, body: "note", timestamp: new Date().toISOString() }],
  });
  const m = w.members[0]!;
  editCard(w, source.id, { assignees: [m.id] });
  editCard(w, source.id, { recurrence: { frequency: "weekly", columnId: todo.id, next: "2026-01-01" } });
  generateRecurrences(w, new Date("2026-01-01T09:00:00"));
  const copy = w.cards.find(c => c.id !== source.id)!;
  expect(copy.title).toBe("Weekly review");
  expect(copy.description).toBe("Check the board");
  expect(copy.priority).toBe("high");
  expect(copy.assignees).toEqual([m.id]);
  expect(copy.subtasks.map(s => ({ title: s.title, done: s.done }))).toEqual([{ title: "Open the board", done: false }]);
  expect(copy.comments).toEqual([]);
  expect(copy.attachments).toEqual([]);
  expect(copy.timeEntries ?? []).toEqual([]);
  expect(copy.recurrence).toBeUndefined();
});

test("Recurring: a second generateRecurrences call right after the first creates nothing more (no reload duplication)", () => {
  const { w, backlog, todo } = fixture();
  const source = createCard(w, backlog.id, "Daily", "bottom");
  editCard(w, source.id, { recurrence: { frequency: "daily", columnId: todo.id, next: "2026-01-01" } });
  const now = new Date("2026-01-03T09:00:00");
  const first = generateRecurrences(w, now);
  expect(first.created).toBeGreaterThan(0);
  const countAfterFirst = w.cards.length;
  const second = generateRecurrences(w, now); // same instant, simulating two launches with nothing missed in between
  expect(second.created).toBe(0);
  expect(w.cards.length).toBe(countAfterFirst);
});

test("Recurring: a long-missed daily recurrence is capped per generation pass and next lands after today", () => {
  const { w, backlog, todo } = fixture();
  const source = createCard(w, backlog.id, "Daily", "bottom");
  editCard(w, source.id, { recurrence: { frequency: "daily", columnId: todo.id, next: "2020-01-01" } });
  const result = generateRecurrences(w, new Date("2026-01-01T09:00:00"), MAX_CATCHUP);
  expect(result.created).toBe(MAX_CATCHUP);
  expect(result.cappedCards).toEqual([source.id]);
  const stored = w.cards.find(c => c.id === source.id)!;
  expect(stored.recurrence!.next > todayCalendarDate(new Date("2026-01-01T09:00:00"))).toBe(true);
});

test("Recurring: an archived card's recurrence is never generated", () => {
  const { w, backlog, todo } = fixture();
  const source = createCard(w, backlog.id, "Paused", "bottom");
  editCard(w, source.id, { recurrence: { frequency: "daily", columnId: todo.id, next: "2026-01-01" } });
  archiveCard(w, source.id, true);
  const result = generateRecurrences(w, new Date("2026-01-05T09:00:00"));
  expect(result.created).toBe(0);
  expect(w.cards.length).toBe(1);
});

test("Recurring: hasDueRecurrences reports true only when something is actually due", () => {
  const { w, backlog, todo } = fixture();
  const source = createCard(w, backlog.id, "Later", "bottom");
  editCard(w, source.id, { recurrence: { frequency: "daily", columnId: todo.id, next: "2099-01-01" } });
  expect(hasDueRecurrences(w, new Date("2026-01-01T09:00:00"))).toBe(false);
  editCard(w, source.id, { recurrence: { frequency: "daily", columnId: todo.id, next: "2020-01-01" } });
  expect(hasDueRecurrences(w, new Date("2026-01-01T09:00:00"))).toBe(true);
});

// --- Validation and cascades ---

test("Recurring: structural validation rejects an unknown frequency, a malformed date, or an empty column reference", () => {
  const { w, backlog } = fixture();
  const source = createCard(w, backlog.id, "Card", "bottom");
  const bad1 = structuredClone(w); bad1.cards.find(c => c.id === source.id)!.recurrence = { frequency: "yearly" as any, columnId: backlog.id, next: "2026-01-01" };
  expect(() => validateWorkspace(bad1)).toThrow();
  const bad2 = structuredClone(w); bad2.cards.find(c => c.id === source.id)!.recurrence = { frequency: "daily", columnId: backlog.id, next: "not-a-date" };
  expect(() => validateWorkspace(bad2)).toThrow();
  const bad3 = structuredClone(w); bad3.cards.find(c => c.id === source.id)!.recurrence = { frequency: "daily", columnId: "", next: "2026-01-01" };
  expect(() => validateWorkspace(bad3)).toThrow();
});

test("Recurring: relational validation rejects a recurrence column from another project", () => {
  const { w, backlog } = fixture();
  const other = createProject(w, "Other project");
  const otherBoard = w.boards.find(b => b.projectId === other.id)!;
  const otherColumn = w.columns.find(c => c.boardId === otherBoard.id)!;
  const source = createCard(w, backlog.id, "Card", "bottom");
  editCard(w, source.id, { recurrence: { frequency: "daily", columnId: otherColumn.id, next: "2026-01-01" } });
  expect(() => validateWorkspace(w)).toThrow();
});

test("Recurring: deleting the target column clears the recurrence rather than stranding it", () => {
  const { w, backlog, board } = fixture();
  const extra = addColumn(w, board.id, "Extra");
  const source = createCard(w, backlog.id, "Card", "bottom");
  editCard(w, source.id, { recurrence: { frequency: "daily", columnId: extra.id, next: "2026-01-01" } });
  deleteColumn(w, extra.id, backlog.id);
  expect(w.cards.find(c => c.id === source.id)!.recurrence).toBeUndefined();
  expect(validateWorkspace(w)).toEqual(w);
});

test("Recurring: deleting the target board (and its columns) clears the recurrence rather than stranding it", () => {
  const { w, p, backlog, board } = fixture();
  const second = addBoard(w, p.id, "Second board");
  const secondColumn = w.columns.find(c => c.boardId === second.id)!;
  const source = createCard(w, backlog.id, "Card", "bottom");
  editCard(w, source.id, { recurrence: { frequency: "daily", columnId: secondColumn.id, next: "2026-01-01" } });
  deleteBoard(w, second.id);
  expect(w.cards.find(c => c.id === source.id)!.recurrence).toBeUndefined();
  expect(validateWorkspace(w)).toEqual(w);
});

test("Recurring: an untouched workspace carries no recurrence key and loads byte-for-byte unchanged", () => {
  const { w, backlog } = fixture();
  createCard(w, backlog.id, "Plain", "bottom");
  const text = JSON.stringify(w);
  expect(JSON.stringify(validateWorkspace(JSON.parse(text)))).toBe(text);
});
