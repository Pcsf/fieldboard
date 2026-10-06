import { editCard, createCard, id, type Card, type Workspace } from "./model";

export const frequencies = ["daily", "weekly", "monthly"] as const;
export type Frequency = typeof frequencies[number];
export interface Recurrence { frequency: Frequency; columnId: string; next: string }

// Occurrences missed while the app was closed are reconciled in one visit; a per-pass cap keeps a
// years-old neglected recurrence from generating years of cards in one sitting.
export const MAX_CATCHUP = 31;

function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function parseCalendarDate(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}
function pad(n: number, width: number): string { return String(n).padStart(width, "0"); }
function formatCalendarDate(y: number, m: number, d: number): string { return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`; }
// UTC only, never a local Date: local arithmetic across a DST transition can add or subtract a wall
// clock hour and land on the wrong calendar day; UTC has no DST to drift across.
function daysInMonth(year: number, month1: number): number { return new Date(Date.UTC(year, month1, 0)).getUTCDate(); }

export function addCalendarDays(date: string, days: number): string {
  const { y, m, d } = parseCalendarDate(date);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return formatCalendarDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
// A day that is the last day of its (short) month looks like a previous clamp, so the next month is
// retried at day 31 -- this is what makes a 31st-of-the-month recurrence come back to the 31st the
// next time a 31-day month allows it, without storing a separate "intended day" anywhere (the schema
// is exactly {frequency, columnId, next}; see DECISIONS "Recurring cards"). A genuinely ordinary day
// (1-28) is never the last day of any month it falls in, so it is never affected by this rule.
function impliedAnchorDay(date: string): number {
  const { y, m, d } = parseCalendarDate(date);
  const last = daysInMonth(y, m);
  return d === last && d < 31 ? 31 : d;
}
export function addCalendarMonth(date: string): string {
  const { y, m } = parseCalendarDate(date);
  const anchor = impliedAnchorDay(date);
  let year = y, month = m + 1;
  if (month > 12) { month = 1; year++; }
  return formatCalendarDate(year, month, Math.min(anchor, daysInMonth(year, month)));
}
export function nextOccurrence(date: string, frequency: Frequency): string {
  if (frequency === "daily") return addCalendarDays(date, 1);
  if (frequency === "weekly") return addCalendarDays(date, 7);
  return addCalendarMonth(date);
}

export function todayCalendarDate(now: Date = new Date()): string {
  return formatCalendarDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// Pure: how many occurrences are due as of `today`, and what `next` becomes afterward. Capped at
// `cap` counted occurrences, then fast-forwarded (without counting further copies) until `next` is
// no longer due, so the caller never has to loop this itself and `next` never gets stuck <= today.
export function dueOccurrences(recurrence: Recurrence, today: string, cap = MAX_CATCHUP): { count: number; next: string; capped: boolean } {
  let next = recurrence.next; let count = 0;
  while (next <= today && count < cap) { next = nextOccurrence(next, recurrence.frequency); count++; }
  let capped = false;
  while (next <= today) { next = nextOccurrence(next, recurrence.frequency); capped = true; }
  return { count, next, capped };
}

export function hasDueRecurrences(w: Workspace, now: Date = new Date()): boolean {
  const today = todayCalendarDate(now);
  return w.cards.some(c => !c.archived && c.recurrence && c.recurrence.next <= today);
}

// Copies exactly what the claim lists (title, description, labels, priority, assignees, subtasks
// unchecked) and nothing else: no comments, attachments, links, time entries, due date, estimate,
// milestone, blocked state, dependencies or the recurrence itself -- each new occurrence starts as a
// fresh instance of the recurring work, not a clone of the previous instance's in-progress state.
function spawnOccurrence(w: Workspace, source: Card, columnId: string): Card {
  return createCard(w, columnId, source.title, "bottom", {
    description: source.description,
    labels: [...source.labels],
    priority: source.priority,
    assignees: [...source.assignees],
    subtasks: source.subtasks.map(s => ({ id: id(), title: s.title, done: false, position: s.position })),
  });
}

// The whole pass -- every due card's catch-up copies plus its own `next` advance -- is meant to be
// run inside exactly one `stage()`/`session.change()` call from the app layer (see DECISIONS); that
// single commit is what makes a reload or a second tab unable to duplicate work, not anything here.
export function generateRecurrences(w: Workspace, now: Date = new Date(), cap = MAX_CATCHUP): { created: number; cappedCards: string[] } {
  const today = todayCalendarDate(now);
  let created = 0; const cappedCards: string[] = [];
  for (const source of w.cards.slice()) {
    const recurrence = source.recurrence;
    if (!recurrence || source.archived || recurrence.next > today) continue;
    if (!w.columns.some(c => c.id === recurrence.columnId)) continue; // dangling reference; validateWorkspace prevents this in practice
    const { count, next, capped } = dueOccurrences(recurrence, today, cap);
    for (let i = 0; i < count; i++) spawnOccurrence(w, source, recurrence.columnId);
    if (count > 0 || next !== recurrence.next) editCard(w, source.id, { recurrence: { ...recurrence, next } });
    created += count;
    if (capped) cappedCards.push(source.id);
  }
  return { created, cappedCards };
}

export function validateRecurrence(value: unknown): asserts value is Recurrence {
  if (!value || typeof value !== "object") throw new Error("Invalid recurrence");
  const r = value as Record<string, unknown>;
  if (!frequencies.includes(r.frequency as Frequency)) throw new Error("Invalid recurrence frequency");
  if (typeof r.columnId !== "string" || !r.columnId.trim()) throw new Error("Recurrence requires a column");
  if (typeof r.next !== "string" || !isCalendarDate(r.next)) throw new Error("Invalid recurrence date");
}
