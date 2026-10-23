import { FolderMirror, supportsFolderSave, pickFolder, readFolderWorkspace, reconcile, writeConflictCopy, isPristine, type DirectoryHandleLike } from "./file-mirror";
import type { AutoBackup } from "./auto-backup";
import { escapeHTML as esc } from "./markdown";
import type { Workspace } from "./model";

export interface StorageDeps {
  mirror: FolderMirror;
  autoBackup: AutoBackup;
  state(): Workspace;
  // Replaces the whole workspace from a validated file and returns once it is acknowledged (or not).
  replace(workspace: Workspace): Promise<boolean>;
  setAutoBackup(enabled: boolean): void;
  showModal(title: string, body: string): HTMLDialogElement;
  closeModal(): void;
  message(error: unknown): void;
  statusChanged(): void;
  $<T extends HTMLElement = HTMLElement>(selector: string, root?: ParentNode): T;
}
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "unknown";
const timeOf = (ms: number | null) => ms === null ? "never" : new Date(ms).toLocaleTimeString(undefined, { timeStyle: "short" });
const blockedByPolicy = (e: unknown) => e instanceof DOMException ? e.name === "SecurityError" || e.name === "NotAllowedError" : e instanceof TypeError;

export function mountStorageControls(deps: StorageDeps) {
  const { mirror, autoBackup, $ } = deps;
  const supported = supportsFolderSave();
  let dismissed = false;
  function renderCard() {
    const status = $("#folder-status"), hint = $("#folder-hint"), button = $<HTMLButtonElement>("#folder-button"), stop = $<HTMLButtonElement>("#folder-disconnect");
    const name = mirror.folderLabel; const auto = deps.state().settings.autoBackup === true;
    const autoRow = `<label class="checkbox-label storage-auto"><input type="checkbox" id="auto-backup"${auto ? " checked" : ""}>Auto-backup downloads</label>` +
      (auto ? `<small class="storage-auto-meta">Last download ${esc(timeOf(autoBackup.lastAt))}${autoBackup.dirty ? " · changes pending" : ""} <button type="button" class="link-button" id="auto-backup-now">Download now</button></small><small class="storage-auto-meta">Saves a dated JSON at most every 15 minutes and when you leave the tab. If the browser asks where to save each file, turn that setting off so backups land in Downloads quietly.</small>` : "");
    stop.hidden = mirror.status === "off";
    if (mirror.status === "synced" || mirror.status === "writing") { status.textContent = `Saved to ${name}`; hint.innerHTML = "fieldboard.json, plus one dated copy per day (7 kept)."; button.textContent = "Change folder…"; }
    else if (mirror.status === "prompt") { status.textContent = `${name[0]!.toUpperCase()}${name.slice(1)} needs permission`; hint.innerHTML = "Grant access again to keep saving there."; button.textContent = "Reconnect folder"; }
    else if (mirror.status === "error") { status.textContent = `Write to ${name} failed`; hint.textContent = mirror.error; button.textContent = "Retry folder write"; }
    else {
      status.textContent = "Saved in this browser only";
      hint.innerHTML = (supported ? "Choose a folder to keep a fieldboard.json you own." : "This browser cannot save straight to a folder; auto-backup downloads work everywhere.") + autoRow;
      button.textContent = "Choose folder…"; button.hidden = !supported;
      const toggle = hint.querySelector<HTMLInputElement>("#auto-backup"); if (toggle) toggle.onchange = () => deps.setAutoBackup(toggle.checked);
      const now = hint.querySelector<HTMLButtonElement>("#auto-backup-now"); if (now) now.onclick = () => { autoBackup.note(deps.state()); autoBackup.flush(); renderCard(); };
    }
    if (mirror.status !== "off") button.hidden = false;
    const welcome = $<HTMLButtonElement>("#welcome-folder"); welcome.hidden = !supported || mirror.status !== "off";
    renderBanner();
  }
  function renderBanner() {
    const banner = $("#folder-banner"); const text = $("#folder-banner-text");
    const show = !dismissed && (mirror.status === "prompt" || mirror.status === "error");
    banner.hidden = !show; if (!show) return;
    $("#folder-reconnect").hidden = mirror.status !== "prompt"; $("#folder-retry").hidden = mirror.status !== "error";
    text.textContent = mirror.status === "prompt" ? `${mirror.folderLabel[0]!.toUpperCase()}${mirror.folderLabel.slice(1)} needs your permission again before changes can be saved there.` : `Could not write to ${mirror.folderLabel}: ${mirror.error}`;
  }
  async function adopt(dir: DirectoryHandleLike): Promise<void> {
    const read = await readFolderWorkspace(dir); const plan = reconcile(deps.state(), read);
    if (plan.action === "invalid") throw new Error(`fieldboard.json in ${dir.name ? `"${dir.name}"` : "the chosen folder"} is not a valid workspace (${plan.error}). Move it aside, then choose the folder again.`);
    if (plan.action === "ask") { conflictDialog(dir, read.kind === "workspace" ? read : null, plan); return; }
    if (plan.action === "adopt" && read.kind === "workspace") { if (!await deps.replace(read.workspace)) return; }
    await mirror.connect(dir); mirror.schedule(deps.state()); renderCard();
  }
  function conflictDialog(dir: DirectoryHandleLike, file: { workspace: Workspace; text: string } | null, plan: { fileChanged: string | null; localChanged: string | null; fileNewer: boolean }) {
    if (!file) return;
    const modal = deps.showModal("The folder's file differs from this browser", `<p>Both hold work, and they are not the same. Nothing has been overwritten yet.</p>
      <div class="conflict-grid"><div class="conflict-side${plan.fileNewer ? " newer" : ""}"><strong>${dir.name ? `Folder "${esc(dir.name)}"` : "The chosen folder"}</strong><span>Last change ${esc(when(plan.fileChanged))}</span><span>${file.workspace.projects.length} projects · ${file.workspace.cards.length} cards</span>${plan.fileNewer ? "<em>Newer</em>" : ""}</div>
      <div class="conflict-side${plan.fileNewer ? "" : " newer"}"><strong>This browser</strong><span>Last change ${esc(when(plan.localChanged))}</span><span>${deps.state().projects.length} projects · ${deps.state().cards.length} cards</span>${plan.fileNewer ? "" : "<em>Newer</em>"}</div></div>
      <p class="muted">Keeping this browser's version first saves the folder's current file as a dated conflict copy, so nothing is lost either way.</p>
      <div class="dialog-actions"><button type="button" id="conflict-local">Keep this browser's version</button><button type="button" class="primary" id="conflict-file">Load the folder's file</button></div>`);
    modal.querySelector<HTMLButtonElement>("#conflict-file")!.onclick = async () => {
      try { deps.closeModal(); if (!await deps.replace(file.workspace)) return; await mirror.connect(dir); mirror.schedule(deps.state()); renderCard(); } catch (e) { deps.message(e); }
    };
    modal.querySelector<HTMLButtonElement>("#conflict-local")!.onclick = async () => {
      try { deps.closeModal(); await writeConflictCopy(dir, file.text); await mirror.connect(dir); mirror.schedule(deps.state()); renderCard(); } catch (e) { deps.message(e); }
    };
  }
  async function chooseFolder() {
    try {
      let dir: DirectoryHandleLike | null;
      try { dir = await pickFolder(); }
      catch (e) {
        if (blockedByPolicy(e)) throw new Error("The folder picker is blocked in this browser (a browser or IT policy). Turn on auto-backup downloads instead: they need no special permission.");
        throw e;
      }
      if (!dir) return;
      await adopt(dir);
    } catch (e) { deps.message(e); }
  }
  async function connectStored() {
    try {
      const state = await mirror.restore();
      if (state === "ready" && mirror.dir) await adopt(mirror.dir);
      renderCard();
    } catch (e) { deps.message(e); renderCard(); }
  }
  async function reconnect() {
    try { if (await mirror.requestAccess() && mirror.dir) { dismissed = false; await adopt(mirror.dir); } renderCard(); } catch (e) { deps.message(e); }
  }
  async function disconnect() { try { await mirror.disconnect(); renderCard(); } catch (e) { deps.message(e); } }
  $("#folder-button").onclick = () => { if (mirror.status === "prompt") void reconnect(); else if (mirror.status === "error") { mirror.retry(); renderCard(); } else void chooseFolder(); };
  $("#welcome-folder").onclick = () => void chooseFolder();
  $("#folder-disconnect").onclick = () => void disconnect();
  $("#folder-reconnect").onclick = () => void reconnect();
  $("#folder-retry").onclick = () => { mirror.retry(); renderCard(); };
  $("#folder-dismiss").onclick = () => { dismissed = true; renderBanner(); };
  mirror.onStatus = () => { if (mirror.status === "synced" || mirror.status === "off") dismissed = false; deps.statusChanged(); renderCard(); };
  autoBackup.onChange = renderCard;
  return { chooseFolder, connectStored, renderCard, isPristine: () => isPristine(deps.state()) };
}
