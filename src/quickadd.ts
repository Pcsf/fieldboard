import { priorities, type Priority } from "./model";

export interface QuickAddMember { id: string; name: string }
export interface QuickAddMilestone { id: string; name: string }
export interface QuickAddContext { members: QuickAddMember[]; milestones?: QuickAddMilestone[] }
export interface QuickAddResult {
  title: string; labelNames: string[]; assigneeIds: string[];
  priority?: Priority; dueDate?: string; milestoneId?: string;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function addDays(d: Date, n: number): Date { const copy = new Date(d); copy.setDate(copy.getDate() + n); return copy; }
function toISO(d: Date): string { return d.toLocaleDateString("en-CA"); }
function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function resolveDueToken(token: string, today: Date): string | undefined {
  const lower = token.toLowerCase();
  if (lower === "today") return toISO(today);
  if (lower === "tomorrow") return toISO(addDays(today, 1));
  const weekday = WEEKDAYS.indexOf(lower);
  if (weekday >= 0) for (let i = 1; i <= 7; i++) { const d = addDays(today, i); if (d.getDay() === weekday) return toISO(d); }
  return isValidISODate(token) ? token : undefined;
}
function resolvePriorityToken(word: string): Priority | undefined {
  if (word === "!!") return "urgent";
  const w = word.slice(1).toLowerCase();
  return w !== "none" && (priorities as readonly string[]).includes(w) ? w as Priority : undefined;
}
function uniquePrefix<T>(token: string, items: T[], name: (item: T) => string): T | undefined {
  const t = token.toLowerCase(); if (!t) return undefined;
  const matches = items.filter(item => name(item).toLowerCase().startsWith(t));
  return matches.length === 1 ? matches[0] : undefined;
}

// Tokens are whitespace-delimited; a word is consumed only when it fully resolves,
// so an unrecognised or ambiguous token is left exactly as typed in the title.
export function parseQuickAdd(raw: string, ctx: QuickAddContext, today: Date = new Date()): QuickAddResult {
  const titleWords: string[] = []; const labelNames: string[] = []; const assigneeIds: string[] = [];
  let priority: Priority | undefined; let dueDate: string | undefined; let milestoneId: string | undefined;
  for (const word of raw.split(/\s+/).filter(Boolean)) {
    if (word.length > 1 && word[0] === "#") { labelNames.push(word.slice(1)); continue; }
    if (word.length > 1 && word[0] === "@") {
      const member = uniquePrefix(word.slice(1), ctx.members, m => m.name);
      if (member) { assigneeIds.push(member.id); continue; }
    } else if (word.length > 1 && word[0] === "!") {
      const resolved = resolvePriorityToken(word);
      if (resolved) { priority = resolved; continue; }
    } else if (word.length > 1 && word[0] === "^") {
      const resolved = resolveDueToken(word.slice(1), today);
      if (resolved) { dueDate = resolved; continue; }
    } else if (word.length > 1 && word[0] === "~" && ctx.milestones?.length) {
      const milestone = uniquePrefix(word.slice(1), ctx.milestones, m => m.name);
      if (milestone) { milestoneId = milestone.id; continue; }
    }
    titleWords.push(word);
  }
  return { title: titleWords.join(" "), labelNames: [...new Set(labelNames)], assigneeIds: [...new Set(assigneeIds)], priority, dueDate, milestoneId };
}
