import { matches, type Card, type Column, type Filters, type Label, type Member, type Milestone, type Priority, type Workspace } from "./model";
import { estimateModule, type Range } from "./planning";
import { formatRange } from "./planning-ui";
import { escapeHTML as esc } from "./markdown";

export const listSortFields = ["title", "column", "priority", "due", "milestone", "epic", "ied"] as const;
export type ListSortField = typeof listSortFields[number];
export const listGroupFields = ["", "column", "priority", "assignee", "label", "milestone", "epic"] as const;
export type ListGroupField = typeof listGroupFields[number];
export const defaultListSort = "title:asc";
const priorityOrder: Priority[] = ["none", "low", "medium", "high", "urgent"];

export interface ListRow { card: Card; column: Column; assignees: Member[]; labels: Label[]; milestone: Milestone | null; epic: Card | null; ied: Range | null }
export interface ListGroup { key: string; label: string; rows: ListRow[] }

export function listRows(w: Workspace, columns: Column[], labels: Label[], milestones: Milestone[], filters: Filters): ListRow[] {
  const colIds = new Set(columns.map(c => c.id));
  return w.cards.filter(c => colIds.has(c.columnId) && !c.archived && matches(c, filters, new Date(), w.settings.actorId)).map(card => ({
    card, column: columns.find(c => c.id === card.columnId)!,
    assignees: card.assignees.map(id => w.members.find(m => m.id === id)).filter((m): m is Member => !!m),
    labels: card.labels.map(id => labels.find(l => l.id === id)).filter((l): l is Label => !!l),
    milestone: milestones.find(m => m.id === card.milestoneId) ?? null,
    epic: card.parentId ? w.cards.find(c => c.id === card.parentId) ?? null : null,
    ied: card.effort ? estimateModule(card.effort).ied : null,
  }));
}
function sortValue(row: ListRow, field: ListSortField): string | number | null {
  switch (field) {
    case "title": return row.card.title.toLocaleLowerCase();
    case "column": return row.column.position;
    case "priority": return priorityOrder.indexOf(row.card.priority);
    case "due": return row.card.dueDate;
    case "milestone": return row.milestone?.date ?? null;
    case "epic": return row.epic?.title.toLocaleLowerCase() ?? null;
    case "ied": return row.ied ? (row.ied[0] + row.ied[1]) / 2 : null;
  }
}
// Stable regardless of engine (explicit index tiebreak); null sorts last in either direction.
export function sortRows(rows: ListRow[], field: ListSortField, dir: "asc" | "desc"): ListRow[] {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const av = sortValue(a.row, field), bv = sortValue(b.row, field);
    if (av === null || bv === null) { if (av === bv) return a.index - b.index; return av === null ? 1 : -1; }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return (dir === "asc" ? cmp : -cmp) || a.index - b.index;
  }).map(x => x.row);
}
function groupSortKey(g: ListGroup, field: ListGroupField): [number, string] {
  if (field === "column") return [g.rows[0]!.column.position, ""];
  if (field === "priority") return [priorityOrder.indexOf(g.key as Priority), ""];
  return [g.key === "none" ? 1 : 0, g.label.toLocaleLowerCase()];
}
export function groupRows(rows: ListRow[], field: ListGroupField): ListGroup[] {
  if (!field) return rows.length ? [{ key: "", label: "", rows }] : [];
  const groups = new Map<string, ListGroup>();
  const push = (key: string, label: string, row: ListRow) => { const g = groups.get(key) ?? { key, label, rows: [] }; g.rows.push(row); groups.set(key, g); };
  for (const row of rows) {
    if (field === "column") push(row.column.id, row.column.name, row);
    else if (field === "priority") push(row.card.priority, row.card.priority === "none" ? "No priority" : row.card.priority[0]!.toUpperCase() + row.card.priority.slice(1), row);
    else if (field === "assignee") { if (row.assignees.length) for (const m of row.assignees) push(m.id, m.name, row); else push("none", "Unassigned", row); }
    else if (field === "label") { if (row.labels.length) for (const l of row.labels) push(l.id, l.name, row); else push("none", "No label", row); }
    else if (field === "milestone") push(row.milestone?.id ?? "none", row.milestone?.name ?? "No milestone", row);
    else if (field === "epic") push(row.epic?.id ?? "none", row.epic?.title ?? "No epic", row);
  }
  return [...groups.values()].sort((a, b) => { const ka = groupSortKey(a, field), kb = groupSortKey(b, field); return ka[0] - kb[0] || ka[1].localeCompare(kb[1]); });
}

