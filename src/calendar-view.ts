import { editCard, type Card, type Milestone, type Workspace } from "./model";
import { escapeHTML as esc } from "./markdown";

export type CalendarMode = "month" | "week";
export interface CalendarCell { date: string; day: number; inMonth: boolean; isToday: boolean }

const isoLocal = (d: Date) => d.toLocaleDateString("en-CA");
const mondayOffset = (d: Date) => (d.getDay() + 6) % 7;

export function startOfWeek(date: Date): Date {
  const d = new Date(date); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - mondayOffset(d)); return d;
}
export function addMonths(date: Date, n: number): Date { return new Date(date.getFullYear(), date.getMonth() + n, 1); }
export function addWeeks(date: Date, n: number): Date { const d = new Date(date); d.setDate(d.getDate() + n * 7); return d; }

// Monday-first weeks spanning the whole month, padded with the leading/trailing days needed to fill them.
export function monthGrid(year: number, month: number, today: Date = new Date()): CalendarCell[][] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const start = startOfWeek(first);
  const end = startOfWeek(last); end.setDate(end.getDate() + 6);
  const todayISO = isoLocal(today);
  const weeks: CalendarCell[][] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const week: CalendarCell[] = [];
    for (let i = 0; i < 7; i++) {
      const date = isoLocal(cursor);
      week.push({ date, day: cursor.getDate(), inMonth: cursor.getMonth() === month, isToday: date === todayISO });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}
export function weekGrid(anchor: Date, today: Date = new Date()): CalendarCell[] {
  const start = startOfWeek(anchor); const todayISO = isoLocal(today); const cursor = new Date(start);
  const week: CalendarCell[] = [];
  for (let i = 0; i < 7; i++) {
    const date = isoLocal(cursor);
    week.push({ date, day: cursor.getDate(), inMonth: true, isToday: date === todayISO });
    cursor.setDate(cursor.getDate() + 1);
  }
  return week;
}
// Weekday names in the viewer's locale, Monday-first; the reference week is arbitrary since only the day-of-week matters.
export function weekdayLabels(locale?: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const monday = new Date(2024, 0, 1);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return fmt.format(d); });
}
export function cardsByDay(cards: Card[]): Map<string, Card[]> {
  const map = new Map<string, Card[]>();
  for (const c of cards) if (c.dueDate) map.set(c.dueDate, [...map.get(c.dueDate) ?? [], c]);
  for (const list of map.values()) list.sort((a, b) => a.title.localeCompare(b.title));
  return map;
}
export function milestonesByDay(milestones: Milestone[]): Map<string, Milestone[]> {
  const map = new Map<string, Milestone[]>();
  for (const m of milestones) map.set(m.date, [...map.get(m.date) ?? [], m]);
  return map;
}
export function noDueDateCards(cards: Card[]): Card[] { return cards.filter(c => !c.dueDate).sort((a, b) => a.title.localeCompare(b.title)); }

export interface CalendarDeps {
  cards(): Card[]; milestones(): Milestone[];
  stage(fn: (w: Workspace) => unknown): boolean;
  openCard(cardId: string): void;
  now?(): Date;
}
const MAX_VISIBLE = 3;
let mode: CalendarMode = "month";
let anchor = new Date();
const expanded = new Set<string>();
let dragCardId: string | null = null;

