import { type Card, type Workspace } from "./model";
import { sprintBoard, setSprintOverride, setCardSprint, estimateModule, cardSprintNumber, sprintWindow, sprintAnchorDate, setSprintMeta, closeSprint, sprintBurnup, type SprintGroup } from "./planning";
import { layoutWindowedBurnup, countTicks, burnupAxisTicks } from "./burnup";
import { formatRange, type PlanningHooks } from "./planning-ui";
import { escapeHTML as esc } from "./markdown";

const sourceLabel = (s: SprintGroup["capacitySource"]) => s === "derived" ? "Derived from staffing" : s === "direct" ? "Direct" : "Overridden";
const verdictLabel = (v: SprintGroup["verdict"]) => v === "within" ? "Within capacity" : v === "over" ? "Over capacity" : "Not quotable";
const cardLoad = (card: Card) => { const r = card.effort ? estimateModule(card.effort) : null; return r ? r.architectureGap ? "Architecture gap" : r.ied[1] === 0 ? "Not sized" : `${formatRange(r.ied)} IED` : "Not sized"; };

// Reuses the same chart engine (countTicks/burnupAxisTicks) and the same CSS classes as the
// milestone burnup chart in src/milestones-ui.ts, but a different layout function
// (layoutWindowedBurnup, not layoutBurnup): a sprint's x-axis is its own start/end window, not a
// range the data decides, so the points sprintBurnup returns already span the full window and the
// today/end markers are only drawn when they actually fall inside it -- see DECISIONS "Time-boxed
// sprints".
const CHART_W = 1000; const CHART_H = 200; const PAD_Y = 16;
function sprintBurnupChart(sprintNumber: number, startDate: string, endDate: string, closed: boolean, w: Workspace, projectId: string, today: Date): string {
  const points = sprintBurnup(w, projectId, sprintNumber, startDate, endDate, closed, today);
  const layout = layoutWindowedBurnup(points, endDate, today);
  const last = points.at(-1) ?? { scope: 0, done: 0 };
  const remaining = last.scope - last.done;
  const summary = `Scope ${last.scope} card${last.scope === 1 ? "" : "s"}, ${last.done} done, ${remaining} remaining`;
  const days = layout.days;
  const x = (offset: number) => days <= 1 ? 0 : (offset / (days - 1)) * CHART_W;
  const y = (v: number) => CHART_H - PAD_Y - (v / layout.maxValue) * (CHART_H - 2 * PAD_Y);
  const pct = (offset: number) => days <= 1 ? 0 : (offset / (days - 1)) * 100;
  const pctY = (v: number) => (y(v) / CHART_H) * 100;
  const stepPath = (key: "scope" | "done") => {
    if (!points.length) return "";
    let d = `M ${x(0).toFixed(1)} ${y(points[0]![key]).toFixed(1)}`;
    for (let i = 1; i < points.length; i++) d += ` H ${x(i).toFixed(1)} V ${y(points[i]![key]).toFixed(1)}`;
    return d;
  };
  // A single-day window would otherwise draw a zero-length path with nothing visible -- a short
  // horizontal stub keeps that day's value visible as a flat dash, same fix the milestone chart's
  // single-point case already uses.
  const stub = (key: "scope" | "done") => points.length === 1 ? ` H ${(x(0) + CHART_W * 0.04).toFixed(1)}` : "";
  const dot = (cls: string, key: "scope" | "done") => layout.todayOffset !== null ? `<div class="burnup-dot ${cls}" style="left:${pct(layout.todayOffset).toFixed(2)}%;top:${pctY(last[key]).toFixed(2)}%"></div>` : "";
  const xTicks = burnupAxisTicks(layout.rangeStart, Math.max(days, 1)).map(t => `<div class="burnup-xaxis-tick" style="left:${pct(t.offset).toFixed(2)}%">${esc(t.label)}</div>`).join("");
  const yTicks = countTicks(layout.maxValue).map(v => `<div class="burnup-yaxis-tick" style="top:${pctY(v).toFixed(2)}%">${v}</div>`).join("");
  const todayMarker = layout.todayOffset !== null ? `<div class="burnup-today-marker" style="left:${pct(layout.todayOffset).toFixed(2)}%" title="Today"></div>` : "";
  const endMarker = layout.endOffset !== null ? `<div class="burnup-milestone-marker" style="left:${pct(layout.endOffset).toFixed(2)}%" title="Sprint end date: ${esc(endDate)}"></div>` : "";
  return `<div class="burnup-chart" data-sprint-burnup="${sprintNumber}" data-burnup-points="${esc(JSON.stringify(points))}">
    <p class="visually-hidden">${esc(summary)}</p>
    <div class="burnup-legend"><span class="burnup-legend-scope">Scope</span><span class="burnup-legend-done">Done</span><span class="burnup-legend-today">Today</span><span class="burnup-legend-milestone">Sprint end date</span></div>
    <div class="burnup-plot">
      <svg viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" role="img" aria-label="${esc(summary)}"><title>${esc(summary)}</title>
        <path class="burnup-line-scope" d="${stepPath("scope")}${stub("scope")}" fill="none" vector-effect="non-scaling-stroke"></path>
        <path class="burnup-line-done" d="${stepPath("done")}${stub("done")}" fill="none" vector-effect="non-scaling-stroke"></path>
      </svg>
      ${todayMarker}${endMarker}${dot("burnup-dot-scope", "scope")}${dot("burnup-dot-done", "done")}
      <div class="burnup-yaxis">${yTicks}</div>
    </div>
    <div class="burnup-xaxis">${xTicks}</div>
  </div>`;
}

