import { startTimer, stopTimer, addManualEntry, deleteEntry, totalTrackedMs, formatDuration, runningEntry, type TimeEntry } from "./time-tracking";
import type { Card } from "./model";
import { escapeHTML as esc } from "./markdown";
import type { PlanningHooks } from "./planning-ui";

// Used by the card face: a small badge only when there is something to show, so a card that has
// never been timed carries no new visual weight. Cost is proportional to this card's own entries
// only -- never a scan of other cards (see DECISIONS "Time tracking").
export function timeBadge(c: Card): string {
  const entries = c.timeEntries ?? []; const running = runningEntry(entries);
  const total = totalTrackedMs(entries);
  if (!running && total === 0) return "";
  const label = running ? `Running · ${formatDuration(total)}` : formatDuration(total);
  return `<span class="time-badge${running ? " running" : ""}" aria-hidden="true" title="Time tracked: ${esc(label)}">⏱ ${esc(label)}</span>`;
}
// Used in the card detail sidebar, next to the Estimate field.
export function trackedTotalText(c: Card): string {
  const entries = c.timeEntries ?? []; const total = totalTrackedMs(entries);
  return total === 0 ? "No time tracked yet" : `Tracked: ${formatDuration(total)}`;
}

function parseDuration(raw: string): number | null {
  const text = raw.trim();
  const hm = /^(\d+):([0-5]?\d)$/.exec(text);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text));
  return null;
}
function entryRow(e: TimeEntry): string {
  const start = new Date(e.start); const duration = e.end !== null ? formatDuration(totalTrackedMs([e])) : "running";
  return `<div class="time-entry" data-entry="${esc(e.id)}"><span class="time-entry-when">${esc(start.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}</span><span class="time-entry-duration">${esc(duration)}</span><span class="time-entry-note">${esc(e.note ?? "")}</span><button type="button" class="danger" data-delete-entry="${esc(e.id)}" aria-label="Delete time entry">×</button></div>`;
}
export function mountTimeTracking(root: HTMLElement, cardId: string, hooks: PlanningHooks) {
  let ticker: ReturnType<typeof setInterval> | undefined;
  function render() {
    const card = hooks.state().cards.find(c => c.id === cardId); if (!card) return;
    const entries = (card.timeEntries ?? []).slice().sort((a, b) => a.start.localeCompare(b.start));
    const running = runningEntry(entries);
    root.innerHTML = `<h3>Time tracking</h3>
      <div class="time-controls"><button type="button" id="time-toggle" class="${running ? "danger" : ""}">${running ? "Stop timer" : "Start timer"}</button><span id="time-running-elapsed" class="muted">${running ? `Running · ${esc(formatDuration(totalTrackedMs(entries)))}` : ""}</span></div>
      <div class="time-entries">${entries.length ? entries.map(entryRow).join("") : '<p class="empty-detail">No time entries yet.</p>'}</div>
      <form id="time-entry-form" class="time-entry-form">
        <label class="form-field"><span>Date</span><input type="date" id="time-entry-date" aria-label="Entry date" required></label>
        <label class="form-field"><span>Duration · minutes or h:mm</span><input id="time-entry-duration" aria-label="Entry duration" placeholder="90 or 1:30" required></label>
        <label class="form-field"><span>Note · optional</span><input id="time-entry-note" aria-label="Entry note"></label>
        <button type="submit">Add entry</button>
      </form><p class="time-entry-error muted"></p>`;
    const toggle = root.querySelector<HTMLButtonElement>("#time-toggle")!;
    toggle.onclick = () => {
      const ok = running ? hooks.stage(w => stopTimer(w, cardId)) : hooks.stage(w => startTimer(w, cardId));
      if (ok) render(); else root.querySelector(".time-entry-error")!.textContent = "That timer action was not accepted. See the storage error.";
    };
    root.querySelectorAll<HTMLButtonElement>("[data-delete-entry]").forEach(b => b.onclick = () => {
      if (hooks.stage(w => deleteEntry(w, cardId, b.dataset.deleteEntry!))) render();
    });
    const form = root.querySelector<HTMLFormElement>("#time-entry-form")!;
    const errorEl = root.querySelector<HTMLElement>(".time-entry-error")!;
    form.onsubmit = e => {
      e.preventDefault();
      const date = root.querySelector<HTMLInputElement>("#time-entry-date")!.value;
      const durationRaw = root.querySelector<HTMLInputElement>("#time-entry-duration")!.value;
      const note = root.querySelector<HTMLInputElement>("#time-entry-note")!.value;
      const minutes = parseDuration(durationRaw);
      if (!date || minutes === null || minutes <= 0) { errorEl.textContent = "Enter a date and a positive duration (minutes, or h:mm)."; return; }
      const start = new Date(`${date}T09:00:00`); const end = new Date(start.getTime() + minutes * 60_000);
      if (hooks.stage(w => addManualEntry(w, cardId, start.toISOString(), end.toISOString(), note))) { errorEl.textContent = ""; render(); }
      else errorEl.textContent = "That entry overlaps another, or was otherwise not accepted. See the storage error.";
    };
    clearInterval(ticker);
    // Live elapsed readout while a timer runs, updated in place every few seconds -- never a full
    // re-render, so it never disturbs drafts, scroll position or the rest of the open dialog.
    if (running) ticker = setInterval(() => {
      const live = root.querySelector<HTMLElement>("#time-running-elapsed");
      if (!live) { clearInterval(ticker); return; }
      live.textContent = `Running · ${formatDuration(totalTrackedMs(entries))}`;
    }, 5000);
  }
  render();
  return { stop: () => clearInterval(ticker) };
}
