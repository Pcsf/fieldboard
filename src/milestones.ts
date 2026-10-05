import { type Workspace, type Milestone } from "./model";
import { capacityPerWorkingDay, estimateModule, projectCards, type Range } from "./planning";

export interface MilestoneSummary {
  milestone: Milestone;
  daysRemaining: number;
  doneCards: number;
  totalCards: number;
  remaining: Range;
  unestimatedCount: number;
  verdict: string;
}
const plus = (a: Range, b: Range): Range => [a[0] + b[0], a[1] + b[1]];
const midday = (d: Date): Date => { const m = new Date(d); m.setHours(12, 0, 0, 0); return m; };
export function daysUntil(dateISO: string, today: Date): number {
  return Math.round((new Date(`${dateISO}T12:00:00`).getTime() - midday(today).getTime()) / 86_400_000);
}
export function workingDaysThrough(today: Date, dateISO: string): number {
  const end = new Date(`${dateISO}T12:00:00`); let day = midday(today); let count = 0;
  while (day <= end) { const weekday = day.getDay(); if (weekday !== 0 && weekday !== 6) count++; day = new Date(day); day.setDate(day.getDate() + 1); }
  return count;
}
function plural(n: number, word: string): string { return `${n} ${word}${n === 1 ? "" : "s"}`; }
export function summarizeMilestones(w: Workspace, projectId: string, today = new Date()): MilestoneSummary[] {
  const project = w.projects.find(p => p.id === projectId); if (!project) return [];
  const milestones = (project.milestones ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const doneColumns = new Set(w.columns.filter(c => c.done).map(c => c.id));
  const cards = projectCards(w, projectId);
  const perDay = project.planning ? capacityPerWorkingDay(project.planning) : 0;
  let cumRemaining: Range = [0, 0]; let cumUnestimated = 0;
  return milestones.map(milestone => {
    const own = cards.filter(c => c.milestoneId === milestone.id);
    const doneCards = own.filter(c => doneColumns.has(c.columnId)).length;
    const unfinished = own.filter(c => !doneColumns.has(c.columnId));
    let remaining: Range = [0, 0]; let unestimated = 0;
    for (const c of unfinished) {
      if (!c.effort) { unestimated++; continue; }
      const e = estimateModule(c.effort);
      if (e.ied[1] === 0) { unestimated++; continue; }
      remaining = plus(remaining, e.ied);
    }
    cumRemaining = plus(cumRemaining, remaining); cumUnestimated += unestimated;
    let verdict: string;
    if (!project.planning) verdict = "Planning not enabled";
    else if (cumUnestimated > 0) verdict = `${plural(cumUnestimated, "unestimated card")} — no verdict`;
    else {
      const capacity = perDay * workingDaysThrough(today, milestone.date); const load = cumRemaining.map(x => x * (1 + project.planning!.contingency));
      verdict = capacity >= load[1]! ? "Fits" : capacity < load[0]! ? "Does not fit" : "At risk";
    }
    return { milestone, daysRemaining: daysUntil(milestone.date, today), doneCards, totalCards: own.length, remaining, unestimatedCount: unestimated, verdict };
  });
}
