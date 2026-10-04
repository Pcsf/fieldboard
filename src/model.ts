import { validateEffort, validatePlanning, validateCalibrations, type Effort, type Planning, type Calibration } from "./planning";

export const SCHEMA_VERSION = 2;
export const priorities = ["none", "low", "medium", "high", "urgent"] as const;
export type Priority = typeof priorities[number];
export interface Member { id: string; name: string; color: string }
export interface Label { id: string; name: string; color: string }
export interface Project { id: string; name: string; description: string; color: string; status: "active" | "archived"; labels: Label[]; planning?: Planning }
export interface Board { id: string; projectId: string; name: string; swimlane: "none" }
export interface Column { id: string; boardId: string; name: string; position: number; wipLimit: number | null; done: boolean }
export interface Subtask { id: string; title: string; done: boolean; position: number }
export interface Comment { id: string; author: string; body: string; timestamp: string }
export interface Attachment { id: string; name: string; type: string; data: string }
export interface Link { id: string; title: string; url: string }
export interface Card {
  id: string; columnId: string; position: number; title: string; description: string;
  priority: Priority; dueDate: string | null; estimate: number | null; labels: string[]; assignees: string[];
  effort?: Effort; calibrations?: Calibration[];
  subtasks: Subtask[]; comments: Comment[]; attachments: Attachment[]; links: Link[];
  createdAt: string; updatedAt: string; completedAt: string | null; archived: boolean;
}
export interface Activity { id: string; cardId: string; actor: string; action: string; before: Card | null; after: Card | null; timestamp: string }
export interface Workspace {
  schemaVersion: number; revision: number; id: string; name: string;
  members: Member[]; settings: { actorId: string };
  projects: Project[]; boards: Board[]; columns: Column[]; cards: Card[]; activities: Activity[];
}
export interface Filters { q: string; label: string; assignee: string; priority: string; due: string; project: string }
export const emptyFilters: Filters = { q: "", label: "", assignee: "", priority: "", due: "", project: "" };
export const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
function required<T>(item: T | undefined, kind: string): T { if (!item) throw new Error(`${kind} not found`); return item; }
function title(s: string): string { if (!s.trim()) throw new Error("A title is required"); return s.trim(); }
export function createWorkspace(): Workspace {
  const actorId = id();
  return { schemaVersion: 2, revision: 0, id: id(), name: "My workspace", members: [{ id: actorId, name: "Me", color: "#5169bc" }], settings: { actorId }, projects: [], boards: [], columns: [], cards: [], activities: [] };
}
export function createProject(w: Workspace, name: string, color = "#667b68"): Project {
  const p: Project = { id: id(), name: title(name), description: "", color, status: "active", labels: [] };
  w.projects.push(p);
  const board: Board = { id: id(), projectId: p.id, name: "Board", swimlane: "none" };
  w.boards.push(board);
  ["Backlog", "To Do", "In Progress", "Review", "Done"].forEach((name, position) => w.columns.push({ id: id(), boardId: board.id, name, position, wipLimit: null, done: position === 4 }));
  return p;
}
export function orderedCards(w: Workspace, columnId: string): Card[] { return w.cards.filter(c => c.columnId === columnId).sort((a, b) => a.position - b.position); }
function normalize(w: Workspace, columnId: string) { orderedCards(w, columnId).forEach((c, i) => c.position = i); }
function audit(w: Workspace, before: Card[], action: string) {
  const old = new Map(before.map(c => [c.id, c]));
  const current = new Map(w.cards.map(c => [c.id, c]));
  for (const cardId of new Set([...old.keys(), ...current.keys()])) {
    const a = old.get(cardId) ?? null; const b = current.get(cardId) ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (b && action !== "undo") b.updatedAt = now();
    w.activities.push({ id: id(), cardId, actor: w.settings.actorId, action, before: a, after: b ? structuredClone(b) : null, timestamp: now() });
  }
}
function mutation<T>(w: Workspace, action: string, fn: () => T): T { const before = structuredClone(w.cards); const result = fn(); audit(w, before, action); return result; }
export function createCard(w: Workspace, columnId: string, name: string, at: "top" | "bottom"): Card {
  const column = required(w.columns.find(c => c.id === columnId), "Column"); const t = title(name);
  return mutation(w, "create", () => {
    const cards = orderedCards(w, columnId); if (at === "top") cards.forEach(c => c.position++);
    const card: Card = { id: id(), columnId, position: at === "top" ? 0 : cards.length, title: t, description: "", priority: "none", dueDate: null, estimate: null, labels: [], assignees: [], subtasks: [], comments: [], attachments: [], links: [], createdAt: now(), updatedAt: now(), completedAt: column.done ? now() : null, archived: false };
    w.cards.push(card); return card;
  });
}
export type CardEdit = Partial<Pick<Card, "title" | "description" | "priority" | "dueDate" | "estimate" | "labels" | "assignees" | "subtasks" | "comments" | "effort" | "calibrations">>;
export function editCard(w: Workspace, cardId: string, patch: CardEdit) {
  if (patch.title !== undefined) patch = { ...patch, title: title(patch.title) };
  mutation(w, "edit", () => Object.assign(required(w.cards.find(c => c.id === cardId), "Card"), structuredClone(patch)));
}
export function moveCard(w: Workspace, cardId: string, columnId: string, index: number) {
  const card = required(w.cards.find(c => c.id === cardId), "Card");
  const target = required(w.columns.find(c => c.id === columnId), "Column");
  const source = required(w.columns.find(c => c.id === card.columnId), "Column");
  if (source.boardId !== target.boardId) throw new Error("Cards must stay on the same board");
  mutation(w, "move", () => {
    const from = card.columnId; const others = orderedCards(w, columnId).filter(c => c.id !== cardId);
    others.splice(Math.max(0, Math.min(index, others.length)), 0, card);
    card.columnId = columnId;
    if (target.done && !card.completedAt) card.completedAt = now();
    if (!target.done) card.completedAt = null;
    others.forEach((c, i) => c.position = i); if (from !== columnId) normalize(w, from);
  });
}
export function archiveCard(w: Workspace, cardId: string, archived: boolean) { mutation(w, archived ? "archive" : "restore", () => required(w.cards.find(c => c.id === cardId), "Card").archived = archived); }
export function deleteCard(w: Workspace, cardId: string) {
  const card = required(w.cards.find(c => c.id === cardId), "Card");
  mutation(w, "delete", () => { w.cards = w.cards.filter(c => c.id !== cardId); normalize(w, card.columnId); });
}
export function addColumn(w: Workspace, boardId: string, name: string): Column {
  required(w.boards.find(b => b.id === boardId), "Board");
  const c: Column = { id: id(), boardId, name: title(name), position: w.columns.filter(c => c.boardId === boardId).length, wipLimit: null, done: false }; w.columns.push(c); return c;
}
export function updateColumn(w: Workspace, columnId: string, patch: Partial<Pick<Column, "name" | "done">>) {
  const column = required(w.columns.find(c => c.id === columnId), "Column");
  if (patch.name !== undefined) patch = { ...patch, name: title(patch.name) };
  mutation(w, "column edit", () => {
    Object.assign(column, patch);
    w.cards.filter(c => c.columnId === columnId).forEach(c => c.completedAt = column.done ? c.completedAt ?? now() : null);
  });
}
export function reorderColumn(w: Workspace, columnId: string, position: number) {
  const col = required(w.columns.find(c => c.id === columnId), "Column");
  const rest = w.columns.filter(c => c.boardId === col.boardId && c.id !== columnId).sort((a, b) => a.position - b.position);
  rest.splice(Math.max(0, Math.min(position, rest.length)), 0, col); rest.forEach((c, i) => c.position = i);
}
export function deleteColumn(w: Workspace, columnId: string, destination?: string) {
  const col = required(w.columns.find(c => c.id === columnId), "Column");
  const columns = w.columns.filter(c => c.boardId === col.boardId);
  if (columns.length < 2) throw new Error("Keep at least one column");
  const cards = orderedCards(w, columnId);
  const dest = w.columns.find(c => c.id === destination && c.id !== columnId && c.boardId === col.boardId);
  if (cards.length && !dest) throw new Error("Choose a destination for the cards first");
  if (dest) for (const card of cards) moveCard(w, card.id, dest.id, orderedCards(w, dest.id).length);
  w.columns = w.columns.filter(c => c.id !== columnId);
  w.columns.filter(c => c.boardId === col.boardId).sort((a, b) => a.position - b.position).forEach((c, i) => c.position = i);
}
export function undoWorkspace(w: Workspace, before: Workspace) {
  const current = structuredClone(w.cards); const log = w.activities; const revision = w.revision;
  const historicalMembers = w.members.filter(m => log.some(a => a.actor === m.id));
  Object.assign(w, structuredClone(before), { activities: log, revision });
  for (const member of historicalMembers) if (!w.members.some(m => m.id === member.id)) w.members.push(member);
  audit(w, current, "undo");
}
export function dueState(c: Card, at = new Date()): "overdue" | "soon" | "later" | "none" {
  if (!c.dueDate) return "none"; if (c.completedAt) return "later";
  const remaining = new Date(`${c.dueDate}T23:59:59`).getTime() - at.getTime();
  return remaining < 0 ? "overdue" : remaining <= 48 * 3600_000 ? "soon" : "later";
}
export function matches(c: Card, f: Filters, at = new Date()): boolean {
  if (c.archived || (f.q && !`${c.title} ${c.description}`.toLocaleLowerCase().includes(f.q.toLocaleLowerCase()))) return false;
  if (f.label && !c.labels.includes(f.label)) return false;
  if (f.assignee && !c.assignees.includes(f.assignee)) return false;
  if (f.priority && c.priority !== f.priority) return false;
  if (f.due === "none" && c.dueDate) return false;
  if (f.due === "overdue" && dueState(c, at) !== "overdue") return false;
  if (f.due === "week") {
    const start = new Date(at); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start); end.setDate(end.getDate() + 7);
    const due = c.dueDate ? new Date(`${c.dueDate}T12:00:00`) : null;
    if (!due || due < start || due >= end) return false;
  }
  return true;
}
export function encodeFilters(f: Filters): string { const p = new URLSearchParams(); for (const [k, v] of Object.entries(f)) if (v) p.set(k, v); return `#${p}`; }
export function decodeFilters(hash: string): Filters { const p = new URLSearchParams(hash.replace(/^#/, "")); return Object.fromEntries(Object.keys(emptyFilters).map(k => [k, p.get(k) ?? ""])) as unknown as Filters; }

// Validation is deliberately structural and relational. No input is spread into live state before this completes.
function fail(message: string): never { throw new Error(`Invalid workspace: ${message}`); }
function obj(x: unknown): Record<string, unknown> { if (!x || typeof x !== "object" || Array.isArray(x)) return fail("expected object"); return x as Record<string, unknown>; }
function str(x: unknown, nonempty = false): asserts x is string { if (typeof x !== "string" || (nonempty && !x.trim())) fail("expected text"); }
function num(x: unknown): asserts x is number { if (typeof x !== "number" || !Number.isFinite(x) || x < 0) fail("expected nonnegative number"); }
function integer(x: unknown) { num(x); if (!Number.isInteger(x)) fail("expected integer"); }
function bool(x: unknown) { if (typeof x !== "boolean") fail("expected boolean"); }
function arr(x: unknown): unknown[] { if (!Array.isArray(x)) return fail("expected array"); return x; }
function timestamp(x: unknown) { str(x); if (!Number.isFinite(Date.parse(x))) fail("invalid timestamp"); }
function color(x: unknown) { str(x); if (!/^#[0-9a-f]{6}$/i.test(x)) fail("invalid color"); }
function ids(xs: unknown): string[] { const result = arr(xs); result.forEach(x => str(x, true)); if (new Set(result).size !== result.length) fail("duplicate reference"); return result as string[]; }
function unique(xs: unknown[]): Record<string, unknown>[] {
  const result = xs.map(obj); const seen = new Set<string>();
  for (const r of result) { str(r.id, true); if (seen.has(r.id)) fail("duplicate ID"); seen.add(r.id); } return result;
}
function positions(xs: { position: number }[]) { const sorted = xs.map(x => x.position).sort((a, b) => a - b); if (sorted.some((n, i) => n !== i)) fail("positions must be contiguous"); }
function checkCard(value: unknown) {
  const c = obj(value); for (const k of ["id", "columnId", "title"]) str(c[k], true); str(c.description); integer(c.position);
  if (!priorities.includes(c.priority as Priority)) fail("invalid priority");
  if (c.dueDate !== null) { str(c.dueDate); if (!/^\d{4}-\d{2}-\d{2}$/.test(c.dueDate) || new Date(`${c.dueDate}T12:00:00Z`).toISOString().slice(0, 10) !== c.dueDate) fail("invalid due date"); }
  if (c.estimate !== null) num(c.estimate); ids(c.labels); ids(c.assignees); bool(c.archived);
  if (c.effort !== undefined) validateEffort(c.effort);
  if (c.calibrations !== undefined) validateCalibrations(c.calibrations);
  timestamp(c.createdAt); timestamp(c.updatedAt); if (c.completedAt !== null) timestamp(c.completedAt);
  unique(arr(c.subtasks)).forEach(s => { str(s.title, true); bool(s.done); integer(s.position); });
  positions(c.subtasks as Subtask[]);
  unique(arr(c.comments)).forEach(s => { str(s.author, true); str(s.body, true); timestamp(s.timestamp); });
  unique(arr(c.attachments)).forEach(s => { str(s.name); str(s.type); str(s.data); });
  unique(arr(c.links)).forEach(s => { str(s.title); str(s.url); });
}
export function validateWorkspace(input: unknown, clone = true): Workspace {
  const w = obj(input); if (w.schemaVersion !== 2) fail("unsupported schema version"); integer(w.revision); str(w.id, true); str(w.name, true);
  const members = unique(arr(w.members)); if (!members.length) fail("member required"); members.forEach(m => { str(m.name, true); color(m.color); });
  const actor = obj(w.settings).actorId; if (!members.some(m => m.id === actor)) fail("unknown actor");
  const projects = unique(arr(w.projects)); projects.forEach(p => { if (p.planning !== undefined) validatePlanning(p.planning); str(p.name, true); str(p.description); color(p.color); if (!["active", "archived"].includes(p.status as string)) fail("invalid project status"); unique(arr(p.labels)).forEach(l => { str(l.name, true); color(l.color); }); });
  const boards = unique(arr(w.boards)); boards.forEach(b => { str(b.name, true); if (!projects.some(p => p.id === b.projectId)) fail("orphan board"); if (b.swimlane !== "none") fail("unsupported swimlane"); });
  projects.forEach(p => { if (!boards.some(b => b.projectId === p.id)) fail("project needs a board"); });
  const columns = unique(arr(w.columns)); columns.forEach(c => { str(c.name, true); integer(c.position); bool(c.done); if (c.wipLimit !== null) integer(c.wipLimit); if (!boards.some(b => b.id === c.boardId)) fail("orphan column"); });
  boards.forEach(b => { const children = columns.filter(c => c.boardId === b.id); if (!children.length) fail("board needs a column"); positions(children as unknown as Column[]); });
  const cards = unique(arr(w.cards)); cards.forEach(c => {
    checkCard(c); const col = columns.find(x => x.id === c.columnId); if (!col) return fail("orphan card");
    const board = boards.find(b => b.id === col.boardId)!; const project = projects.find(p => p.id === board.projectId)!;
    if ((c.completedAt !== null) !== col.done) fail("completion contradicts column");
    for (const label of ids(c.labels)) if (!(project.labels as Label[]).some(l => l.id === label)) fail("unknown label");
    for (const member of ids(c.assignees)) if (!members.some(m => m.id === member)) fail("unknown assignee");
    for (const comment of c.comments as Comment[]) if (!members.some(m => m.id === comment.author)) fail("unknown comment author");
  });
  columns.forEach(c => positions(cards.filter(x => x.columnId === c.id) as unknown as Card[]));
  unique(arr(w.activities)).forEach(a => { str(a.cardId, true); str(a.actor, true); str(a.action, true); timestamp(a.timestamp); if (!members.some(m => m.id === a.actor)) fail("unknown activity actor"); for (const side of [a.before, a.after]) if (side !== null) { checkCard(side); if (obj(side).id !== a.cardId) fail("activity card mismatch"); } });
  return (clone ? structuredClone(input) : input) as Workspace;
}
export function migrateWorkspace(input: unknown): Workspace {
  const w = obj(structuredClone(input));
  if (w.schemaVersion === 1) {
    const cols = arr(w.columns).map(obj);
    for (const value of arr(w.cards)) { const c = obj(value); if (c.completedAt === undefined) c.completedAt = cols.find(col => col.id === c.columnId)?.done ? c.updatedAt : null; }
    for (const value of arr(w.activities)) for (const side of [obj(value).before, obj(value).after]) if (side) { const c = obj(side); if (c.completedAt === undefined) c.completedAt = cols.find(col => col.id === c.columnId)?.done ? c.updatedAt : null; }
    w.schemaVersion = 2;
  }
  return validateWorkspace(w);
}
