import { createProject, createCard, editCard, moveCard, moveCardInLane, archiveCard, deleteCard, addColumn, updateColumn, reorderColumn, deleteColumn, orderedCards, resolveLabels, priorities, swimlaneKinds, setBoardSwimlane, matches, dueState, emptyFilters, encodeFilters, decodeFilters, migrateWorkspace, id, setBlocked, children, epicProgress, waitingOn, blocks, createCardFromTemplate, saveCardTemplate, deleteCardTemplate, moveCardToBoard, type Card, type CardEdit, type Column, type Workspace, type Filters, type Theme, type Swimlane, type Activity } from "./model";
import { extendColumnEntryIndex, cardAgeDays, type ColumnEntry } from "./aging";
import { Storage, Session, DraftJournal } from "./storage";
import { escapeHTML as esc, markdown } from "./markdown";
import { mountEffort, mountPlanning, effortBadge, type PlanningHooks } from "./planning-ui";
import { sumEstimates, formatEstimateSum, unitLabel, unitName, estimateUnits, type EstimateUnit } from "./estimates";
import { mountTimeTracking, timeBadge, trackedTotalText } from "./time-tracking-ui";
import { mountRecurrence, recurrenceChip } from "./recurring-ui";
import { generateRecurrences, hasDueRecurrences } from "./recurring";
import { applyAutomation, runOverdueRule, runAutoArchive, hasDueAutomation } from "./automation";
import { mountAutomation } from "./automation-ui";
import { mountMilestones, milestoneChip } from "./milestones-ui";
import { mountSprints } from "./sprint-ui";
import { cardSprintNumber, setCardSprint } from "./planning";
import { mountCardStyle, cardCoverHTML, cardColorAttrs } from "./card-style-ui";
import { parseQuickAdd } from "./quickadd";
import { visualOrder, adjacentColumn, neighbor, shortcuts as shortcutList } from "./keyboard";
import { mountPalette, type PaletteItem } from "./palette";
import { mountBoards } from "./boards-ui";
import { mountMyWork } from "./my-work-ui";
import { lanesFor, laneCards, cardLaneIds } from "./swimlanes";
import { mountListView } from "./list-view";
import { mountCalendar, type CalendarDeps } from "./calendar-view";
import { mountTimeline, type TimelineDeps } from "./timeline-view";
import { mountInsights, type InsightsDeps } from "./insights-ui";
import { cardTimes } from "./cycletime";
import { mountAttachments } from "./attachments-ui";
import { mountLinks } from "./links-ui";
import { mountImportDialog } from "./import-ui";
import { downloadBoardCsv, downloadBoardMarkdown } from "./export-ui";
import { hasDueReminders, generateDueReminders } from "./notifications";
import { mountInbox, unreadCount, watchToggleHTML, watchersListHTML, bindWatchToggle } from "./notifications-ui";

