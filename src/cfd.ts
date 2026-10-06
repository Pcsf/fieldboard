import type { Activity, Card, Column, Workspace } from "./model";
import { rawActivityStates } from "./burnup";

export interface CfdDayPoint { date: string; byColumn: Record<string, number>; removed: number }
export type CfdRangeDays = 14 | 30 | 90 | null; // null means "all"

const DAY_MS = 86_400_000;
const localDay = (d: Date): Date => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; };
const isoLocal = (d: Date): string => d.toLocaleDateString("en-CA");

interface ColumnPoint { at: number; columnId: string | null }

// Reuses the same replay step milestoneBurnup's cardFlagTimeline is built from (src/burnup.ts):
// one dated state per Activity entry, with pre-log state floored at createdAt. This projects each
// state onto its columnId instead of a milestone's in-scope/done flags; a card with no activity at
// all falls back to its own current column at its createdAt, the same "no history" fallback burnup uses.
function cardColumnTimeline(card: Card | undefined, activities: Activity[]): ColumnPoint[] {
  const raw = rawActivityStates(activities).map(r => ({ at: r.at, columnId: r.state ? r.state.columnId : null }));
  if (!activities.length && card) raw.push({ at: Date.parse(card.createdAt), columnId: card.columnId });
  const byTime = new Map<number, string | null>();
  for (const r of raw) byTime.set(r.at, r.columnId);
  const ordered = [...byTime.entries()].sort((a, b) => a[0] - b[0]);
  const points: ColumnPoint[] = [];
  let prev: string | null | undefined;
  for (const [at, columnId] of ordered) if (columnId !== prev) { points.push({ at, columnId }); prev = columnId; }
  return points;
}

export interface CfdBand { key: string; label: string; columnId: string | null }
// Board position order, with done columns moved to the bottom of the stack (band index 0 is the
// bottom of the chart); the synthetic "Removed columns" band catches a day's cards whose column has
// since been deleted, and sits at the very bottom, below even the done columns.
export function cfdBands(columns: Column[]): CfdBand[] {
  const sorted = columns.slice().sort((a, b) => a.position - b.position);
  const done = sorted.filter(c => c.done);
  const notDone = sorted.filter(c => !c.done);
  return [
    { key: "removed", label: "Removed columns", columnId: null },
    ...done.map(c => ({ key: c.id, label: c.name, columnId: c.id })),
    ...notDone.map(c => ({ key: c.id, label: c.name, columnId: c.id })),
  ];
}

// Daily per-column scope for one board, rebuilt from Activity, never stored. A card is in this
// board's scope on a day only if its column that day belongs to this board right now; a column
// that belonged to a DIFFERENT board which still exists excludes the card from that day entirely
// (it genuinely wasn't on this board yet/anymore), while a column that no longer exists anywhere
// falls into "Removed columns" — the two cases this app's board-move and column-delete features
// can actually produce. By construction the last day always equals live, non-deleted per-column
// counts: a live card's latest replayed state is always its own current fields (see burnup.ts).
export function cfdSeries(w: Workspace, boardId: string, today: Date = new Date()): CfdDayPoint[] {
  const boardColumnIds = new Set(w.columns.filter(c => c.boardId === boardId).map(c => c.id));
  const otherColumnIds = new Set(w.columns.filter(c => c.boardId !== boardId).map(c => c.id));
  const cardsById = new Map(w.cards.map(c => [c.id, c]));
  const activitiesByCard = new Map<string, Activity[]>();
  for (const a of w.activities) { const list = activitiesByCard.get(a.cardId); if (list) list.push(a); else activitiesByCard.set(a.cardId, [a]); }
  for (const list of activitiesByCard.values()) list.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const cardIds = new Set([...cardsById.keys(), ...activitiesByCard.keys()]);

  function bandKeyFor(columnId: string | null): "removed" | string | null {
    if (columnId === null) return null;
    if (boardColumnIds.has(columnId)) return columnId;
    if (otherColumnIds.has(columnId)) return null; // currently on a different, still-existing board
    return "removed";
  }

  interface Timeline { points: ColumnPoint[]; cursor: number }
  const timelines: Timeline[] = [];
  let firstAt: number | null = null;
  for (const cardId of cardIds) {
    const points = cardColumnTimeline(cardsById.get(cardId), activitiesByCard.get(cardId) ?? []);
    const firstInScope = points.find(p => bandKeyFor(p.columnId) !== null);
    if (!firstInScope) continue;
    timelines.push({ points, cursor: -1 });
    if (firstAt === null || firstInScope.at < firstAt) firstAt = firstInScope.at;
  }
  if (firstAt === null) return [];

  const startDay = localDay(new Date(firstAt));
  const endDay = localDay(today);
  const points: CfdDayPoint[] = [];
  for (const day = new Date(startDay); day <= endDay; day.setDate(day.getDate() + 1)) {
    const dayEnd = day.getTime() + DAY_MS - 1;
    const byColumn: Record<string, number> = {}; let removed = 0;
    for (const t of timelines) {
      while (t.cursor + 1 < t.points.length && t.points[t.cursor + 1]!.at <= dayEnd) t.cursor++;
      const columnId = t.cursor >= 0 ? t.points[t.cursor]!.columnId : null;
      const key = bandKeyFor(columnId);
      if (key === "removed") removed++;
      else if (key !== null) byColumn[key] = (byColumn[key] ?? 0) + 1;
    }
    points.push({ date: isoLocal(day), byColumn, removed });
  }
  return points;
}

// 14/30/90 slice the already-built series to its trailing N days; "all" (null) returns it unchanged.
// Slicing never recomputes the sweep above, so switching ranges stays cheap.
export function sliceCfdRange(series: CfdDayPoint[], rangeDays: CfdRangeDays): CfdDayPoint[] {
  if (rangeDays === null || series.length <= rangeDays) return series;
  return series.slice(series.length - rangeDays);
}
