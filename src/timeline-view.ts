import type { Card, Column } from "./model";
import { escapeHTML as esc } from "./markdown";

export type TimelineGroupBy = "column" | "epic";
export interface TimelineBar { cardId: string; title: string; row: number; startOffset: number; span: number; done: boolean }
export interface TimelineGroupRow { key: string; label: string; bars: TimelineBar[] }
export interface TimelineArrow { fromCardId: string; toCardId: string; fromOffset: number; toOffset: number; conflict: boolean }
export interface TimelineLayout { rangeStart: string; days: number; todayOffset: number | null; groups: TimelineGroupRow[]; arrows: TimelineArrow[]; notScheduled: Card[]; totalRows: number }
export interface AxisTick { offset: number; label: string; week: boolean }

const DAY_MS = 86400_000;
const isoLocal = (d: Date) => d.toLocaleDateString("en-CA");
function parseLocalDate(iso: string): Date { const [y, m, d] = iso.split("-").map(Number); return new Date(y!, m! - 1, d!); }
function daysBetween(a: Date, b: Date): number { return Math.round((b.getTime() - a.getTime()) / DAY_MS); }
function startOfWeekLocal(d: Date): Date { const c = new Date(d); c.setHours(0, 0, 0, 0); c.setDate(c.getDate() - ((c.getDay() + 6) % 7)); return c; }
const scheduled = (c: Card) => !!c.startDate && !!c.dueDate;

// Every week boundary always gets a full date label; between boundaries, day numbers appear every
// Nth day so a long range doesn't crowd the axis into illegible overlapping text.
export function axisTicks(rangeStart: string, days: number, locale?: string): AxisTick[] {
  const start = parseLocalDate(rangeStart);
  const weekFmt = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" });
  const dayFmt = new Intl.DateTimeFormat(locale, { day: "numeric" });
  const step = days > 60 ? 7 : days > 31 ? 2 : 1;
  const ticks: AxisTick[] = [];
  for (let offset = 0; offset < days; offset++) {
    const week = offset % 7 === 0;
    if (!week && offset % step !== 0) continue;
    const d = new Date(start); d.setDate(d.getDate() + offset);
    ticks.push({ offset, label: week ? weekFmt.format(d) : dayFmt.format(d), week });
  }
  return ticks;
}

// Each scheduled card becomes exactly one bar; grouping only reorders rows, it never resizes a bar.
export function layoutTimeline(cards: Card[], groupBy: TimelineGroupBy, columns: Column[], today: Date = new Date()): TimelineLayout {
  const bars = cards.filter(scheduled);
  const notScheduled = cards.filter(c => !scheduled(c));
  const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!bars.length) return { rangeStart: isoLocal(startOfWeekLocal(todayLocal)), days: 7, todayOffset: 0, groups: [], arrows: [], notScheduled, totalRows: 0 };

  const earliest = bars.map(c => parseLocalDate(c.startDate!)).reduce((a, b) => a < b ? a : b);
  const latest = bars.map(c => parseLocalDate(c.dueDate!)).reduce((a, b) => a > b ? a : b);
  const lower = earliest.getTime() < todayLocal.getTime() ? earliest : todayLocal;
  const upper = latest.getTime() > todayLocal.getTime() ? latest : todayLocal;
  const rangeStartDate = startOfWeekLocal(lower);
  const rangeEndExclusive = startOfWeekLocal(upper); rangeEndExclusive.setDate(rangeEndExclusive.getDate() + 7);
  const days = daysBetween(rangeStartDate, rangeEndExclusive);
  const todayOffset = daysBetween(rangeStartDate, todayLocal);

  const cardsById = new Map(cards.map(c => [c.id, c]));
  // An epic's own bar joins its children's group (keyed and labelled by the epic), rather than sitting in "No epic".
  const epicParents = new Set(bars.map(c => c.parentId).filter((id): id is string => !!id));
  const groupOf = (c: Card) => {
    if (groupBy === "column") return { key: c.columnId, label: columns.find(x => x.id === c.columnId)?.name ?? "Unknown column", order: columns.find(x => x.id === c.columnId)?.position ?? 0 };
    const epicId = c.parentId ?? (epicParents.has(c.id) ? c.id : undefined);
    return { key: epicId ?? "__none__", label: epicId ? cardsById.get(epicId)?.title ?? "Unknown epic" : "No epic", order: epicId ? 0 : 1 };
  };
  const byKey = new Map<string, { label: string; order: number; cards: Card[] }>();
  for (const c of bars) { const g = groupOf(c); const entry = byKey.get(g.key) ?? { label: g.label, order: g.order, cards: [] }; entry.cards.push(c); byKey.set(g.key, entry); }
  const orderedGroups = [...byKey.entries()].sort((a, b) => a[1].order - b[1].order || a[1].label.localeCompare(b[1].label));

  let row = 0;
  const groups: TimelineGroupRow[] = [];
  const barsByCard = new Map<string, TimelineBar>();
  for (const [key, g] of orderedGroups) {
    const sorted = g.cards.slice().sort((a, b) => a.startDate!.localeCompare(b.startDate!) || a.title.localeCompare(b.title));
    const groupBars = sorted.map(c => {
      const startOffset = daysBetween(rangeStartDate, parseLocalDate(c.startDate!));
      const span = daysBetween(parseLocalDate(c.startDate!), parseLocalDate(c.dueDate!)) + 1;
      const bar: TimelineBar = { cardId: c.id, title: c.title, row: row++, startOffset, span, done: c.completedAt !== null };
      barsByCard.set(c.id, bar); return bar;
    });
    groups.push({ key, label: g.label, bars: groupBars });
  }
  const arrows: TimelineArrow[] = [];
  for (const c of bars) for (const blockerId of c.blockedBy ?? []) {
    const blocker = barsByCard.get(blockerId); const dependent = barsByCard.get(c.id); if (!blocker || !dependent) continue;
    const blockerEnd = blocker.startOffset + blocker.span;
    arrows.push({ fromCardId: blockerId, toCardId: c.id, fromOffset: blockerEnd, toOffset: dependent.startOffset, conflict: dependent.startOffset < blockerEnd });
  }
  return { rangeStart: isoLocal(rangeStartDate), days, todayOffset, groups, arrows, notScheduled, totalRows: row };
}

