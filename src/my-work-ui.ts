import { myWork, type MyWorkRow } from "./my-work";
import type { PlanningHooks } from "./planning-ui";
import { escapeHTML as esc } from "./markdown";

function rowHTML(row: MyWorkRow): string {
  return `<button type="button" class="my-work-row" data-card="${esc(row.card.id)}" aria-label="Open card: ${esc(row.card.title)}">
    <span class="my-work-title">${esc(row.card.title)}</span>
    <span class="my-work-meta">${esc(row.project.name)} · ${esc(row.column.name)}${row.card.dueDate ? ` · ${esc(row.card.dueDate)}` : ""}</span></button>`;
}
function section(label: string, rows: MyWorkRow[]): string {
  return rows.length ? `<div class="my-work-group"><h3>${esc(label)} <span class="count">${rows.length}</span></h3>${rows.map(rowHTML).join("")}</div>` : "";
}
export function mountMyWork(root: HTMLElement, hooks: PlanningHooks, openCard: (cardId: string) => void) {
  const w = hooks.state();
  const groups = myWork(w, w.settings.actorId);
  const total = groups.overdue.length + groups.today.length + groups.week.length + groups.later.length + groups.none.length;
  root.innerHTML = `<p>Every non-archived card assigned to you, across every project, grouped by due date.</p>`
    + (total ? [section("Overdue", groups.overdue), section("Today", groups.today), section("This week", groups.week), section("Later", groups.later), section("No date", groups.none)].join("")
      : '<p class="muted">Nothing assigned to you right now.</p>')
    + (groups.done.length ? `<details class="my-work-done"><summary>Done (${groups.done.length})</summary>${groups.done.map(rowHTML).join("")}</details>` : "");
  root.querySelectorAll<HTMLButtonElement>("[data-card]").forEach(button => button.onclick = () => openCard(button.dataset.card!));
}
