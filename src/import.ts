import { createProject, createCard, archiveCard, resolveLabels, addColumn, updateColumn, deleteColumn, id, priorities, type Workspace, type Project, type Priority, type Link } from "./model";
import { parseLinkInput, buildLink } from "./links";
import { parseCsvRecords } from "./csv";

export interface ImportedCard {
  title: string; description: string; column: string; labels: string[];
  priority: Priority; dueDate: string | null; estimate: number | null;
  archived: boolean; subtasks: { title: string; done: boolean }[]; link?: Link;
}
export interface ImportedProject { name: string; columns: string[]; cards: ImportedCard[] }

const DEFAULT_COLUMNS = ["Backlog", "To Do", "In Progress", "Review", "Done"];

// --- Trello board export -------------------------------------------------

interface TrelloList { id: string; name: string; closed?: boolean }
interface TrelloLabel { name?: string }
interface TrelloCard { id: string; name?: string; desc?: string; idList: string; closed?: boolean; due?: string | null; labels?: TrelloLabel[] }
interface TrelloChecklistItem { name?: string; state?: string }
interface TrelloChecklist { idCard: string; checkItems?: TrelloChecklistItem[] }

export function parseTrelloBoard(json: unknown): ImportedProject {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("That file is not a Trello board export.");
  const board = json as Record<string, unknown>;
  if (typeof board.name !== "string" || !board.name.trim()) throw new Error("That file is not a Trello board export (missing a board name).");
  if (!Array.isArray(board.lists) || !Array.isArray(board.cards)) throw new Error("That file is not a Trello board export (missing its lists or cards).");
  const lists = board.lists as TrelloList[];
  const listName = new Map(lists.map(l => [l.id, l.name]));
  const checklists = Array.isArray(board.checklists) ? board.checklists as TrelloChecklist[] : [];
  const subtasksByCard = new Map<string, { title: string; done: boolean }[]>();
  for (const list of checklists) {
    const items = (list.checkItems ?? []).map(item => ({ title: String(item.name ?? "").trim(), done: item.state === "complete" })).filter(s => s.title);
    subtasksByCard.set(list.idCard, [...(subtasksByCard.get(list.idCard) ?? []), ...items]);
  }
  const cards: ImportedCard[] = (board.cards as TrelloCard[]).map((card, i) => {
    const title = (card.name ?? "").trim();
    if (!title) throw new Error(`Trello card ${i + 1}: a title is required.`);
    const column = listName.get(card.idList);
    if (!column) throw new Error(`Trello card "${title}": its list was not found on the board.`);
    return {
      title, description: card.desc ?? "", column,
      labels: (card.labels ?? []).map(l => (l.name ?? "").trim()).filter(Boolean),
      priority: "none" as Priority, dueDate: card.due ? String(card.due).slice(0, 10) : null, estimate: null,
      archived: !!card.closed, subtasks: subtasksByCard.get(card.id) ?? [],
    };
  });
  return { name: board.name.trim(), columns: lists.map(l => l.name), cards };
}

// --- GitHub Issues export (gh issue list --json number,title,body,labels,state,assignees,url) ---

interface GithubLabel { name?: string }
interface GithubIssue { number?: number; title?: string; body?: string; labels?: GithubLabel[]; state?: string; url?: string }

export function parseGithubIssues(json: unknown): ImportedProject {
  if (!Array.isArray(json)) throw new Error("That file is not a GitHub Issues export (expected a JSON array).");
  const issues = json as GithubIssue[];
  const cards: ImportedCard[] = issues.map((issue, i) => {
    const title = (issue.title ?? "").trim();
    if (!title) throw new Error(`GitHub issue ${i + 1}: a title is required.`);
    if (typeof issue.number !== "number") throw new Error(`"${title}": missing an issue number.`);
    const open = (issue.state ?? "").toLowerCase() === "open";
    const link = issue.url ? buildLink(parseLinkInput(issue.url)) : undefined;
    return {
      title, description: issue.body ?? "", column: open ? "To Do" : "Done",
      labels: (issue.labels ?? []).map(l => (l.name ?? "").trim()).filter(Boolean),
      priority: "none" as Priority, dueDate: null, estimate: null, archived: false, subtasks: [],
      ...(link ? { link } : {}),
    };
  });
  return { name: "GitHub Issues import", columns: DEFAULT_COLUMNS, cards };
}

