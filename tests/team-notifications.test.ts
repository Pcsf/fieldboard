import { test, expect } from "bun:test";
import { onCardChange, capNotifications, hasDueReminders, generateDueReminders, MAX_NOTIFICATIONS_PER_MEMBER, type Notification } from "../src/notifications";
import { createWorkspace, createProject, createCard, editCard, validateWorkspace, type Workspace, type Card } from "../src/model";

function withSecondMember(w: Workspace): string {
  const memberId = crypto.randomUUID();
  w.members.push({ id: memberId, name: "Bob", color: "#667b68" });
  return memberId;
}

test("onCardChange: a new mention in the description notifies the mentioned member, not the actor", () => {
  const w = createWorkspace(); const bob = withSecondMember(w);
  w.members.push({ id: "carol", name: "Carol", color: "#667b68" });
  const before: Card = { id: "c1", columnId: "x", position: 0, title: "T", description: "", priority: "none", dueDate: null, estimate: null, labels: [], assignees: [], subtasks: [], comments: [], attachments: [], links: [], createdAt: "", updatedAt: "", completedAt: null, archived: false };
  const after: Card = { ...before, description: "Hey @Bob, please look at this" };
  const notes = onCardChange(w.members, before, after, w.settings.actorId, "2026-01-01T00:00:00.000Z");
  expect(notes).toHaveLength(1);
  expect(notes[0]!.memberId).toBe(bob);
  expect(notes[0]!.kind).toBe("mention");
  expect(notes[0]!.cardId).toBe("c1");
});

test("onCardChange: mentioning the actor themselves notifies nobody", () => {
  const w = createWorkspace();
  const before: Card = { id: "c1", columnId: "x", position: 0, title: "T", description: "", priority: "none", dueDate: null, estimate: null, labels: [], assignees: [], subtasks: [], comments: [], attachments: [], links: [], createdAt: "", updatedAt: "", completedAt: null, archived: false };
  const after: Card = { ...before, description: `Hey @${w.members[0]!.name}` };
  const notes = onCardChange(w.members, before, after, w.settings.actorId, "2026-01-01T00:00:00.000Z");
  expect(notes).toHaveLength(0);
});

test("onCardChange: a mention already present before the edit does not re-notify", () => {
  const w = createWorkspace(); const bob = withSecondMember(w);
  const before: Card = { id: "c1", columnId: "x", position: 0, title: "T", description: "@Bob already here", priority: "none", dueDate: null, estimate: null, labels: [], assignees: [], subtasks: [], comments: [], attachments: [], links: [], createdAt: "", updatedAt: "", completedAt: null, archived: false };
  const after: Card = { ...before, description: "@Bob already here, with more text" };
  const notes = onCardChange(w.members, before, after, w.settings.actorId, "2026-01-01T00:00:00.000Z");
  expect(notes.filter(n => n.memberId === bob && n.kind === "mention")).toHaveLength(0);
});

test("onCardChange: a mention inside a newly added comment notifies that member", () => {
  const w = createWorkspace(); const bob = withSecondMember(w);
  const before: Card = { id: "c1", columnId: "x", position: 0, title: "T", description: "", priority: "none", dueDate: null, estimate: null, labels: [], assignees: [], subtasks: [], comments: [], attachments: [], links: [], createdAt: "", updatedAt: "", completedAt: null, archived: false };
  const after: Card = { ...before, comments: [{ id: "cm1", author: w.settings.actorId, body: "cc @Bob", timestamp: "2026-01-01T00:00:00.000Z" }] };
  const notes = onCardChange(w.members, before, after, w.settings.actorId, "2026-01-01T00:00:00.000Z");
  expect(notes.filter(n => n.memberId === bob && n.kind === "mention")).toHaveLength(1);
});

test("onCardChange: a newly added assignee is notified, a removed one is not", () => {
  const w = createWorkspace(); const bob = withSecondMember(w); const carolId = crypto.randomUUID();
  w.members.push({ id: carolId, name: "Carol", color: "#667b68" });
  const before: Card = { id: "c1", columnId: "x", position: 0, title: "T", description: "", priority: "none", dueDate: null, estimate: null, labels: [], assignees: [carolId], subtasks: [], comments: [], attachments: [], links: [], createdAt: "", updatedAt: "", completedAt: null, archived: false };
  const after: Card = { ...before, assignees: [bob] };
  const notes = onCardChange(w.members, before, after, w.settings.actorId, "2026-01-01T00:00:00.000Z");
  const assignmentNotes = notes.filter(n => n.kind === "assignment");
  expect(assignmentNotes).toHaveLength(1);
  expect(assignmentNotes[0]!.memberId).toBe(bob);
});

