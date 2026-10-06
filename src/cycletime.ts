import type { Activity, Card, Column } from "./model";

export interface CardTimes { leadDays: number | null; cycleDays: number | null; inProgressDays: number | null }

const DAY_MS = 86_400_000;

export function firstColumnId(columns: Column[]): string | undefined {
  return columns.slice().sort((a, b) => a.position - b.position)[0]?.id;
}

// The first instant the card's Activity shows it leaving the board's first column, scanned oldest
// first so a card that left, came back, and left again still starts its cycle at the FIRST exit.
// A card with no such entry — created straight into another column, never left the first column,
// or holding no history at all — starts its cycle at its own createdAt instead.
function cycleStartAt(card: Card, activities: Activity[], firstColId: string | undefined): number {
  if (firstColId !== undefined) {
    const sorted = activities.slice().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    for (const a of sorted) if (a.before?.columnId === firstColId && a.after && a.after.columnId !== firstColId) return Date.parse(a.timestamp);
  }
  return Date.parse(card.createdAt);
}

// Lead time is createdAt -> the card's CURRENT completedAt (not any earlier completion a reopen
// erased): the model keeps only one live completedAt, so reading it already is "the latest
// completion" with no extra history lookup. Cycle time is cycleStartAt -> that same completedAt.
// Both are null for a card still open; inProgressDays (createdAt -> now) is reported instead.
export function cardTimes(card: Card, activities: Activity[], columns: Column[], now: Date = new Date()): CardTimes {
  const createdAt = Date.parse(card.createdAt);
  if (card.completedAt !== null) {
    const completedAt = Date.parse(card.completedAt);
    const cycleStart = cycleStartAt(card, activities, firstColumnId(columns));
    return { leadDays: (completedAt - createdAt) / DAY_MS, cycleDays: (completedAt - cycleStart) / DAY_MS, inProgressDays: null };
  }
  return { leadDays: null, cycleDays: null, inProgressDays: (now.getTime() - createdAt) / DAY_MS };
}

// Linear interpolation between closest ranks (the common median/percentile convention): p=50 on an
// even-length set averages the two middle values, matching the usual definition of "the median".
export function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lower = Math.floor(rank), upper = Math.ceil(rank), weight = rank - lower;
  return sortedAsc[lower]! + weight * (sortedAsc[upper]! - sortedAsc[lower]!);
}

export interface TimeDistribution { count: number; medianDays: number | null; p85Days: number | null; samples: number[] }
export function summarizeDistribution(values: number[]): TimeDistribution {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, medianDays: null, p85Days: null, samples: [] };
  return { count: sorted.length, medianDays: percentile(sorted, 50), p85Days: percentile(sorted, 85), samples: sorted };
}

export interface BoardCycleStats { lead: TimeDistribution; cycle: TimeDistribution }
// Cards completed within the selected range (by their current completedAt); archived counts as
// scope exactly like the rest of this app's planning/insight views, deleted cards never appear here
// since they are not passed in at all.
export function boardCycleStats(cards: Card[], activitiesByCard: Map<string, Activity[]>, columns: Column[], rangeDays: number | null, today: Date = new Date()): BoardCycleStats {
  const cutoff = rangeDays === null ? -Infinity : today.getTime() - rangeDays * DAY_MS;
  const leads: number[] = []; const cycles: number[] = [];
  for (const card of cards) {
    if (card.completedAt === null) continue;
    const completedAt = Date.parse(card.completedAt);
    if (completedAt < cutoff || completedAt > today.getTime()) continue;
    const t = cardTimes(card, activitiesByCard.get(card.id) ?? [], columns, today);
    if (t.leadDays !== null) leads.push(t.leadDays);
    if (t.cycleDays !== null) cycles.push(t.cycleDays);
  }
  return { lead: summarizeDistribution(leads), cycle: summarizeDistribution(cycles) };
}
