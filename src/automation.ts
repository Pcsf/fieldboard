import { editCard, archiveCard, resolveLabels, id, type Board, type Card, type Project, type Workspace } from "./model";
import { todayCalendarDate } from "./recurring";

export const ruleKinds = ["enter-check-subtasks", "enter-assign-member", "overdue-label"] as const;
export type RuleKind = typeof ruleKinds[number];
export const DEFAULT_OVERDUE_LABEL = "late";

export interface EnterCheckSubtasksRule { id: string; kind: "enter-check-subtasks"; enabled: boolean; columnId: string }
export interface EnterAssignMemberRule { id: string; kind: "enter-assign-member"; enabled: boolean; columnId: string; memberId: string }
export interface OverdueLabelRule { id: string; kind: "overdue-label"; enabled: boolean; labelName: string }
export type Rule = EnterCheckSubtasksRule | EnterAssignMemberRule | OverdueLabelRule;

// Shape only, like validateRecurrence -- relational checks (the column/member actually exist on this
// board) belong to validateWorkspace, which is the only place with the full members/columns lists.
export function validateRule(value: unknown): asserts value is Rule {
  if (!value || typeof value !== "object") throw new Error("Invalid rule");
  const r = value as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id.trim()) throw new Error("Rule requires an id");
  if (typeof r.enabled !== "boolean") throw new Error("Rule requires an enabled flag");
  if (!ruleKinds.includes(r.kind as RuleKind)) throw new Error("Invalid rule kind");
  if (r.kind === "enter-check-subtasks") {
    if (typeof r.columnId !== "string" || !r.columnId.trim()) throw new Error("Rule requires a column");
  } else if (r.kind === "enter-assign-member") {
    if (typeof r.columnId !== "string" || !r.columnId.trim()) throw new Error("Rule requires a column");
    if (typeof r.memberId !== "string" || !r.memberId.trim()) throw new Error("Rule requires a member");
  } else {
    if (typeof r.labelName !== "string" || !r.labelName.trim()) throw new Error("Rule requires a label name");
  }
}

function findBoard(w: Workspace, boardId: string): Board {
  const board = w.boards.find(b => b.id === boardId); if (!board) throw new Error("Board not found"); return board;
}

// A plain Omit<Rule, "id"> collapses the discriminated union to its common keys (kind, enabled) --
// this distributes it over each variant first, so columnId/memberId/labelName stay available per kind.
type NewRule = { [K in Rule["kind"]]: Omit<Extract<Rule, { kind: K }>, "id"> }[Rule["kind"]];
export function addRule(w: Workspace, boardId: string, rule: NewRule): Rule {
  const board = findBoard(w, boardId);
  const created = { ...rule, id: id() } as Rule;
  board.rules = [...(board.rules ?? []), created];
  return created;
}
export function toggleRule(w: Workspace, boardId: string, ruleId: string, enabled: boolean) {
  const board = findBoard(w, boardId);
  const rule = (board.rules ?? []).find(r => r.id === ruleId); if (!rule) throw new Error("Rule not found");
  rule.enabled = enabled;
}
export function deleteRule(w: Workspace, boardId: string, ruleId: string) {
  const board = findBoard(w, boardId);
  if (!(board.rules ?? []).some(r => r.id === ruleId)) throw new Error("Rule not found");
  board.rules = (board.rules ?? []).filter(r => r.id !== ruleId);
}
export function setAutoArchiveDays(w: Workspace, boardId: string, days: number | null) {
  const board = findBoard(w, boardId);
  if (days !== null && (!Number.isInteger(days) || days < 1)) throw new Error("Auto-archive days must be a positive whole number");
  board.autoArchiveDays = days;
}

// --- Event rules: a card entering a column, by any path -------------------------------------------
//
// Called once per (cardId, enteredColumnId) pair from the single app-layer choke point (see
// applyAutomation below), never recursively from inside a rule's own effect -- the effects below only
// ever touch subtasks/assignees, never columnId, so a rule cannot cause a card to "enter" any column
// and therefore cannot retrigger itself or another entry rule. That absence of a columnId write is the
// loop guard; there is no counter or recursion depth to maintain.
export function runEntryRules(w: Workspace, cardId: string, columnId: string) {
  const column = w.columns.find(c => c.id === columnId); if (!column) return;
  const board = w.boards.find(b => b.id === column.boardId); if (!board) return;
  const card = w.cards.find(c => c.id === cardId); if (!card) return;
  for (const rule of board.rules ?? []) {
    if (!rule.enabled) continue;
    if (rule.kind === "enter-check-subtasks" && rule.columnId === columnId) {
      if (card.subtasks.some(s => !s.done)) {
        editCard(w, cardId, { subtasks: card.subtasks.map(s => ({ ...s, done: true })) }, `rule: entering ${column.name} checks all subtasks`);
      }
    } else if (rule.kind === "enter-assign-member" && rule.columnId === columnId) {
      const member = w.members.find(m => m.id === rule.memberId);
      if (member && !card.assignees.includes(rule.memberId)) {
        editCard(w, cardId, { assignees: [...card.assignees, rule.memberId] }, `rule: entering ${column.name} assigns ${member.name}`);
      }
    }
  }
}

