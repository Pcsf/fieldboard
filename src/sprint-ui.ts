import { type Card } from "./model";
import { sprintBoard, setSprintOverride, setCardSprint, estimateModule, type SprintGroup } from "./planning";
import { formatRange, type PlanningHooks } from "./planning-ui";
import { escapeHTML as esc } from "./markdown";

const sourceLabel = (s: SprintGroup["capacitySource"]) => s === "derived" ? "Derived from staffing" : s === "direct" ? "Direct" : "Overridden";
const verdictLabel = (v: SprintGroup["verdict"]) => v === "within" ? "Within capacity" : v === "over" ? "Over capacity" : "Not quotable";
const cardLoad = (card: Card) => { const r = card.effort ? estimateModule(card.effort) : null; return r ? r.architectureGap ? "Architecture gap" : r.ied[1] === 0 ? "Not sized" : `${formatRange(r.ied)} IED` : "Not sized"; };

function sprintRow(s: SprintGroup): string {
  const quotable = !s.architectureGap && !s.unestimated;
  const headroom = quotable ? (s.capacity - s.ied[1]).toFixed(2) : "—";
  return `<div class="milestone-row" data-sprint="${s.sprint}">
    <div class="milestone-head"><strong>Sprint ${s.sprint}</strong>
    <input class="sprint-capacity" type="number" min="0" step="any" aria-label="Sprint ${s.sprint} capacity" value="${s.capacity}">
    <button type="button" class="subtle sprint-capacity-clear" aria-label="Use default capacity for sprint ${s.sprint}">Use default</button></div>
    <div class="milestone-meta"><span>${esc(sourceLabel(s.capacitySource))}</span><span>Load ${quotable ? `${formatRange(s.ied)} IED` : "not quotable"}</span><span>Headroom ${headroom}</span><span class="milestone-verdict${s.verdict !== "within" ? " planning-warning" : ""}">${verdictLabel(s.verdict)}</span></div>
    <table class="planning-table"><thead><tr><th>Card</th><th>IED</th><th>Sprint</th></tr></thead><tbody>${s.cards.map(({ card }) => `<tr data-card="${esc(card.id)}"><td>${esc(card.title)}</td><td>${cardLoad(card)}</td><td><input class="card-sprint" type="number" min="1" step="1" aria-label="Sprint for ${esc(card.title)}" value="${card.effort!.sprint}"></td></tr>`).join("")}</tbody></table>
  </div>`;
}
function unassignedRow(card: Card): string {
  return `<div class="dialog-list" data-card="${esc(card.id)}"><span>${esc(card.title)} · ${cardLoad(card)}</span><input class="card-sprint" type="number" min="1" step="1" placeholder="Sprint" aria-label="Assign sprint for ${esc(card.title)}"></div>`;
}
export function mountSprints(root: HTMLElement, projectId: string, hooks: PlanningHooks) {
  function render() {
    const w = hooks.state();
    const { sprints, unassigned } = sprintBoard(w, projectId);
    root.innerHTML = `<p>Capacity, load (including module contingency) and headroom for each numbered sprint — a view over the cards on this board, not a second schedule. Changing a card's sprint here is the same edit as changing it from the card detail. A sprint's capacity can be overridden here for holidays or lab weeks; clearing the override returns it to the project's derived or direct capacity.</p>
    <div id="sprint-list">${sprints.map(sprintRow).join("") || '<p class="muted">No card carries a sprint number yet.</p>'}</div>
    <h3>Unassigned</h3><p class="muted">Estimated cards without a sprint number.</p>
    <div id="sprint-unassigned">${unassigned.length ? unassigned.map(unassignedRow).join("") : '<p class="muted">Nothing unassigned.</p>'}</div>`;
    for (const row of root.querySelectorAll<HTMLElement>("[data-sprint]")) {
      const sprint = Number(row.dataset.sprint);
      const capacity = row.querySelector<HTMLInputElement>(".sprint-capacity")!;
      capacity.onchange = () => { if (hooks.stage(w => setSprintOverride(w, projectId, sprint, Number(capacity.value)))) render(); };
      row.querySelector<HTMLButtonElement>(".sprint-capacity-clear")!.onclick = () => { if (hooks.stage(w => setSprintOverride(w, projectId, sprint, null))) render(); };
    }
    for (const el of root.querySelectorAll<HTMLElement>("[data-card]")) {
      const cardId = el.dataset.card!;
      const input = el.querySelector<HTMLInputElement>(".card-sprint")!;
      input.onchange = () => { if (hooks.stage(w => setCardSprint(w, cardId, input.value === "" ? null : Number(input.value)))) render(); };
    }
  }
  render();
}
