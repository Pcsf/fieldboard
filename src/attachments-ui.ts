import { editCard, id, type Card, type CardEdit } from "./model";
import { ATTACHMENT_MAX_BYTES, isThumbnailType, attachmentBlob, readFileAsDataUrl } from "./attachments";
import type { PlanningHooks } from "./planning-ui";
import { escapeHTML as esc } from "./markdown";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function extensionFor(type: string): string {
  const match = /\/([a-z0-9.+-]+)$/i.exec(type); return match ? match[1]!.replace("+xml", "") : "bin";
}
function downloadAttachment(name: string, data: string) {
  const blob = attachmentBlob({ data });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name || "attachment"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Exactly one paste listener for the whole app, delegating to whichever attachments section was
// mounted most recently and is still in the live DOM -- avoids piling up a document listener
// every time a card is reopened and re-rendered.
let active: { root: HTMLElement; addFiles: (files: FileList | null) => Promise<void> } | null = null;
let listenerInstalled = false;
function ensurePasteListener() {
  if (listenerInstalled) return; listenerInstalled = true;
  document.addEventListener("paste", e => {
    if (!active || !active.root.isConnected) return;
    const files = e.clipboardData?.files; if (!files || !files.length) return;
    e.preventDefault(); void active.addFiles(files);
  });
}

// onChange notifies a sibling panel (the card-style section's cover picker) that the attachment
// list it reads from has changed, without this module knowing anything about that panel.
export function mountAttachments(root: HTMLElement, cardId: string, hooks: PlanningHooks, onChange: () => void = () => {}) {
  const errorKey = `attachments:${cardId}`;
  const card = (): Card => hooks.state().cards.find(c => c.id === cardId)!;

  async function addFiles(files: FileList | null) {
    if (!files || !files.length) return;
    const accepted: { id: string; name: string; type: string; data: string }[] = [];
    const refused: string[] = [];
    for (const file of Array.from(files)) {
      if (file.size > ATTACHMENT_MAX_BYTES) { refused.push(`${file.name || "file"} (${formatSize(file.size)})`); continue; }
      const data = await readFileAsDataUrl(file);
      const type = file.type || "application/octet-stream";
      accepted.push({ id: id(), name: file.name || `pasted-${Date.now()}.${extensionFor(type)}`, type, data });
    }
    const limitMiB = ATTACHMENT_MAX_BYTES / (1024 * 1024);
    const message = refused.length ? `Refused (over ${limitMiB} MiB): ${refused.join(", ")}` : "";
    hooks.error(errorKey, message);
    const errorEl = root.querySelector<HTMLElement>("#attachment-error"); if (errorEl) errorEl.textContent = message;
    if (accepted.length && hooks.stage(w => { const cur = w.cards.find(x => x.id === cardId)!; editCard(w, cardId, { attachments: [...cur.attachments, ...accepted] }); })) { render(); onChange(); }
  }

  function render() {
    const c = card();
    root.innerHTML = `<h3>Attachments <span class="count">${c.attachments.length}</span></h3>
    <div class="attachment-dropzone" tabindex="0" aria-label="Drop files here to attach them">
      <p>Drag files here, paste an image, or</p>
      <button type="button" id="attachment-add">Add file</button>
      <input type="file" id="attachment-input" multiple class="visually-hidden" aria-label="Choose a file to attach">
    </div>
    <p class="field-error" id="attachment-error" role="alert"></p>
    <div class="attachment-list">${c.attachments.map(a => `
      <div class="attachment-item" data-attachment="${esc(a.id)}">
        ${isThumbnailType(a.type) ? `<img class="attachment-thumb" src="${esc(a.data)}" alt="">` : `<span class="attachment-icon" aria-hidden="true">\u{1F4C4}</span>`}
        <span class="attachment-name">${esc(a.name)}</span>
        <button type="button" data-download="${esc(a.id)}" aria-label="Download ${esc(a.name)}">Download</button>
        <button type="button" class="danger" data-remove="${esc(a.id)}" aria-label="Remove attachment ${esc(a.name)}">Remove</button>
      </div>`).join("") || '<p class="empty-detail">No files yet.</p>'}</div>`;

    const dropzone = root.querySelector<HTMLElement>(".attachment-dropzone")!;
    const input = root.querySelector<HTMLInputElement>("#attachment-input")!;
    root.querySelector<HTMLButtonElement>("#attachment-add")!.onclick = () => input.click();
    input.onchange = () => { void addFiles(input.files); input.value = ""; };
    dropzone.ondragover = e => { e.preventDefault(); dropzone.classList.add("drag-over"); };
    dropzone.ondragleave = () => dropzone.classList.remove("drag-over");
    dropzone.ondrop = e => { e.preventDefault(); dropzone.classList.remove("drag-over"); void addFiles(e.dataTransfer?.files ?? null); };
    root.querySelectorAll<HTMLButtonElement>("[data-download]").forEach(b => b.onclick = () => {
      const a = card().attachments.find(x => x.id === b.dataset.download); if (a) downloadAttachment(a.name, a.data);
    });
    root.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach(b => b.onclick = () => {
      // Removing the cover's own attachment clears the cover in the same edit -- a card can never
      // be left pointing at an attachment it no longer has (checkCard would refuse to validate it).
      if (hooks.stage(w => {
        const cur = w.cards.find(x => x.id === cardId)!;
        const patch: CardEdit = { attachments: cur.attachments.filter(a => a.id !== b.dataset.remove) };
        if (cur.cover === b.dataset.remove) patch.cover = undefined;
        editCard(w, cardId, patch);
      })) { render(); onChange(); }
    });
  }
  render();
  active = { root, addFiles };
  ensurePasteListener();
}
