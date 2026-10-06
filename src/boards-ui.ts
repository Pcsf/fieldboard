import { addBoard, renameBoard, deleteBoard, saveBoardTemplate, createBoardFromTemplate, deleteBoardTemplate, type Workspace } from "./model";
import type { PlanningHooks } from "./planning-ui";
import { escapeHTML as esc } from "./markdown";

function boardsOf(w: Workspace, projectId: string) { return w.boards.filter(b => b.projectId === projectId); }

export function mountBoards(root: HTMLElement, projectId: string, hooks: PlanningHooks, onSwitch: (boardId: string) => void) {
  function render() {
    const w = hooks.state();
    const boards = boardsOf(w, projectId);
    const templates = w.boardTemplates ?? [];
    root.innerHTML = `<p>A project can hold several boards. Deleting a board with cards requires a destination board; its cards land in that board's first column.</p>
    <div id="board-list">${boards.map(b => `<div class="board-row" data-board="${esc(b.id)}">
      <div class="form-row"><input class="board-name" aria-label="Board name" value="${esc(b.name)}"><button type="button" class="board-switch" aria-label="Switch to board ${esc(b.name)}">Switch to</button></div>
      ${boards.length > 1 ? `<div class="form-row"><select class="board-destination" aria-label="Move ${esc(b.name)}'s cards to"><option value="">Choose a destination to delete</option>${boards.filter(o => o.id !== b.id).map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("")}</select><button type="button" class="danger board-delete" aria-label="Delete board ${esc(b.name)}">Delete</button></div>` : ""}
      <div class="form-row"><input class="board-template-name" aria-label="Template name for board ${esc(b.name)}" placeholder="Template name" value="${esc(b.name)} template"><button type="button" class="board-save-template" aria-label="Save as template: board ${esc(b.name)}">Save as template</button></div>
    </div>`).join("")}</div>
    <form id="board-form" class="form-row"><input id="board-name-input" aria-label="New board name" placeholder="New board name" required><select id="board-template-select" aria-label="Start new board from template"><option value="">Blank board</option>${templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select><button type="submit">Create board</button></form>
    ${templates.length ? `<div class="section-label">BOARD TEMPLATES</div>${templates.map(t => `<div class="dialog-list"><span>${esc(t.name)} (${t.columns.length} columns)</span><button type="button" class="danger" data-delete-board-template="${esc(t.id)}" aria-label="Delete board template ${esc(t.name)}">Delete</button></div>`).join("")}` : ""}`;
    const nameInput = root.querySelector<HTMLInputElement>("#board-name-input")!;
    const nameKey = `board:${projectId}:new:name`; const draft = hooks.draft(nameKey); if (draft !== undefined) nameInput.value = draft;
    nameInput.addEventListener("input", () => hooks.retain(nameKey, nameInput.value));
    root.querySelector<HTMLFormElement>("#board-form")!.onsubmit = e => {
      e.preventDefault(); const name = nameInput.value; if (!hooks.retain(nameKey, name)) return;
      const templateId = root.querySelector<HTMLSelectElement>("#board-template-select")!.value;
      if (hooks.stage(w2 => templateId ? createBoardFromTemplate(w2, projectId, templateId, name) : addBoard(w2, projectId, name))) { void hooks.clear(nameKey, name); render(); }
    };
    for (const row of root.querySelectorAll<HTMLElement>("[data-board]")) {
      const boardId = row.dataset.board!;
      const nameField = row.querySelector<HTMLInputElement>(".board-name")!;
      const key = `board:${boardId}:name`; const nameDraft = hooks.draft(key); if (nameDraft !== undefined) nameField.value = nameDraft;
      nameField.addEventListener("input", () => hooks.retain(key, nameField.value));
      nameField.addEventListener("change", () => {
        const value = nameField.value; if (!hooks.retain(key, value)) return;
        if (hooks.stage(w2 => renameBoard(w2, boardId, value))) void hooks.clear(key, value);
      });
      row.querySelector<HTMLButtonElement>(".board-switch")!.onclick = () => onSwitch(boardId);
      row.querySelector<HTMLButtonElement>(".board-save-template")!.onclick = () => {
        const label = row.querySelector<HTMLInputElement>(".board-template-name")!.value;
        if (hooks.stage(w2 => saveBoardTemplate(w2, boardId, label))) render();
      };
      const del = row.querySelector<HTMLButtonElement>(".board-delete");
      if (del) del.onclick = () => {
        const dest = row.querySelector<HTMLSelectElement>(".board-destination")!.value;
        if (confirm(`Delete board "${nameField.value}"? Its cards move to the chosen destination's first column.`) && hooks.stage(w2 => deleteBoard(w2, boardId, dest || undefined))) render();
      };
    }
    root.querySelectorAll<HTMLButtonElement>("[data-delete-board-template]").forEach(button => button.onclick = () => {
      if (confirm("Delete this board template?") && hooks.stage(w2 => deleteBoardTemplate(w2, button.dataset.deleteBoardTemplate!))) render();
    });
  }
  render();
}