function sprintRow(s: SprintGroup, win: ReturnType<typeof sprintWindow>, w: Workspace, projectId: string, today: Date): string {
  const quotable = !s.architectureGap && !s.unestimated;
  const headroom = quotable ? (s.capacity - s.ied[1]).toFixed(2) : "—";
  const closed = !!win.closedAt;
  return `<div class="milestone-row" data-sprint="${s.sprint}">
    <div class="milestone-head"><strong>Sprint ${s.sprint}</strong>
    <input class="sprint-capacity" type="number" min="0" step="any" aria-label="Sprint ${s.sprint} capacity" value="${s.capacity}">
    <button type="button" class="subtle sprint-capacity-clear" aria-label="Use default capacity for sprint ${s.sprint}">Use default</button></div>
    <div class="milestone-meta"><span>${esc(sourceLabel(s.capacitySource))}</span><span>Load ${quotable ? `${formatRange(s.ied)} IED` : "not quotable"}</span><span>Headroom ${headroom}</span><span class="milestone-verdict${s.verdict !== "within" ? " planning-warning" : ""}">${verdictLabel(s.verdict)}</span></div>
    <label class="form-field"><span>Name</span><input class="sprint-name" aria-label="Sprint ${s.sprint} name" value="${esc(win.name)}" placeholder="Optional" ${closed ? "disabled" : ""}></label>
    <div class="form-row sprint-dates">
      <label class="form-field"><span>Start date</span><input class="sprint-start" aria-label="Sprint ${s.sprint} start date" type="date" value="${esc(win.startDate)}" ${closed ? "disabled" : ""}></label>
      <label class="form-field"><span>End date</span><input class="sprint-end" aria-label="Sprint ${s.sprint} end date" type="date" value="${esc(win.endDate)}" ${closed ? "disabled" : ""}></label>
    </div>
    <label class="form-field"><span>Scope</span><textarea class="sprint-scope" aria-label="Sprint ${s.sprint} scope" placeholder="What this sprint is for" ${closed ? "disabled" : ""}>${esc(win.scope)}</textarea></label>
    <table class="planning-table"><thead><tr><th>Card</th><th>IED</th><th>Sprint</th></tr></thead><tbody>${s.cards.map(({ card }) => `<tr data-card="${esc(card.id)}"><td>${esc(card.title)}</td><td>${cardLoad(card)}</td><td><input class="card-sprint" type="number" min="1" step="1" aria-label="Sprint for ${esc(card.title)}" value="${cardSprintNumber(card) ?? ""}"></td></tr>`).join("")}</tbody></table>
    ${closed
      ? `<p class="muted">Closed ${esc(new Date(win.closedAt!).toLocaleDateString())}${win.completedSummary ? ` — ${esc(win.completedSummary)}` : ""}</p>`
      : `<form class="sprint-close-form"><label class="form-field"><span>What was completed</span><textarea class="sprint-close-summary" aria-label="What was completed in sprint ${s.sprint}" placeholder="Summarize before closing"></textarea></label><button type="submit">Close sprint</button></form>`}
    ${sprintBurnupChart(s.sprint, win.startDate, win.endDate, closed, w, projectId, today)}
  </div>`;
}
function unassignedRow(card: Card): string {
  return `<div class="dialog-list" data-card="${esc(card.id)}"><span>${esc(card.title)} · ${cardLoad(card)}</span><input class="card-sprint" type="number" min="1" step="1" placeholder="Sprint" aria-label="Assign sprint for ${esc(card.title)}"></div>`;
}
export function mountSprints(root: HTMLElement, projectId: string, hooks: PlanningHooks) {
  function render() {
    const w = hooks.state();
    const { sprints, unassigned } = sprintBoard(w, projectId);
    const project = w.projects.find(p => p.id === projectId);
    const sprintWeeks = project?.planning?.sprintWeeks ?? 2;
    const metas = project?.sprints ?? [];
    const today = new Date();
    const anchor = sprintAnchorDate(w, projectId, today);
    root.innerHTML = `<p>Capacity, load (including module contingency) and headroom for each numbered sprint — a view over the cards on this board, not a second schedule. Changing a card's sprint here is the same edit as changing it from the card detail, and a card need not carry an IED estimate to belong to one. A sprint's capacity can be overridden here for holidays or lab weeks; clearing the override returns it to the project's derived or direct capacity. Dates default to consecutive ${sprintWeeks}-week windows and can be edited per sprint. Closing a sprint moves its unfinished cards to the next sprint and records what was completed.</p>
    <div id="sprint-list">${sprints.map(s => sprintRow(s, sprintWindow(metas, sprintWeeks, s.sprint, anchor), w, projectId, today)).join("") || '<p class="muted">No card carries a sprint number yet.</p>'}</div>
    <h3>Unassigned</h3><p class="muted">Estimated cards without a sprint number.</p>
    <div id="sprint-unassigned">${unassigned.length ? unassigned.map(unassignedRow).join("") : '<p class="muted">Nothing unassigned.</p>'}</div>`;
    for (const row of root.querySelectorAll<HTMLElement>("[data-sprint]")) {
      const sprint = Number(row.dataset.sprint);
      const capacity = row.querySelector<HTMLInputElement>(".sprint-capacity")!;
      capacity.onchange = () => { if (hooks.stage(w => setSprintOverride(w, projectId, sprint, Number(capacity.value)))) render(); };
      row.querySelector<HTMLButtonElement>(".sprint-capacity-clear")!.onclick = () => { if (hooks.stage(w => setSprintOverride(w, projectId, sprint, null))) render(); };
      const nameInput = row.querySelector<HTMLInputElement>(".sprint-name")!;
      nameInput.onchange = () => { if (hooks.stage(w => setSprintMeta(w, projectId, sprint, { name: nameInput.value }))) render(); };
      const startInput = row.querySelector<HTMLInputElement>(".sprint-start")!;
      startInput.onchange = () => { if (startInput.value && hooks.stage(w => setSprintMeta(w, projectId, sprint, { startDate: startInput.value }))) render(); };
      const endInput = row.querySelector<HTMLInputElement>(".sprint-end")!;
      endInput.onchange = () => { if (endInput.value && hooks.stage(w => setSprintMeta(w, projectId, sprint, { endDate: endInput.value }))) render(); };
      const scopeInput = row.querySelector<HTMLTextAreaElement>(".sprint-scope")!;
      scopeInput.onchange = () => { if (hooks.stage(w => setSprintMeta(w, projectId, sprint, { scope: scopeInput.value }))) render(); };
      const closeForm = row.querySelector<HTMLFormElement>(".sprint-close-form");
      closeForm?.addEventListener("submit", e => {
        e.preventDefault();
        const summary = row.querySelector<HTMLTextAreaElement>(".sprint-close-summary")!.value;
        if (hooks.stage(w => closeSprint(w, projectId, sprint, summary))) render();
      });
    }
    for (const el of root.querySelectorAll<HTMLElement>("[data-card]")) {
      const cardId = el.dataset.card!;
      const input = el.querySelector<HTMLInputElement>(".card-sprint")!;
      input.onchange = () => { if (hooks.stage(w => setCardSprint(w, cardId, input.value === "" ? null : Number(input.value)))) render(); };
    }
  }
  render();
}
