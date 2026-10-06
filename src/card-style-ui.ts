import { editCard, type Card, type CardEdit } from "./model";
import { isThumbnailType } from "./attachments";
import { cardColors } from "./card-style";
import type { PlanningHooks } from "./planning-ui";
import { escapeHTML as esc } from "./markdown";

// Both read-only helpers are O(1) in the card's own attachment count, same complexity class
// cardHTML already accepts for subtask/label/attachment counts -- never a scan of other cards.
export function cardCoverHTML(card: Card): string {
  if (!card.cover) return "";
  const a = card.attachments.find(x => x.id === card.cover);
  return a ? `<img class="card-cover" src="${esc(a.data)}" alt="">` : "";
}
export function cardColorAttrs(card: Card): string {
  return card.color ? ` data-card-color style="--card-accent:var(--card-color-${esc(card.color)})"` : "";
}

export function mountCardStyle(root: HTMLElement, cardId: string, hooks: PlanningHooks) {
  function render() {
    const c = hooks.state().cards.find(x => x.id === cardId)!;
    const images = c.attachments.filter(a => isThumbnailType(a.type));
    root.innerHTML = `<h3>Cover &amp; colour</h3>
      <label class="form-field"><span>Cover image</span>
        <select id="card-cover-select" aria-label="Cover image">${['<option value="">No cover</option>'].concat(images.map(a => `<option value="${esc(a.id)}" ${c.cover === a.id ? "selected" : ""}>${esc(a.name)}</option>`)).join("")}</select>
      </label>
      ${images.length ? "" : '<p class="muted">Attach an image to this card (above) to give it a cover.</p>'}
      <div class="section-label">CARD COLOUR</div>
      <div class="card-color-swatches" role="group" aria-label="Card colour">
        <button type="button" class="card-color-swatch card-color-none" data-card-color="" aria-label="No colour" aria-pressed="${!c.color}"></button>
        ${cardColors.map(cc => `<button type="button" class="card-color-swatch" style="background:var(--card-color-${cc.id})" data-card-color="${cc.id}" aria-label="${esc(cc.name)}" aria-pressed="${c.color === cc.id}"></button>`).join("")}
      </div>`;
    root.querySelector<HTMLSelectElement>("#card-cover-select")!.onchange = e => {
      const value = (e.target as HTMLSelectElement).value;
      if (hooks.stage(w => editCard(w, cardId, { cover: value || undefined }))) render();
    };
    root.querySelectorAll<HTMLButtonElement>("[data-card-color]").forEach(b => b.onclick = () => {
      const value = b.dataset.cardColor!;
      const patch: CardEdit = { color: value || undefined };
      if (hooks.stage(w => editCard(w, cardId, patch))) render();
    });
  }
  render();
}
