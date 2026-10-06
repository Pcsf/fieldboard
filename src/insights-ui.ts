import type { Activity, Board, Card, Column, Workspace } from "./model";
import { cfdSeries, cfdBands, sliceCfdRange, type CfdRangeDays } from "./cfd";
import { boardCycleStats, type TimeDistribution } from "./cycletime";
import { weeklyThroughput } from "./throughput";
import { countTicks, burnupAxisTicks } from "./burnup";
import { escapeHTML as esc } from "./markdown";

export interface InsightsDeps {
  workspace(): Workspace;
  board(): Board | undefined;
  columns(): Column[];
  cards(): Card[]; // the current board's cards, archived included, deleted excluded
  openCard(cardId: string): void;
}

const rangeOptions: { value: string; label: string; days: CfdRangeDays }[] = [
  { value: "14", label: "14 days", days: 14 },
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "90 days", days: 90 },
  { value: "all", label: "All time", days: null },
];
let rangeValue = "30";

const CHART_COLORS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6", "chart-7", "chart-8"];
function bandColor(index: number): string { return `var(--${CHART_COLORS[index % CHART_COLORS.length]})`; }

function cfdSummaryText(bandsWithLabels: { label: string; count: number }[], total: number): string {
  const parts = bandsWithLabels.filter(b => b.count > 0).map(b => `${b.label} ${b.count}`).join(", ");
  return `Cumulative flow, today: ${total} card${total === 1 ? "" : "s"} total${parts ? ` — ${parts}` : ""}`;
}

function cfdChart(w: Workspace, board: Board, columns: Column[], rangeDays: CfdRangeDays): string {
  const full = cfdSeries(w, board.id, new Date());
  if (!full.length) return `<p class="muted">No card has been on this board yet.</p>`;
  const points = sliceCfdRange(full, rangeDays);
  const bands = cfdBands(columns);
  const maxValue = Math.max(1, ...points.map(p => bands.reduce((sum, b) => sum + (b.columnId === null ? p.removed : p.byColumn[b.columnId] ?? 0), 0)));
  const last = points.at(-1)!;
  const lastByBand = bands.map(b => ({ label: b.label, count: b.columnId === null ? last.removed : last.byColumn[b.columnId] ?? 0 }));
  const lastTotal = lastByBand.reduce((s, b) => s + b.count, 0);
  const summary = cfdSummaryText(lastByBand, lastTotal);

  const legend = bands.map((b, i) => {
    const color = b.columnId === null ? "var(--chart-removed)" : bandColor(i - 1);
    return `<span style="--cfd-swatch:${color}">${esc(b.label)}</span>`;
  }).join("");

  const dayCols = points.map((p, dayIdx) => {
    const segs = bands.map((b, i) => {
      const count = b.columnId === null ? p.removed : p.byColumn[b.columnId] ?? 0;
      if (!count) return "";
      const color = b.columnId === null ? "var(--chart-removed)" : bandColor(i - 1);
      const heightPct = (count / maxValue) * 100;
      const last = dayIdx === points.length - 1;
      return `<div class="cfd-seg" style="--cfd-swatch:${color};height:${heightPct.toFixed(2)}%"${last ? ` data-cfd-day="last" data-band="${esc(b.key)}" data-count="${count}"` : ""}></div>`;
    }).join("");
    return `<div class="cfd-day" title="${esc(p.date)}">${segs}</div>`;
  }).join("");

  const yTicks = countTicks(maxValue).map(v => `<div class="cfd-yaxis-tick" style="bottom:${((v / maxValue) * 100).toFixed(2)}%">${v}</div>`).join("");
  const xTicks = burnupAxisTicks(points[0]!.date, points.length).map(t =>
    `<div class="cfd-xaxis-tick" style="left:${points.length <= 1 ? 0 : (t.offset / (points.length - 1)) * 100}%">${esc(t.label)}</div>`).join("");

  return `<div data-cfd-chart="${esc(board.id)}">
    <p class="visually-hidden">${esc(summary)}</p>
    <div class="cfd-legend">${legend}</div>
    <div class="cfd-plot" role="img" aria-label="${esc(summary)}"><title>${esc(summary)}</title>
      ${dayCols}
      <div class="cfd-yaxis">${yTicks}</div>
    </div>
    <div class="cfd-xaxis">${xTicks}</div>
  </div>`;
}

