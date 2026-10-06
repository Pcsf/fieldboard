import { editCard, type Workspace } from "./model";
import type { Notification } from "./notifications";
import { escapeHTML as esc } from "./markdown";
import type { PlanningHooks } from "./planning-ui";

// Computed once per render from the acting member's own notifications -- never a per-card scan (see
// WORKER-RULES anti-claims and DECISIONS "Notifications").
export function unreadCount(w: Workspace, memberId: string): number {
  return (w.notifications ?? []).filter(n => n.memberId === memberId && !n.read).length;
}

function kindLabel(kind: Notification["kind"]): string {
  return kind === "mention" ? "Mention" : kind === "assignment" ? "Assignment" : kind === "watch" ? "Watched card" : "Due";
}

export function mountInbox(root: HTMLElement, hooks: PlanningHooks, openCard: (cardId: string) => void) {
  function render() {
    const w = hooks.state(); const memberId = w.settings.actorId;
    const mine = (w.notifications ?? []).filter(n => n.memberId === memberId).slice().reverse();
    if (!mine.length) { root.innerHTML = '<p class="muted">Nothing here yet. Mentions, assignments, due reminders and watched-card changes for you will show up in this list.</p>'; return; }
    root.innerHTML = `<button type="button" id="inbox-mark-all" class="subtle" style="margin-bottom:10px">Mark all read</button>`
      + mine.map(n => {
        const card = w.cards.find(c => c.id === n.cardId);
        const title = card ? card.title : "(removed card)";
        // No aria-label override: the visible title and timestamp already say everything a label
        // would, and axe's label-content-name-mismatch rule wants the accessible name built from
        // what's on screen, not a differently-punctuated paraphrase of it.
        return `<button type="button" class="inbox-row ${n.read ? "" : "unread"}" data-notification="${esc(n.id)}" data-card="${esc(n.cardId)}">${n.read ? "" : '<span class="inbox-dot" aria-hidden="true"></span>'}<span class="inbox-body"><span class="inbox-title">${esc(kindLabel(n.kind))} · ${esc(title)}</span> <span class="inbox-meta">${esc(new Date(n.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}</span></span></button>`;
      }).join("");
    root.querySelectorAll<HTMLButtonElement>("[data-notification]").forEach(button => button.onclick = () => {
      const notificationId = button.dataset.notification!; const cardId = button.dataset.card!;
      hooks.stage(w => { const note = (w.notifications ?? []).find(n => n.id === notificationId); if (note) note.read = true; });
      if (w.cards.some(c => c.id === cardId)) openCard(cardId); else render();
    });
    root.querySelector<HTMLButtonElement>("#inbox-mark-all")!.onclick = () => {
      if (hooks.stage(w => { for (const n of w.notifications ?? []) if (n.memberId === w.settings.actorId) n.read = true; })) render();
    };
  }
  render();
}

export function watchToggleHTML(watching: boolean): string {
  return `<button type="button" id="watch-toggle" aria-label="${watching ? "Unwatch this card" : "Watch this card"}">${watching ? "Unwatch" : "Watch"}</button>`;
}
export function watchersListHTML(w: Workspace, watchers: string[]): string {
  if (!watchers.length) return '<p class="muted" id="watchers-list">Nobody is watching this card.</p>';
  const names = watchers.map(id => w.members.find(m => m.id === id)?.name ?? "Member").map(n => esc(n)).join(", ");
  return `<p class="muted" id="watchers-list">Watched by: ${names}</p>`;
}
export function bindWatchToggle(root: ParentNode, hooks: PlanningHooks, cardId: string, onChanged: () => void) {
  const button = root.querySelector<HTMLButtonElement>("#watch-toggle"); if (!button) return;
  button.onclick = () => {
    const w = hooks.state(); const actorId = w.settings.actorId; const card = w.cards.find(c => c.id === cardId); if (!card) return;
    const current = card.watchers ?? []; const next = current.includes(actorId) ? current.filter(id => id !== actorId) : [...current, actorId];
    if (hooks.stage(w => editCard(w, cardId, { watchers: next.length ? next : undefined }))) onChanged();
  };
}
