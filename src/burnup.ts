import type { Activity, Card, Workspace } from "./model";

export interface BurnupPoint { date: string; scope: number; done: number }
// A scope predicate decides, from one historical (or current) card snapshot, whether that state
// counts as "in scope" for the series being drawn. milestoneBurnup below is the original caller;
// sprintBurnup (src/planning.ts) reuses this same engine with its own predicate rather than a copy.
export type ScopePredicate = (state: Card) => boolean;

const DAY_MS = 86_400_000;
const localDay = (d: Date): Date => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; };
const isoLocal = (d: Date): string => d.toLocaleDateString("en-CA");

function flagsOf(state: Card | null, inScope: ScopePredicate): [inScope: boolean, done: boolean] {
  if (!state || !inScope(state)) return [false, false];
  return [true, state.completedAt !== null];
}

interface FlagPoint { at: number; inScope: boolean; done: boolean }

export interface RawCardState { at: number; state: Card | null }
// The shared replay step every per-card history reconstruction in this app starts from: one dated
// state per Activity entry's `after`, plus (when the log doesn't start at the card's creation) one
// synthetic point for whatever `before` the first entry already carried. That point is dated from
// the earlier of the card's own createdAt and the entry's timestamp, so pre-log state is never
// placed before the card is known to have existed, even under clock skew on the first entry itself.
export function rawActivityStates(activities: Activity[]): RawCardState[] {
  const raw: RawCardState[] = [];
  if (!activities.length) return raw;
  const first = activities[0]!;
  if (first.before) raw.push({ at: Math.min(Date.parse(first.before.createdAt), Date.parse(first.timestamp)), state: first.before });
  for (const a of activities) raw.push({ at: Date.parse(a.timestamp), state: a.after });
  return raw;
}

// One flag timeline per card: a sorted list of instants at which (inScope, done) actually changes.
// A card with activity entries is driven entirely by those entries' before/after snapshots; a card
// with none falls back to its current fields, appearing at createdAt and completing at completedAt.
// State from before the first recorded entry is dated from createdAt, never earlier.
function cardFlagTimeline(card: Card | undefined, activities: Activity[], inScope: ScopePredicate): FlagPoint[] {
  const raw: RawCardState[] = rawActivityStates(activities);
  if (!activities.length && card) {
    raw.push({ at: Date.parse(card.createdAt), state: { ...card, completedAt: null } });
    if (card.completedAt !== null) raw.push({ at: Date.parse(card.completedAt), state: card });
  }
  // Later entries at the same instant win (a tie only happens when createdAt === completedAt).
  const byTime = new Map<number, Card | null>();
  for (const r of raw) byTime.set(r.at, r.state);
  const ordered = [...byTime.entries()].sort((a, b) => a[0] - b[0]);
  const points: FlagPoint[] = [];
  let prevScope = false, prevDone = false;
  for (const [at, state] of ordered) {
    const [scoped, done] = flagsOf(state, inScope);
    if (scoped !== prevScope || done !== prevDone) { points.push({ at, inScope: scoped, done }); prevScope = scoped; prevDone = done; }
  }
  return points;
}

interface DeltaEvent { at: number; dScope: number; dDone: number }
function deltaEvents(timeline: FlagPoint[]): DeltaEvent[] {
  const events: DeltaEvent[] = [];
  let prevScope = false, prevDone = false;
  for (const p of timeline) {
    events.push({ at: p.at, dScope: (p.inScope ? 1 : 0) - (prevScope ? 1 : 0), dDone: (p.done ? 1 : 0) - (prevDone ? 1 : 0) });
    prevScope = p.inScope; prevDone = p.done;
  }
  return events;
}

