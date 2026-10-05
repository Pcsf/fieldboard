import { escapeHTML as esc } from "./markdown";

export interface PaletteItem { id: string; kind: "project" | "board" | "card" | "action"; label: string; hint?: string }

function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
// Ranking: exact/prefix beats a word-start match beats a plain subsequence; ties break alphabetically.
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase(); const t = text.toLowerCase();
  if (!q) return 0;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (new RegExp(`\\b${escapeRegExp(q)}`).test(t)) return 2;
  let from = 0;
  for (const ch of q) { const at = t.indexOf(ch, from); if (at < 0) return null; from = at + 1; }
  return 3 + from;
}
export function rankItems(items: PaletteItem[], query: string): PaletteItem[] {
  const scored: { item: PaletteItem; score: number }[] = [];
  for (const item of items) { const score = fuzzyScore(query, item.label); if (score !== null) scored.push({ item, score }); }
  scored.sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label));
  return scored.slice(0, 50).map(s => s.item);
}

export function mountPalette(dialog: HTMLDialogElement, getItems: () => PaletteItem[], execute: (item: PaletteItem) => void) {
  const input = dialog.querySelector<HTMLInputElement>("#palette-input")!;
  const list = dialog.querySelector<HTMLUListElement>("#palette-results")!;
  let results: PaletteItem[] = []; let active = 0;
  function paint() {
    list.innerHTML = results.length
      ? results.map((item, i) => `<li role="option" id="palette-option-${i}" aria-selected="${i === active}" class="palette-result${i === active ? " active" : ""}" data-index="${i}"><span class="palette-kind">${esc(item.kind)}</span><span class="palette-label">${esc(item.label)}</span>${item.hint ? `<span class="palette-hint">${esc(item.hint)}</span>` : ""}</li>`).join("")
      : '<li class="palette-empty">No matches</li>';
    input.setAttribute("aria-activedescendant", results.length ? `palette-option-${active}` : "");
    for (const li of list.querySelectorAll<HTMLLIElement>("[data-index]")) li.onclick = () => { active = Number(li.dataset.index); run(); };
  }
  function search() { results = rankItems(getItems(), input.value); active = Math.min(active, Math.max(results.length - 1, 0)); paint(); }
  function run() { const item = results[active]; if (item) { dialog.close(); execute(item); } }
  input.oninput = () => { active = 0; search(); };
  input.onkeydown = e => {
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, results.length - 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); paint(); }
    else if (e.key === "Enter") { e.preventDefault(); run(); }
  };
  return { open() { active = 0; input.value = ""; if (!dialog.open) dialog.showModal(); search(); input.focus(); } };
}
