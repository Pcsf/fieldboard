import type { Activity, Card } from "./model";

const DAY_MS = 86_400_000;

// One entry per card: the column it last actually entered, and when. An Activity entry counts as
// an entry into `after`'s column when there is no `before` (create, undo-of-delete) or `before`
// names a different column (move, board move, column delete relocation, undo-of-move). An edit
// that leaves the column unchanged produces an entry too, but before/after agree, so it never
// overwrites the map.
export interface ColumnEntry { columnId: string; timestamp: string }

export function extendColumnEntryIndex(index: Map<string, ColumnEntry>, activities: Activity[], from = 0): Map<string, ColumnEntry> {
  for (let i = from; i < activities.length; i++) {
    const a = activities[i]!;
    if (!a.after) continue;
    if (a.before === null || a.before.columnId !== a.after.columnId) index.set(a.cardId, { columnId: a.after.columnId, timestamp: a.timestamp });
  }
  return index;
}

export function columnEntryIndex(activities: Activity[]): Map<string, ColumnEntry> {
  return extendColumnEntryIndex(new Map(), activities);
}

// Whole calendar days since the card entered its current column, per the index above. A card
// whose latest indexed entry names a different column than it is in now (crafted/partial history)
// falls back to createdAt, same as a card with no indexed entry at all.
export function cardAgeDays(card: Pick<Card, "id" | "columnId" | "createdAt">, index: Map<string, ColumnEntry>, now: Date = new Date()): number {
  const entry = index.get(card.id);
  const since = entry && entry.columnId === card.columnId ? entry.timestamp : card.createdAt;
  return Math.floor((now.getTime() - new Date(since).getTime()) / DAY_MS);
}
