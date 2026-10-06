import { editCard, type Card } from "./model";
import { frequencies, todayCalendarDate, type Frequency, type Recurrence } from "./recurring";
import { escapeHTML as esc } from "./markdown";
import type { PlanningHooks } from "./planning-ui";

export function recurrenceChip(card: Card): string {
  if (!card.recurrence) return "";
  const label = card.recurrence.frequency[0]!.toUpperCase() + card.recurrence.frequency.slice(1);
  return `<span class="recurrence-chip" aria-hidden="true" title="Recurs ${esc(card.recurrence.frequency)}, next on ${esc(card.recurrence.next)}">↻ ${esc(label)}</span>`;
}

export function mountRecurrence(root: HTMLElement, cardId: string, hooks: PlanningHooks, columns: { id: string; label: string }[]) {
  function render() {
    const card = hooks.state().cards.find(c => c.id === cardId); if (!card) return;
    const r = card.recurrence;
    if (!columns.length) { root.innerHTML = `<h3>Recurrence</h3><p class="muted">This project has no column to regenerate into yet.</p>`; return; }
    if (!r) {
      root.innerHTML = `<h3>Recurrence</h3><p class="empty-detail">Regenerate this card daily, weekly or monthly into a chosen column. The copy carries the title, description, labels, priority, assignees and unchecked subtasks; comments, attachments, time entries and the recurrence itself never carry over.</p><button type="button" id="recurrence-start">Make this card recurring</button>`;
      root.querySelector<HTMLButtonElement>("#recurrence-start")!.onclick = () => {
        if (hooks.stage(w => editCard(w, cardId, { recurrence: { frequency: "weekly", columnId: columns[0]!.id, next: todayCalendarDate() } }))) render();
      };
      return;
    }
    root.innerHTML = `<h3>Recurrence</h3>
      <label class="form-field"><span>Frequency</span><select id="recurrence-frequency" aria-label="Recurrence frequency">${frequencies.map(f => `<option value="${f}" ${f === r.frequency ? "selected" : ""}>${f[0]!.toUpperCase()}${f.slice(1)}</option>`).join("")}</select></label>
      <label class="form-field"><span>Generates into</span><select id="recurrence-column" aria-label="Recurrence column">${columns.map(c => `<option value="${esc(c.id)}" ${c.id === r.columnId ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>
      <label class="form-field"><span>Next occurrence</span><input type="date" id="recurrence-next" aria-label="Next occurrence date" value="${esc(r.next)}"></label>
      <button type="button" id="recurrence-remove" class="danger">Remove recurrence</button>`;
    const commit = (patch: Partial<Recurrence>) => { if (hooks.stage(w => editCard(w, cardId, { recurrence: { ...r, ...patch } }))) render(); };
    root.querySelector<HTMLSelectElement>("#recurrence-frequency")!.onchange = e => commit({ frequency: (e.target as HTMLSelectElement).value as Frequency });
    root.querySelector<HTMLSelectElement>("#recurrence-column")!.onchange = e => commit({ columnId: (e.target as HTMLSelectElement).value });
    root.querySelector<HTMLInputElement>("#recurrence-next")!.onchange = e => { const v = (e.target as HTMLInputElement).value; if (v) commit({ next: v }); };
    root.querySelector<HTMLButtonElement>("#recurrence-remove")!.onclick = () => { if (hooks.stage(w => editCard(w, cardId, { recurrence: undefined }))) render(); };
  }
  render();
}
