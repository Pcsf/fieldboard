import { addMilestone, editMilestone, deleteMilestone, type Card, type Milestone, type Workspace } from "./model";
import { summarizeMilestones, type MilestoneSummary } from "./milestones";
import { formatRange } from "./planning-ui";
import type { PlanningHooks } from "./planning-ui";
import { escapeHTML as esc } from "./markdown";

export function milestoneChip(card: Card, milestones: Milestone[] | undefined): string {
  const m = card.milestoneId ? milestones?.find(x => x.id === card.milestoneId) : undefined;
  return m ? `<span class="milestone-chip" title="Milestone: ${esc(m.name)} (${esc(m.date)})">◆ ${esc(m.name)}</span>` : "";
}
function dueLabel(days: number): string {
  return days < 0 ? `${-days} day${days === -1 ? "" : "s"} overdue` : days === 0 ? "Due today" : `${days} day${days === 1 ? "" : "s"} remaining`;
}
function bindMilestoneField(input: HTMLInputElement | HTMLTextAreaElement, key: string, hooks: PlanningHooks, commit: (value: string) => boolean, event: string) {
  const draft = hooks.draft(key); if (draft !== undefined) input.value = draft;
  input.addEventListener(event, () => {
    const value = input.value;
    if (!hooks.retain(key, value)) { hooks.error(key, "A milestone text draft has not been saved. Correct it or download drafts before closing this tab."); return; }
    if (commit(value)) { hooks.error(key, ""); void hooks.clear(key, value); } else hooks.error(key, "Milestone edit was not accepted. Check the value and storage status.");
  });
}
function row(s: MilestoneSummary): string {
  const pct = s.totalCards ? Math.round(s.doneCards / s.totalCards * 100) : 0;
  const effort = `${formatRange(s.remaining)} IED${s.unestimatedCount ? ` + ${s.unestimatedCount} unestimated` : ""}`;
  const warn = s.verdict === "Fits" ? "" : " planning-warning";
  return `<div class="milestone-row" data-milestone="${esc(s.milestone.id)}">
    <div class="milestone-head"><input class="milestone-name" aria-label="Milestone name" value="${esc(s.milestone.name)}">
    <input class="milestone-date" aria-label="Milestone date" type="date" value="${esc(s.milestone.date)}">
    <button type="button" class="danger milestone-delete" aria-label="Delete milestone ${esc(s.milestone.name)}">Delete</button></div>
    <textarea class="milestone-description" aria-label="Milestone description" placeholder="Optional description">${esc(s.milestone.description)}</textarea>
    <div class="milestone-meta"><span>${esc(dueLabel(s.daysRemaining))}</span><span>${s.doneCards}/${s.totalCards} cards done</span><span>${esc(effort)}</span><span class="milestone-verdict${warn}">${esc(s.verdict)}</span></div>
    <div class="progress"><i style="width:${pct}%"></i></div></div>`;
}
export function mountMilestones(root: HTMLElement, projectId: string, hooks: PlanningHooks) {
  function render() {
    const w = hooks.state();
    const summaries = summarizeMilestones(w, projectId);
    root.innerHTML = `<p>A milestone is a dated outcome a card can belong to. This view is a capacity check against the project's planning settings, not a delivery schedule: the board stays pull-based and nothing here reorders a card or sets its date. The fit check adds module contingency, as sprint loads do; platform overheads are not assigned to milestones.</p>
    <form id="milestone-form" class="form-row"><input id="milestone-name-input" aria-label="New milestone name" placeholder="Milestone name" required><input id="milestone-date-input" aria-label="New milestone date" type="date" required><button type="submit">Add milestone</button></form>
    <div id="milestone-list">${summaries.map(row).join("") || '<p class="muted">No milestones yet.</p>'}</div>`;
    const nameInput = root.querySelector<HTMLInputElement>("#milestone-name-input")!;
    const dateInput = root.querySelector<HTMLInputElement>("#milestone-date-input")!;
    const nameKey = `milestone:${projectId}:new:name`; const dateKey = `milestone:${projectId}:new:date`;
    const nameDraft = hooks.draft(nameKey); if (nameDraft !== undefined) nameInput.value = nameDraft;
    const dateDraft = hooks.draft(dateKey); if (dateDraft !== undefined) dateInput.value = dateDraft;
    nameInput.addEventListener("input", () => hooks.retain(nameKey, nameInput.value));
    dateInput.addEventListener("input", () => hooks.retain(dateKey, dateInput.value));
    root.querySelector<HTMLFormElement>("#milestone-form")!.onsubmit = e => {
      e.preventDefault(); const name = nameInput.value, date = dateInput.value;
      if (!hooks.retain(nameKey, name) || !hooks.retain(dateKey, date)) return;
      if (hooks.stage(w => addMilestone(w, projectId, name, date))) { void hooks.clear(nameKey, name); void hooks.clear(dateKey, date); render(); }
    };
    for (const el of root.querySelectorAll<HTMLElement>("[data-milestone]")) {
      const id = el.dataset.milestone!;
      bindMilestoneField(el.querySelector(".milestone-name")!, `milestone:${id}:name`, hooks, value => hooks.stage(w => editMilestone(w, projectId, id, { name: value })), "change");
      bindMilestoneField(el.querySelector(".milestone-date")!, `milestone:${id}:date`, hooks, value => hooks.stage(w => editMilestone(w, projectId, id, { date: value })), "change");
      bindMilestoneField(el.querySelector(".milestone-description")!, `milestone:${id}:description`, hooks, value => hooks.stage(w => editMilestone(w, projectId, id, { description: value })), "input");
      el.querySelector<HTMLButtonElement>(".milestone-delete")!.onclick = () => {
        const name = el.querySelector<HTMLInputElement>(".milestone-name")!.value;
        if (confirm(`Delete milestone "${name}"? Its cards are unassigned, not deleted.`) && hooks.stage(w => deleteMilestone(w, projectId, id))) render();
      };
    }
  }
  render();
}