const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T => {
  const result = root.querySelector<T>(selector); if (!result) throw new Error(`Missing UI element: ${selector}`); return result;
};
const modal = $<HTMLDialogElement>("#modal"); const detail = $<HTMLDialogElement>("#detail"); const palette = $<HTMLDialogElement>("#palette");
const storage = new Storage();
let session: Session;
let filters: Filters = decodeFilters(location.hash);
let openedCard: string | null = null;
let ready = false;
let bound = false;
let draftStorageError = "";
const fieldErrors = new Map<string, string>();
let dragging: { kind: "card" | "column"; id: string; lane?: string } | null = null;
let focusedCard: string | null = null;
let paletteApi: { open(): void };
let timeTrackingHandle: { stop(): void } | null = null;
let rawDrafts: Record<string, string> = {};
const selected = new Set<string>();
const columnMarkup = new WeakMap<HTMLElement, string>();
const cardMarkup = new WeakMap<HTMLElement, string>();
function syncChildren(parent: HTMLElement, nodes: HTMLElement[]) {
  // Stale children go first; otherwise one departed card shifts every later sibling into a DOM move.
  const keep = new Set(nodes); for (const child of Array.from(parent.children)) if (!keep.has(child as HTMLElement)) child.remove();
  nodes.forEach((node, index) => { if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] ?? null); });
}
const cardIndexes = new WeakMap<Card[], { byId: Map<string, Card>; children: Map<string, Card[]> }>();
function cardIndex(w: Workspace) {
  let index = cardIndexes.get(w.cards);
  if (!index) {
    const children = new Map<string, Card[]>();
    for (const c of w.cards) if (c.parentId) children.set(c.parentId, [...children.get(c.parentId) ?? [], c]);
    index = { byId: new Map(w.cards.map(c => [c.id, c])), children }; cardIndexes.set(w.cards, index);
  }
  return index;
}
const agingCaches = new WeakMap<Activity[], { length: number; index: Map<string, ColumnEntry> }>();
function agingIndex(w: Workspace) {
  let cache = agingCaches.get(w.activities);
  if (!cache) { cache = { length: 0, index: new Map() }; agingCaches.set(w.activities, cache); }
  if (cache.length < w.activities.length) { extendColumnEntryIndex(cache.index, w.activities, cache.length); cache.length = w.activities.length; }
  return cache.index;
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
// Every business mutation in this file funnels through here, so wrapping the callback with
// applyAutomation is the single choke point where "a card entered column X" is detected for every
// move path (drag, move menu, keyboard, bulk move, board move, column-delete relocation, quick-add) --
// no individual call site below has to remember to fire entry rules. session.undo() calls
// session.change() directly, bypassing stage(), so undo restores a rule's effect along with the
// change that triggered it without ever re-running automation on the way back.
function stage(fn: (w: Workspace) => unknown, rerender = true): boolean {
  if (!ready) { message(new Error("Persistent storage is not ready. No changes accepted.")); return false; }
  try { session.change(w => applyAutomation(w, fn)); if (rerender) render(); return true; } catch { return false; }
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
function milestonesDialog() {
  const p = activeProject(); if (!p) return;
  showModal("Milestones", '<div id="project-milestones"></div>');
  modal.classList.add("milestones-dialog"); modal.dataset.milestonesProject = p.id;
  mountMilestones($("#project-milestones", modal), p.id, planningHooks);
}
function sprintsDialog() {
  const p = activeProject(); if (!p) return;
  showModal("Sprints", '<div id="project-sprints"></div>');
  modal.classList.add("milestones-dialog"); modal.dataset.sprintsProject = p.id;
  mountSprints($("#project-sprints", modal), p.id, planningHooks);
}
function boardsDialog() {
  const p = activeProject(); if (!p) return;
  showModal("Boards", '<div id="project-boards"></div>');
  modal.classList.add("milestones-dialog"); modal.dataset.boardsProject = p.id;
  mountBoards($("#project-boards", modal), p.id, planningHooks, boardId => { filters.board = boardId; selected.clear(); setHash(); modal.close(); render(); });
}
function automationDialog() {
  const board = currentBoard(); if (!board) return;
  showModal("Automation", '<div id="board-automation"></div>');
  modal.classList.add("milestones-dialog"); modal.dataset.automationBoard = board.id;
  mountAutomation($("#board-automation", modal), board.id, planningHooks);
}
function importDialog() {
  showModal("Import a board", '<div id="import-root"></div>');
  mountImportDialog($("#import-root", modal), planningHooks, projectId => {
    modal.close(); filters = { ...emptyFilters, project: projectId }; selected.clear(); setHash(); render();
  });
}
function myWorkDialog() {
  showModal("My work", '<div id="my-work-list"></div>');
  modal.classList.add("milestones-dialog");
  mountMyWork($("#my-work-list", modal), planningHooks, cardId => { modal.close(); openCardInContext(cardId); });
}
function inboxDialog() {
  showModal("Notifications", '<div id="inbox-list"></div>');
  modal.classList.add("milestones-dialog");
  mountInbox($("#inbox-list", modal), planningHooks, cardId => { modal.close(); openCardInContext(cardId); });
}
function openCardInContext(cardId: string) {
  const w = session.state; const card = w.cards.find(c => c.id === cardId); if (!card) return;
  const column = w.columns.find(c => c.id === card.columnId); const board = column && w.boards.find(b => b.id === column.boardId);
  if (board && (filters.project !== board.projectId || filters.board !== board.id)) { filters = { ...emptyFilters, project: board.projectId, board: board.id }; selected.clear(); setHash(); render(); }
  openCard(cardId);
}
function cardTemplateDialog(columnId: string) {
  const templates = session.state.cardTemplates ?? [];
  showModal("Create from template", templates.length
    ? templates.map(t => `<div class="dialog-list"><span>${esc(t.name)}</span><button type="button" data-use-template="${esc(t.id)}">Use</button><button type="button" class="danger" data-delete-template="${esc(t.id)}" aria-label="Delete template ${esc(t.name)}">Delete</button></div>`).join("")
    : '<p class="muted">No card templates yet. Save one from a card’s detail view.</p>');
  modal.querySelectorAll<HTMLButtonElement>("[data-use-template]").forEach(b => b.onclick = () => { if (stage(w => createCardFromTemplate(w, columnId, b.dataset.useTemplate!))) modal.close(); });
  modal.querySelectorAll<HTMLButtonElement>("[data-delete-template]").forEach(b => b.onclick = () => { if (confirm("Delete this card template?") && stage(w => deleteCardTemplate(w, b.dataset.deleteTemplate!))) cardTemplateDialog(columnId); });
}
function activeProject() { return session.state.projects.find(p => p.id === filters.project) ?? session.state.projects.find(p => p.status === "active") ?? session.state.projects[0]; }
function projectBoards() { const project = activeProject(); return project ? session.state.boards.filter(b => b.projectId === project.id) : []; }
function currentBoard() { const boards = projectBoards(); return boards.find(b => b.id === filters.board) ?? boards[0]; }
function boardColumns(): Column[] { return session.state.columns.filter(c => c.boardId === currentBoard()?.id).sort((a, b) => a.position - b.position); }
// Every column across every board of the active project -- a recurrence's target column can be on a
// different board than the card it recurs from, the same project-wide scope "Epic / parent" and
// "Blocked by" already use (see DECISIONS "Recurring cards").
function projectColumns(): { id: string; label: string }[] {
  const project = activeProject(); if (!project) return [];
  const boards = session.state.boards.filter(b => b.projectId === project.id);
  const multiBoard = boards.length > 1;
  return session.state.columns.filter(c => boards.some(b => b.id === c.boardId))
    .map(c => ({ id: c.id, label: multiBoard ? `${boards.find(b => b.id === c.boardId)!.name} / ${c.name}` : c.name }));
}
function currentView(): string { return filters.view || "board"; }
function projectCardList(): Card[] { const colIds = boardColumns().map(c => c.id); return session.state.cards.filter(c => colIds.includes(c.columnId)); }
function visibleCards(): Card[] { const columns = boardColumns(); return session.state.cards.filter(c => columns.some(col => col.id === c.columnId) && !c.archived && matches(c, filters, new Date(), session.state.settings.actorId)); }
function setHash() { history.replaceState(null, "", encodeFilters(filters)); }
function estimateUnit(): EstimateUnit { return session.state.settings.estimateUnit ?? "points"; }
// Non-archived cards only, independent of the current search/filter -- the same scope the WIP badge
// already uses (see DECISIONS "Flow control"). Returns "" when nothing in the set carries an estimate,
// so a column or lane with no estimated cards shows no badge at all rather than a noisy "Σ 0".
function estimateSumBadge(cards: { estimate: number | null; archived: boolean }[]): string {
  const sum = sumEstimates(cards); return sum === null ? "" : esc(formatEstimateSum(sum, estimateUnit()));
}
function option(value: string, label: string, selected = false) { return `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`; }
function prettyDate(s: string) { return new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
function shortDue(s: string) { return new Date(`${s}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function initials(name: string) { return name.split(/\s+/).map(s => s[0]).join("").slice(0, 2).toUpperCase(); }
const calendarDeps: CalendarDeps = {
  cards: visibleCards, milestones: () => activeProject()?.milestones ?? [],
  stage: fn => stage(fn), openCard,
};
const timelineDeps: TimelineDeps = { cards: visibleCards, columns: boardColumns, openCard };
const insightsDeps: InsightsDeps = { workspace: () => session.state, board: currentBoard, columns: boardColumns, cards: projectCardList, openCard };

function applyTheme(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme === "system" ? "light dark" : theme);
}
function render() {
  const w = session.state; const project = activeProject();
  applyTheme(w.settings.theme ?? "system");
  $<HTMLSelectElement>("#theme-select").value = w.settings.theme ?? "system";
  if (project && filters.project !== project.id) { filters.project = project.id; setHash(); }
  const board = currentBoard(); if (board && filters.board !== board.id) { filters.board = board.id; setHash(); }
  $<HTMLSelectElement>("#board-select").innerHTML = projectBoards().map(b => option(b.id, b.name, b.id === board?.id)).join("");
  $("#workspace-name").textContent = w.name;
  const unread = unreadCount(w, w.settings.actorId);
  const inboxCount = $("#inbox-count"); inboxCount.hidden = !unread; inboxCount.textContent = String(unread);
  $("#inbox-button").setAttribute("aria-label", unread ? `Notifications, ${unread} unread` : "Notifications");
  $("#projects").innerHTML = w.projects.map(p => {
    const boardIds = w.boards.filter(b => b.projectId === p.id).map(b => b.id); const colIds = w.columns.filter(c => boardIds.includes(c.boardId)).map(c => c.id);
    const count = w.cards.filter(c => colIds.includes(c.columnId) && !c.archived).length;
    return `<button class="project-link ${p.id === project?.id ? "selected" : ""}" data-project="${esc(p.id)}"><span class="project-dot" style="background:${p.color}"></span><span class="project-name">${esc(p.name)}${p.status === "archived" ? " (archived)" : ""}</span><span class="count">${count}</span></button>`;
  }).join("");
  $("#projects").querySelectorAll<HTMLButtonElement>("[data-project]").forEach(b => b.onclick = () => { filters = { ...emptyFilters, project: b.dataset.project! }; selected.clear(); setHash(); render(); });
  $("#breadcrumb-project").textContent = project?.name ?? "Overview";
  $("#project-title").textContent = project?.name ?? "Your work, in view.";
  $("#project-description").textContent = project?.description || (project ? "Small steps. Meaningful progress." : "A quiet place to turn plans into progress.");
  $("#project-settings").hidden = !project; $("#board-tools").hidden = !project; $("#welcome").hidden = !!project;
  $<HTMLInputElement>("#search").value = filters.q;
  $<HTMLSelectElement>("#filter-label").innerHTML = option("", "All labels") + (project?.labels ?? []).map(l => option(l.id, l.name, filters.label === l.id)).join("");
  $<HTMLSelectElement>("#filter-assignee").innerHTML = option("", "All assignees") + w.members.map(m => option(m.id, m.name, filters.assignee === m.id)).join("");
  $<HTMLSelectElement>("#filter-priority").value = filters.priority; $<HTMLSelectElement>("#filter-due").value = filters.due;
  $<HTMLSelectElement>("#filter-milestone").innerHTML = option("", "All milestones") + (project?.milestones ?? []).slice().sort((a, b) => a.date.localeCompare(b.date)).map(m => option(m.id, m.name, filters.milestone === m.id)).join("");
  $<HTMLSelectElement>("#filter-blocked").value = filters.blocked;
  $<HTMLInputElement>("#filter-focus").checked = filters.focus === "mine";
  const epics = projectCardList().filter(c => children(w, c.id).length > 0);
  $<HTMLSelectElement>("#filter-epic").innerHTML = option("", "All epics") + epics.map(e => option(e.id, e.title, filters.epic === e.id)).join("");
  const view = currentView();
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(b => { const active = b.dataset.view === view; b.classList.toggle("active", active); b.setAttribute("aria-selected", String(active)); });
  $("#board").hidden = !project || view !== "board"; $("#list-view").hidden = !project || view !== "list"; $("#calendar-view").hidden = !project || view !== "calendar"; $("#timeline-view").hidden = !project || view !== "timeline"; $("#insights-view").hidden = !project || view !== "insights";
  $("#add-column").hidden = view !== "board"; $("#swimlane-select").hidden = view !== "board";
  if (board) $<HTMLSelectElement>("#swimlane-select").value = board.swimlane;
  if (view !== "board") $("#bulk-bar").hidden = true;
  renderActiveView();
}
// The view switcher and every filter control route redraws through here, so a filter typed while the
// list view is open updates the list instead of the (hidden) board underneath it.
function renderActiveView() {
  const project = activeProject(); if (!project) return;
  if (currentView() === "list") mountListView($("#list-view"), session.state, boardColumns(), project.labels, project.milestones ?? [], filters, { openCard: openCardInContext, onSort: next => { filters.sort = next; setHash(); renderActiveView(); }, onGroup: next => { filters.group = next; setHash(); renderActiveView(); } });
  else if (currentView() === "calendar") mountCalendar($("#calendar-view"), calendarDeps);
  else if (currentView() === "timeline") mountTimeline($("#timeline-view"), timelineDeps);
  else if (currentView() === "insights") mountInsights($("#insights-view"), insightsDeps);
  else renderBoard();
}
function blockedBadge(card: Card): string {
  return card.blocked ? `<span class="blocked-badge" aria-hidden="true" title="Blocked: ${esc(card.blocked.reason)}">⛔ Blocked</span>` : "";
}
function waitingBadge(card: Card): string {
  const byId = cardIndex(session.state).byId;
  const waiting = (card.blockedBy ?? []).map(id => byId.get(id)).filter((b): b is Card => !!b && !b.completedAt);
  return waiting.length ? `<span class="waiting-badge" aria-hidden="true" title="Waiting on: ${esc(waiting.map(c => c.title).join(", "))}">⧗ Waiting on: ${esc(waiting.map(c => c.title).join(", "))}</span>` : "";
}
function leadCycleHTML(card: Card): string {
  const activities = session.state.activities.filter(a => a.cardId === card.id);
  const t = cardTimes(card, activities, boardColumns(), new Date());
  const day = (n: number) => `${n.toFixed(1)} day${Math.abs(n - 1) < 0.05 ? "" : "s"}`;
  if (t.leadDays !== null && t.cycleDays !== null) return `<p class="empty-detail">Lead time: ${day(t.leadDays)} (created → done). Cycle time: ${day(t.cycleDays)} (left the first column → done).</p>`;
  return `<p class="empty-detail">In progress for ${day(t.inProgressDays ?? 0)}.</p>`;
}
function epicChip(card: Card): string {
  const parent = card.parentId ? cardIndex(session.state).byId.get(card.parentId) : undefined;
  return parent ? `<span class="epic-chip" aria-hidden="true" title="Part of ${esc(parent.title)}">⛩ ${esc(parent.title)}</span>` : "";
}
function epicProgressRow(card: Card): string {
  const kids = cardIndex(session.state).children.get(card.id) ?? []; const total = kids.length; if (!total) return "";
  const done = kids.filter(c => c.completedAt).length;
  const pct = Math.round(done / total * 100);
  return `<div class="epic-progress-row" aria-hidden="true" title="${done}/${total} child cards done"><span>⛩ ${done}/${total}</span><span class="mini-progress"><i style="width:${pct}%"></i></span></div>`;
}
function agingBadge(card: Card, column: Column): string {
  if (column.agingDays == null || column.done) return "";
  const age = cardAgeDays(card, agingIndex(session.state));
  if (age < column.agingDays) return "";
  const cls = age >= column.agingDays * 2 ? "overdue" : "soon";
  const title = esc(`${age} days in ${column.name}; flagged after ${column.agingDays}`);
  return `<span class="aging-badge ${cls}" aria-hidden="true" title="${title}">⏳ ${age} d in column</span>`;
}
function sprintChip(card: Card): string {
  if (card.effort) return ""; // effort cards already show their sprint inside the IED badge
  const n = cardSprintNumber(card);
  return n ? `<span class="sprint-chip" aria-hidden="true" title="Sprint ${n}">▤ Sprint ${n}</span>` : "";
}
function cardHTML(card: Card, column: Column): string {
  const project = activeProject();
  const labels = card.labels.map(id => project?.labels.find(l => l.id === id)).filter(l => !!l);
  const members = card.assignees.map(id => session.state.members.find(m => m.id === id)).filter(m => !!m);
  return `<button class="card${selected.has(card.id) ? " selected" : ""}" draggable="true" data-card="${esc(card.id)}" aria-label="Open card: ${esc(card.title)}" aria-pressed="${selected.has(card.id)}"${cardColorAttrs(card)}>
    ${cardCoverHTML(card)}
    <div class="card-labels" aria-hidden="true">${labels.map(l => `<span class="label-chip"><i style="background:${l.color}"></i>${esc(l.name)}</span>`).join("")}</div>
    <div class="card-title" aria-hidden="true">${esc(card.title)}</div>${effortBadge(card)}${milestoneChip(card, project?.milestones)}${epicChip(card)}${sprintChip(card)}
    ${blockedBadge(card)}${waitingBadge(card)}${agingBadge(card, column)}${timeBadge(card)}${recurrenceChip(card)}${epicProgressRow(card)}
    <div class="card-meta" aria-hidden="true">${card.priority !== "none" ? `<span class="priority ${card.priority}" title="${card.priority} priority">${card.priority === "urgent" ? "!!" : "↑"} ${card.priority}</span>` : ""}
    ${card.dueDate ? `<span class="due ${dueState(card)}" title="Due ${esc(card.dueDate)}">◷ ${shortDue(card.dueDate)}</span>` : ""}
    ${card.subtasks.length ? `<span title="Subtasks completed">☑ ${card.subtasks.filter(s => s.done).length}/${card.subtasks.length}</span>` : ""}
    ${card.comments.length ? `<span title="Comments">▤ ${card.comments.length}</span>` : ""}
    ${card.attachments.length ? `<span title="Attachments">📎 ${card.attachments.length}</span>` : ""}
    ${card.links.length ? `<span title="Links">🔗 ${card.links.length}</span>` : ""}
    <span class="avatars">${members.map(m => `<span class="avatar" title="${esc(m.name)}" aria-label="Assigned to ${esc(m.name)}">${esc(initials(m.name))}</span>`).join("")}</span></div></button>`;
}
function renderBoard() {
  const columns = boardColumns(); const w = session.state;
  const cards = w.cards.filter(c => columns.some(col => col.id === c.columnId) && !c.archived);
  const visible = cards.filter(c => matches(c, filters, new Date(), session.state.settings.actorId));
  $("#total-count").textContent = String(cards.length);
  $("#board-summary").textContent = columns.length ? `${visible.length} of ${cards.length} cards · ${cards.filter(c => c.completedAt).length} completed · Drag to make your next move` : "Ready when you are.";
  const board = currentBoard();
  $("#board").classList.toggle("swimlanes", !!board && board.swimlane !== "none");
  if (board && board.swimlane !== "none") renderSwimlaneBoard(columns, w, visible, board.swimlane);
  else renderPlainBoard(columns, w, visible);
  $("#board").querySelectorAll<HTMLButtonElement>(".card").forEach(card => {
    card.onclick = e => {
      const cardId = card.dataset.card!;
      if (e.shiftKey || e.ctrlKey || e.metaKey) { if (selected.has(cardId)) selected.delete(cardId); else selected.add(cardId); renderBoard(); }
      else { focusedCard = cardId; openCard(cardId); }
    };
    card.ondragstart = e => {
      if (!e.dataTransfer) return; e.stopPropagation();
      const lane = card.closest<HTMLElement>("[data-lane]")?.dataset.lane;
      dragging = { kind: "card", id: card.dataset.card!, lane }; e.dataTransfer.setData("text/plain", card.dataset.card!); e.dataTransfer.effectAllowed = "move"; card.classList.add("dragging");
    };
    card.ondragend = () => { dragging = null; card.classList.remove("dragging"); document.querySelectorAll(".drag-over").forEach(e => e.classList.remove("drag-over")); };
  });
  renderBulkBar();
}
function renderPlainBoard(columns: Column[], w: Workspace, visible: Card[]) {
  const boardElement = $("#board");
  const previousColumns = new Map(Array.from(boardElement.querySelectorAll<HTMLElement>(".column")).map(el => [el.dataset.column!, el]));
  const previousCards = new Map(Array.from(boardElement.querySelectorAll<HTMLElement>(".card")).map(el => [el.dataset.card!, el]));
  const columnNodes = columns.map(col => {
    const items = visible.filter(c => c.columnId === col.id).sort((a, b) => a.position - b.position);
    const html = `<section class="column" data-column="${esc(col.id)}" aria-label="${esc(col.name)} column"><header class="column-heading" draggable="true" data-column-drag="${esc(col.id)}"><span class="stage-dot ${col.done ? "done-dot" : ""}"></span><h2>${esc(col.name)}</h2><span class="count">0</span><span class="estimate-sum" hidden></span><button data-settings="${esc(col.id)}" aria-label="Edit column ${esc(col.name)}">⋯</button></header><button class="add-card top" data-add="top" aria-label="Add card at top">+ Add card at top</button><div class="cards"></div><button class="add-card" data-add="bottom" aria-label="Add card at bottom">+ Add card</button><button class="add-card template" data-template="${esc(col.id)}" aria-label="Create card from template">+ From template</button></section>`;
    let element = previousColumns.get(col.id);
    if (!element || columnMarkup.get(element) !== html) {
      const template = document.createElement("template"); template.innerHTML = html;
      element = template.content.firstElementChild as HTMLElement; columnMarkup.set(element, html);
    }
    const columnCards = w.cards.filter(c => c.columnId === col.id && !c.archived);
    const wipText = col.wipLimit != null ? `${columnCards.length} / ${col.wipLimit}` : String(items.length);
    const wipClass = col.wipLimit == null ? "" : columnCards.length > col.wipLimit ? "wip-over" : columnCards.length === col.wipLimit ? "wip-at" : "";
    const count = $(".count", element); if (count.textContent !== wipText) count.textContent = wipText;
    if (count.className !== `count ${wipClass}`.trim()) count.className = `count ${wipClass}`.trim();
    const sum = sumEstimates(columnCards);
    const sumBadge = $(".estimate-sum", element); const sumText = sum === null ? "" : formatEstimateSum(sum, estimateUnit());
    if (sumBadge.textContent !== sumText) sumBadge.textContent = sumText;
    sumBadge.hidden = sum === null;
    const cardNodes = items.map(card => {
      const markup = cardHTML(card, col); const old = previousCards.get(card.id);
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
    $<HTMLButtonElement>("[data-template]", col).onclick = () => cardTemplateDialog(columnId);
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
}
function renderSwimlaneBoard(columns: Column[], w: Workspace, visible: Card[], swimlane: Swimlane) {
  const boardElement = $("#board");
  const lanes = lanesFor(swimlane, visible, { members: w.members, labels: activeProject()?.labels ?? [] });
  const columnCardCount = (columnId: string) => w.cards.filter(c => c.columnId === columnId && !c.archived).length;
  // Lane membership (not column) decides this sum, so it spans every column on the board, and it uses
  // the full non-archived set rather than `visible` -- same "ignore the current filter" rule as the
  // column header and the WIP count.
  const boardCards = w.cards.filter(c => columns.some(col => col.id === c.columnId) && !c.archived);
  const laneSumBadge = (laneId: string): string => {
    const sum = sumEstimates(boardCards.filter(c => cardLaneIds(c, swimlane).includes(laneId)));
    return sum === null ? "" : `<span class="estimate-sum" data-lane-sum="${esc(laneId)}">${esc(formatEstimateSum(sum, estimateUnit()))}</span>`;
  };
  // One flat grid (header cells + every lane's label and cells as direct children) rather than a nested
  // grid per row: each row has exactly 1 + columns.length items, so the fixed column count alone keeps
  // every lane's cells vertically aligned with the header -- independent per-row auto-fit grids used to
  // wrap at different points once the board got too wide for one line, breaking that alignment.
  const head = `<div class="lane-label-cell"></div>${columns.map(col => {
    const count = columnCardCount(col.id); const wipText = col.wipLimit != null ? `${count} / ${col.wipLimit}` : String(count);
    const wipClass = col.wipLimit == null ? "" : count > col.wipLimit ? "wip-over" : count === col.wipLimit ? "wip-at" : "";
    return `<div class="swimlane-col-head"><h2>${esc(col.name)}</h2><span class="count ${wipClass}">${wipText}</span></div>`;
  }).join("")}`;
  const body = lanes.map(lane => `<div class="lane-label" data-lane="${esc(lane.id)}">${esc(lane.label)}${laneSumBadge(lane.id)}</div>${columns.map(col => {
    const items = laneCards(visible, col.id, lane.id, swimlane);
    return `<div class="swimlane-cell" data-lane="${esc(lane.id)}" data-column="${esc(col.id)}">${items.map(c => cardHTML(c, col)).join("") || '<div class="empty-column">—</div>'}</div>`;
  }).join("")}`).join("");
  boardElement.innerHTML = `<div class="swimlane-grid" style="grid-template-columns:140px repeat(${columns.length},minmax(220px,1fr))">${head}${body}</div>`;
  boardElement.querySelectorAll<HTMLElement>(".swimlane-cell").forEach(cell => {
    cell.ondragover = e => { if (dragging?.kind === "card") { e.preventDefault(); cell.classList.add("drag-over"); if (e.dataTransfer) e.dataTransfer.dropEffect = "move"; } };
    cell.ondragleave = () => cell.classList.remove("drag-over");
    cell.ondrop = e => {
      e.preventDefault(); cell.classList.remove("drag-over"); const drag = dragging; dragging = null; if (!drag || drag.kind !== "card") return;
      const columnId = cell.dataset.column!; const toLane = cell.dataset.lane!;
      const target = (e.target as Element).closest<HTMLElement>("[data-card]");
      if (target?.dataset.card === drag.id) return;
      const others = orderedCards(session.state, columnId).filter(c => c.id !== drag.id);
      const index = target ? others.findIndex(c => c.id === target.dataset.card) : others.length;
      stage(w => moveCardInLane(w, drag.id, columnId, index < 0 ? others.length : index, swimlane, drag.lane ?? "none", toLane));
    };
  });
}
function renderBulkBar() {
  const bar = $("#bulk-bar"); const w = session.state; const cols = boardColumns(); const colIds = new Set(cols.map(c => c.id));
  for (const cardId of [...selected]) { const card = w.cards.find(c => c.id === cardId); if (!card || card.archived || !colIds.has(card.columnId)) selected.delete(cardId); }
  bar.hidden = selected.size === 0; if (!selected.size) return;
  $("#bulk-count").textContent = `${selected.size} card${selected.size === 1 ? "" : "s"} selected`;
  const project = activeProject();
  $<HTMLSelectElement>("#bulk-move").innerHTML = option("", "Move to…") + cols.map(c => option(c.id, c.name)).join("");
  $<HTMLSelectElement>("#bulk-label").innerHTML = option("", "Add label…") + (project?.labels ?? []).map(l => option(l.id, l.name)).join("");
  $<HTMLSelectElement>("#bulk-remove-label").innerHTML = option("", "Remove label…") + (project?.labels ?? []).map(l => option(l.id, l.name)).join("");
  $<HTMLSelectElement>("#bulk-assign").innerHTML = option("", "Assign…") + w.members.map(m => option(m.id, m.name)).join("");
  $<HTMLSelectElement>("#bulk-unassign").innerHTML = option("", "Unassign…") + w.members.map(m => option(m.id, m.name)).join("");
}
function runBulk(fn: (w: Workspace, cardId: string) => void) {
  const ids = [...selected];
  if (stage(w => { for (const cardId of ids) fn(w, cardId); })) selected.clear();
  renderActiveView();
}
function inlineAdd(col: HTMLElement, columnId: string, at: "top" | "bottom") {
  if (col.querySelector(".inline-add")) { $<HTMLInputElement>(".inline-add input", col).focus(); return; }
  const form = document.createElement("form"); form.className = "inline-add";
  form.innerHTML = '<input placeholder="Card title" aria-label="New card title" autocomplete="off" required><small>Enter to add · Escape to close (draft retained) · #label @assignee !priority ^due ~milestone</small>';
  const cards = $(".cards", col); if (at === "top") cards.before(form); else cards.after(form);
  const input = $<HTMLInputElement>("input", form); const key = `add:${columnId}:${at}`; fieldDraft(input, key); input.focus();
  form.onsubmit = e => { e.preventDefault(); const value = input.value; if (!value.trim()) return;
    if (!retain(key, value)) return;
    const project = activeProject();
    const parsed = parseQuickAdd(value, { members: session.state.members, milestones: project?.milestones ?? [] });
    if (!parsed.title.trim()) return;
    if (stage(w => {
      const patch: CardEdit = {};
      if (parsed.priority) patch.priority = parsed.priority;
      if (parsed.dueDate) patch.dueDate = parsed.dueDate;
      if (parsed.assigneeIds.length) patch.assignees = parsed.assigneeIds;
      if (parsed.milestoneId) patch.milestoneId = parsed.milestoneId;
      if (parsed.labelNames.length) { const p = w.projects.find(x => x.id === project?.id); if (p) patch.labels = resolveLabels(p, parsed.labelNames); }
      createCard(w, columnId, parsed.title, at, patch);
    })) { form.remove(); void clearDraft(key, value); }
  };
  input.onkeydown = e => { if (e.key === "Escape") form.remove(); };
}
function visibleCardOrder(): string[] {
  const columns = boardColumns();
  const cards = session.state.cards.filter(c => !c.archived && columns.some(col => col.id === c.columnId) && matches(c, filters, new Date(), session.state.settings.actorId));
  return visualOrder(columns, cards);
}
function focusCardElement(cardId: string) {
  const el = document.querySelector<HTMLElement>(`[data-card="${cardId}"]`); el?.focus(); el?.scrollIntoView({ block: "nearest" });
}
function newCardShortcut() {
  const columns = boardColumns(); if (!columns.length) return;
  const columnId = (focusedCard && session.state.cards.find(c => c.id === focusedCard)?.columnId) ?? columns[0]!.id;
  const col = document.querySelector<HTMLElement>(`[data-column="${columnId}"]`); if (col) inlineAdd(col, columnId, "top");
}
function moveFocusedCardColumn(direction: 1 | -1) {
  if (!focusedCard) return;
  const card = session.state.cards.find(c => c.id === focusedCard); if (!card) return;
  const target = adjacentColumn(boardColumns(), card.columnId, direction); if (!target) return;
  const cardId = focusedCard;
  if (stage(w => moveCard(w, cardId, target, orderedCards(w, target).length))) focusCardElement(cardId);
}
// Reorders the focused card within its own column by one position; a no-op at either end.
function moveFocusedCardWithinColumn(direction: 1 | -1) {
  if (!focusedCard) return;
  const card = session.state.cards.find(c => c.id === focusedCard); if (!card) return;
  const ordered = orderedCards(session.state, card.columnId);
  const index = ordered.findIndex(c => c.id === card.id); const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length) return;
  const cardId = focusedCard;
  if (stage(w => moveCard(w, cardId, card.columnId, target))) focusCardElement(cardId);
}
function moveCardFocus(direction: 1 | -1) {
  const next = neighbor(visibleCardOrder(), focusedCard, direction); if (!next) return;
  focusedCard = next; focusCardElement(next);
}
function shortcutsDialog() {
  showModal("Keyboard shortcuts", `<ul class="shortcut-list">${shortcutList.map(s => `<li><kbd>${esc(s.keys)}</kbd><span>${esc(s.description)}</span></li>`).join("")}</ul>`, "Close shortcuts");
}
function showModal(title: string, body: string, closeLabel = "Close dialog") {
  modal.classList.remove("planning-dialog", "milestones-dialog"); delete modal.dataset.planningProject; delete modal.dataset.milestonesProject; delete modal.dataset.sprintsProject; delete modal.dataset.boardsProject; delete modal.dataset.automationBoard;
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
  showModal(col ? "Column settings" : "Add a column", `<form id="column-form"><label class="form-field"><span>Column name</span><input id="column-name-input" aria-label="Column name" value="${esc(col?.name ?? "")}" required autofocus></label><label class="checkbox-label"><input id="column-done-input" type="checkbox" ${col?.done ? "checked" : ""}>Cards here are done</label><label class="form-field"><span>WIP limit</span><input id="column-wip-input" aria-label="WIP limit" type="number" min="1" step="1" placeholder="No limit" value="${col?.wipLimit ?? ""}"></label><small>Counts non-archived cards. Exceeding the limit is allowed; the header turns amber at the limit and red above it.</small><label class="form-field"><span>Aging threshold · days</span><input id="column-aging-input" aria-label="Aging threshold" type="number" min="1" step="1" placeholder="Off" value="${col?.agingDays ?? ""}"></label><small>Shows how long a card has sat here once it clears this many days; never shown in a done column.</small>${col ? '<small>Changes save automatically.</small>' : '<div class="dialog-actions"><button type="submit" class="primary">Create column</button></div>'}</form>${col ? `<hr><div class="form-row"><button id="column-left" aria-label="Move column left">← Move left</button><button id="column-right" aria-label="Move column right">Move right →</button></div><p>Deleting this column also moves its archived cards. Choose a destination first.</p><label class="form-field"><span>Move cards to</span><select id="column-destination" aria-label="Column deletion destination">${option("", "Choose a destination")}${columns.filter(c => c.id !== col.id).map(c => option(c.id, c.name)).join("")}</select></label><button id="delete-column" class="danger">Delete column</button>` : ""}`);
  const input = $<HTMLInputElement>("#column-name-input"); const key = `column:${columnId ?? "new"}`; fieldDraft(input, key);
  const wipValue = () => { const raw = $<HTMLInputElement>("#column-wip-input").value; return raw === "" ? null : Number(raw); };
  const agingValue = () => { const raw = $<HTMLInputElement>("#column-aging-input").value; return raw === "" ? null : Number(raw); };
  $<HTMLFormElement>("#column-form").onsubmit = e => {
    e.preventDefault(); const value = input.value; if (!retain(key, value)) return;
    const done = $<HTMLInputElement>("#column-done-input").checked; const wipLimit = wipValue(); const agingDays = agingValue();
    if (stage(w => { if (col) updateColumn(w, col.id, { name: value, done, wipLimit, agingDays }); else { const created = addColumn(w, currentBoard()!.id, value); updateColumn(w, created.id, { done, wipLimit, agingDays }); } })) { modal.close(); void clearDraft(key, value); }
  };
  if (col) {
    const autosave = () => {
      const value = input.value; if (!retain(key, value)) return;
      if (stage(w => updateColumn(w, col.id, { name: value, done: $<HTMLInputElement>("#column-done-input").checked, wipLimit: wipValue(), agingDays: agingValue() }))) { fieldErrors.delete(key); updateStatus(); void clearDraft(key, value); }
      else { fieldErrors.set(key, session.error); updateStatus(); }
    };
    input.addEventListener("input", autosave);
    $<HTMLInputElement>("#column-done-input").onchange = autosave;
    $<HTMLInputElement>("#column-wip-input").onchange = autosave;
    $<HTMLInputElement>("#column-aging-input").onchange = autosave;
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
    if (stage(w => editCard(w, card.id, { [field]: read(input) }), false)) { fieldErrors.delete(key); updateStatus(); renderActiveView(); void clearDraft(key, raw); }
    else { fieldErrors.set(key, session.error); updateStatus(); }
    if (field === "description") $("#description-preview", detail).innerHTML = markdown(raw, session.state.members);
  });
}
function openCard(cardId: string) {
  const c = session.state.cards.find(c => c.id === cardId); if (!c) return;
  openedCard = cardId; const w = session.state; const project = activeProject(); const col = w.columns.find(x => x.id === c.columnId)!;
  const complete = c.subtasks.filter(s => s.done).length;
  detail.innerHTML = `<header class="dialog-head"><div class="breadcrumb">${esc(project?.name ?? "")} <span aria-hidden="true">/</span> ${esc(col.name)}</div><button aria-label="Close card">×</button></header><div class="detail-layout"><div class="detail-main">
    <label class="form-field"><span>Title</span><input class="title-input" id="card-title" aria-label="Title" value="${esc(c.title)}" required></label>
    <label class="form-field"><span>Description</span><textarea id="card-description" aria-label="Description" placeholder="Give this work a little context. Markdown is welcome.">${esc(c.description)}</textarea></label>
    <div class="preview-label">RENDERED PREVIEW · REMOTE IMAGES DISABLED</div><div id="description-preview" class="markdown">${markdown(rawDrafts[`${c.id}:description`] ?? c.description, w.members)}</div>
    <section id="card-effort" class="detail-section"></section>
    <section id="card-time" class="detail-section"></section>
    <section id="card-recurrence" class="detail-section"></section>
    <section class="detail-section"><h3>Subtasks <span class="count">${complete}/${c.subtasks.length}</span></h3><div class="progress"><i style="width:${c.subtasks.length ? complete / c.subtasks.length * 100 : 0}%"></i></div>
    ${c.subtasks.slice().sort((a, b) => a.position - b.position).map(s => `<div class="subtask ${s.done ? "completed" : ""}"><input type="checkbox" data-subtask="${esc(s.id)}" ${s.done ? "checked" : ""} aria-label="Complete subtask: ${esc(s.title)}"><span>${esc(s.title)}</span><button data-remove-subtask="${esc(s.id)}" aria-label="Remove subtask: ${esc(s.title)}">×</button></div>`).join("")}<form id="subtask-form" class="subtask-add"><input placeholder="Add subtask" aria-label="Add subtask" required></form></section>
    <section class="detail-section" id="card-attachments"></section>
    <section class="detail-section" id="card-style"></section>
    <section class="detail-section" id="card-links"></section>
    <section class="detail-section"><h3>Template</h3><form id="card-template-form" class="form-row"><input id="card-template-name" aria-label="Template name" placeholder="Template name" required><button type="submit">Save as template</button></form><small>Saves this card's description and subtasks (with labels and priority) for reuse from any column's “+ From template” control.</small></section>
    <section class="detail-section"><h3>Dependencies</h3><div class="section-label">BLOCKED BY</div>${projectCardList().filter(x => x.id !== c.id).map(x => `<label class="checkbox-label"><input type="checkbox" data-blocker="${esc(x.id)}" aria-label="Blocked by ${esc(x.title)}" ${c.blockedBy?.includes(x.id) ? "checked" : ""}>${esc(x.title)}</label>`).join("") || '<p class="empty-detail">No other cards in this project yet.</p>'}${blocks(w, c.id).length ? `<div class="section-label">BLOCKS</div>${blocks(w, c.id).map(x => `<div class="dialog-list"><span>${esc(x.title)}</span></div>`).join("")}` : ""}</section>
    <section class="detail-section"><h3>Epic children <span class="count">${epicProgress(w, c.id).done}/${epicProgress(w, c.id).total}</span></h3>${children(w, c.id).length ? `<div class="progress"><i style="width:${Math.round(epicProgress(w, c.id).done / epicProgress(w, c.id).total * 100)}%"></i></div>${children(w, c.id).map(x => `<div class="dialog-list"><span>${esc(x.title)}</span></div>`).join("")}` : '<p class="empty-detail">No child cards yet.</p>'}</section>
    <section class="detail-section"><h3>Lead &amp; cycle time</h3>${leadCycleHTML(c)}</section>
    <section class="detail-section"><h3>Comments <span class="count">${c.comments.length}</span></h3>${c.comments.map(comment => `<div class="comment"><div class="comment-head"><strong>${esc(w.members.find(m => m.id === comment.author)?.name ?? "Member")}</strong><time>${prettyDate(comment.timestamp)}</time></div><div class="markdown">${markdown(comment.body, w.members)}</div></div>`).join("") || '<p class="empty-detail">Leave a note for the next person. Identities are local, not accounts.</p>'}<form id="comment-form" class="comment-form"><textarea placeholder="Write a comment" aria-label="Comment body" required></textarea><button type="submit">Add comment</button></form></section>
    <section class="detail-section"><h3>Activity</h3><ul class="history">${w.activities.filter(a => a.cardId === c.id).slice().reverse().map(a => `<li><strong>${esc(w.members.find(m => m.id === a.actor)?.name ?? a.actor)}</strong> · ${esc(a.action)}<time>${prettyDate(a.timestamp)}</time><details><summary>Before / after</summary><pre>${esc(JSON.stringify({ before: a.before, after: a.after }, null, 2))}</pre></details></li>`).join("")}</ul><small>Recent edits appear here when you reopen the card.</small></section>
    </div><aside class="detail-sidebar"><label class="form-field"><span>Move to…</span><select id="card-column" aria-label="Move to column">${boardColumns().map(col => option(col.id, col.name, c.columnId === col.id)).join("")}</select></label>
    <label class="form-field"><span>Move to board…</span><select id="card-board" aria-label="Move to board">${option("", "Stay on this board")}${w.boards.filter(b => b.projectId === project?.id && b.id !== col.boardId).map(b => option(b.id, b.name)).join("")}</select></label>
    <label class="form-field"><span>Priority</span><select id="card-priority" aria-label="Priority">${priorities.map(p => option(p, p[0]!.toUpperCase() + p.slice(1), c.priority === p)).join("")}</select></label>
    <label class="checkbox-label"><input type="checkbox" id="card-blocked" aria-label="Mark card as blocked" ${c.blocked ? "checked" : ""}>Blocked</label>
    <label class="form-field" id="blocked-reason-field"${c.blocked ? "" : " hidden"}><span>Blocked reason</span><input id="card-blocked-reason" aria-label="Blocked reason" placeholder="Why is this blocked?" value="${esc(c.blocked?.reason ?? "")}"></label>
    <label class="form-field"><span>Milestone</span><select id="card-milestone" aria-label="Milestone">${option("", "No milestone")}${(project?.milestones ?? []).slice().sort((a, b) => a.date.localeCompare(b.date)).map(m => option(m.id, m.name, c.milestoneId === m.id)).join("")}</select></label>
    <label class="form-field"><span>Sprint</span><input id="card-sprint" aria-label="Sprint" type="number" min="1" step="1" placeholder="No sprint" value="${cardSprintNumber(c) ?? ""}"${c.effort ? " disabled" : ""}></label>
    ${c.effort ? '<small>This card has an IED estimate; set its sprint from Effort estimation above or from the Sprints view.</small>' : ""}
    <label class="form-field"><span>Epic / parent</span><select id="card-parent" aria-label="Parent epic">${option("", "No parent")}${projectCardList().filter(x => x.id !== c.id).map(x => option(x.id, x.title, c.parentId === x.id)).join("")}</select></label>
    <label class="form-field"><span>Start date</span><input id="card-start" aria-label="Start date" type="date" value="${c.startDate ?? ""}"></label>
    <label class="form-field"><span>Due date</span><input id="card-due" aria-label="Due date" type="date" value="${c.dueDate ?? ""}"></label>
    <label class="form-field"><span>Estimate · ${esc(unitLabel(estimateUnit()))}</span><input id="card-estimate" aria-label="Estimate" type="number" min="0" step="any" value="${c.estimate ?? ""}" placeholder="Optional"><small class="tracked-total">${esc(trackedTotalText(c))}</small></label>
    <label class="form-field"><span>Labels · comma separated</span><input id="card-labels" aria-label="Label names" placeholder="Release, Bug" value="${esc(c.labels.map(l => project?.labels.find(x => x.id === l)?.name ?? "").join(", "))}"></label>
    <div class="section-label">ASSIGNEES</div>${w.members.map(m => `<label class="checkbox-label"><input type="checkbox" data-assignee="${esc(m.id)}" aria-label="Assign to ${esc(m.name)}" ${c.assignees.includes(m.id) ? "checked" : ""}>${esc(m.name)}</label>`).join("")}
    <div class="section-label">WATCHING</div>${watchToggleHTML((c.watchers ?? []).includes(w.settings.actorId))}${watchersListHTML(w, c.watchers ?? [])}
    <div class="side-actions"><button id="archive-card">Archive card</button><button id="delete-card" class="danger" aria-label="Delete card permanently">Delete permanently…</button></div><div class="timestamps">Created ${prettyDate(c.createdAt)}<br>Updated ${prettyDate(c.updatedAt)}${c.completedAt ? `<br>Completed ${prettyDate(c.completedAt)}` : ""}</div></aside></div>`;
  $<HTMLButtonElement>(".dialog-head button", detail).onclick = () => detail.close();
  bindEdit("#card-title", "title", c); bindEdit("#card-description", "description", c); bindEdit("#card-priority", "priority", c, el => el.value, "change");
  bindEdit("#card-start", "startDate", c, el => el.value || undefined, "change");
  bindEdit("#card-due", "dueDate", c, el => el.value || null, "change"); bindEdit("#card-estimate", "estimate", c, el => el.value === "" ? null : Number(el.value), "change");
  bindEdit("#card-milestone", "milestoneId", c, el => el.value || undefined, "change");
  bindEdit("#card-parent", "parentId", c, el => el.value || undefined, "change");
  $<HTMLInputElement>("#card-sprint", detail).onchange = e => {
    const value = (e.target as HTMLInputElement).value;
    if (stage(w => setCardSprint(w, c.id, value === "" ? null : Number(value)))) renderActiveView();
    else openCard(c.id);
  };
  const blockedCheckbox = $<HTMLInputElement>("#card-blocked", detail); const reasonField = $("#blocked-reason-field", detail); const reasonInput = $<HTMLInputElement>("#card-blocked-reason", detail);
  const reasonKey = `${c.id}:blockedReason`; fieldDraft(reasonInput, reasonKey);
  blockedCheckbox.onchange = () => {
    if (blockedCheckbox.checked) { reasonField.hidden = false; reasonInput.focus(); }
    else if (stage(w => setBlocked(w, c.id, null))) openCard(c.id);
  };
  const commitReason = () => {
    const value = reasonInput.value; if (!retain(reasonKey, value)) return;
    if (!value.trim()) { fieldErrors.set(reasonKey, "A reason is required to mark a card blocked."); updateStatus(); return; }
    if (stage(w => setBlocked(w, c.id, value))) { fieldErrors.delete(reasonKey); updateStatus(); void clearDraft(reasonKey, value); openCard(c.id); }
    else { fieldErrors.set(reasonKey, session.error); updateStatus(); }
  };
  reasonInput.addEventListener("change", commitReason);
  detail.querySelectorAll<HTMLInputElement>("[data-blocker]").forEach(box => box.onchange = () => {
    if (stage(w => { const card = w.cards.find(x => x.id === c.id)!; const current = card.blockedBy ?? []; const next = box.checked ? [...current, box.dataset.blocker!] : current.filter(id => id !== box.dataset.blocker); editCard(w, c.id, { blockedBy: next.length ? next : undefined }); })) openCard(c.id);
  });
  $<HTMLSelectElement>("#card-column", detail).onchange = e => {
    const destination = (e.target as HTMLSelectElement).value; if (stage(w => moveCard(w, c.id, destination, orderedCards(w, destination).length))) openCard(c.id);
  };
  $<HTMLSelectElement>("#card-board", detail).onchange = e => {
    const boardId = (e.target as HTMLSelectElement).value; if (!boardId) return;
    if (stage(w => moveCardToBoard(w, c.id, boardId))) { filters.board = boardId; selected.clear(); setHash(); render(); openCard(c.id); }
  };
  const labels = $<HTMLInputElement>("#card-labels", detail); const labelsKey = `${c.id}:labelNames`; fieldDraft(labels, labelsKey);
  labels.onchange = () => {
    const value = labels.value; if (!retain(labelsKey, value)) return;
    if (stage(w => {
      const p = w.projects.find(x => x.id === project!.id)!;
      editCard(w, c.id, { labels: resolveLabels(p, value.split(",")) });
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
  const templateName = $<HTMLInputElement>("#card-template-name", detail); const templateKey = `${c.id}:new-template`; fieldDraft(templateName, templateKey);
  $<HTMLFormElement>("#card-template-form", detail).onsubmit = e => {
    e.preventDefault(); const value = templateName.value; if (!value.trim() || !retain(templateKey, value)) return;
    if (stage(w => saveCardTemplate(w, c.id, value), false)) void clearDraft(templateKey, value);
  };
  const comment = $<HTMLTextAreaElement>("#comment-form textarea", detail); const commentKey = `${c.id}:new-comment`; fieldDraft(comment, commentKey);
  $<HTMLFormElement>("#comment-form", detail).onsubmit = async e => {
    e.preventDefault(); const value = comment.value.trim(); if (!value || !retain(commentKey, value)) return;
    if (stage(w => { const card = w.cards.find(x => x.id === c.id)!; editCard(w, c.id, { comments: [...card.comments, { id: id(), author: w.settings.actorId, body: value, timestamp: new Date().toISOString() }] }); })) { await clearDraft(commentKey, value); openCard(c.id); }
  };
  $("#archive-card", detail).onclick = () => { if (stage(w => archiveCard(w, c.id, true))) detail.close(); };
  $("#delete-card", detail).onclick = () => { if (confirm(`Permanently delete “${c.title}”? Archive keeps cards restorable. Undo is available only in this session.`) && stage(w => deleteCard(w, c.id))) detail.close(); };
  mountEffort($("#card-effort", detail), c.id, planningHooks);
  timeTrackingHandle?.stop(); timeTrackingHandle = mountTimeTracking($("#card-time", detail), c.id, planningHooks);
  mountRecurrence($("#card-recurrence", detail), c.id, planningHooks, projectColumns());
  mountAttachments($("#card-attachments", detail), c.id, planningHooks, () => mountCardStyle($("#card-style", detail), c.id, planningHooks));
  mountCardStyle($("#card-style", detail), c.id, planningHooks);
  mountLinks($("#card-links", detail), c.id, planningHooks);
  bindWatchToggle(detail, planningHooks, c.id, () => openCard(c.id));
  if (!detail.open) detail.showModal();
}
function archiveDialog() {
  const columns = boardColumns().map(c => c.id); const archived = session.state.cards.filter(c => c.archived && columns.includes(c.columnId));
  showModal("Archived cards", archived.length ? archived.map(c => `<div class="dialog-list"><span>${esc(c.title)}</span><button data-restore="${esc(c.id)}" aria-label="Restore ${esc(c.title)}">Restore</button></div>`).join("") : '<p class="muted">No archived cards in this project.</p>', "Close archive");
  modal.querySelectorAll<HTMLButtonElement>("[data-restore]").forEach(button => button.onclick = () => { if (stage(w => archiveCard(w, button.dataset.restore!, false))) archiveDialog(); });
}
function membersDialog() {
  const w = session.state;
  showModal("Workspace & members", `<label class="form-field"><span>Workspace name</span><input id="ws-name" aria-label="Workspace name" value="${esc(w.name)}"></label><label class="form-field"><span>Acting as</span><select id="actor" aria-label="Acting as">${w.members.map(m => option(m.id, m.name, m.id === w.settings.actorId)).join("")}</select></label><label class="form-field"><span>Estimate unit</span><select id="estimate-unit" aria-label="Estimate unit">${estimateUnits.map(u => option(u, unitName(u), u === estimateUnit())).join("")}</select></label><small>Labels the card estimate field and the column/swimlane sum badges. Does not affect the IED effort estimate.</small><p class="muted">These are local identities, not accounts. Everyone using this browser profile shares the workspace.</p>${w.members.map(m => `<div class="dialog-list"><span>${esc(m.name)}</span><small>${m.id === w.settings.actorId ? "Current actor" : "Local member"}</small></div>`).join("")}<form id="member-form" class="form-row" style="margin-top:18px"><input id="member-name" aria-label="Member name" placeholder="Member name" required><button type="submit">Add member</button></form>`);
  const name = $<HTMLInputElement>("#ws-name"); fieldDraft(name, "workspace-name"); name.onchange = () => { const value = name.value; if (retain("workspace-name", value) && stage(w => w.name = value)) void clearDraft("workspace-name", value); };
  $<HTMLSelectElement>("#actor").onchange = e => { stage(w => w.settings.actorId = (e.target as HTMLSelectElement).value); };
  $<HTMLSelectElement>("#estimate-unit").onchange = e => { stage(w => w.settings.estimateUnit = (e.target as HTMLSelectElement).value as EstimateUnit); };
  const member = $<HTMLInputElement>("#member-name"); fieldDraft(member, "new-member");
  $<HTMLFormElement>("#member-form").onsubmit = async e => { e.preventDefault(); const value = member.value.trim(); if (retain("new-member", value) && stage(w => w.members.push({ id: id(), name: value, color: "#667b68" }))) { await clearDraft("new-member", value); membersDialog(); } };
}
async function snapshotsDialog() {
  try {
    const snapshots = await storage.snapshots();
    showModal("Daily snapshots", '<p>One snapshot per local day, up to seven days retained. Same-device recovery only; download backups for protection against browser eviction or device loss.</p>' + (snapshots.map(s => `<div class="dialog-list"><span>${esc(s.date)}</span><button data-snapshot="${esc(s.date)}">Restore ${esc(s.date)}</button></div>`).join("") || '<p class="muted">No snapshots yet.</p>'));
    modal.querySelectorAll<HTMLButtonElement>("[data-snapshot]").forEach(button => button.onclick = async () => {
      if (!confirm("Replace the entire workspace with this snapshot? Download a backup first if needed.")) return;
      try { await session.flush(); session.replace(migrateWorkspace(snapshots.find(s => s.date === button.dataset.snapshot)!.state)); await session.flush(); modal.close(); filters = { ...emptyFilters }; setHash(); render(); runHousekeeping(); } catch (e) { message(e); }
    });
  } catch (e) { message(e); }
}
function download(name: string, data: unknown) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function backup() {
  try { await session.flush(); if (session.status !== "saved" || draftStorageError || fieldErrors.size) throw new Error("Workspace has unsaved changes. Download drafts or retry the write first."); const committed = await storage.load(); if (!committed) throw new Error("No stored workspace"); download(`fieldboard-${new Date().toISOString().slice(0, 10)}.json`, committed); }
  catch (e) { message(e); }
}
function help() {
  showModal("Your work stays here", `<p>Fieldboard runs from this single HTML file, without accounts, servers or a network. Workspace data lives separately in this browser profile’s IndexedDB. Edits show “Saved” only after a strict transaction completes.</p><p><strong>Download a backup regularly.</strong> Before moving or renaming the HTML, changing browsers, profiles or computers, download JSON and restore it at the new location. File-path storage behavior differs by browser.</p><p>Private browsing, browser eviction, clearing site data, storage denial and device failure can remove data. Daily snapshots share these limits. Strict durability is not protection against disk failure.</p><p>Draft text stays in localStorage until committed. A red “Not saved” message means the change is not acknowledged. Retry or download drafts. If draft storage is denied too, keep this tab open and copy your text.</p><p>Open only one editing tab per profile. A conflicting write is rejected rather than overwriting another tab’s work. Export drafts before reloading after a conflict.</p><p><strong>Keyboard:</strong> Ctrl+Z (or Cmd+Z) undoes the last workspace action outside text inputs. Inside a text field, native text undo remains available. Outside dialogs and text fields: <kbd>/</kbd> focuses search, <kbd>n</kbd> opens a new-card input at the top of the focused card's column (or the first column), <kbd>e</kbd> opens the focused card, <kbd>j</kbd>/<kbd>k</kbd> move focus down/up through cards, <kbd>←</kbd>/<kbd>→</kbd> move the focused card to the previous/next column, <kbd>Shift+↑</kbd>/<kbd>Shift+↓</kbd> move the focused card up/down within its column, and <kbd>?</kbd> shows the full shortcut list. Escape closes a dialog or inline input and returns focus to whatever opened it. Tab reaches every control, including every field inside an open dialog, which keeps focus trapped while it is open. Move cards with their “Move to…” menu when drag or keyboard reordering is impractical.</p><p><strong>Command palette:</strong> Ctrl+K (or Cmd+K), or the ⌘K button in the top bar, opens a fuzzy search across projects, boards, cards and actions (new project, new card, add column, milestones, sprints, effort &amp; planning, archive, backup, help, theme). Arrow keys move the selection, Enter runs it, Escape closes the palette.</p><p><strong>Quick-add:</strong> typing into any "Card title" input accepts inline syntax anywhere in the text — <code>#label</code> (matched case-insensitively or created), <code>@name</code> (matched by member name, first-name prefix allowed when unique), <code>!low</code>/<code>!medium</code>/<code>!high</code>/<code>!urgent</code> or <code>!!</code> for urgent, <code>^today</code>/<code>^tomorrow</code>/a weekday name/<code>^YYYY-MM-DD</code> for the due date, and <code>~milestone</code> for a project milestone. An unrecognised or ambiguous token is left exactly as typed in the title rather than guessed.</p><p><strong>Theme:</strong> the Theme control in the sidebar follows System by default, tracking your OS setting live, or can be pinned to Light or Dark. The choice is saved with the workspace and travels in backups.</p><p><strong>Markdown:</strong> headings, emphasis, lists, quotes, code and HTTP(S) links. Raw HTML is escaped. Images are shown as text and never fetched.</p><p><strong>Effort &amp; planning:</strong> enable project planning from the board. On a card, choose “Start IED estimate”, then pick a category and subcategory — the IED catalog groups design work (register interfaces, FSMs, CDC, datapaths, interfaces, top level, reference models) and lab/debug work (board bring-up, hardware testbench verification, interface characterization, on-chip debug, field update, qualification, production test) by general type, with a subcategory factor sizing the specific case. Choose “Custom task” to size the IED fields directly instead; every field stays visible and editable either way. A Lab access factor (dedicated bench, shared lab, or booked/remote lab) corrects for lab contention alongside the other module factors. Categories and subcategories can be renamed, re-valued, added and deleted per workspace from the IED catalog in this dialog; one still used by a card cannot be deleted. An IED is 6–7 uninterrupted engineering hours, separate from the legacy unitless estimate. Calendar output is a staffing scenario, not a delivery commitment.</p><p><strong>Sprint capacity:</strong> a project’s sprint capacity is either derived from staffing or typed directly as IED per sprint, set in “Effort &amp; planning”. Open the board’s “Sprints” control for a view of each numbered sprint’s capacity (derived, direct or overridden), load including module contingency, headroom and verdict, with its cards and an “Unassigned” group for estimated cards without a sprint; a sprint’s capacity can be overridden there for holidays or lab weeks, and a card’s sprint can be changed from either view.</p><p><strong>Milestones:</strong> a milestone is a dated outcome, not a schedule. Add one from the board’s “Milestones” control, then assign it to any card from that card’s “Milestone” field. The board stays pull-based — nothing here reorders a card or sets its date. The overview lists done/total cards, remaining IED and a fit verdict against the project’s planning capacity, shared cumulatively across every milestone on or before a given date; it withholds a verdict when planning isn’t enabled or scope is unestimated. Deleting a milestone unassigns its cards rather than deleting them, and the change is undoable like any other card edit.</p><p><strong>WIP limits:</strong> set an optional limit on any column from its “⋯” menu. The header shows the column’s non-archived card count as “count / limit”, turning amber at the limit and red above it; going over is allowed, never blocked. Clear the field to remove the limit.</p><p><strong>Blocked cards:</strong> check “Blocked” on a card and give a reason — required, since a block with no reason explains nothing. A blocked card shows a “Blocked” badge with the reason in its tooltip, and the “Filter blocked” control narrows the board to blocked cards only. Uncheck to clear it.</p><p><strong>Dependencies:</strong> a card’s detail view lists every other card in the project under “Blocked by” — check the ones it depends on. While any of them isn’t in a done column, the card’s face shows “Waiting on: …”; the indicator disappears once they’re all done. The same section lists what the card itself blocks. Deleting a card removes it from every dependent automatically.</p><p><strong>Epics:</strong> set a card’s “Epic / parent” field to make it a child of another card. The parent’s face shows a small progress bar of its children’s completion; a child’s face links back to its parent. The “Filter epic” control shows an epic and its children together. Deleting a parent leaves its children in place, unparented.</p><p><strong>Boards:</strong> a project can hold several boards, switched from the dropdown next to the board's card count. Open “Boards” to add one, rename one, or delete one — deleting a board with cards requires picking a destination board, whose first column receives them. The last board of a project can't be deleted. A card can also jump straight to another board's first column from “Move to board…” in its detail view, bypassing the usual same-board move restriction. Project totals, milestones and sprints already add up every board's cards, not just the one shown.</p><p><strong>My work:</strong> the sidebar's “My work” opens every non-archived card assigned to the acting member, across every project, grouped into Overdue, Today, This week, Later and No date; done cards sit in a collapsed Done group rather than disappearing. Opening a row's card switches the board to wherever that card lives.</p><p><strong>Views:</strong> the Board/List/Calendar/Timeline/Insights tabs in the viewbar switch how the current board's filtered cards show; only the active view renders, and the choice travels in the URL fragment with the other filters. The board stays the one place that reorders a card. “Group board by” (board view) splits the board into horizontal lanes by assignee, priority, label or epic, plus a None lane, saved on the board itself; a card with several assignees or labels appears in every lane it matches, and dragging it into another lane changes column position and that one attribute together as a single undo step — an epic-lane move still respects the same no-cycle, same-project rule as the “Epic / parent” field, rejecting and leaving the card unchanged if it would break it. Column WIP counts stay per column across lanes. List view shows the same cards as a sortable, groupable table (click a header to sort, nulls last; “Group by” buckets rows the same way swimlanes do, with groups in a fixed order and sort governing order within each group); opening a row opens that card.</p><p><strong>Calendar view:</strong> shows cards with a due date on a month or week grid, Monday-first with weekday names in your locale; ◆ markers show the active project's milestones on their dates. Previous/Next/Today navigate; a day over a few cards shows “+N more” to expand it. Drag a card onto a day to set its due date, or onto the “No due date” side list to clear it — the only way this view writes a date, and it goes through the normal card edit, so it is one Activity entry and undoable.</p><p><strong>Timeline view:</strong> draws a bar from a card's Start date to its Due date (set in the card detail, next to Due date; a start date after the due date is rejected) on a day scale with week gridlines and a line marking today. Cards missing either date are listed under “Not scheduled” rather than guessing one. Rows group by column or epic, switchable above the chart. An arrow runs from a blocker's bar to the cards it blocks; an arrow drawn in the warning colour means the dependent starts before its blocker is due. Clicking a bar or a “Not scheduled” row opens that card.</p><p><strong>Insights:</strong> the Insights tab shows the current board's cumulative flow diagram (daily card count per column, over a 14/30/90-day or all-time range you choose; a column removed from the board since shows as “Removed columns”), lead and cycle time (median, 85th percentile and a dot-strip distribution for cards completed in that range), and throughput (cards completed per week for the last 12 weeks). Every chart is read from existing Activity history and completion dates — nothing here writes to a card, and none of it projects a finish date. A card's own lead and cycle time (or “In progress for N days” before it's done) show in its detail view next to Comments.</p><p><strong>Templates:</strong> save a card as a template from its detail view's “Template” section (description, subtasks, labels and priority); create one from a column's “+ From template” control. Save a board's columns, done flags and WIP limits as a board template from “Boards”, and start a new board from one the same place.</p><p><strong>Bulk actions:</strong> Shift-click or Ctrl/Cmd-click card faces to select several; a plain click still opens a card. The selection bar below the filters moves, labels, assigns or archives every selected card as one undo step, with its own Activity entry per card. Escape clears the selection.</p><p><strong>Time tracking:</strong> a card's detail view has a Start/Stop timer (one running timer per card) plus a form to add a manual entry by date and duration (minutes, or h:mm) with an optional note. The total tracked time shows next to the card's Estimate field, and a small “⏱” badge appears on the card face once anything has been tracked or a timer is running. A running timer survives reload — only its start time is stored, and the elapsed time shown is always computed from it. Entries may not overlap each other on the same card.</p>
<p><strong>Recurring cards:</strong> a card's detail view can make it recur daily, weekly or monthly into a chosen column (any column in the project, not just the current board). Opening the app — at launch, every minute it stays open, and whenever the tab becomes visible again — generates a copy for every occurrence whose date has arrived, carrying the title, description, labels, priority, assignees and unchecked subtasks; comments, attachments, time entries and the recurrence itself never carry over. Occurrences missed while the app was closed are all created the moment it reopens, each exactly once, up to a per-card cap per visit; reloading afterward never creates more. This never runs while the file is closed — there is no background service.</p>
<p><strong>Automation:</strong> a board's “Automation” control lists its rules and its auto-archive setting. A rule fires when a card enters a chosen column — checking all its subtasks, or assigning a chosen member — or, for the overdue rule, whenever a card's due date has passed and it isn't in a done column, adding a chosen label (creating it in the project if it doesn't exist yet). Each rule can be toggled on and off, or deleted, from the same dialog, and every firing appears in the card's Activity history in plain words (for example “rule: entering Review assigns Robin”). Undoing the change that triggered a rule undoes the rule's effect too, as one step. “Archive done cards after” sets how many days after completion a board's done cards archive themselves automatically; leave it empty to turn it off. Archived cards stay restorable from Archive, and restoring one resets its clock to today rather than letting it be archived again immediately. Entering-column rules fire the moment a card moves, however it moved; the overdue rule and auto-archive are checked at launch, about once a minute while the app stays open, and when the tab becomes visible again — the same schedule recurring cards use. None of this runs while the file is closed — there is no background service, and nothing here rewrites existing history.</p>
<p><strong>Estimates:</strong> set a workspace-wide estimate unit — points or hours — from “Workspace &amp; members”; it labels the card detail’s Estimate field and every sum badge, and is separate from the IED effort estimate above it. Each column header shows the total estimate of its non-archived cards next to the card count, and in a grouped board each lane shows its own total beneath the lane name; a column or lane with nothing estimated shows no badge rather than “Σ 0”.</p>
<p><strong>Attachments:</strong> a card's detail view has an Attachments section — drag files onto it, paste an image or file while the card is open, or use Add file. PNG, JPEG, GIF and WebP show a thumbnail; every other type, including SVG, shows as a file chip only and is never opened or rendered. Each file is capped at 2 MiB; a larger file is refused and nothing is written. Download saves the original bytes; Remove deletes it.</p><p><strong>Links:</strong> the Links section holds a plain URL, a git commit (repository and SHA) or a GitHub issue/PR (repository and number) — pick a kind, fill in its fields and press Add link. Pasting a github.com issue, PR or commit URL fills in the right kind automatically. Only http(s) links are clickable; nothing about a link makes a network request.</p><p><strong>Import and export:</strong> the sidebar's Import… creates a new project from a Trello board export, a GitHub Issues export, or a CSV with a title column (plus optional description, column, labels, priority, due and estimate); a file that can't be read is refused and nothing is imported. A board's Export CSV and Export Markdown controls, above the board, download the current board — the CSV re-imports to the same cards, Markdown is a readable summary.</p>
<p><strong>Mentions:</strong> typing <code>@Name</code> in a card's description or in a comment, where Name matches a workspace member (case-insensitively; the longest matching name wins, so "@Ana Maria" matches the full name rather than just "@Ana"), renders as a small chip once the card is saved. An unrecognised name is left as plain text.</p>
<p><strong>Notifications:</strong> the envelope button in the top bar shows how many unread notifications the acting member has, and opens their inbox — newest first, each one naming what happened and which card, opening that card and marking it read when clicked. “Mark all read” clears the whole list at once. You’re notified when someone else mentions you, assigns you to a card, or changes a card you watch, and your own changes never notify you. A card assigned to you also gets a one-time reminder once it’s due within 24 hours or overdue; reloading or missing a day never duplicates it, and this check runs on the same schedule as recurring cards (launch, every minute, and whenever the tab becomes visible again) — never while the file is closed.</p>
<p><strong>Watchers:</strong> a card's detail view has a Watch/Unwatch toggle and shows who's watching. Any change another member makes to a watched card — not your own — notifies every watcher once, not once per changed field.</p>
<p class="storage-caution">Every in-scope Tier 1, 2 and 3 feature is implemented. There is no real-time collaboration or authenticated identity, and nothing runs while this file is closed.</p>`);
}
function paletteActions(): PaletteItem[] {
  return [
    { id: "action:new-project", kind: "action", label: "New project" },
    { id: "action:new-card", kind: "action", label: "New card" },
    { id: "action:add-column", kind: "action", label: "Add column" },
    { id: "action:boards", kind: "action", label: "Boards" },
    { id: "action:my-work", kind: "action", label: "My work" },
    { id: "action:milestones", kind: "action", label: "Milestones" },
    { id: "action:sprints", kind: "action", label: "Sprints" },
    { id: "action:planning", kind: "action", label: "Effort & planning" },
    { id: "action:automation", kind: "action", label: "Automation" },
    { id: "action:archive", kind: "action", label: "Archive" },
    { id: "action:backup", kind: "action", label: "Download backup" },
    { id: "action:import", kind: "action", label: "Import…" },
    { id: "action:export-csv", kind: "action", label: "Export CSV" },
    { id: "action:export-md", kind: "action", label: "Export Markdown" },
    { id: "action:help", kind: "action", label: "Help" },
    { id: "action:view-board", kind: "action", label: "View: board" },
    { id: "action:view-list", kind: "action", label: "View: list" },
    { id: "action:view-insights", kind: "action", label: "View: insights" },
    { id: "action:theme-light", kind: "action", label: "Theme: light" },
    { id: "action:theme-dark", kind: "action", label: "Theme: dark" },
    { id: "action:theme-system", kind: "action", label: "Theme: system" },
  ];
}
function buildPaletteItems(): PaletteItem[] {
  const w = session.state; const items: PaletteItem[] = [];
  for (const p of w.projects) items.push({ id: `project:${p.id}`, kind: "project", label: p.name });
  for (const b of w.boards) items.push({ id: `board:${b.id}`, kind: "board", label: b.name, hint: w.projects.find(p => p.id === b.projectId)?.name });
  for (const c of w.cards) if (!c.archived) items.push({ id: `card:${c.id}`, kind: "card", label: c.title });
  return [...items, ...paletteActions()];
}
function goToProject(projectId: string) { filters = { ...emptyFilters, project: projectId }; setHash(); render(); }
function executePaletteItem(item: PaletteItem) {
  const value = item.id.slice(item.id.indexOf(":") + 1);
  if (item.kind === "project") { goToProject(value); return; }
  if (item.kind === "board") { const board = session.state.boards.find(b => b.id === value); if (board) { filters = { ...emptyFilters, project: board.projectId, board: board.id }; setHash(); render(); } return; }
  if (item.kind === "card") {
    const card = session.state.cards.find(c => c.id === value); if (!card) return;
    const column = session.state.columns.find(c => c.id === card.columnId); const board = session.state.boards.find(b => b.id === column?.boardId);
    if (board && (filters.project !== board.projectId || filters.board !== board.id)) { filters = { ...emptyFilters, project: board.projectId, board: board.id }; setHash(); render(); }
    focusedCard = card.id; openCard(card.id); return;
  }
  switch (item.id) {
    case "action:new-project": projectDialog(); break;
    case "action:new-card": newCardShortcut(); break;
    case "action:add-column": columnDialog(); break;
    case "action:boards": boardsDialog(); break;
    case "action:my-work": myWorkDialog(); break;
    case "action:milestones": milestonesDialog(); break;
    case "action:sprints": sprintsDialog(); break;
    case "action:planning": planningDialog(); break;
    case "action:automation": automationDialog(); break;
    case "action:archive": archiveDialog(); break;
    case "action:backup": void backup(); break;
    case "action:import": importDialog(); break;
    case "action:export-csv": { const b = currentBoard(); if (b) downloadBoardCsv(session.state, b.id, b.name); break; }
    case "action:export-md": { const b = currentBoard(); if (b) downloadBoardMarkdown(session.state, b.id, b.name); break; }
    case "action:help": help(); break;
    case "action:view-board": filters.view = ""; selected.clear(); setHash(); render(); break;
    case "action:view-list": filters.view = "list"; selected.clear(); setHash(); render(); break;
    case "action:view-insights": filters.view = "insights"; selected.clear(); setHash(); render(); break;
    case "action:theme-light": stage(w => w.settings.theme = "light"); break;
    case "action:theme-dark": stage(w => w.settings.theme = "dark"); break;
    case "action:theme-system": stage(w => w.settings.theme = "system"); break;
  }
}
function undo() {
  try {
    session.undo(); render();
    if (modal.open && modal.dataset.planningProject) mountPlanning($("#project-planning", modal), modal.dataset.planningProject, planningHooks);
    if (modal.open && modal.dataset.milestonesProject) mountMilestones($("#project-milestones", modal), modal.dataset.milestonesProject, planningHooks);
    if (modal.open && modal.dataset.sprintsProject) mountSprints($("#project-sprints", modal), modal.dataset.sprintsProject, planningHooks);
    if (modal.open && modal.dataset.boardsProject) mountBoards($("#project-boards", modal), modal.dataset.boardsProject, planningHooks, boardId => { filters.board = boardId; selected.clear(); setHash(); modal.close(); render(); });
    if (modal.open && modal.dataset.automationBoard) mountAutomation($("#board-automation", modal), modal.dataset.automationBoard, planningHooks);
    if (openedCard && detail.open) { if (session.state.cards.some(c => c.id === openedCard)) openCard(openedCard); else detail.close(); }
  } catch (e) { message(e); }
}
// One housekeeping pass covers every time-based mechanism -- recurring cards, the overdue-label rule
// and auto-archive -- on the same schedule: checked on launch, every minute while the app stays open,
// and whenever the tab becomes visible again, never while the file is closed (see README's anti-claim).
// A cheap read-only pre-check skips the commit entirely when nothing is due, so an idle board does not
// write to storage every minute for no reason.
function runHousekeeping() {
  if (!ready) return;
  const w = session.state;
  if (hasDueRecurrences(w) || hasDueAutomation(w) || hasDueReminders(w)) stage(w => { generateRecurrences(w); runOverdueRule(w); runAutoArchive(w); generateDueReminders(w); });
}
function bind() {
  if (bound) return; bound = true;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") runHousekeeping(); });
  for (const selector of ["#new-project", "#new-project-small", "#welcome-create"]) $(selector).onclick = projectDialog;
  const sidebar = $(".sidebar"), menuToggle = $("#menu-toggle");
  const setMenu = (open: boolean) => { sidebar.classList.toggle("menu-open", open); menuToggle.setAttribute("aria-expanded", String(open)); };
  menuToggle.onclick = () => setMenu(!sidebar.classList.contains("menu-open"));
  $("#sidebar-menu").addEventListener("click", e => { if ((e.target as Element).closest("button")) setMenu(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") setMenu(false); });
  $("#planning-button").onclick = planningDialog; $("#milestones-button").onclick = milestonesDialog; $("#sprints-button").onclick = sprintsDialog;
  $("#boards-button").onclick = boardsDialog; $("#my-work-button").onclick = myWorkDialog; $("#automation-button").onclick = automationDialog;
  $<HTMLSelectElement>("#board-select").onchange = e => { filters.board = (e.target as HTMLSelectElement).value; selected.clear(); setHash(); render(); };
  $<HTMLSelectElement>("#swimlane-select").onchange = e => { const b = currentBoard(); const value = (e.target as HTMLSelectElement).value; if (b && swimlaneKinds.includes(value as Swimlane)) stage(w => setBoardSwimlane(w, b.id, value as Swimlane)); };
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(b => b.onclick = () => { filters.view = b.dataset.view === "board" ? "" : b.dataset.view!; selected.clear(); setHash(); render(); });
  $<HTMLSelectElement>("#bulk-move").onchange = e => { const sel = e.target as HTMLSelectElement; const col = sel.value; if (col) runBulk((w, cardId) => moveCard(w, cardId, col, orderedCards(w, col).length)); sel.value = ""; };
  $<HTMLSelectElement>("#bulk-label").onchange = e => { const sel = e.target as HTMLSelectElement; const label = sel.value; if (label) runBulk((w, cardId) => { const card = w.cards.find(c => c.id === cardId)!; if (!card.labels.includes(label)) editCard(w, cardId, { labels: [...card.labels, label] }); }); sel.value = ""; };
  $<HTMLSelectElement>("#bulk-remove-label").onchange = e => { const sel = e.target as HTMLSelectElement; const label = sel.value; if (label) runBulk((w, cardId) => { const card = w.cards.find(c => c.id === cardId)!; if (card.labels.includes(label)) editCard(w, cardId, { labels: card.labels.filter(l => l !== label) }); }); sel.value = ""; };
  $<HTMLSelectElement>("#bulk-assign").onchange = e => { const sel = e.target as HTMLSelectElement; const member = sel.value; if (member) runBulk((w, cardId) => { const card = w.cards.find(c => c.id === cardId)!; if (!card.assignees.includes(member)) editCard(w, cardId, { assignees: [...card.assignees, member] }); }); sel.value = ""; };
  $<HTMLSelectElement>("#bulk-unassign").onchange = e => { const sel = e.target as HTMLSelectElement; const member = sel.value; if (member) runBulk((w, cardId) => { const card = w.cards.find(c => c.id === cardId)!; if (card.assignees.includes(member)) editCard(w, cardId, { assignees: card.assignees.filter(a => a !== member) }); }); sel.value = ""; };
  $("#bulk-archive").onclick = () => { if (confirm(`Archive ${selected.size} card${selected.size === 1 ? "" : "s"}?`)) runBulk((w, cardId) => archiveCard(w, cardId, true)); };
  $("#bulk-clear").onclick = () => { selected.clear(); renderActiveView(); };
  $<HTMLSelectElement>("#theme-select").onchange = e => { stage(w => w.settings.theme = (e.target as HTMLSelectElement).value as Theme); };
  $("#project-settings").onclick = projectSettings; $("#add-column").onclick = () => columnDialog(); $("#archive-button").onclick = archiveDialog;
  $("#members-button").onclick = membersDialog; $("#snapshots-button").onclick = () => void snapshotsDialog(); $("#backup-button").onclick = () => void backup(); $("#help-button").onclick = help;
  $("#import-button").onclick = importDialog;
  $("#export-csv-button").onclick = () => { const b = currentBoard(); if (b) downloadBoardCsv(session.state, b.id, b.name); };
  $("#export-md-button").onclick = () => { const b = currentBoard(); if (b) downloadBoardMarkdown(session.state, b.id, b.name); };
  $("#inbox-button").onclick = inboxDialog;
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
      filters = { ...emptyFilters }; setHash(); detail.close(); modal.close(); render(); runHousekeeping();
    } catch (error) { message(error); } finally { input.value = ""; }
  };
  $<HTMLInputElement>("#search").oninput = e => { filters.q = (e.target as HTMLInputElement).value; setHash(); renderActiveView(); };
  for (const [selector, key] of [["#filter-label", "label"], ["#filter-assignee", "assignee"], ["#filter-priority", "priority"], ["#filter-due", "due"], ["#filter-milestone", "milestone"], ["#filter-blocked", "blocked"], ["#filter-epic", "epic"]] as const) $<HTMLSelectElement>(selector).onchange = e => { filters[key] = (e.target as HTMLSelectElement).value; setHash(); renderActiveView(); };
  $<HTMLInputElement>("#filter-focus").onchange = e => { filters.focus = (e.target as HTMLInputElement).checked ? "mine" : ""; setHash(); renderActiveView(); };
  $("#clear-filters").onclick = () => { filters = { ...emptyFilters, project: filters.project }; setHash(); render(); };
  window.onhashchange = () => { filters = decodeFilters(location.hash); render(); };
  paletteApi = mountPalette(palette, buildPaletteItems, executePaletteItem);
  $("#palette-button").onclick = () => paletteApi.open();
  document.addEventListener("keydown", e => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLElement && e.target.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (!palette.open && !modal.open && !detail.open) paletteApi.open(); return; }
    if (e.key === "Escape" && selected.size && !modal.open && !detail.open) { selected.clear(); renderActiveView(); return; }
    if (typing || modal.open || detail.open) return;
    if (e.key === "/") { e.preventDefault(); $<HTMLInputElement>("#search").focus(); return; }
    if (e.key === "?") { e.preventDefault(); shortcutsDialog(); return; }
    if (e.key.toLowerCase() === "n") { e.preventDefault(); newCardShortcut(); return; }
    if (e.key.toLowerCase() === "e") { e.preventDefault(); if (focusedCard) openCard(focusedCard); return; }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); moveFocusedCardColumn(e.key === "ArrowRight" ? 1 : -1); return; }
    if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); moveFocusedCardWithinColumn(e.key === "ArrowDown" ? 1 : -1); return; }
    if (e.key === "j" || e.key === "k") { e.preventDefault(); moveCardFocus(e.key === "j" ? 1 : -1); }
  });
  detail.onclose = () => { timeTrackingHandle?.stop(); timeTrackingHandle = null; openedCard = null; render(); if (focusedCard) focusCardElement(focusedCard); };
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
    runHousekeeping();
    setInterval(runHousekeeping, 60_000);
    setInterval(() => { void storage.snapshot().catch(message); }, 60_000);
    await storage.snapshot();
  } catch (e) { message(e); if (session) { bind(); render(); } }
}
void init();
