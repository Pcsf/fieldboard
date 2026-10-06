import { parseMentions } from "./mentions";
import type { Card, Member, Workspace } from "./model";

export const notificationKinds = ["mention", "assignment", "due", "watch"] as const;
export type NotificationKind = typeof notificationKinds[number];
// `dedupeKey` is set only on "due" notifications (see `generateDueReminders`): it is what lets a
// reload or a missed day reconcile without ever creating the same card/due-date reminder twice.
export interface Notification { id: string; memberId: string; kind: NotificationKind; cardId: string; read: boolean; createdAt: string; dedupeKey?: string }

// Keeps each member's inbox bounded regardless of workspace age: the oldest entries for that member
// are dropped first, read or unread alike -- see DECISIONS "Notifications".
export const MAX_NOTIFICATIONS_PER_MEMBER = 200;

function newId(): string { return crypto.randomUUID(); }

// Drops the oldest entries per member above the cap while preserving the original relative order of
// everyone else's notifications (callers always append newest-last, so "oldest" is "earliest in the
// array" per member).
export function capNotifications(notifications: Notification[]): Notification[] {
  const counts = new Map<string, number>();
  for (const n of notifications) counts.set(n.memberId, (counts.get(n.memberId) ?? 0) + 1);
  const seen = new Map<string, number>();
  return notifications.filter(n => {
    const total = counts.get(n.memberId)!; const index = seen.get(n.memberId) ?? 0; seen.set(n.memberId, index + 1);
    return total - index <= MAX_NOTIFICATIONS_PER_MEMBER;
  });
}

function mentionedMemberIds(text: string, members: Member[]): Set<string> {
  return new Set(parseMentions(text, members).map(m => m.memberId));
}

// True when every field of `before`/`after` is equal except `position` (and `updatedAt`, which the
// caller has not yet stamped at this point anyway). A pure reindex -- another card in the same column
// being created, moved or deleted renumbers its siblings -- is not a change a watcher asked to hear
// about; a real move (which also changes `columnId`) still is.
function meaningfulChange(before: Card, after: Card): boolean {
  const ignore = new Set(["position", "updatedAt"]);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof Card>;
  for (const key of keys) { if (ignore.has(key as string)) continue; if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) return true; }
  return false;
}

// Called once per changed card from the same `audit()` pass that already writes the Activity entry
// (see model.ts), so this never re-scans history and never fires per field -- one call, at most one
// notification per recipient per kind. Returns new notifications to append; callers cap the result.
export function onCardChange(members: Member[], before: Card | null, after: Card | null, actorId: string, createdAt: string): Notification[] {
  if (!after) return [];
  const notes: Notification[] = [];
  const recipient = (memberId: string, kind: NotificationKind) => {
    if (memberId === actorId || !members.some(m => m.id === memberId)) return;
    notes.push({ id: newId(), memberId, kind, cardId: after.id, read: false, createdAt });
  };
  const beforeMentions = before ? mentionedMemberIds(before.description, members) : new Set<string>();
  for (const memberId of mentionedMemberIds(after.description, members)) if (!beforeMentions.has(memberId)) recipient(memberId, "mention");
  const beforeCommentIds = new Set((before?.comments ?? []).map(c => c.id));
  for (const comment of after.comments) if (!beforeCommentIds.has(comment.id)) for (const memberId of mentionedMemberIds(comment.body, members)) recipient(memberId, "mention");
  const beforeAssignees = new Set(before?.assignees ?? []);
  for (const memberId of after.assignees) if (!beforeAssignees.has(memberId)) recipient(memberId, "assignment");
  if (before && meaningfulChange(before, after)) for (const memberId of new Set([...(before.watchers ?? []), ...(after.watchers ?? [])])) recipient(memberId, "watch");
  return notes;
}

// Pure read-only check mirroring `hasDueRecurrences` in recurring.ts: lets `checkRecurrences` skip a
// commit entirely on an idle board instead of writing to storage on every scheduled check.
function dueReminderTargets(w: Workspace, at: Date): { cardId: string; dueDate: string; memberId: string; dedupeKey: string }[] {
  const targets: { cardId: string; dueDate: string; memberId: string; dedupeKey: string }[] = [];
  for (const c of w.cards) {
    if (c.archived || c.completedAt || !c.dueDate) continue;
    const due = new Date(`${c.dueDate}T23:59:59`).getTime();
    if (due - at.getTime() > 24 * 3600_000) continue; // more than 24h out: not yet due, not overdue
    for (const memberId of c.assignees) targets.push({ cardId: c.id, dueDate: c.dueDate, memberId, dedupeKey: `due:${c.id}:${c.dueDate}` });
  }
  return targets;
}
export function hasDueReminders(w: Workspace, at: Date = new Date()): boolean {
  const existing = w.notifications ?? [];
  return dueReminderTargets(w, at).some(t => !existing.some(n => n.memberId === t.memberId && n.dedupeKey === t.dedupeKey));
}
// One reminder per card/due-date/member, ever: the dedupe key is checked against everything already
// stored, so a reload, a missed day, or calling this twice in the same minute never duplicates one.
// Changing a card's due date is a new situation and is allowed to remind again.
export function generateDueReminders(w: Workspace, at: Date = new Date()): { created: number } {
  const notifications = [...(w.notifications ?? [])];
  let created = 0;
  for (const target of dueReminderTargets(w, at)) {
    if (notifications.some(n => n.memberId === target.memberId && n.dedupeKey === target.dedupeKey)) continue;
    notifications.push({ id: newId(), memberId: target.memberId, kind: "due", cardId: target.cardId, read: false, createdAt: at.toISOString(), dedupeKey: target.dedupeKey });
    created++;
  }
  if (created) w.notifications = capNotifications(notifications);
  return { created };
}

// Structural validation only, mirroring model.ts's own style (see `checkCard`): shape and a relational
// check against known members (members are append-only in this app, so this is stable), but not
// against live cards -- a notification outliving the card it names is handled by `deleteCard`'s
// cascade, the same way Activity history is allowed to outlive a deleted card.
function fail(message: string): never { throw new Error(`Invalid workspace: ${message}`); }
export function validateNotifications(value: unknown, memberIds: string[]): void {
  if (!Array.isArray(value)) fail("expected notifications array");
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") fail("expected notification object");
    const n = entry as Record<string, unknown>;
    if (typeof n.id !== "string" || !n.id.trim()) fail("notification requires an id");
    if (seen.has(n.id)) fail("duplicate notification id"); seen.add(n.id);
    if (typeof n.memberId !== "string" || !memberIds.includes(n.memberId)) fail("unknown notification member");
    if (!notificationKinds.includes(n.kind as NotificationKind)) fail("invalid notification kind");
    if (typeof n.cardId !== "string" || !n.cardId.trim()) fail("notification requires a card id");
    if (typeof n.read !== "boolean") fail("notification read flag must be boolean");
    if (typeof n.createdAt !== "string" || !Number.isFinite(Date.parse(n.createdAt))) fail("invalid notification timestamp");
    if (n.dedupeKey !== undefined && (typeof n.dedupeKey !== "string" || !n.dedupeKey.trim())) fail("invalid notification dedupe key");
  }
}