test("onCardChange: assigning yourself notifies nobody", () => {
  const w = createWorkspace();
  const before: Card = { id: "c1", columnId: "x", position: 0, title: "T", description: "", priority: "none", dueDate: null, estimate: null, labels: [], assignees: [], subtasks: [], comments: [], attachments: [], links: [], createdAt: "", updatedAt: "", completedAt: null, archived: false };
  const after: Card = { ...before, assignees: [w.settings.actorId] };
  const notes = onCardChange(w.members, before, after, w.settings.actorId, "2026-01-01T00:00:00.000Z");
  expect(notes).toHaveLength(0);
});

test("onCardChange: a watcher is notified of a real edit made by someone else", () => {
  const w = createWorkspace(); const bob = withSecondMember(w);
  const before: Card = { id: "c1", columnId: "x", position: 0, title: "Old title", description: "", priority: "none", dueDate: null, estimate: null, labels: [], assignees: [], watchers: [bob], subtasks: [], comments: [], attachments: [], links: [], createdAt: "", updatedAt: "", completedAt: null, archived: false };
  const after: Card = { ...before, title: "New title" };
  const notes = onCardChange(w.members, before, after, w.settings.actorId, "2026-01-01T00:00:00.000Z");
  expect(notes.filter(n => n.kind === "watch" && n.memberId === bob)).toHaveLength(1);
});

test("onCardChange: the watcher who made the edit is not notified of their own change", () => {
  const w = createWorkspace();
  const before: Card = { id: "c1", columnId: "x", position: 0, title: "Old title", description: "", priority: "none", dueDate: null, estimate: null, labels: [], assignees: [], watchers: [w.settings.actorId], subtasks: [], comments: [], attachments: [], links: [], createdAt: "", updatedAt: "", completedAt: null, archived: false };
  const after: Card = { ...before, title: "New title" };
  const notes = onCardChange(w.members, before, after, w.settings.actorId, "2026-01-01T00:00:00.000Z");
  expect(notes).toHaveLength(0);
});

test("onCardChange: a change limited to a sibling-renumbering position shift is not a watch-worthy change", () => {
  const w = createWorkspace(); const bob = withSecondMember(w);
  const before: Card = { id: "c1", columnId: "x", position: 2, title: "T", description: "", priority: "none", dueDate: null, estimate: null, labels: [], assignees: [], watchers: [bob], subtasks: [], comments: [], attachments: [], links: [], createdAt: "", updatedAt: "", completedAt: null, archived: false };
  const after: Card = { ...before, position: 1 };
  const notes = onCardChange(w.members, before, after, w.settings.actorId, "2026-01-01T00:00:00.000Z");
  expect(notes.filter(n => n.kind === "watch")).toHaveLength(0);
});

test("onCardChange: a deleted card (no after) produces no notifications", () => {
  const w = createWorkspace(); const bob = withSecondMember(w);
  const before: Card = { id: "c1", columnId: "x", position: 0, title: "T", description: "", priority: "none", dueDate: null, estimate: null, labels: [], assignees: [], watchers: [bob], subtasks: [], comments: [], attachments: [], links: [], createdAt: "", updatedAt: "", completedAt: null, archived: false };
  const notes = onCardChange(w.members, before, null, w.settings.actorId, "2026-01-01T00:00:00.000Z");
  expect(notes).toHaveLength(0);
});