// Diffs columnId before/after the triggering mutation and runs entry rules for every card that moved
// (including a brand-new card: "entering" covers quick-add and create-from-template too). This is the
// one place every move path funnels through -- drag, move menu, keyboard, bulk move, board move,
// column-delete relocation and quick-add all call app.ts's `stage()`, which wraps its callback here --
// so no individual call site has to remember to fire rules. The fast path below skips the O(cards)
// column-tracking map entirely when no board has an enabled entry rule, which keeps the common,
// rule-free case at the same cost as before this feature existed.
export function applyAutomation(w: Workspace, fn: (w: Workspace) => unknown) {
  const hasEntryRules = w.boards.some(b => (b.rules ?? []).some(r => r.enabled && r.kind !== "overdue-label"));
  if (!hasEntryRules) { fn(w); return; }
  const before = new Map(w.cards.map(c => [c.id, c.columnId]));
  fn(w);
  const evaluated = new Set<string>();
  for (const card of w.cards) {
    if (evaluated.has(card.id)) continue;
    if (card.columnId !== before.get(card.id)) { evaluated.add(card.id); runEntryRules(w, card.id, card.columnId); }
  }
}

// --- Time-based rules: overdue label and auto-archive, reconciled on launch and on the schedule ----
//
// Shared candidate scan for both the cheap "is anything due" pre-check and the actual run, so the two
// can never disagree about what counts as overdue.
function forEachOverdueCandidate(w: Workspace, today: string, cb: (card: Card, project: Project, rule: OverdueLabelRule) => void) {
  for (const board of w.boards) {
    const rules = (board.rules ?? []).filter((r): r is OverdueLabelRule => r.kind === "overdue-label" && r.enabled);
    if (!rules.length) continue;
    const project = w.projects.find(p => p.id === board.projectId); if (!project) continue;
    const boardColumns = w.columns.filter(c => c.boardId === board.id);
    const doneIds = new Set(boardColumns.filter(c => c.done).map(c => c.id));
    const colIds = new Set(boardColumns.map(c => c.id));
    for (const card of w.cards) {
      if (card.archived || !colIds.has(card.columnId) || doneIds.has(card.columnId)) continue;
      if (!card.dueDate || card.dueDate >= today) continue;
      for (const rule of rules) cb(card, project, rule);
    }
  }
}
export function hasOverdueWork(w: Workspace, now: Date = new Date()): boolean {
  const today = todayCalendarDate(now); let due = false;
  forEachOverdueCandidate(w, today, (card, project, rule) => {
    if (due) return;
    const label = project.labels.find(l => l.name.toLocaleLowerCase() === rule.labelName.toLocaleLowerCase());
    if (!label || !card.labels.includes(label.id)) due = true;
  });
  return due;
}
// Idempotent: a card already carrying the label is skipped (no-op, no Activity), so running this every
// minute never produces duplicate entries.
export function runOverdueRule(w: Workspace, now: Date = new Date()): number {
  const today = todayCalendarDate(now); let fired = 0;
  forEachOverdueCandidate(w, today, (card, project, rule) => {
    const labelId = resolveLabels(project, [rule.labelName])[0]!;
    if (card.labels.includes(labelId)) return;
    editCard(w, card.id, { labels: [...card.labels, labelId] }, `rule: overdue adds label ${rule.labelName}`);
    fired++;
  });
  return fired;
}

function forEachAutoArchiveCandidate(w: Workspace, now: Date, cb: (card: Card, board: Board) => void) {
  const nowMs = now.getTime();
  for (const board of w.boards) {
    const days = board.autoArchiveDays; if (!days) continue;
    const doneIds = new Set(w.columns.filter(c => c.boardId === board.id && c.done).map(c => c.id));
    if (!doneIds.size) continue;
    const cutoff = nowMs - days * 86_400_000;
    for (const card of w.cards) {
      if (card.archived || !doneIds.has(card.columnId) || !card.completedAt) continue;
      // The clock starts at the later of completedAt and the most recent restore: completedAt itself
      // is never rewritten by a restore (Insight and CSV export read it as the true completion date),
      // so restoredAt is the only thing that resets how "old" a restored card counts as.
      const clockStart = card.restoredAt && card.restoredAt > card.completedAt ? card.restoredAt : card.completedAt;
      if (new Date(clockStart).getTime() < cutoff) cb(card, board);
    }
  }
}
export function hasAutoArchiveWork(w: Workspace, now: Date = new Date()): boolean {
  let due = false; forEachAutoArchiveCandidate(w, now, () => { due = true; }); return due;
}
export function runAutoArchive(w: Workspace, now: Date = new Date()): number {
  let archived = 0;
  forEachAutoArchiveCandidate(w, now, (card, board) => { archiveCard(w, card.id, true, `auto-archive after ${board.autoArchiveDays} days`); archived++; });
  return archived;
}

export function hasDueAutomation(w: Workspace, now: Date = new Date()): boolean {
  return hasOverdueWork(w, now) || hasAutoArchiveWork(w, now);
}