export interface TimelineDeps { cards(): Card[]; columns(): Column[]; openCard(cardId: string): void; now?(): Date }
const MIN_DAY_PX = 24; const ROW_PX = 30; const BAR_PX = 20; const HEADER_PX = 26; const AXIS_PX = 28;
let groupBy: TimelineGroupBy = "column";
// Days fill the available panel width (one day at least MIN_DAY_PX) so a short range isn't a sliver
// of tiny bars; a long range still scrolls once days no longer fit at the minimum width.
function dayPx(root: HTMLElement, days: number): number {
  const available = root.clientWidth - 72; // .timeline-scroll's left+right margin
  return Math.max(MIN_DAY_PX, Math.floor((available > 0 ? available : 960) / Math.max(days, 1)));
}

function notScheduledRow(c: Card): string {
  const missing = !c.startDate && !c.dueDate ? "No start or due date" : !c.startDate ? "No start date" : "No due date";
  return `<button type="button" class="timeline-unscheduled-row" data-timeline-card="${esc(c.id)}" aria-label="Open card: ${esc(c.title)}"><span>${esc(c.title)}</span><small>${esc(missing)}</small></button>`;
}
export function mountTimeline(root: HTMLElement, deps: TimelineDeps) {
  const layout = layoutTimeline(deps.cards(), groupBy, deps.columns(), deps.now?.() ?? new Date());
  const toolbar = `<div class="timeline-toolbar"><div class="timeline-groupby" role="group" aria-label="Group rows by">
    <button type="button" data-tl-group="column" aria-pressed="${groupBy === "column"}">By column</button>
    <button type="button" data-tl-group="epic" aria-pressed="${groupBy === "epic"}">By epic</button></div></div>`;
  if (!layout.groups.length) {
    root.innerHTML = `${toolbar}<p class="muted">No filtered card has both a start and a due date yet.</p>${unscheduledSection(layout)}`;
    bindUnscheduled(root, deps); bindToolbar(root, deps); return;
  }
  const DAY_PX = dayPx(root, layout.days);
  let cursor = AXIS_PX; const groupTops: number[] = []; const topByCard = new Map<string, number>();
  for (const group of layout.groups) { groupTops.push(cursor); cursor += HEADER_PX; for (const bar of group.bars) { topByCard.set(bar.cardId, cursor); cursor += ROW_PX; } }
  const chartHeight = cursor;
  const axisHTML = axisTicks(layout.rangeStart, layout.days).map(t =>
    `<div class="timeline-axis-tick${t.week ? " week" : ""}" style="left:calc(var(--tl-day) * ${t.offset})">${esc(t.label)}</div>`).join("");
  const weekLines = Array.from({ length: Math.floor(layout.days / 7) + 1 }, (_, i) => i * 7)
    .map(offset => `<div class="timeline-gridline" style="left:calc(var(--tl-day) * ${offset});top:${AXIS_PX}px"></div>`).join("");
  const todayLine = layout.todayOffset !== null && layout.todayOffset >= 0 && layout.todayOffset < layout.days
    ? `<div class="timeline-today" style="left:calc(var(--tl-day) * ${layout.todayOffset});top:${AXIS_PX}px" title="Today"></div>` : "";
  const groupsHTML = layout.groups.map((group, i) => `<div class="timeline-group-label" style="top:${groupTops[i]}px">${esc(group.label)}</div>`
    + group.bars.map(bar => `<button type="button" class="timeline-bar${bar.done ? " done" : ""}" data-timeline-bar="${esc(bar.cardId)}" data-start-offset="${bar.startOffset}" data-span="${bar.span}"
      style="left:calc(var(--tl-day) * ${bar.startOffset});width:calc(var(--tl-day) * ${bar.span});top:${topByCard.get(bar.cardId)}px" aria-label="Open card: ${esc(bar.title)}" title="${esc(bar.title)}">${esc(bar.title)}</button>`).join("")).join("");
  // Edge midpoint: each endpoint sits exactly at the referenced bar's vertical centre, at the x of
  // the bar's leading (dependent) or trailing (blocker) edge, so the line meets the bar flush, not mid-label.
  const arrowLines = layout.arrows.map(a => {
    const fromY = (topByCard.get(a.fromCardId) ?? 0) + BAR_PX / 2; const toY = (topByCard.get(a.toCardId) ?? 0) + BAR_PX / 2;
    const fromX = a.fromOffset * DAY_PX; const toX = a.toOffset * DAY_PX;
    const title = a.conflict ? "Conflict: the dependent card starts before its blocker is due" : "Depends on a card scheduled to finish first";
    return `<line class="timeline-arrow${a.conflict ? " conflict" : ""}" data-arrow-from="${esc(a.fromCardId)}" data-arrow-to="${esc(a.toCardId)}" x1="${fromX}" y1="${fromY}" x2="${toX}" y2="${toY}" stroke="${a.conflict ? "var(--planning-warning-text)" : "var(--accent)"}" stroke-width="2" marker-end="url(#${a.conflict ? "tl-arrow-warn" : "tl-arrow"})"><title>${esc(title)}</title></line>`;
  }).join("");
  // Arrows paint first (and sit behind via z-index too) so bars and their labels are always legible on top.
  root.innerHTML = `${toolbar}<div class="timeline-scroll"><div class="timeline-chart" style="--tl-day:${DAY_PX}px;width:calc(var(--tl-day) * ${layout.days});height:${chartHeight}px">
    <svg class="timeline-arrows" width="${layout.days * DAY_PX}" height="${chartHeight}" aria-hidden="true">
      <defs><marker id="tl-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--accent)"></path></marker>
      <marker id="tl-arrow-warn" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--planning-warning-text)"></path></marker></defs>
      ${arrowLines}</svg>
    ${weekLines}${todayLine}<div class="timeline-axis">${axisHTML}</div>${groupsHTML}</div></div>${unscheduledSection(layout)}`;
  root.querySelectorAll<HTMLButtonElement>("[data-timeline-bar]").forEach(btn => btn.onclick = () => deps.openCard(btn.dataset.timelineBar!));
  bindUnscheduled(root, deps); bindToolbar(root, deps);
}
function unscheduledSection(layout: TimelineLayout): string {
  return `<div class="timeline-notscheduled" aria-label="Not scheduled"><h3>Not scheduled <span class="count">${layout.notScheduled.length}</span></h3>${layout.notScheduled.map(notScheduledRow).join("") || '<p class="muted">Every filtered card has both dates.</p>'}</div>`;
}
function bindUnscheduled(root: HTMLElement, deps: TimelineDeps) {
  root.querySelectorAll<HTMLButtonElement>("[data-timeline-card]").forEach(btn => btn.onclick = () => deps.openCard(btn.dataset.timelineCard!));
}
function bindToolbar(root: HTMLElement, deps: TimelineDeps) {
  root.querySelectorAll<HTMLButtonElement>("[data-tl-group]").forEach(btn => btn.onclick = () => { groupBy = btn.dataset.tlGroup as TimelineGroupBy; mountTimeline(root, deps); });
}