test("capNotifications: caps each member's notifications at the documented maximum, keeping the newest", () => {
  const notes: Notification[] = [];
  for (let i = 0; i < MAX_NOTIFICATIONS_PER_MEMBER + 10; i++) {
    notes.push({ id: `n${i}`, memberId: "bob", kind: "mention", cardId: "c1", read: false, createdAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z` });
  }
  const capped = capNotifications(notes);
  const bobNotes = capped.filter(n => n.memberId === "bob");
  expect(bobNotes.length).toBe(MAX_NOTIFICATIONS_PER_MEMBER);
  expect(bobNotes[0]!.id).toBe("n10"); // the oldest 10 were dropped
  expect(bobNotes.at(-1)!.id).toBe(`n${MAX_NOTIFICATIONS_PER_MEMBER + 9}`);
});

test("capNotifications: caps are independent per member", () => {
  const notes: Notification[] = [];
  for (let i = 0; i < 5; i++) notes.push({ id: `a${i}`, memberId: "alice", kind: "mention", cardId: "c1", read: false, createdAt: "2026-01-01T00:00:00.000Z" });
  for (let i = 0; i < 5; i++) notes.push({ id: `b${i}`, memberId: "bob", kind: "mention", cardId: "c1", read: false, createdAt: "2026-01-01T00:00:00.000Z" });
  const capped = capNotifications(notes);
  expect(capped.filter(n => n.memberId === "alice")).toHaveLength(5);
  expect(capped.filter(n => n.memberId === "bob")).toHaveLength(5);
});

function dueFixture(dueDate: string): { w: Workspace; cardId: string } {
  const w = createWorkspace(); const p = createProject(w, "P");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const column = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position)[0]!;
  const card = createCard(w, column.id, "Due soon", "bottom");
  editCard(w, card.id, { dueDate, assignees: [w.settings.actorId] });
  return { w, cardId: card.id };
}

// Due dates are calendar days (end-of-day local, like `dueState` in model.ts); "now" is mid-afternoon
// on the due day itself, so the gap to end-of-day is comfortably inside 24h in any timezone.
test("due reminders: a card due within 24 hours generates exactly one reminder per assignee", () => {
  const now = new Date(2026, 2, 10, 15, 0, 0);
  const { w, cardId } = dueFixture("2026-03-10");
  expect(hasDueReminders(w, now)).toBe(true);
  const { created } = generateDueReminders(w, now);
  expect(created).toBe(1);
  const notes = (w.notifications ?? []).filter(n => n.cardId === cardId && n.kind === "due");
  expect(notes).toHaveLength(1);
  expect(notes[0]!.memberId).toBe(w.settings.actorId);
});

test("due reminders: an overdue card also generates a reminder", () => {
  const now = new Date("2026-03-10T10:00:00.000Z");
  const { w, cardId } = dueFixture("2026-03-01");
  const { created } = generateDueReminders(w, now);
  expect(created).toBe(1);
  expect((w.notifications ?? []).some(n => n.cardId === cardId && n.kind === "due")).toBe(true);
});

test("due reminders: a card due far in the future generates nothing", () => {
  const now = new Date("2026-03-10T10:00:00.000Z");
  const { w } = dueFixture("2026-04-10");
  expect(hasDueReminders(w, now)).toBe(false);
  expect(generateDueReminders(w, now).created).toBe(0);
});

test("due reminders: repeated passes never duplicate the same card/due-date reminder", () => {
  const now = new Date(2026, 2, 10, 15, 0, 0);
  const { w } = dueFixture("2026-03-10");
  generateDueReminders(w, now);
  const countAfterFirst = (w.notifications ?? []).length;
  generateDueReminders(w, now);
  generateDueReminders(w, new Date(2026, 2, 10, 15, 5, 0));
  expect((w.notifications ?? []).length).toBe(countAfterFirst);
  expect(hasDueReminders(w, now)).toBe(false);
});

test("due reminders: a changed due date is allowed to remind again", () => {
  const now = new Date(2026, 2, 10, 15, 0, 0);
  const { w, cardId } = dueFixture("2026-03-10");
  generateDueReminders(w, now);
  editCard(w, cardId, { dueDate: "2026-03-09" }); // now overdue instead of due today, a different date
  expect(hasDueReminders(w, now)).toBe(true);
  const { created } = generateDueReminders(w, now);
  expect(created).toBe(1);
});

test("due reminders: completed or archived cards never generate a reminder", () => {
  const now = new Date("2026-03-10T10:00:00.000Z");
  const w = createWorkspace(); const p = createProject(w, "P");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const columns = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  const done = columns.at(-1)!;
  const card = createCard(w, done.id, "Done card", "bottom", { dueDate: "2026-03-10", assignees: [w.settings.actorId] });
  expect(card.completedAt).not.toBeNull();
  expect(hasDueReminders(w, now)).toBe(false);
});

test("validateWorkspace: rejects a notification referencing an unknown member", () => {
  const w = createWorkspace();
  (w as unknown as { notifications: unknown }).notifications = [{ id: "n1", memberId: "ghost", kind: "mention", cardId: "c1", read: false, createdAt: new Date().toISOString() }];
  expect(() => validateWorkspace(w)).toThrow();
});

test("validateWorkspace: rejects a card watcher that is not a known member", () => {
  const w = createWorkspace(); const p = createProject(w, "P");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const column = w.columns.filter(c => c.boardId === board.id)[0]!;
  const card = createCard(w, column.id, "Card", "bottom");
  (card as unknown as { watchers: string[] }).watchers = ["ghost"];
  expect(() => validateWorkspace(w)).toThrow();
});

test("validateWorkspace: a workspace with no notifications field (old data) still validates", () => {
  const w = createWorkspace();
  expect(() => validateWorkspace(w)).not.toThrow();
});
