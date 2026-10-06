import { editCard, id, type Workspace } from "./model";

// A running entry is `end: null`; only its start is ever stored, so a reload (or a second tab's
// commit) never loses or duplicates elapsed time -- the displayed elapsed figure is always computed
// fresh from `start` and the current time, never persisted.
export interface TimeEntry { id: string; start: string; end: string | null; note?: string }

export function runningEntry(entries: TimeEntry[]): TimeEntry | undefined { return entries.find(e => e.end === null); }

export function entryDurationMs(e: TimeEntry, now: number): number {
  const end = e.end !== null ? Date.parse(e.end) : now;
  return Math.max(0, end - Date.parse(e.start));
}

// Only this card's own entries are ever touched -- summing them costs work proportional to this
// card's entry count, never to the workspace's card count, same class as the existing subtask/label
// counts cardHTML already computes per card.
export function totalTrackedMs(entries: TimeEntry[], now = Date.now()): number {
  return entries.reduce((sum, e) => sum + entryDurationMs(e, now), 0);
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMinutes / 60); const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Overlap is checked only among entries with a known end: a running entry's real end is unknown, so
// it is excluded here and instead governed by its own "at most one running entry" rule -- closing it
// (stopTimer) re-enters this check with a concrete end, same as any manual entry would.
function overlapsCompleted(entries: TimeEntry[], candidate: { start: string; end: string }, excludeId?: string): boolean {
  const cStart = Date.parse(candidate.start); const cEnd = Date.parse(candidate.end);
  return entries.some(e => e.id !== excludeId && e.end !== null && Date.parse(e.start) < cEnd && cStart < Date.parse(e.end));
}
export function hasOverlap(entries: TimeEntry[]): boolean {
  const completed = entries.filter(e => e.end !== null);
  return completed.some((e, i) => overlapsCompleted(completed.slice(0, i), { start: e.start, end: e.end! }));
}

function card(w: Workspace, cardId: string) {
  const c = w.cards.find(c => c.id === cardId); if (!c) throw new Error("Card not found"); return c;
}
export function startTimer(w: Workspace, cardId: string) {
  const entries = card(w, cardId).timeEntries ?? [];
  if (runningEntry(entries)) throw new Error("A timer is already running on this card");
  editCard(w, cardId, { timeEntries: [...entries, { id: id(), start: new Date().toISOString(), end: null }] });
}
export function stopTimer(w: Workspace, cardId: string) {
  const entries = card(w, cardId).timeEntries ?? []; const running = runningEntry(entries);
  if (!running) throw new Error("No timer is running on this card");
  const end = new Date().toISOString();
  if (Date.parse(end) < Date.parse(running.start)) throw new Error("Stop time cannot be before start time");
  if (overlapsCompleted(entries, { start: running.start, end }, running.id)) throw new Error("Stopping now would overlap another time entry on this card");
  editCard(w, cardId, { timeEntries: entries.map(e => e.id === running.id ? { ...e, end } : e) });
}
export function addManualEntry(w: Workspace, cardId: string, start: string, end: string, note = "") {
  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) throw new Error("Enter a valid start and end");
  if (Date.parse(end) <= Date.parse(start)) throw new Error("End must be after start");
  const entries = card(w, cardId).timeEntries ?? [];
  if (overlapsCompleted(entries, { start, end })) throw new Error("This entry overlaps another time entry on this card");
  const trimmed = note.trim();
  editCard(w, cardId, { timeEntries: [...entries, { id: id(), start, end, ...(trimmed ? { note: trimmed } : {}) }] });
}
export function deleteEntry(w: Workspace, cardId: string, entryId: string) {
  const entries = card(w, cardId).timeEntries ?? [];
  editCard(w, cardId, { timeEntries: entries.filter(e => e.id !== entryId) });
}

// Structural only (see DECISIONS "IED planning extension" for why this split exists at all): every
// invariant here is checkable from the entry list alone, with no reference to other cards or to "now",
// so it applies identically to a live card and to an Activity before/after snapshot.
export function validateTimeEntries(value: unknown): asserts value is TimeEntry[] {
  if (!Array.isArray(value)) throw new Error("Time entries must be an array");
  const seen = new Set<string>();
  for (const v of value) {
    if (!v || typeof v !== "object") throw new Error("Invalid time entry");
    const e = v as Record<string, unknown>;
    if (typeof e.id !== "string" || !e.id.trim()) throw new Error("Time entry requires an id");
    if (seen.has(e.id)) throw new Error("Duplicate time entry id"); seen.add(e.id);
    if (typeof e.start !== "string" || !Number.isFinite(Date.parse(e.start))) throw new Error("Invalid time entry start");
    if (e.end !== null) {
      if (typeof e.end !== "string" || !Number.isFinite(Date.parse(e.end))) throw new Error("Invalid time entry end");
      if (Date.parse(e.end) < Date.parse(e.start)) throw new Error("Time entry ends before it starts");
    }
    if (e.note !== undefined && typeof e.note !== "string") throw new Error("Time entry note must be text");
  }
  const entries = value as TimeEntry[];
  if (entries.filter(e => e.end === null).length > 1) throw new Error("Only one running time entry is allowed per card");
  if (hasOverlap(entries)) throw new Error("Time entries overlap");
}
