import type { Activity, Card, Workspace } from "./model";

export interface BurnupPoint { date: string; scope: number; done: number }

const DAY_MS = 86_400_000;
const localDay = (d: Date): Date => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; };
const isoLocal = (d: Date): string => d.toLocaleDateString("en-CA");

function flagsOf(state: Card | null, milestoneId: string): [inScope: boolean, done: boolean] {
  if (!state || state.milestoneId !== milestoneId) return [false, false];
  return [true, state.completedAt !== null];
}

interface FlagPoint { at: number; inScope: boolean; done: boolean }

// One flag timeline per card: a sorted list of instants at which (inScope, done) actually changes.
// A card with activity entries is driven entirely by those entries' before/after snapshots; a card
// with none falls back to its current fields, appearing at createdAt and completing at completedAt.
// State from before the first recorded entry is dated from createdAt, never earlier.
function cardFlagTimeline(card: Card | undefined, activities: Activity[], milestoneId: string): FlagPoint[] {
  const raw: { at: number; state: Card | null }[] = [];
  if (activities.length) {
    const first = activities[0]!;
    if (first.before) raw.push({ at: Math.min(Date.parse(first.before.createdAt), Date.parse(first.timestamp)), state: first.before });
    for (const a of activities) raw.push({ at: Date.parse(a.timestamp), state: a.after });
  } else if (card) {
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
    const [inScope, done] = flagsOf(state, milestoneId);
    if (inScope !== prevScope || done !== prevDone) { points.push({ at, inScope, done }); prevScope = inScope; prevDone = done; }
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

// Daily series from the first day any card carried the milestone through today, built by a single
// sorted sweep over every card's scope/done delta events (never days × cards × activities).
export function milestoneBurnup(w: Workspace, milestoneId: string, today: Date = new Date()): BurnupPoint[] {
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
    const timeline = cardFlagTimeline(cardsById.get(cardId), activitiesByCard.get(cardId) ?? [], milestoneId);
    const firstScope = timeline.find(p => p.inScope);
    if (firstScope && (firstScopeAt === null || firstScope.at < firstScopeAt)) firstScopeAt = firstScope.at;
    allEvents.push(...deltaEvents(timeline));
  }
  if (firstScopeAt === null) return [];
  allEvents.sort((a, b) => a.at - b.at);

  const startDay = localDay(new Date(firstScopeAt));
  const endDay = localDay(today);
  const points: BurnupPoint[] = [];
  let scope = 0, done = 0, eventIndex = 0;
  for (const day = new Date(startDay); day <= endDay; day.setDate(day.getDate() + 1)) {
    const dayEnd = day.getTime() + DAY_MS - 1; // 23:59:59.999 local
    while (eventIndex < allEvents.length && allEvents[eventIndex]!.at <= dayEnd) {
      scope += allEvents[eventIndex]!.dScope; done += allEvents[eventIndex]!.dDone; eventIndex++;
    }
    points.push({ date: isoLocal(day), scope, done });
  }
  return points;
}

export interface BurnupChartLayout { rangeStart: string; days: number; todayOffset: number; milestoneOffset: number | null; maxValue: number }
function parseLocalISO(iso: string): Date { const [y, m, d] = iso.split("-").map(Number); return new Date(y!, m! - 1, d!); }
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
