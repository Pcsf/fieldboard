import { editCard, type Card, type Link } from "./model";
import { linkKinds, type LinkKind, type LinkInput, buildLink, parseLinkInput, linkLabel, linkHref } from "./links";
import type { PlanningHooks } from "./planning-ui";
import { escapeHTML as esc } from "./markdown";

const KIND_LABEL: Record<LinkKind, string> = { url: "Link", commit: "Git commit", issue: "GitHub issue", pr: "GitHub PR" };

function chipHTML(l: Link): string {
  const href = linkHref(l); const label = esc(linkLabel(l));
  const body = href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<span>${label}</span>`;
  return `<span class="link-chip" data-link="${esc(l.id)}">${body}<button type="button" class="danger" data-remove-link="${esc(l.id)}" aria-label="Remove link ${label}">×</button></span>`;
}

export function mountLinks(root: HTMLElement, cardId: string, hooks: PlanningHooks) {
  const errorKey = `links:${cardId}`;
  const card = (): Card => hooks.state().cards.find(c => c.id === cardId)!;

  function render() {
    const c = card();
    root.innerHTML = `<h3>Links <span class="count">${c.links.length}</span></h3>
    <form id="link-form" class="link-form">
      <label class="form-field"><span>Kind</span><select id="link-kind" aria-label="Link kind">${linkKinds.map(k => `<option value="${k}">${esc(KIND_LABEL[k])}</option>`).join("")}</select></label>
      <label class="form-field" id="link-url-field"><span>URL</span><input id="link-url" aria-label="URL" placeholder="https:// -- pasting a GitHub issue, PR or commit link fills in the fields below"></label>
      <label class="form-field" id="link-repo-field" hidden><span>Repository (owner/repo)</span><input id="link-repo" aria-label="Repository (owner/repo)"></label>
      <label class="form-field" id="link-sha-field" hidden><span>Commit SHA</span><input id="link-sha" aria-label="Commit SHA"></label>
      <label class="form-field" id="link-number-field" hidden><span>Number</span><input id="link-number" type="number" min="1" step="1" aria-label="Issue or PR number"></label>
      <button type="submit">Add link</button>
    </form>
    <p class="field-error" id="link-error" role="alert"></p>
    <div class="link-chip-list">${c.links.map(chipHTML).join("") || '<p class="empty-detail">No links yet.</p>'}</div>`;

    const kindSelect = root.querySelector<HTMLSelectElement>("#link-kind")!;
    const urlField = root.querySelector<HTMLElement>("#link-url-field")!;
    const urlInput = root.querySelector<HTMLInputElement>("#link-url")!;
    const repoField = root.querySelector<HTMLElement>("#link-repo-field")!;
    const repoInput = root.querySelector<HTMLInputElement>("#link-repo")!;
    const shaField = root.querySelector<HTMLElement>("#link-sha-field")!;
    const shaInput = root.querySelector<HTMLInputElement>("#link-sha")!;
    const numberField = root.querySelector<HTMLElement>("#link-number-field")!;
    const numberInput = root.querySelector<HTMLInputElement>("#link-number")!;
    const errorEl = root.querySelector<HTMLElement>("#link-error")!;

    function showFieldsFor(kind: LinkKind) {
      kindSelect.value = kind;
      urlField.hidden = kind !== "url";
      repoField.hidden = kind === "url";
      shaField.hidden = kind !== "commit";
      numberField.hidden = kind !== "issue" && kind !== "pr";
    }
    showFieldsFor("url");
    kindSelect.onchange = () => showFieldsFor(kindSelect.value as LinkKind);
    // A pasted (or typed) github.com issue/PR/commit URL switches the form to that kind and
    // fills in its fields, instead of being added as an opaque plain-URL link.
    urlInput.addEventListener("input", () => {
      const parsed = parseLinkInput(urlInput.value);
      if (parsed.kind !== "url") {
        showFieldsFor(parsed.kind);
        repoInput.value = parsed.repo ?? "";
        if (parsed.kind === "commit") shaInput.value = parsed.sha ?? "";
        else numberInput.value = parsed.number ? String(parsed.number) : "";
      }
    });

    root.querySelector<HTMLFormElement>("#link-form")!.onsubmit = e => {
      e.preventDefault();
      try {
        const kind = kindSelect.value as LinkKind;
        const input: LinkInput = kind === "url" ? { kind, url: urlInput.value }
          : kind === "commit" ? { kind, repo: repoInput.value, sha: shaInput.value }
          : { kind, repo: repoInput.value, number: Number(numberInput.value) };
        const link = buildLink(input);
        if (hooks.stage(w => { const cur = w.cards.find(x => x.id === cardId)!; editCard(w, cardId, { links: [...cur.links, link] }); })) {
          hooks.error(errorKey, "");
          render();
        } else errorEl.textContent = "Link was not saved. Check the storage status.";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errorEl.textContent = message; hooks.error(errorKey, message);
      }
    };
    root.querySelectorAll<HTMLButtonElement>("[data-remove-link]").forEach(b => b.onclick = () => {
      if (hooks.stage(w => { const cur = w.cards.find(x => x.id === cardId)!; editCard(w, cardId, { links: cur.links.filter(l => l.id !== b.dataset.removeLink) }); })) render();
    });
  }
  render();
}