// Collects every card's scope/done delta events (never days × cards × activities) and the earliest
// instant any card matched `inScope`, shared by every burnup flavour below -- burnup(), milestoneBurnup
// and sprintBurnup (src/planning.ts, via burnupInWindow) all sweep the same event stream, they just
// pick different day ranges to sweep it over.
function collectEvents(w: Workspace, inScope: ScopePredicate): { firstScopeAt: number | null; events: DeltaEvent[] } {
  const cardsById = new Map(w.cards.map(c => [c.id, c]));
  const activitiesByCard = new Map<string, Activity[]>();
  for (const a of w.activities) {
    const list = activitiesByCard.get(a.cardId); if (list) list.push(a); else activitiesByCard.set(a.cardId, [a]);
  }
  for (const list of activitiesByCard.values()) list.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const cardIds = new Set([...cardsById.keys(), ...activitiesByCard.keys()]);

  let firstScopeAt: number | null = null;
  const allEvents: DeltaEvent[] = [];
  for (const cardId of cardIds) {
    const timeline = cardFlagTimeline(cardsById.get(cardId), activitiesByCard.get(cardId) ?? [], inScope);
    const firstScope = timeline.find(p => p.inScope);
    if (firstScope && (firstScopeAt === null || firstScope.at < firstScopeAt)) firstScopeAt = firstScope.at;
    allEvents.push(...deltaEvents(timeline));
  }
  allEvents.sort((a, b) => a.at - b.at);
  return { firstScopeAt, events: allEvents };
}
// One point per calendar day from startDay through endDay inclusive, regardless of when the data
// itself starts: every event timestamped at or before a day's end is swept into that day's
// cumulative total, so an event before `startDay` is folded into day one's opening value rather than
// being skipped -- "history before the window counts as the state at the start" falls out of this
// for free, it needs no separate case.
function sweepDays(events: DeltaEvent[], startDay: Date, endDay: Date): BurnupPoint[] {
  const points: BurnupPoint[] = [];
  let scope = 0, done = 0, eventIndex = 0;
  for (const day = new Date(startDay); day <= endDay; day.setDate(day.getDate() + 1)) {
    const dayEnd = day.getTime() + DAY_MS - 1; // 23:59:59.999 local
    while (eventIndex < events.length && events[eventIndex]!.at <= dayEnd) {
      scope += events[eventIndex]!.dScope; done += events[eventIndex]!.dDone; eventIndex++;
    }
    points.push({ date: isoLocal(day), scope, done });
  }
  return points;
}
// Daily series from the first day any card matched `inScope` through today -- the milestone shape,
// where there is no independently known start date, so the data itself decides where the series begins.
export function burnup(w: Workspace, inScope: ScopePredicate, today: Date = new Date()): BurnupPoint[] {
  const { firstScopeAt, events } = collectEvents(w, inScope);
  if (firstScopeAt === null) return [];
  return sweepDays(events, localDay(new Date(firstScopeAt)), localDay(today));
}
export function milestoneBurnup(w: Workspace, milestoneId: string, today: Date = new Date()): BurnupPoint[] {
  return burnup(w, state => state.milestoneId === milestoneId, today);
}
// Daily series over an explicit, independently-known window (a sprint's own start/end dates) rather
// than the data-derived range burnup() uses -- the window is drawn in full even on a day nothing
// changed, and even when no card ever matched `inScope` at all (a flat zero line), because the window
// itself carries meaning (it's the sprint's own dates) independent of whether any card ever used it.
export function burnupInWindow(w: Workspace, inScope: ScopePredicate, start: Date, end: Date): BurnupPoint[] {
  const { events } = collectEvents(w, inScope);
  return sweepDays(events, localDay(start), localDay(end));
}

export interface BurnupChartLayout { rangeStart: string; days: number; todayOffset: number; milestoneOffset: number | null; maxValue: number }
export function parseLocalISO(iso: string): Date { const [y, m, d] = iso.split("-").map(Number); return new Date(y!, m! - 1, d!); }
function daysBetweenISO(aISO: string, bISO: string): number { return Math.round((parseLocalISO(bISO).getTime() - parseLocalISO(aISO).getTime()) / DAY_MS); }