function cardChip(c: Card): string {
  const marker = c.priority === "urgent" ? "!!" : c.priority === "high" ? "↑" : "";
  return `<button type="button" class="calendar-card${c.completedAt ? " done" : ""}" draggable="true" data-calendar-card="${esc(c.id)}" aria-label="Open card: ${esc(c.title)}">${marker ? `<span class="priority ${c.priority}">${marker}</span> ` : ""}${esc(c.title)}</button>`;
}
function dayCellHTML(cell: CalendarCell, dayCards: Card[], dayMilestones: Milestone[]): string {
  const visible = expanded.has(cell.date) ? dayCards : dayCards.slice(0, MAX_VISIBLE);
  const more = dayCards.length > visible.length ? `<button type="button" class="calendar-more" data-expand="${esc(cell.date)}">+${dayCards.length - visible.length} more</button>` : "";
  const milestoneHTML = dayMilestones.map(m => `<span class="calendar-milestone" title="Milestone: ${esc(m.name)}">◆ ${esc(m.name)}</span>`).join("");
  return `<div class="calendar-cell${cell.inMonth ? "" : " outside"}${cell.isToday ? " today" : ""}" data-calendar-day="${esc(cell.date)}">
    <div class="calendar-day-head"><span class="calendar-day-number">${cell.day}</span></div>
    ${milestoneHTML}${visible.map(cardChip).join("")}${more}</div>`;
}
export function mountCalendar(root: HTMLElement, deps: CalendarDeps) {
  const today = deps.now?.() ?? new Date();
  const cards = deps.cards();
  const byDay = cardsByDay(cards);
  const byMilestoneDay = milestonesByDay(deps.milestones());
  const grid = mode === "month" ? monthGrid(anchor.getFullYear(), anchor.getMonth(), today) : [weekGrid(anchor, today)];
  const label = mode === "month"
    ? anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : (() => { const start = startOfWeek(anchor); const end = new Date(start); end.setDate(end.getDate() + 6); return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`; })();
  const noDate = noDueDateCards(cards);
  root.innerHTML = `<div class="calendar-toolbar">
    <div class="calendar-nav"><button type="button" data-cal-prev aria-label="Previous ${mode}">← Previous</button><button type="button" data-cal-today>Today</button><button type="button" data-cal-next aria-label="Next ${mode}">Next →</button><strong class="calendar-label">${esc(label)}</strong></div>
    <div class="calendar-mode" role="group" aria-label="Calendar mode"><button type="button" data-cal-mode="month" aria-pressed="${mode === "month"}">Month</button><button type="button" data-cal-mode="week" aria-pressed="${mode === "week"}">Week</button></div></div>
    <div class="calendar-body"><div class="calendar-grid${mode === "week" ? " week-mode" : ""}">
    <div class="calendar-weekdays">${weekdayLabels().map(d => `<span>${esc(d)}</span>`).join("")}</div>
    ${grid.map(week => `<div class="calendar-week-row">${week.map(cell => dayCellHTML(cell, byDay.get(cell.date) ?? [], byMilestoneDay.get(cell.date) ?? [])).join("")}</div>`).join("")}</div>
    <aside class="calendar-sidebar" aria-label="Cards without a due date"><h2>No due date <span class="count">${noDate.length}</span></h2>
    <div class="calendar-nodate-list" data-calendar-nodate>${noDate.map(cardChip).join("") || '<p class="muted">Every filtered card has a due date.</p>'}</div></aside></div>`;
  root.querySelectorAll<HTMLButtonElement>("[data-calendar-card]").forEach(btn => {
    btn.onclick = () => deps.openCard(btn.dataset.calendarCard!);
    btn.ondragstart = e => { if (!e.dataTransfer) return; dragCardId = btn.dataset.calendarCard!; e.dataTransfer.setData("text/plain", dragCardId); e.dataTransfer.effectAllowed = "move"; btn.classList.add("dragging"); };
    btn.ondragend = () => { dragCardId = null; btn.classList.remove("dragging"); root.querySelectorAll(".drag-over").forEach(e => e.classList.remove("drag-over")); };
  });
  root.querySelectorAll<HTMLButtonElement>("[data-expand]").forEach(btn => btn.onclick = () => { expanded.add(btn.dataset.expand!); mountCalendar(root, deps); });
  root.querySelectorAll<HTMLElement>("[data-calendar-day]").forEach(cell => {
    cell.ondragover = e => { if (dragCardId) { e.preventDefault(); cell.classList.add("drag-over"); if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; } };
    cell.ondragleave = () => cell.classList.remove("drag-over");
    cell.ondrop = e => { e.preventDefault(); cell.classList.remove("drag-over"); const cardId = dragCardId; dragCardId = null; if (!cardId) return; deps.stage(w => editCard(w, cardId, { dueDate: cell.dataset.calendarDay! })); };
  });
  const nodate = root.querySelector<HTMLElement>("[data-calendar-nodate]")!;
  nodate.ondragover = e => { if (dragCardId) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; } };
  nodate.ondrop = e => { e.preventDefault(); const cardId = dragCardId; dragCardId = null; if (!cardId) return; deps.stage(w => editCard(w, cardId, { dueDate: null })); };
  root.querySelector<HTMLButtonElement>("[data-cal-prev]")!.onclick = () => { anchor = mode === "month" ? addMonths(anchor, -1) : addWeeks(anchor, -1); mountCalendar(root, deps); };
  root.querySelector<HTMLButtonElement>("[data-cal-next]")!.onclick = () => { anchor = mode === "month" ? addMonths(anchor, 1) : addWeeks(anchor, 1); mountCalendar(root, deps); };
  root.querySelector<HTMLButtonElement>("[data-cal-today]")!.onclick = () => { anchor = deps.now?.() ?? new Date(); mountCalendar(root, deps); };
  root.querySelectorAll<HTMLButtonElement>("[data-cal-mode]").forEach(btn => btn.onclick = () => { mode = btn.dataset.calMode as CalendarMode; mountCalendar(root, deps); });
}
