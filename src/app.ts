import { createProject, createCard, editCard, moveCard, archiveCard, deleteCard, addColumn, updateColumn, reorderColumn, deleteColumn, orderedCards, priorities, matches, dueState, emptyFilters, encodeFilters, decodeFilters, migrateWorkspace, id, type Card, type CardEdit, type Column, type Workspace, type Filters } from "./model";
import { Storage, Session, DraftJournal } from "./storage";
import { escapeHTML as esc, markdown } from "./markdown";
import { mountEffort, mountPlanning, effortBadge, type PlanningHooks } from "./planning-ui";

const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T => {
  const result = root.querySelector<T>(selector); if (!result) throw new Error(`Missing UI element: ${selector}`); return result;
};
const modal = $<HTMLDialogElement>("#modal"); const detail = $<HTMLDialogElement>("#detail");
const storage = new Storage();
let session: Session;
let filters: Filters = decodeFilters(location.hash);
let openedCard: string | null = null;
let ready = false;
let bound = false;
let draftStorageError = "";
const fieldErrors = new Map<string, string>();
let dragging: { kind: "card" | "column"; id: string } | null = null;
let rawDrafts: Record<string, string> = {};
const columnMarkup = new WeakMap<HTMLElement, string>();
const cardMarkup = new WeakMap<HTMLElement, string>();
function syncChildren(parent: HTMLElement, nodes: HTMLElement[]) {
  nodes.forEach((node, index) => { if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] ?? null); });
  const keep = new Set(nodes); for (const child of Array.from(parent.children)) if (!keep.has(child as HTMLElement)) child.remove();
}
const status = $("#storage-status");
function message(error: unknown) { if (session) session.report(error); else { status.textContent = "Not saved · storage unavailable"; $("#error-banner").hidden = false; $("#error-message").textContent = String(error); } }
function updateStatus() {
  const error = draftStorageError || [...fieldErrors.values()][0] || session.error;
  status.className = error ? "error" : session.status;
  status.textContent = error || session.status === "error" ? "Not saved · action needed" : session.status === "saving" ? "Saving…" : "✓ Saved on this device";
  $("#error-banner").hidden = !error && session.status !== "error";
  $("#error-message").textContent = error;
}
function stage(fn: (w: Workspace) => unknown, rerender = true): boolean {
  if (!ready) { message(new Error("Persistent storage is not ready. No changes accepted.")); return false; }
  try { session.change(fn); if (rerender) render(); return true; } catch { return false; }
}
function retain(key: string, value: string): boolean {
  rawDrafts = { ...rawDrafts, [key]: value };
  try { localStorage.setItem("fieldboard-text", JSON.stringify(rawDrafts)); draftStorageError = ""; return true; }
  catch (e) { draftStorageError = `Draft storage failed: ${String(e)}. Keep this tab open and copy or download your text.`; message(new Error(draftStorageError)); return false; }
}
async function clearDraft(key: string, expected: string) {
  await session.flush(); if (session.status !== "saved" || rawDrafts[key] !== expected) return;
  try { delete rawDrafts[key]; localStorage.setItem("fieldboard-text", JSON.stringify(rawDrafts)); } catch (e) { message(e); }
}
function fieldDraft(input: HTMLInputElement | HTMLTextAreaElement, key: string) {
  if (rawDrafts[key] !== undefined) input.value = rawDrafts[key]!;
  input.addEventListener("input", () => retain(key, input.value));
}
const planningHooks: PlanningHooks = {
  state: () => session.state,
  stage: fn => stage(fn), retain, draft: key => rawDrafts[key], clear: clearDraft,
  error: (key, message) => { if (message) fieldErrors.set(key, message); else fieldErrors.delete(key); updateStatus(); },
};
function planningDialog() {
  const p = activeProject(); if (!p) return;
  showModal("Effort & planning", '<div id="project-planning"></div>');
  modal.classList.add("planning-dialog"); modal.dataset.planningProject = p.id;
  mountPlanning($("#project-planning", modal), p.id, planningHooks);
}
function activeProject() { return session.state.projects.find(p => p.id === filters.project) ?? session.state.projects.find(p => p.status === "active") ?? session.state.projects[0]; }
function currentBoard() { return session.state.boards.find(b => b.projectId === activeProject()?.id); }
function boardColumns(): Column[] { return session.state.columns.filter(c => c.boardId === currentBoard()?.id).sort((a, b) => a.position - b.position); }
function setHash() { history.replaceState(null, "", encodeFilters(filters)); }
function option(value: string, label: string, selected = false) { return `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`; }
function prettyDate(s: string) { return new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
function shortDue(s: string) { return new Date(`${s}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function initials(name: string) { return name.split(/\s+/).map(s => s[0]).join("").slice(0, 2).toUpperCase(); }

function render() {
  const w = session.state; const project = activeProject();
  if (project && filters.project !== project.id) { filters.project = project.id; setHash(); }
  $("#workspace-name").textContent = w.name;
  $("#projects").innerHTML = w.projects.map(p => {
    const boardIds = w.boards.filter(b => b.projectId === p.id).map(b => b.id); const colIds = w.columns.filter(c => boardIds.includes(c.boardId)).map(c => c.id);
    const count = w.cards.filter(c => colIds.includes(c.columnId) && !c.archived).length;
    return `<button class="project-link ${p.id === project?.id ? "selected" : ""}" data-project="${esc(p.id)}"><span class="project-dot" style="background:${p.color}"></span><span class="project-name">${esc(p.name)}${p.status === "archived" ? " (archived)" : ""}</span><span class="count">${count}</span></button>`;
  }).join("");
  $("#projects").querySelectorAll<HTMLButtonElement>("[data-project]").forEach(b => b.onclick = () => { filters = { ...emptyFilters, project: b.dataset.project! }; setHash(); render(); });
  $("#breadcrumb-project").textContent = project?.name ?? "Overview";
  $("#project-title").textContent = project?.name ?? "Your work, in view.";
  $("#project-description").textContent = project?.description || (project ? "Small steps. Meaningful progress." : "A quiet place to turn plans into progress.");
  $("#project-settings").hidden = !project; $("#board-tools").hidden = !project; $("#welcome").hidden = !!project; $("#board").hidden = !project;
  $<HTMLInputElement>("#search").value = filters.q;
  $<HTMLSelectElement>("#filter-label").innerHTML = option("", "All labels") + (project?.labels ?? []).map(l => option(l.id, l.name, filters.label === l.id)).join("");
  $<HTMLSelectElement>("#filter-assignee").innerHTML = option("", "All assignees") + w.members.map(m => option(m.id, m.name, filters.assignee === m.id)).join("");
  $<HTMLSelectElement>("#filter-priority").value = filters.priority; $<HTMLSelectElement>("#filter-due").value = filters.due;
  renderBoard();
}
function cardHTML(card: Card): string {
  const project = activeProject();
  const labels = card.labels.map(id => project?.labels.find(l => l.id === id)).filter(l => !!l);
  const members = card.assignees.map(id => session.state.members.find(m => m.id === id)).filter(m => !!m);
  return `<button class="card" draggable="true" data-card="${esc(card.id)}" aria-label="Open card: ${esc(card.title)}">
    <div class="card-labels">${labels.map(l => `<span class="label-chip"><i style="background:${l.color}"></i>${esc(l.name)}</span>`).join("")}</div>
    <div class="card-title">${esc(card.title)}</div>${effortBadge(card)}
    <div class="card-meta">${card.priority !== "none" ? `<span class="priority ${card.priority}" title="${card.priority} priority">${card.priority === "urgent" ? "!!" : "↑"} ${card.priority}</span>` : ""}
    ${card.dueDate ? `<span class="due ${dueState(card)}" title="Due ${esc(card.dueDate)}">◷ ${shortDue(card.dueDate)}</span>` : ""}
    ${card.subtasks.length ? `<span title="Subtasks completed">☑ ${card.subtasks.filter(s => s.done).length}/${card.subtasks.length}</span>` : ""}
    ${card.comments.length ? `<span title="Comments">▤ ${card.comments.length}</span>` : ""}
    <span class="avatars">${members.map(m => `<span class="avatar" title="${esc(m.name)}" aria-label="Assigned to ${esc(m.name)}">${esc(initials(m.name))}</span>`).join("")}</span></div></button>`;
}
function renderBoard() {
  const columns = boardColumns(); const w = session.state;
  const cards = w.cards.filter(c => columns.some(col => col.id === c.columnId) && !c.archived);
  const visible = cards.filter(c => matches(c, filters));
  $("#total-count").textContent = String(cards.length);
  $("#board-summary").textContent = columns.length ? `${visible.length} of ${cards.length} cards · ${cards.filter(c => c.completedAt).length} completed · Drag to make your next move` : "Ready when you are.";
  const boardElement = $("#board");
  const previousColumns = new Map(Array.from(boardElement.querySelectorAll<HTMLElement>(".column")).map(el => [el.dataset.column!, el]));
  const previousCards = new Map(Array.from(boardElement.querySelectorAll<HTMLElement>(".card")).map(el => [el.dataset.card!, el]));
  const columnNodes = columns.map(col => {
    const items = visible.filter(c => c.columnId === col.id).sort((a, b) => a.position - b.position);
    const html = `<section class="column" data-column="${esc(col.id)}" aria-label="${esc(col.name)} column"><header class="column-heading" draggable="true" data-column-drag="${esc(col.id)}"><span class="stage-dot ${col.done ? "done-dot" : ""}"></span><h2>${esc(col.name)}</h2><span class="count">0</span><button data-settings="${esc(col.id)}" aria-label="Edit column ${esc(col.name)}">⋯</button></header><button class="add-card top" data-add="top" aria-label="Add card at top">+ Add at top</button><div class="cards"></div><button class="add-card" data-add="bottom" aria-label="Add card at bottom">+ Add card</button></section>`;
    let element = previousColumns.get(col.id);
    if (!element || columnMarkup.get(element) !== html) {
      const template = document.createElement("template"); template.innerHTML = html;
      element = template.content.firstElementChild as HTMLElement; columnMarkup.set(element, html);
    }
    const count = $(".count", element); if (count.textContent !== String(items.length)) count.textContent = String(items.length);
    const cardNodes = items.map(card => {
      const markup = cardHTML(card); const old = previousCards.get(card.id);
      if (old && cardMarkup.get(old) === markup) return old;
      const template = document.createElement("template"); template.innerHTML = markup;
      const node = template.content.firstElementChild as HTMLElement; cardMarkup.set(node, markup); return node;
    });
    if (!items.length) { const empty = document.createElement("div"); empty.className = "empty-column"; empty.textContent = "A little room for what’s next."; cardNodes.push(empty); }
    syncChildren($(".cards", element), cardNodes); return element;
  });
  syncChildren(boardElement, columnNodes);
  $("#board").querySelectorAll<HTMLElement>(".column").forEach(col => {
    const columnId = col.dataset.column!;
    col.querySelectorAll<HTMLButtonElement>("[data-add]").forEach(b => b.onclick = () => inlineAdd(col, columnId, b.dataset.add as "top" | "bottom"));
    $<HTMLButtonElement>("[data-settings]", col).onclick = () => columnDialog(columnId);
    $<HTMLElement>(".column-heading", col).ondragstart = e => {
      if (!e.dataTransfer) return; dragging = { kind: "column", id: columnId }; e.dataTransfer.setData("text/plain", columnId); e.dataTransfer.effectAllowed = "move";
    };
    col.ondragover = e => { if (dragging) { e.preventDefault(); col.classList.add("drag-over"); if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; } };
    col.ondragleave = () => col.classList.remove("drag-over");
    col.ondrop = e => {
      e.preventDefault(); col.classList.remove("drag-over"); const drag = dragging; dragging = null; if (!drag) return;
      if (drag.kind === "column") stage(w => reorderColumn(w, drag.id, columns.findIndex(c => c.id === columnId)));
      else {
        const target = (e.target as Element).closest<HTMLElement>("[data-card]");
        if (target?.dataset.card === drag.id) return;
        const others = orderedCards(session.state, columnId).filter(c => c.id !== drag.id);
        const index = target ? others.findIndex(c => c.id === target.dataset.card) : others.length;
        stage(w => moveCard(w, drag.id, columnId, index < 0 ? others.length : index));
      }
    };
  });
  $("#board").querySelectorAll<HTMLButtonElement>(".card").forEach(card => {
    card.onclick = () => openCard(card.dataset.card!);
    card.ondragstart = e => { if (!e.dataTransfer) return; e.stopPropagation(); dragging = { kind: "card", id: card.dataset.card! }; e.dataTransfer.setData("text/plain", card.dataset.card!); e.dataTransfer.effectAllowed = "move"; card.classList.add("dragging"); };
    card.ondragend = () => { dragging = null; card.classList.remove("dragging"); document.querySelectorAll(".drag-over").forEach(e => e.classList.remove("drag-over")); };
  });
}
function inlineAdd(col: HTMLElement, columnId: string, at: "top" | "bottom") {
  if (col.querySelector(".inline-add")) { $<HTMLInputElement>(".inline-add input", col).focus(); return; }
  const form = document.createElement("form"); form.className = "inline-add";
  form.innerHTML = '<input placeholder="Card title" aria-label="New card title" autocomplete="off" required><small>Enter to add · Escape to close (draft retained)</small>';
  const cards = $(".cards", col); if (at === "top") cards.before(form); else cards.after(form);
  const input = $<HTMLInputElement>("input", form); const key = `add:${columnId}:${at}`; fieldDraft(input, key); input.focus();
  form.onsubmit = e => { e.preventDefault(); const value = input.value; if (!value.trim()) return;
    if (!retain(key, value)) return;
    if (stage(w => createCard(w, columnId, value, at))) { form.remove(); void clearDraft(key, value); }
  };
  input.onkeydown = e => { if (e.key === "Escape") form.remove(); };
}
function showModal(title: string, body: string, closeLabel = "Close dialog") {
  modal.classList.remove("planning-dialog"); delete modal.dataset.planningProject;
  modal.innerHTML = `<header class="dialog-head"><h2>${esc(title)}</h2><button aria-label="${esc(closeLabel)}">×</button></header><div class="dialog-body">${body}</div>`;
  $<HTMLButtonElement>(".dialog-head button", modal).onclick = () => modal.close(); if (!modal.open) modal.showModal();
}
function projectDialog() {
  showModal("A new place for your work", '<form id="project-form"><label class="form-field"><span>Project name</span><input id="project-name-input" aria-label="Project name" placeholder="What are you working on?" required autofocus></label><label class="form-field"><span>Project color</span><input id="project-color-input" type="color" value="#667b68" aria-label="Project color"></label><p class="muted">We’ll start you with Backlog, To Do, In Progress, Review, and Done. Make them your own.</p><div class="dialog-actions"><button class="primary" type="submit">Create project</button></div></form>');
  const name = $<HTMLInputElement>("#project-name-input"); fieldDraft(name, "new-project");
  $<HTMLFormElement>("#project-form").onsubmit = e => {
    e.preventDefault(); const value = name.value; if (!retain("new-project", value)) return;
    if (stage(w => { filters.project = createProject(w, value, $<HTMLInputElement>("#project-color-input").value).id; }, false)) { modal.close(); setHash(); render(); void clearDraft("new-project", value); }
  };
}
function projectSettings() {
  const p = activeProject(); if (!p) return;
  showModal("Project settings", `<label class="form-field"><span>Project name</span><input id="ps-name" aria-label="Project name" value="${esc(p.name)}"></label><label class="form-field"><span>Description</span><textarea id="ps-description" aria-label="Project description">${esc(p.description)}</textarea></label><label class="form-field"><span>Color</span><input id="ps-color" aria-label="Project color" type="color" value="${p.color}"></label><label class="form-field"><span>Status</span><select id="ps-status" aria-label="Project status">${option("active", "Active", p.status === "active")}${option("archived", "Archived", p.status === "archived")}</select></label><small>Changes save automatically. Archived projects remain accessible in the sidebar.</small>`);
  for (const [selector, field] of [["#ps-name", "name"], ["#ps-description", "description"], ["#ps-color", "color"], ["#ps-status", "status"]] as const) {
    const input = $<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector); const key = `project:${p.id}:${field}`;
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) fieldDraft(input, key);
    input.addEventListener("input", () => { const value = input.value; if (!retain(key, value)) return; if (stage(w => { const project = w.projects.find(x => x.id === p.id)!; if (field === "status") project.status = value as "active" | "archived"; else project[field] = value; })) void clearDraft(key, value); });
  }
}
function columnDialog(columnId?: string) {
  const col = session.state.columns.find(c => c.id === columnId); const columns = boardColumns();
  showModal(col ? "Column settings" : "Add a column", `<form id="column-form"><label class="form-field"><span>Column name</span><input id="column-name-input" aria-label="Column name" value="${esc(col?.name ?? "")}" required autofocus></label><label class="checkbox-label"><input id="column-done-input" type="checkbox" ${col?.done ? "checked" : ""}>Cards here are done</label>${col ? '<small>Changes save automatically.</small>' : '<div class="dialog-actions"><button type="submit" class="primary">Create column</button></div>'}</form>${col ? `<hr><div class="form-row"><button id="column-left" aria-label="Move column left">← Move left</button><button id="column-right" aria-label="Move column right">Move right →</button></div><p>Deleting this column also moves its archived cards. Choose a destination first.</p><label class="form-field"><span>Move cards to</span><select id="column-destination" aria-label="Column deletion destination">${option("", "Choose a destination")}${columns.filter(c => c.id !== col.id).map(c => option(c.id, c.name)).join("")}</select></label><button id="delete-column" class="danger">Delete column</button>` : ""}`);
  const input = $<HTMLInputElement>("#column-name-input"); const key = `column:${columnId ?? "new"}`; fieldDraft(input, key);
  $<HTMLFormElement>("#column-form").onsubmit = e => {
    e.preventDefault(); const value = input.value; if (!retain(key, value)) return;
    const done = $<HTMLInputElement>("#column-done-input").checked;
    if (stage(w => { if (col) updateColumn(w, col.id, { name: value, done }); else { const created = addColumn(w, currentBoard()!.id, value); updateColumn(w, created.id, { done }); } })) { modal.close(); void clearDraft(key, value); }
  };
  if (col) {
    const autosave = () => {
      const value = input.value; if (!retain(key, value)) return;
      if (stage(w => updateColumn(w, col.id, { name: value, done: $<HTMLInputElement>("#column-done-input").checked }))) { fieldErrors.delete(key); updateStatus(); void clearDraft(key, value); }
      else { fieldErrors.set(key, session.error); updateStatus(); }
    };
    input.addEventListener("input", autosave);
    $<HTMLInputElement>("#column-done-input").onchange = autosave;
    $("#column-left").onclick = () => { stage(w => reorderColumn(w, col.id, Math.max(0, session.state.columns.find(c => c.id === col.id)!.position - 1))); };
    $("#column-right").onclick = () => { stage(w => reorderColumn(w, col.id, session.state.columns.find(c => c.id === col.id)!.position + 1)); };
    $("#delete-column").onclick = () => {
      const dest = $<HTMLSelectElement>("#column-destination").value;
      if (session.state.cards.some(c => c.columnId === col.id) && !dest) { alert("Choose where this column’s cards should go."); return; }
      if (confirm(`Delete column “${col.name}”? Cards will move to the chosen destination.`) && stage(w => deleteColumn(w, col.id, dest || undefined))) modal.close();
    };
  }
}
function bindEdit(selector: string, field: keyof CardEdit, card: Card, read: (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => unknown = el => el.value, event = "input") {
  const input = $<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector, detail); const key = `${card.id}:${field}`;
  if (rawDrafts[key] !== undefined) input.value = rawDrafts[key]!;
  input.addEventListener(event, () => {
    const raw = input.value;
    if (!retain(key, raw)) { fieldErrors.set(key, "A card text draft has not been saved. Correct it or download drafts before closing this tab."); updateStatus(); return; }
    if (stage(w => editCard(w, card.id, { [field]: read(input) }), false)) { fieldErrors.delete(key); updateStatus(); renderBoard(); void clearDraft(key, raw); }
    else { fieldErrors.set(key, session.error); updateStatus(); }
    if (field === "description") $("#description-preview", detail).innerHTML = markdown(raw);
  });
}
function openCard(cardId: string) {
  const c = session.state.cards.find(c => c.id === cardId); if (!c) return;
  openedCard = cardId; const w = session.state; const project = activeProject(); const col = w.columns.find(x => x.id === c.columnId)!;
  const complete = c.subtasks.filter(s => s.done).length;
  detail.innerHTML = `<header class="dialog-head"><div class="breadcrumb">${esc(project?.name ?? "")} <span>/</span> ${esc(col.name)}</div><button aria-label="Close card">×</button></header><div class="detail-layout"><div class="detail-main">
    <label class="form-field"><span>Title</span><input class="title-input" id="card-title" aria-label="Title" value="${esc(c.title)}" required></label>
    <label class="form-field"><span>Description</span><textarea id="card-description" aria-label="Description" placeholder="Give this work a little context. Markdown is welcome.">${esc(c.description)}</textarea></label>
    <div class="preview-label">RENDERED PREVIEW · REMOTE IMAGES DISABLED</div><div id="description-preview" class="markdown">${markdown(rawDrafts[`${c.id}:description`] ?? c.description)}</div>
    <section id="card-effort" class="detail-section"></section>
    <section class="detail-section"><h3>Subtasks <span class="count">${complete}/${c.subtasks.length}</span></h3><div class="progress"><i style="width:${c.subtasks.length ? complete / c.subtasks.length * 100 : 0}%"></i></div>
    ${c.subtasks.slice().sort((a, b) => a.position - b.position).map(s => `<div class="subtask ${s.done ? "completed" : ""}"><input type="checkbox" data-subtask="${esc(s.id)}" ${s.done ? "checked" : ""} aria-label="Complete subtask: ${esc(s.title)}"><span>${esc(s.title)}</span><button data-remove-subtask="${esc(s.id)}" aria-label="Remove subtask: ${esc(s.title)}">×</button></div>`).join("")}<form id="subtask-form" class="subtask-add"><input placeholder="Add subtask" aria-label="Add subtask" required></form></section>
    <section class="detail-section"><h3>Comments <span class="count">${c.comments.length}</span></h3>${c.comments.map(comment => `<div class="comment"><div class="comment-head"><strong>${esc(w.members.find(m => m.id === comment.author)?.name ?? "Member")}</strong><time>${prettyDate(comment.timestamp)}</time></div><div class="markdown">${markdown(comment.body)}</div></div>`).join("") || '<p class="empty-detail">Leave a note for the next person. Identities are local, not accounts.</p>'}<form id="comment-form" class="comment-form"><textarea placeholder="Write a comment" aria-label="Comment body" required></textarea><button type="submit">Add comment</button></form></section>
    <section class="detail-section"><h3>Activity</h3><ul class="history">${w.activities.filter(a => a.cardId === c.id).slice().reverse().map(a => `<li><strong>${esc(w.members.find(m => m.id === a.actor)?.name ?? a.actor)}</strong> · ${esc(a.action)}<time>${prettyDate(a.timestamp)}</time><details><summary>Before / after</summary><pre>${esc(JSON.stringify({ before: a.before, after: a.after }, null, 2))}</pre></details></li>`).join("")}</ul><small>Recent edits appear here when you reopen the card.</small></section>
    </div><aside class="detail-sidebar"><label class="form-field"><span>Column</span><select id="card-column" aria-label="Move to column">${boardColumns().map(col => option(col.id, col.name, c.columnId === col.id)).join("")}</select></label>
    <label class="form-field"><span>Priority</span><select id="card-priority" aria-label="Priority">${priorities.map(p => option(p, p[0]!.toUpperCase() + p.slice(1), c.priority === p)).join("")}</select></label>
    <label class="form-field"><span>Due date</span><input id="card-due" aria-label="Due date" type="date" value="${c.dueDate ?? ""}"></label>
    <label class="form-field"><span>Legacy estimate · unitless</span><input id="card-estimate" aria-label="Estimate" type="number" min="0" step="any" value="${c.estimate ?? ""}" placeholder="Optional"></label>
    <label class="form-field"><span>Labels · comma separated</span><input id="card-labels" aria-label="Label names" placeholder="Release, Bug" value="${esc(c.labels.map(l => project?.labels.find(x => x.id === l)?.name ?? "").join(", "))}"></label>
    <div class="section-label">ASSIGNEES</div>${w.members.map(m => `<label class="checkbox-label"><input type="checkbox" data-assignee="${esc(m.id)}" aria-label="Assign to ${esc(m.name)}" ${c.assignees.includes(m.id) ? "checked" : ""}>${esc(m.name)}</label>`).join("")}
    <div class="side-actions"><button id="archive-card">Archive card</button><button id="delete-card" class="danger" aria-label="Delete card permanently">Delete permanently…</button></div><div class="timestamps">Created ${prettyDate(c.createdAt)}<br>Updated ${prettyDate(c.updatedAt)}${c.completedAt ? `<br>Completed ${prettyDate(c.completedAt)}` : ""}</div></aside></div>`;
  $<HTMLButtonElement>(".dialog-head button", detail).onclick = () => detail.close();
  bindEdit("#card-title", "title", c); bindEdit("#card-description", "description", c); bindEdit("#card-priority", "priority", c, el => el.value, "change");
  bindEdit("#card-due", "dueDate", c, el => el.value || null, "change"); bindEdit("#card-estimate", "estimate", c, el => el.value === "" ? null : Number(el.value), "change");
  $<HTMLSelectElement>("#card-column", detail).onchange = e => {
    const destination = (e.target as HTMLSelectElement).value; if (stage(w => moveCard(w, c.id, destination, orderedCards(w, destination).length))) openCard(c.id);
  };
  const labels = $<HTMLInputElement>("#card-labels", detail); const labelsKey = `${c.id}:labelNames`; fieldDraft(labels, labelsKey);
  labels.onchange = () => {
    const value = labels.value; if (!retain(labelsKey, value)) return;
    if (stage(w => {
      const p = w.projects.find(x => x.id === project!.id)!;
      const names = [...new Set(value.split(",").map(n => n.trim()).filter(Boolean))];
      const labelIds = names.map(name => { let label = p.labels.find(l => l.name.toLocaleLowerCase() === name.toLocaleLowerCase()); if (!label) { label = { id: id(), name, color: "#70865e" }; p.labels.push(label); } return label.id; });
      editCard(w, c.id, { labels: labelIds });
    })) void clearDraft(labelsKey, value);
  };
  detail.querySelectorAll<HTMLInputElement>("[data-assignee]").forEach(box => box.onchange = () => { stage(w => { const card = w.cards.find(x => x.id === c.id)!; editCard(w, c.id, { assignees: box.checked ? [...new Set([...card.assignees, box.dataset.assignee!])] : card.assignees.filter(a => a !== box.dataset.assignee) }); }); });
  detail.querySelectorAll<HTMLInputElement>("[data-subtask]").forEach(box => box.onchange = () => {
    if (stage(w => { const card = w.cards.find(x => x.id === c.id)!; editCard(w, c.id, { subtasks: card.subtasks.map(s => s.id === box.dataset.subtask ? { ...s, done: box.checked } : s) }); })) openCard(c.id);
  });
  detail.querySelectorAll<HTMLButtonElement>("[data-remove-subtask]").forEach(button => button.onclick = () => {
    if (stage(w => { const card = w.cards.find(x => x.id === c.id)!; editCard(w, c.id, { subtasks: card.subtasks.filter(s => s.id !== button.dataset.removeSubtask).map((s, position) => ({ ...s, position })) }); })) openCard(c.id);
  });
  const subtask = $<HTMLInputElement>("#subtask-form input", detail); const subKey = `${c.id}:new-subtask`; fieldDraft(subtask, subKey);
  $<HTMLFormElement>("#subtask-form", detail).onsubmit = async e => {
    e.preventDefault(); const value = subtask.value.trim(); if (!value || !retain(subKey, value)) return;
    if (stage(w => { const card = w.cards.find(x => x.id === c.id)!; editCard(w, c.id, { subtasks: [...card.subtasks, { id: id(), title: value, done: false, position: card.subtasks.length }] }); })) { await clearDraft(subKey, value); openCard(c.id); }
  };
  const comment = $<HTMLTextAreaElement>("#comment-form textarea", detail); const commentKey = `${c.id}:new-comment`; fieldDraft(comment, commentKey);
  $<HTMLFormElement>("#comment-form", detail).onsubmit = async e => {
    e.preventDefault(); const value = comment.value.trim(); if (!value || !retain(commentKey, value)) return;
    if (stage(w => { const card = w.cards.find(x => x.id === c.id)!; editCard(w, c.id, { comments: [...card.comments, { id: id(), author: w.settings.actorId, body: value, timestamp: new Date().toISOString() }] }); })) { await clearDraft(commentKey, value); openCard(c.id); }
  };
  $("#archive-card", detail).onclick = () => { if (stage(w => archiveCard(w, c.id, true))) detail.close(); };
  $("#delete-card", detail).onclick = () => { if (confirm(`Permanently delete “${c.title}”? Archive keeps cards restorable. Undo is available only in this session.`) && stage(w => deleteCard(w, c.id))) detail.close(); };
  mountEffort($("#card-effort", detail), c.id, planningHooks);
  if (!detail.open) detail.showModal();
}
function archiveDialog() {
  const columns = boardColumns().map(c => c.id); const archived = session.state.cards.filter(c => c.archived && columns.includes(c.columnId));
  showModal("Archived cards", archived.length ? archived.map(c => `<div class="dialog-list"><span>${esc(c.title)}</span><button data-restore="${esc(c.id)}" aria-label="Restore ${esc(c.title)}">Restore</button></div>`).join("") : '<p class="muted">No archived cards in this project.</p>', "Close archive");
  modal.querySelectorAll<HTMLButtonElement>("[data-restore]").forEach(button => button.onclick = () => { if (stage(w => archiveCard(w, button.dataset.restore!, false))) archiveDialog(); });
}
function membersDialog() {
  const w = session.state;
  showModal("Workspace & members", `<label class="form-field"><span>Workspace name</span><input id="ws-name" aria-label="Workspace name" value="${esc(w.name)}"></label><label class="form-field"><span>Acting as</span><select id="actor" aria-label="Acting as">${w.members.map(m => option(m.id, m.name, m.id === w.settings.actorId)).join("")}</select></label><p class="muted">These are local identities, not accounts. Everyone using this browser profile shares the workspace.</p>${w.members.map(m => `<div class="dialog-list"><span>${esc(m.name)}</span><small>${m.id === w.settings.actorId ? "Current actor" : "Local member"}</small></div>`).join("")}<form id="member-form" class="form-row" style="margin-top:18px"><input id="member-name" aria-label="Member name" placeholder="Member name" required><button type="submit">Add member</button></form>`);
  const name = $<HTMLInputElement>("#ws-name"); fieldDraft(name, "workspace-name"); name.onchange = () => { const value = name.value; if (retain("workspace-name", value) && stage(w => w.name = value)) void clearDraft("workspace-name", value); };
  $<HTMLSelectElement>("#actor").onchange = e => { stage(w => w.settings.actorId = (e.target as HTMLSelectElement).value); };
  const member = $<HTMLInputElement>("#member-name"); fieldDraft(member, "new-member");
  $<HTMLFormElement>("#member-form").onsubmit = async e => { e.preventDefault(); const value = member.value.trim(); if (retain("new-member", value) && stage(w => w.members.push({ id: id(), name: value, color: "#667b68" }))) { await clearDraft("new-member", value); membersDialog(); } };
}
async function snapshotsDialog() {
  try {
    const snapshots = await storage.snapshots();
    showModal("Daily snapshots", '<p>One snapshot per local day, up to seven days retained. Same-device recovery only; download backups for protection against browser eviction or device loss.</p>' + (snapshots.map(s => `<div class="dialog-list"><span>${esc(s.date)}</span><button data-snapshot="${esc(s.date)}">Restore ${esc(s.date)}</button></div>`).join("") || '<p class="muted">No snapshots yet.</p>'));
    modal.querySelectorAll<HTMLButtonElement>("[data-snapshot]").forEach(button => button.onclick = async () => {
      if (!confirm("Replace the entire workspace with this snapshot? Download a backup first if needed.")) return;
      try { await session.flush(); session.replace(migrateWorkspace(snapshots.find(s => s.date === button.dataset.snapshot)!.state)); await session.flush(); modal.close(); filters = { ...emptyFilters }; setHash(); render(); } catch (e) { message(e); }
    });
  } catch (e) { message(e); }
}
function download(name: string, data: unknown) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function backup() {
  try { await session.flush(); if (session.status !== "saved" || draftStorageError || fieldErrors.size) throw new Error("Workspace has unsaved changes. Download drafts or retry the write first."); const committed = await storage.load(); if (!committed) throw new Error("No stored workspace"); download(`fieldboard-${new Date().toISOString().slice(0, 10)}.json`, committed); }
  catch (e) { message(e); }
}
function help() {
  showModal("Your work stays here", `<p>Fieldboard runs from this single HTML file, without accounts, servers or a network. Workspace data lives separately in this browser profile’s IndexedDB. Edits show “Saved” only after a strict transaction completes.</p><p><strong>Download a backup regularly.</strong> Before moving or renaming the HTML, changing browsers, profiles or computers, download JSON and restore it at the new location. File-path storage behavior differs by browser.</p><p>Private browsing, browser eviction, clearing site data, storage denial and device failure can remove data. Daily snapshots share these limits. Strict durability is not protection against disk failure.</p><p>Draft text stays in localStorage until committed. A red “Not saved” message means the change is not acknowledged. Retry or download drafts. If draft storage is denied too, keep this tab open and copy your text.</p><p>Open only one editing tab per profile. A conflicting write is rejected rather than overwriting another tab’s work. Export drafts before reloading after a conflict.</p><p><strong>Keyboard:</strong> Ctrl+Z (or Cmd+Z) undoes the last workspace action outside text inputs. Inside a text field, native text undo remains available. / focuses search. Escape closes a dialog. Tab reaches controls. Move cards with their “Column” menu when drag is impractical.</p><p><strong>Markdown:</strong> headings, emphasis, lists, quotes, code and HTTP(S) links. Raw HTML is escaped. Images are shown as text and never fetched.</p><p><strong>Effort &amp; planning:</strong> enable project planning from the board. On a card, choose “Start IED estimate” for baseline ranges, correction factors, sprint allocation and calibration. An IED is 6–7 uninterrupted engineering hours, separate from the legacy unitless estimate. Calendar output is a staffing scenario, not a delivery commitment.</p><p class="storage-caution">Tier 1 implementation under acceptance testing. Tier 2 and Tier 3 remain deferred except for the requested IED planning extension. There is no real-time collaboration or authenticated identity.</p>`);
}
function undo() { try { session.undo(); render(); if (modal.open && modal.dataset.planningProject) mountPlanning($("#project-planning", modal), modal.dataset.planningProject, planningHooks); if (openedCard && detail.open) { if (session.state.cards.some(c => c.id === openedCard)) openCard(openedCard); else detail.close(); } } catch (e) { message(e); } }
function bind() {
  if (bound) return; bound = true;
  for (const selector of ["#new-project", "#new-project-small", "#welcome-create"]) $(selector).onclick = projectDialog;
  $("#planning-button").onclick = planningDialog;
  $("#project-settings").onclick = projectSettings; $("#add-column").onclick = () => columnDialog(); $("#archive-button").onclick = archiveDialog;
  $("#members-button").onclick = membersDialog; $("#snapshots-button").onclick = () => void snapshotsDialog(); $("#backup-button").onclick = () => void backup(); $("#help-button").onclick = help;
  $("#undo-button").onclick = undo; $("#retry-button").onclick = () => session.retry();
  $("#draft-button").onclick = () => {
    let journal: unknown = null; try { journal = localStorage.getItem("fieldboard-draft"); } catch { /* still download in-memory text */ }
    const openFields = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type=file]),textarea")).map(el => ({ field: el.id || el.getAttribute("aria-label") || el.placeholder, value: el.value }));
    download("fieldboard-drafts.json", { note: "Recovery journal, not a workspace backup. Copy text or recover the validated state from journal.state.", journal, text: rawDrafts, openFields });
  };
  $<HTMLInputElement>("#restore-input").onchange = async e => {
    const input = e.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error("Backup exceeds the 50 MiB import limit");
      const restored = migrateWorkspace(JSON.parse(await file.text()));
      if (!confirm("Replace the entire workspace with this backup? This includes all projects and history. Download a backup first if needed.")) return;
      await session.flush(); session.replace(restored); await session.flush(); if (session.status !== "saved") return;
      filters = { ...emptyFilters }; setHash(); detail.close(); modal.close(); render();
    } catch (error) { message(error); } finally { input.value = ""; }
  };
  $<HTMLInputElement>("#search").oninput = e => { filters.q = (e.target as HTMLInputElement).value; setHash(); renderBoard(); };
  for (const [selector, key] of [["#filter-label", "label"], ["#filter-assignee", "assignee"], ["#filter-priority", "priority"], ["#filter-due", "due"]] as const) $<HTMLSelectElement>(selector).onchange = e => { filters[key] = (e.target as HTMLSelectElement).value; setHash(); renderBoard(); };
  $("#clear-filters").onclick = () => { filters = { ...emptyFilters, project: filters.project }; setHash(); render(); };
  window.onhashchange = () => { filters = decodeFilters(location.hash); render(); };
  document.addEventListener("keydown", e => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLElement && e.target.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); undo(); }
    if (e.key === "/" && !typing && !modal.open && !detail.open) { e.preventDefault(); $<HTMLInputElement>("#search").focus(); }
  });
  detail.onclose = () => { openedCard = null; render(); };
  window.addEventListener("beforeunload", e => { if (session.status !== "saved" || draftStorageError || fieldErrors.size) { e.preventDefault(); e.returnValue = ""; } });
}
async function init() {
  try {
    session = new Session(storage, new DraftJournal(localStorage)); session.onStatus = updateStatus;
    if (!navigator.locks) throw new Error("This browser cannot acquire the exclusive workspace lock. Persistent editing is unavailable.");
    await new Promise<void>((resolve, reject) => {
      void navigator.locks.request("fieldboard-editor", { ifAvailable: true }, async lock => {
        if (!lock) { reject(new Error("Workspace is open in another tab. Save there, close it, then reload this tab.")); return; }
        resolve(); await new Promise<void>(() => {}); // Released by the browser when this document closes or crashes.
      }).catch(reject);
    });
    await storage.open(); await session.load();
    const text = localStorage.getItem("fieldboard-text");
    if (text) { const parsed: unknown = JSON.parse(text); if (!parsed || typeof parsed !== "object" || Object.values(parsed).some(v => typeof v !== "string")) throw new Error("Invalid text draft journal. Download drafts before recovery."); rawDrafts = parsed as Record<string, string>; }
    ready = true; bind(); render(); updateStatus();
    setInterval(() => { void storage.snapshot().catch(message); }, 60_000);
    await storage.snapshot();
  } catch (e) { message(e); if (session) { bind(); render(); } }
}
void init();