// Day-unit layout only (no pixels here, same split as layoutTimeline/mountTimeline): the x-axis
// extends to the milestone date when it is still in the future, otherwise the series already
// covers today and nothing is added — there is never a point drawn past today.
export function layoutBurnup(points: BurnupPoint[], milestoneDate: string, today: Date = new Date()): BurnupChartLayout {
  if (!points.length) {
    const rangeStart = isoLocal(localDay(today));
    const milestoneRaw = daysBetweenISO(rangeStart, milestoneDate);
    return { rangeStart, days: Math.max(1, milestoneRaw + 1), todayOffset: 0, milestoneOffset: milestoneRaw >= 0 ? milestoneRaw : null, maxValue: 1 };
  }
  const rangeStart = points[0]!.date;
  const todayOffset = points.length - 1;
  const milestoneRaw = daysBetweenISO(rangeStart, milestoneDate);
  const days = milestoneRaw > todayOffset ? milestoneRaw + 1 : points.length;
  const maxValue = Math.max(1, ...points.map(p => p.scope));
  return { rangeStart, days, todayOffset, milestoneOffset: milestoneRaw >= 0 ? milestoneRaw : null, maxValue };
}

// Layout for a window-bounded chart (burnupInWindow's points, which already span the full window --
// unlike layoutBurnup, there is no "extend to the milestone date" step because the window's own end
// is already the last point, or past it if an open sprint has run over). today/end markers are only
// placed when they actually fall inside the drawn range; otherwise they are omitted rather than
// clamped to an edge, so a marker is never shown somewhere it doesn't truly belong.
export interface WindowedBurnupLayout { rangeStart: string; days: number; todayOffset: number | null; endOffset: number | null; maxValue: number }
export function layoutWindowedBurnup(points: BurnupPoint[], endDate: string, today: Date = new Date()): WindowedBurnupLayout {
  if (!points.length) return { rangeStart: endDate, days: 1, todayOffset: null, endOffset: null, maxValue: 1 };
  const rangeStart = points[0]!.date;
  const days = points.length;
  const todayRaw = daysBetweenISO(rangeStart, isoLocal(localDay(today)));
  const todayOffset = todayRaw >= 0 && todayRaw < days ? todayRaw : null;
  const endRaw = daysBetweenISO(rangeStart, endDate);
  const endOffset = endRaw >= 0 && endRaw < days ? endRaw : null;
  const maxValue = Math.max(1, ...points.map(p => p.scope));
  return { rangeStart, days, todayOffset, endOffset, maxValue };
}

// Nice integer tick values for the count axis: a handful of evenly spaced steps up to the maximum,
// always ending exactly on the maximum so the top gridline matches the chart's own scale ceiling.
export function countTicks(maxValue: number): number[] {
  const max = Math.max(1, Math.ceil(maxValue));
  const step = Math.max(1, Math.ceil(max / 4));
  const ticks: number[] = [];
  for (let v = 0; v < max; v += step) ticks.push(v);
  ticks.push(max);
  return ticks;
}

export interface BurnupAxisTick { offset: number; label: string }
// The chart never scrolls (unlike the timeline view's per-day-pixel axis), so density is capped by
// a target tick count rather than by day width: a fixed step keeps labels readable at any container
// width, from the 720px milestones dialog down to a 390px phone, without measuring layout in JS.
export function burnupAxisTicks(rangeStart: string, days: number, targetCount = 5, locale?: string): BurnupAxisTick[] {
  const start = parseLocalISO(rangeStart);
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const label = (offset: number): string => { const d = new Date(start); d.setDate(d.getDate() + offset); return fmt.format(d); };
  const lastOffset = Math.max(0, days - 1);
  const step = Math.max(1, Math.ceil(lastOffset / Math.max(1, targetCount - 1)));
  const offsets = new Set<number>();
  for (let o = 0; o <= lastOffset; o += step) offsets.add(o);
  offsets.add(lastOffset); // today (or the milestone date, when it is the later one) is always labelled
  return [...offsets].sort((a, b) => a - b).map(offset => ({ offset, label: label(offset) }));
}
