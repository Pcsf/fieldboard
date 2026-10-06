import { addMilestone, editMilestone, deleteMilestone, type Card, type Milestone, type Workspace } from "./model";
import { summarizeMilestones, type MilestoneSummary } from "./milestones";
import { milestoneBurnup, layoutBurnup, countTicks, burnupAxisTicks, type BurnupPoint } from "./burnup";
import { formatRange } from "./planning-ui";
import type { PlanningHooks } from "./planning-ui";
import { escapeHTML as esc } from "./markdown";

export function milestoneChip(card: Card, milestones: Milestone[] | undefined): string {
  const m = card.milestoneId ? milestones?.find(x => x.id === card.milestoneId) : undefined;
  return m ? `<span class="milestone-chip" aria-hidden="true" title="Milestone: ${esc(m.name)} (${esc(m.date)})">◆ ${esc(m.name)}</span>` : "";
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
const CHART_W = 1000; const CHART_H = 200; const PAD_Y = 16;
function burnupSummaryText(last: BurnupPoint): string {
  const remaining = last.scope - last.done;
  const s = (n: number) => n === 1 ? "" : "s";
  return `Scope ${last.scope} card${s(last.scope)}, ${last.done} done, ${remaining} remaining`;
}
// Pure data in, markup out: milestoneBurnup/layoutBurnup already did the model and day-unit work;
// this only turns day offsets and counts into percentages, reusing the day-axis tick rule timeline-view
// already established. Step paths read directly from the daily series, so a drawn point and a model
// point are the same number — no separate chart-side rounding to drift out of sync with it.
function burnupChart(milestone: Milestone, w: Workspace, today: Date): string {
  const points = milestoneBurnup(w, milestone.id, today);
  if (!points.length) {
    return `<div class="burnup-chart" data-milestone-burnup="${esc(milestone.id)}"><p class="muted">No card has carried this milestone yet.</p></div>`;
  }
  const layout = layoutBurnup(points, milestone.date, today);
  const last = points.at(-1)!;
  const summary = burnupSummaryText(last);
  const days = layout.days;
  const x = (offset: number) => days <= 1 ? 0 : (offset / (days - 1)) * CHART_W;
  const y = (v: number) => CHART_H - PAD_Y - (v / layout.maxValue) * (CHART_H - 2 * PAD_Y);
  const pct = (offset: number) => days <= 1 ? 0 : (offset / (days - 1)) * 100;
  const pctY = (v: number) => (y(v) / CHART_H) * 100;
  const stepPath = (key: "scope" | "done") => {
    let d = `M ${x(0).toFixed(1)} ${y(points[0]![key]).toFixed(1)}`;
    for (let i = 1; i < points.length; i++) d += ` H ${x(i).toFixed(1)} V ${y(points[i]![key]).toFixed(1)}`;
    return d;
  };
  // A dot at today's value on each line makes the chart legible even for a single-day series, whose
  // step path alone would otherwise be a zero-length "moveto" with nothing visibly drawn.
  const dot = (cls: string, key: "scope" | "done") =>
    `<div class="burnup-dot ${cls}" style="left:${pct(layout.todayOffset).toFixed(2)}%;top:${pctY(last[key]).toFixed(2)}%"></div>`;
  const xTicks = burnupAxisTicks(layout.rangeStart, Math.max(days, 1)).map(t =>
    `<div class="burnup-xaxis-tick" style="left:${pct(t.offset).toFixed(2)}%">${esc(t.label)}</div>`).join("");
  const yTicks = countTicks(layout.maxValue).map(v =>
    `<div class="burnup-yaxis-tick" style="top:${pctY(v).toFixed(2)}%">${v}</div>`).join("");
  // Today and the milestone date use colours neither line uses (not --accent, which the done line and
  // progress bar already carry) so a marker is never confused with a series or with the other marker.
  const todayMarker = `<div class="burnup-today-marker" style="left:${pct(layout.todayOffset).toFixed(2)}%" title="Today"></div>`;
  const milestoneMarker = layout.milestoneOffset !== null
    ? `<div class="burnup-milestone-marker" style="left:${pct(layout.milestoneOffset).toFixed(2)}%" title="Milestone date: ${esc(milestone.date)}"></div>` : "";
  return `<div class="burnup-chart" data-milestone-burnup="${esc(milestone.id)}" data-burnup-points="${esc(JSON.stringify(points))}">
    <p class="visually-hidden">${esc(summary)}</p>
    <div class="burnup-legend">
      <span class="burnup-legend-scope">Scope</span><span class="burnup-legend-done">Done</span>
      <span class="burnup-legend-today">Today</span><span class="burnup-legend-milestone">Milestone date</span>
    </div>
    <div class="burnup-plot">
      <svg viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" role="img" aria-label="${esc(summary)}"><title>${esc(summary)}</title>
        <path class="burnup-line-scope" d="${stepPath("scope")}" fill="none" vector-effect="non-scaling-stroke"></path>
        <path class="burnup-line-done" d="${stepPath("done")}" fill="none" vector-effect="non-scaling-stroke"></path>
      </svg>
      ${todayMarker}${milestoneMarker}${dot("burnup-dot-scope", "scope")}${dot("burnup-dot-done", "done")}
      <div class="burnup-yaxis">${yTicks}</div>
    </div>
    <div class="burnup-xaxis">${xTicks}</div>
  </div>`;
}
function row(s: MilestoneSummary, w: Workspace, today: Date): string {
  const pct = s.totalCards ? Math.round(s.doneCards / s.totalCards * 100) : 0;
  const effort = `${formatRange(s.remaining)} IED${s.unestimatedCount ? ` + ${s.unestimatedCount} unestimated` : ""}`;
  const warn = s.verdict === "Fits" ? "" : " planning-warning";
  return `<div class="milestone-row" data-milestone="${esc(s.milestone.id)}">
    <div class="milestone-head"><input class="milestone-name" aria-label="Milestone name" value="${esc(s.milestone.name)}">
    <input class="milestone-date" aria-label="Milestone date" type="date" value="${esc(s.milestone.date)}">
    <button type="button" class="danger milestone-delete" aria-label="Delete milestone ${esc(s.milestone.name)}">Delete</button></div>
    <textarea class="milestone-description" aria-label="Milestone description" placeholder="Optional description">${esc(s.milestone.description)}</textarea>
    <div class="milestone-meta"><span>${esc(dueLabel(s.daysRemaining))}</span><span>${s.doneCards}/${s.totalCards} cards done</span><span>${esc(effort)}</span><span class="milestone-verdict${warn}">${esc(s.verdict)}</span></div>
    <div class="progress"><i style="width:${pct}%"></i></div>
    ${burnupChart(s.milestone, w, today)}</div>`;
}
export function mountMilestones(root: HTMLElement, projectId: string, hooks: PlanningHooks) {
  function render() {
    const w = hooks.state();
    const today = new Date();
    const summaries = summarizeMilestones(w, projectId);
    root.innerHTML = `<p>A milestone is a dated outcome a card can belong to. This view is a capacity check against the project's planning settings, not a delivery schedule: the board stays pull-based and nothing here reorders a card or sets its date. The fit check adds module contingency, as sprint loads do; platform overheads are not assigned to milestones.</p>
    <form id="milestone-form" class="form-row"><input id="milestone-name-input" aria-label="New milestone name" placeholder="Milestone name" required><input id="milestone-date-input" aria-label="New milestone date" type="date" required><button type="submit">Add milestone</button></form>
    <div id="milestone-list">${summaries.map(s => row(s, w, today)).join("") || '<p class="muted">No milestones yet.</p>'}</div>`;
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
