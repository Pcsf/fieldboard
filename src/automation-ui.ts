import { addRule, toggleRule, deleteRule, setAutoArchiveDays, ruleKinds, DEFAULT_OVERDUE_LABEL, type Rule, type RuleKind } from "./automation";
import type { PlanningHooks } from "./planning-ui";
import { escapeHTML as esc } from "./markdown";
import type { Member, Workspace } from "./model";

function columnsOf(w: Workspace, boardId: string) { return w.columns.filter(c => c.boardId === boardId).sort((a, b) => a.position - b.position); }

const kindLabel: Record<RuleKind, string> = {
  "enter-check-subtasks": "Entering a column: check all subtasks",
  "enter-assign-member": "Entering a column: assign a member",
  "overdue-label": "Overdue: add a label",
};
function ruleDescription(rule: Rule, w: Workspace, boardId: string): string {
  if (rule.kind === "enter-check-subtasks") {
    const col = columnsOf(w, boardId).find(c => c.id === rule.columnId);
    return `When a card enters “${col?.name ?? "a deleted column"}”, check all its subtasks`;
  }
  if (rule.kind === "enter-assign-member") {
    const col = columnsOf(w, boardId).find(c => c.id === rule.columnId);
    const member = w.members.find(m => m.id === rule.memberId);
    return `When a card enters “${col?.name ?? "a deleted column"}”, assign ${member?.name ?? "a removed member"}`;
  }
  return `When a card is overdue, add the label “${rule.labelName}”`;
}
function newRuleFields(kind: RuleKind, columns: { id: string; name: string }[], members: Member[]): string {
  const columnField = `<label class="form-field"><span>Column</span><select id="rule-column" aria-label="New rule column">${columns.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></label>`;
  if (kind === "enter-check-subtasks") return columnField;
  if (kind === "enter-assign-member") return `${columnField}<label class="form-field"><span>Assign</span><select id="rule-member" aria-label="New rule member">${members.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</select></label>`;
  return `<label class="form-field"><span>Label name</span><input id="rule-label" aria-label="New rule label name" value="${esc(DEFAULT_OVERDUE_LABEL)}" required></label>`;
}

export function mountAutomation(root: HTMLElement, boardId: string, hooks: PlanningHooks) {
  let newKind: RuleKind = "enter-check-subtasks";
  function render() {
    const w = hooks.state();
    const board = w.boards.find(b => b.id === boardId);
    if (!board) { root.innerHTML = '<p class="muted">Board not found.</p>'; return; }
    const columns = columnsOf(w, boardId);
    const rules = board.rules ?? [];
    root.innerHTML = `
      <p>Rules and auto-archive run only while this file is open: on launch, about once a minute while it stays open, and right away when a card moves through the board. There is no background service -- anything missed while it was closed is reconciled the next time it opens.</p>
      <label class="form-field"><span>Archive done cards after · days</span><input id="auto-archive-days" aria-label="Archive done cards after N days" type="number" min="1" step="1" placeholder="Off" value="${board.autoArchiveDays ?? ""}"></label>
      <small>Counts days since a card was marked done in one of this board's done columns. Archived cards stay restorable from Archive; restoring one resets the clock to today.</small>
      <div class="section-label">RULES</div>
      <div id="rule-list">${rules.length ? rules.map(r => `<div class="dialog-list" data-rule="${esc(r.id)}">
        <label class="checkbox-label"><input type="checkbox" class="rule-enabled" ${r.enabled ? "checked" : ""} aria-label="Enabled: ${esc(ruleDescription(r, w, boardId))}">${esc(ruleDescription(r, w, boardId))}</label>
        <button type="button" class="danger rule-delete" aria-label="Delete rule: ${esc(ruleDescription(r, w, boardId))}">Delete</button></div>`).join("") : '<p class="muted">No rules yet.</p>'}</div>
      <form id="rule-form">
        <label class="form-field"><span>New rule</span><select id="rule-kind" aria-label="New rule kind">${ruleKinds.map(k => `<option value="${k}" ${k === newKind ? "selected" : ""}>${esc(kindLabel[k])}</option>`).join("")}</select></label>
        ${newRuleFields(newKind, columns, w.members)}
        <div class="dialog-actions"><button type="submit" class="primary">Add rule</button></div>
      </form>`;
    root.querySelector<HTMLSelectElement>("#rule-kind")!.onchange = e => { newKind = (e.target as HTMLSelectElement).value as RuleKind; render(); };
    root.querySelector<HTMLFormElement>("#rule-form")!.onsubmit = e => {
      e.preventDefault();
      if (newKind === "enter-check-subtasks") {
        const columnId = root.querySelector<HTMLSelectElement>("#rule-column")!.value;
        if (hooks.stage(w2 => addRule(w2, boardId, { kind: "enter-check-subtasks", enabled: true, columnId }))) render();
      } else if (newKind === "enter-assign-member") {
        const columnId = root.querySelector<HTMLSelectElement>("#rule-column")!.value;
        const memberId = root.querySelector<HTMLSelectElement>("#rule-member")!.value;
        if (hooks.stage(w2 => addRule(w2, boardId, { kind: "enter-assign-member", enabled: true, columnId, memberId }))) render();
      } else {
        const labelName = root.querySelector<HTMLInputElement>("#rule-label")!.value.trim() || DEFAULT_OVERDUE_LABEL;
        if (hooks.stage(w2 => addRule(w2, boardId, { kind: "overdue-label", enabled: true, labelName }))) render();
      }
    };
    for (const row of root.querySelectorAll<HTMLElement>("[data-rule]")) {
      const ruleId = row.dataset.rule!;
      row.querySelector<HTMLInputElement>(".rule-enabled")!.onchange = e => { hooks.stage(w2 => toggleRule(w2, boardId, ruleId, (e.target as HTMLInputElement).checked)); };
      row.querySelector<HTMLButtonElement>(".rule-delete")!.onclick = () => { if (confirm("Delete this rule?") && hooks.stage(w2 => deleteRule(w2, boardId, ruleId))) render(); };
    }
    const daysInput = root.querySelector<HTMLInputElement>("#auto-archive-days")!;
    const daysKey = `automation:${boardId}:autoArchiveDays`;
    const daysDraft = hooks.draft(daysKey); if (daysDraft !== undefined) daysInput.value = daysDraft;
    daysInput.addEventListener("input", () => hooks.retain(daysKey, daysInput.value));
    daysInput.onchange = () => {
      const raw = daysInput.value; if (!hooks.retain(daysKey, raw)) return;
      const value = raw === "" ? null : Number(raw);
      if (hooks.stage(w2 => setAutoArchiveDays(w2, boardId, value))) { hooks.error(daysKey, ""); void hooks.clear(daysKey, raw); }
      else hooks.error(daysKey, "Auto-archive days was not accepted. Use a positive whole number or leave it empty.");
    };
  }
  render();
}