export interface ListViewHooks { openCard(cardId: string): void; onSort(next: string): void; onGroup(next: string): void }
const headers: [string, ListSortField | null][] = [["Title", "title"], ["Column", "column"], ["Priority", "priority"], ["Due", "due"], ["Assignees", null], ["Labels", null], ["Milestone", "milestone"], ["Epic", "epic"], ["IED estimate", "ied"]];
function headerCell(label: string, field: ListSortField | null, sortField: ListSortField, dir: "asc" | "desc"): string {
  if (!field) return `<th>${esc(label)}</th>`;
  const active = field === sortField; const arrow = active ? (dir === "asc" ? " ▲" : " ▼") : "";
  return `<th><button type="button" class="list-sort" data-sort="${field}" aria-label="Sort by ${esc(label)}">${esc(label)}${arrow}</button></th>`;
}
function rowHTML(row: ListRow): string {
  return `<tr class="list-row" data-card="${esc(row.card.id)}" tabindex="0" role="button" aria-label="Open card: ${esc(row.card.title)}">
    <td>${esc(row.card.title)}</td><td>${esc(row.column.name)}</td><td>${esc(row.card.priority)}</td>
    <td>${row.card.dueDate ? esc(row.card.dueDate) : ""}</td>
    <td>${row.assignees.map(m => esc(m.name)).join(", ")}</td>
    <td>${row.labels.map(l => esc(l.name)).join(", ")}</td>
    <td>${row.milestone ? esc(row.milestone.name) : ""}</td>
    <td>${row.epic ? esc(row.epic.title) : ""}</td>
    <td>${row.ied ? esc(`${formatRange(row.ied)} IED`) : ""}</td></tr>`;
}
export function mountListView(root: HTMLElement, w: Workspace, columns: Column[], labels: Label[], milestones: Milestone[], filters: Filters, hooks: ListViewHooks) {
  const [sortFieldRaw, dirRaw] = (filters.sort || defaultListSort).split(":");
  const sortField: ListSortField = (listSortFields as readonly string[]).includes(sortFieldRaw ?? "") ? sortFieldRaw as ListSortField : "title";
  const dir: "asc" | "desc" = dirRaw === "desc" ? "desc" : "asc";
  const groupField: ListGroupField = (listGroupFields as readonly string[]).includes(filters.group) ? filters.group as ListGroupField : "";
  const rows = sortRows(listRows(w, columns, labels, milestones, filters), sortField, dir);
  const groups = groupRows(rows, groupField);
  root.innerHTML = `<div class="list-controls"><label class="form-field"><span>Group by</span><select id="list-group" aria-label="Group list by">${listGroupFields.map(f => `<option value="${f}" ${f === groupField ? "selected" : ""}>${f ? f[0]!.toUpperCase() + f.slice(1) : "No grouping"}</option>`).join("")}</select></label></div>`
    + (rows.length ? `<table class="list-table"><thead><tr>${headers.map(([label, field]) => headerCell(label, field, sortField, dir)).join("")}</tr></thead><tbody>${groups.map(g => (groupField ? `<tr class="list-group-row"><td colspan="${headers.length}">${esc(g.label)} <span class="count">${g.rows.length}</span></td></tr>` : "") + g.rows.map(rowHTML).join("")).join("")}</tbody></table>`
      : '<p class="muted">No cards match the current filters.</p>');
  root.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach(b => b.onclick = () => {
    const field = b.dataset.sort as ListSortField; const nextDir = field === sortField && dir === "asc" ? "desc" : "asc";
    hooks.onSort(`${field}:${nextDir}`);
  });
  root.querySelectorAll<HTMLElement>("[data-card]").forEach(el => {
    el.onclick = () => hooks.openCard(el.dataset.card!);
    el.onkeydown = e => { if (e.key === "Enter") hooks.openCard(el.dataset.card!); };
  });
  const groupSelect = root.querySelector<HTMLSelectElement>("#list-group");
  if (groupSelect) groupSelect.onchange = () => hooks.onGroup(groupSelect.value);
}