// --- CSV ------------------------------------------------------------------

function parseDueDate(raw: string, context: string): string | null {
  const value = raw.trim(); if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${context}: invalid due date "${raw}".`);
  return value;
}
function parseEstimate(raw: string, context: string): number | null {
  const value = raw.trim(); if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${context}: invalid estimate "${raw}".`);
  return n;
}
function parsePriority(raw: string): Priority {
  const value = raw.trim().toLowerCase();
  return (priorities as readonly string[]).includes(value) ? value as Priority : "none";
}

export function parseCsvBoard(text: string): ImportedProject {
  const records = parseCsvRecords(text);
  if (!records.length) throw new Error("The CSV file has no data rows.");
  const header = Object.keys(records[0]!);
  const key = (name: string) => header.find(h => h.trim().toLowerCase() === name);
  const titleKey = key("title");
  if (!titleKey) throw new Error('The CSV file needs a "title" column.');
  const field = (record: Record<string, string>, name: string) => { const k = key(name); return k ? record[k] ?? "" : ""; };
  const cards: ImportedCard[] = records.map((record, i) => {
    const title = (record[titleKey] ?? "").trim();
    const context = `Row ${i + 2}`;
    if (!title) throw new Error(`${context}: a title is required.`);
    return {
      title, description: field(record, "description"),
      column: field(record, "column").trim() || "Backlog",
      labels: field(record, "labels").split(";").map(s => s.trim()).filter(Boolean),
      priority: parsePriority(field(record, "priority")),
      dueDate: parseDueDate(field(record, "due"), `${context} ("${title}")`),
      estimate: parseEstimate(field(record, "estimate"), `${context} ("${title}")`),
      archived: false, subtasks: [],
    };
  });
  return { name: "CSV import", columns: workflowOrder([...new Set(cards.map(c => c.column))]), cards };
}

// A file listing only the default column names gets them in workflow order; any custom name means
// the file's own order is the only order there is.
function workflowOrder(names: string[]): string[] {
  const rank = (n: string) => DEFAULT_COLUMNS.findIndex(d => d.toLowerCase() === n.toLowerCase());
  return names.every(n => rank(n) >= 0) ? names.slice().sort((x, y) => rank(x) - rank(y)) : names;
}

// --- Commit ---------------------------------------------------------------

function ensureColumns(w: Workspace, boardId: string, names: string[]) {
  const existing = w.columns.filter(c => c.boardId === boardId).sort((a, b) => a.position - b.position);
  names.forEach((name, i) => { if (existing[i]) updateColumn(w, existing[i]!.id, { name }); else addColumn(w, boardId, name); });
  for (let i = names.length; i < existing.length; i++) deleteColumn(w, existing[i]!.id);
}

// Parsing already validated every row; this still runs on a snapshot and restores it on any
// failure, so a problem this function itself discovers (an unknown-to-the-parser edge case,
// or a caller building an ImportedProject by hand, as the model tests do) still writes nothing.
export function applyImport(w: Workspace, imported: ImportedProject): Project {
  const snapshot = structuredClone(w);
  try {
    const project = createProject(w, imported.name);
    const board = w.boards.find(b => b.projectId === project.id)!;
    const names = imported.columns.length ? imported.columns : ["Backlog"];
    ensureColumns(w, board.id, names);
    const columns = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
    const named = columns.find(c => /^(done|closed|complete|completed)$/i.test(c.name.trim()));
    const doneColumn = named ?? columns[columns.length - 1]!;
    columns.forEach(c => updateColumn(w, c.id, { done: c === doneColumn }));
    const byName = new Map(columns.map(c => [c.name, c]));
    for (const card of imported.cards) {
      const column = byName.get(card.column) ?? columns[0]!;
      const created = createCard(w, column.id, card.title, "bottom", {
        description: card.description, priority: card.priority, dueDate: card.dueDate, estimate: card.estimate,
        labels: resolveLabels(project, card.labels),
        subtasks: card.subtasks.map((s, i) => ({ id: id(), title: s.title, done: s.done, position: i })),
        links: card.link ? [card.link] : [],
      });
      if (card.archived) archiveCard(w, created.id, true);
    }
    return project;
  } catch (error) {
    Object.assign(w, structuredClone(snapshot));
    throw error;
  }
}
