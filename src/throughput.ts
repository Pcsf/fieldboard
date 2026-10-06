import type { Card } from "./model";

export interface ThroughputWeek { weekStart: string; count: number }

const isoLocal = (d: Date): string => d.toLocaleDateString("en-CA");
function mondayOf(d: Date): Date { const c = new Date(d); c.setHours(0, 0, 0, 0); c.setDate(c.getDate() - ((c.getDay() + 6) % 7)); return c; }

// Only currently-completed cards count, read straight off their live completedAt: a card whose
// completion was undone has no completedAt right now, so it is never in this scan at all — no
// Activity replay needed for this one, unlike the cumulative flow diagram and cycle time above.
export function weeklyThroughput(cards: Card[], weeks = 12, today: Date = new Date()): ThroughputWeek[] {
  const thisWeekStart = mondayOf(today);
  const firstWeekStart = new Date(thisWeekStart); firstWeekStart.setDate(firstWeekStart.getDate() - 7 * (weeks - 1));
  const buckets: ThroughputWeek[] = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(firstWeekStart); d.setDate(d.getDate() + 7 * i); return { weekStart: isoLocal(d), count: 0 };
  });
  const indexByWeek = new Map(buckets.map((b, i) => [b.weekStart, i]));
  for (const card of cards) {
    if (card.completedAt === null) continue;
    const idx = indexByWeek.get(isoLocal(mondayOf(new Date(card.completedAt))));
    if (idx !== undefined) buckets[idx]!.count++;
  }
  return buckets;
}