function distributionStrip(kind: "lead" | "cycle", dist: TimeDistribution): string {
  if (!dist.count) return `<p class="muted">No card completed in this range yet.</p>`;
  const max = Math.max(1, ...dist.samples);
  const dots = dist.samples.map(v => `<div class="insights-dist-dot ${kind}" style="left:${((v / max) * 100).toFixed(2)}%" title="${v.toFixed(1)} days"></div>`).join("");
  const median = dist.medianDays!, p85 = dist.p85Days!;
  const summary = `${dist.count} card${dist.count === 1 ? "" : "s"}, median ${median.toFixed(1)} days, 85th percentile ${p85.toFixed(1)} days`;
  return `<p class="visually-hidden">${esc(summary)}</p>
  <div class="insights-dist" role="img" aria-label="${esc(summary)}" data-dist="${kind}" data-median="${median.toFixed(2)}" data-p85="${p85.toFixed(2)}" data-count="${dist.count}">
    <div class="insights-dist-marker median" style="left:${((median / max) * 100).toFixed(2)}%" title="Median: ${median.toFixed(1)} days"></div>
    <div class="insights-dist-marker p85" style="left:${((p85 / max) * 100).toFixed(2)}%" title="85th percentile: ${p85.toFixed(1)} days"></div>
    ${dots}
  </div>
  <div class="insights-dist-axis"><span>0 days</span><span>${max.toFixed(1)} days</span></div>`;
}

function cycleTimeCard(cards: Card[], activitiesByCard: Map<string, Activity[]>, columns: Column[], rangeDays: number | null): string {
  const stats = boardCycleStats(cards, activitiesByCard, columns, rangeDays, new Date());
  const stat = (label: string, d: TimeDistribution) => `<div class="insights-stat"><strong>${d.medianDays !== null ? d.medianDays.toFixed(1) : "—"}</strong>${esc(label)} median (days), 85th: ${d.p85Days !== null ? d.p85Days.toFixed(1) : "—"}, n=${d.count}</div>`;
  return `<div class="insights-stats">${stat("Lead time", stats.lead)}${stat("Cycle time", stats.cycle)}</div>
  <p class="insights-unit">Lead time: created → done. Cycle time: left the first column → done.</p>
  <p class="muted" style="font-size:11px;margin:0 0 4px">Lead time distribution</p>${distributionStrip("lead", stats.lead)}
  <p class="muted" style="font-size:11px;margin:12px 0 4px">Cycle time distribution</p>${distributionStrip("cycle", stats.cycle)}`;
}

function throughputChart(cards: Card[]): string {
  const weeks = weeklyThroughput(cards, 12, new Date());
  const max = Math.max(1, ...weeks.map(w => w.count));
  const total = weeks.reduce((s, w) => s + w.count, 0);
  const fmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
  const bars = weeks.map(w => {
    const heightPct = (w.count / max) * 100;
    return `<div class="throughput-bar-col"><div class="throughput-bar" style="height:${w.count ? heightPct.toFixed(2) : 0}%" data-week="${esc(w.weekStart)}" data-count="${w.count}" title="${esc(w.weekStart)}: ${w.count} card${w.count === 1 ? "" : "s"}"></div><span class="throughput-label">${esc(fmt.format(new Date(`${w.weekStart}T12:00:00`)))}</span></div>`;
  }).join("");
  const summary = `Throughput, last 12 weeks: ${total} card${total === 1 ? "" : "s"} completed`;
  return `<p class="visually-hidden">${esc(summary)}</p>
  <div class="throughput-plot" role="img" aria-label="${esc(summary)}" data-throughput>${bars}</div>
  ${total ? "" : '<p class="muted">No card completed in the last 12 weeks.</p>'}`;
}

export function mountInsights(root: HTMLElement, deps: InsightsDeps) {
  const w = deps.workspace(); const board = deps.board();
  if (!board) { root.innerHTML = `<p class="muted">Select a board to see its insights.</p>`; return; }
  const columns = deps.columns(); const cards = deps.cards();
  const activitiesByCard = new Map<string, Activity[]>();
  for (const a of w.activities) { const list = activitiesByCard.get(a.cardId); if (list) list.push(a); else activitiesByCard.set(a.cardId, [a]); }
  const option = rangeOptions.find(o => o.value === rangeValue) ?? rangeOptions[1]!;

  root.innerHTML = `<div class="insights-toolbar"><label>Range
    <select id="insights-range" aria-label="Insights time range">${rangeOptions.map(o => `<option value="${o.value}"${o.value === rangeValue ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>
  </label></div>
  <div class="insights-card"><h2>Cumulative flow</h2><p class="insights-unit">Cards per column, per day (units: cards)</p>
    ${cfdChart(w, board, columns, option.days)}
  </div>
  <div class="insights-card"><h2>Lead and cycle time</h2><p class="insights-unit">Cards completed in the selected range (units: days)</p>
    ${cycleTimeCard(cards, activitiesByCard, columns, option.days)}
  </div>
  <div class="insights-card"><h2>Throughput</h2><p class="insights-unit">Cards completed per week, last 12 weeks (units: cards)</p>
    ${throughputChart(cards)}
  </div>`;
  root.querySelector<HTMLSelectElement>("#insights-range")!.onchange = e => { rangeValue = (e.target as HTMLSelectElement).value; mountInsights(root, deps); };
}
