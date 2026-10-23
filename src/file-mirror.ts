import { migrateWorkspace, type Workspace } from "./model";

// The subset of the File System Access API this module uses. lib.dom ships the handle types but not
// the picker or the permission methods, and tests substitute in-memory handles, so the contract is
// spelled out here rather than taken from the global declarations.
export interface FileHandleLike {
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
}
export interface DirectoryHandleLike {
  readonly name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string): Promise<void>;
  keys?(): AsyncIterable<string>;
  queryPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
}
export interface HandleStore {
  load(): Promise<DirectoryHandleLike | null>;
  save(handle: DirectoryHandleLike): Promise<void>;
  clear(): Promise<void>;
}

export const WORKSPACE_FILE = "fieldboard.json";
export const DAILY_RETENTION = 7;
const DAILY_PATTERN = /^fieldboard-(\d{4}-\d{2}-\d{2})\.json$/;
const dailyName = (date: string) => `fieldboard-${date}.json`;
const today = () => new Date().toLocaleDateString("en-CA");

export function supportsFolderSave(scope: object = globalThis): boolean { return typeof (scope as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function"; }
export async function pickFolder(): Promise<DirectoryHandleLike | null> {
  const picker = (globalThis as { showDirectoryPicker?: (o: object) => Promise<DirectoryHandleLike> }).showDirectoryPicker;
  if (!picker) throw new Error("This browser cannot open folders. Chrome, Edge, or Brave with its File System Access flag enabled, can.");
  try { return await picker({ id: "fieldboard-workspace", mode: "readwrite", startIn: "documents" }); }
  catch (e) { if (e instanceof DOMException && e.name === "AbortError") return null; throw e; }
}
// Handles without the permission methods (the origin-private file system, test doubles) are usable as they are.
async function permission(dir: DirectoryHandleLike, request: boolean): Promise<PermissionState> {
  if (request) return dir.requestPermission ? dir.requestPermission({ mode: "readwrite" }) : "granted";
  return dir.queryPermission ? dir.queryPermission({ mode: "readwrite" }) : "granted";
}

export type FolderRead = { kind: "missing" } | { kind: "invalid"; error: string } | { kind: "workspace"; workspace: Workspace; text: string };
export async function readFolderWorkspace(dir: DirectoryHandleLike): Promise<FolderRead> {
  let handle: FileHandleLike;
  try { handle = await dir.getFileHandle(WORKSPACE_FILE); }
  catch (e) { if (e instanceof DOMException && e.name === "NotFoundError") return { kind: "missing" }; throw e; }
  const text = await (await handle.getFile()).text();
  try { return { kind: "workspace", workspace: migrateWorkspace(JSON.parse(text)), text }; }
  catch (e) { return { kind: "invalid", error: e instanceof Error ? e.message : String(e) }; }
}
async function writeText(dir: DirectoryHandleLike, name: string, text: string) {
  const stream = await (await dir.getFileHandle(name, { create: true })).createWritable();
  try { await stream.write(text); } catch (e) { await stream.abort?.(); throw e; }
  await stream.close();
}
async function exists(dir: DirectoryHandleLike, name: string): Promise<boolean> {
  try { await dir.getFileHandle(name); return true; } catch (e) { if (e instanceof DOMException && e.name === "NotFoundError") return false; throw e; }
}
// The workspace file, plus one dated copy per local day (same format, so either restores with
// "Restore JSON backup"). Only files named exactly like a dated copy are ever pruned.
export async function writeFolderWorkspace(dir: DirectoryHandleLike, workspace: Workspace, date = today()): Promise<void> {
  const text = JSON.stringify(workspace, null, 2);
  await writeText(dir, WORKSPACE_FILE, text);
  if (!await exists(dir, dailyName(date))) {
    await writeText(dir, dailyName(date), text);
    if (dir.keys) {
      const dated: string[] = []; for await (const name of dir.keys()) if (DAILY_PATTERN.test(name)) dated.push(name);
      for (const name of dated.sort().slice(0, -DAILY_RETENTION)) await dir.removeEntry(name);
    }
  }
}
export async function writeConflictCopy(dir: DirectoryHandleLike, text: string): Promise<string> {
  const name = `fieldboard-conflict-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await writeText(dir, name, text); return name;
}

export function isPristine(w: Workspace): boolean { return w.projects.length === 0 && w.cards.length === 0 && w.activities.length === 0; }
const comparable = (w: Workspace) => JSON.stringify({ ...w, revision: 0 });
export function lastChange(w: Workspace): string | null {
  let latest: string | null = null;
  const consider = (t: string | null | undefined) => { if (t && (!latest || t > latest)) latest = t; };
  for (const c of w.cards) { consider(c.updatedAt); consider(c.completedAt); }
  for (const a of w.activities) consider(a.timestamp);
  return latest;
}
export type Reconcile =
  | { action: "write" } | { action: "none" } | { action: "adopt" } | { action: "invalid"; error: string }
  | { action: "ask"; fileChanged: string | null; localChanged: string | null; fileNewer: boolean };
export function reconcile(local: Workspace, file: FolderRead): Reconcile {
  if (file.kind === "missing") return { action: "write" };
  if (file.kind === "invalid") return { action: "invalid", error: file.error };
  if (comparable(local) === comparable(file.workspace)) return { action: "none" };
  if (isPristine(local)) return { action: "adopt" };
  if (isPristine(file.workspace)) return { action: "write" };
  const fileChanged = lastChange(file.workspace), localChanged = lastChange(local);
  return { action: "ask", fileChanged, localChanged, fileNewer: (fileChanged ?? "") > (localChanged ?? "") };
}

export type MirrorStatus = "off" | "prompt" | "writing" | "synced" | "error";
// Mirrors acknowledged workspace states into the chosen folder. Rapid changes coalesce: only the
// latest scheduled state is written, and an unchanged state is never rewritten.
export class FolderMirror {
  dir: DirectoryHandleLike | null = null;
  status: MirrorStatus = "off";
  error = "";
  onStatus: () => void = () => {};
  private pending: Workspace | null = null;
  private written: string | null = null;
  private writtenRef: Workspace | null = null;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private store: HandleStore, private delayMs = 400) {}
  get folderName(): string { return this.dir?.name ?? ""; }
  // A root handle (origin-private file system, some drives) carries no name; labels then say "the chosen folder".
  get folderLabel(): string { return this.dir ? (this.dir.name ? `folder "${this.dir.name}"` : "the chosen folder") : ""; }
  get busy(): boolean { return this.pending !== null || this.running !== null; }
  private set(status: MirrorStatus, error = "") { if (this.status === status && this.error === error) return; this.status = status; this.error = error; this.onStatus(); }
  async restore(): Promise<"none" | "ready" | "prompt"> {
    const dir = await this.store.load(); if (!dir) return "none";
    this.dir = dir;
    if (await permission(dir, false) === "granted") { this.set("synced"); return "ready"; }
    this.set("prompt"); return "prompt";
  }
  // Needs a user gesture in a real browser; the caller runs it from a click.
  async requestAccess(): Promise<boolean> {
    if (!this.dir) return false;
    const state = await permission(this.dir, true);
    if (state === "granted") { this.set("synced"); return true; }
    this.set("prompt", "Folder access was not granted."); return false;
  }
  async connect(dir: DirectoryHandleLike) { await this.store.save(dir); this.dir = dir; this.written = null; this.writtenRef = null; this.set("synced"); }
  async disconnect() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.pending = null; await this.running; await this.store.clear(); this.dir = null; this.written = null; this.set("off"); }
  schedule(workspace: Workspace) {
    if (!this.dir || this.status === "prompt" || workspace === this.writtenRef) return;
    this.pending = workspace; if (this.status !== "error") this.set("writing");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.start(); }, this.delayMs);
  }
  // Writes whatever is pending right away, for pagehide, where no debounce delay can be afforded.
  flushNow() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } this.start(); }
  async flush() { if (this.timer) this.flushNow(); await this.running; }
  retry() { if (this.status === "error" && this.pending) { this.set("writing"); this.start(); } }
  private start() { if (this.running || !this.pending) return; this.running = this.loop().finally(() => { this.running = null; }); }
  private async loop() {
    while (this.pending && this.dir) {
      const target = this.pending; this.pending = null;
      const text = comparable(target);
      if (text === this.written) { this.writtenRef = target; continue; }
      try { await writeFolderWorkspace(this.dir, target); this.written = text; this.writtenRef = target; }
      catch (e) { this.pending = target; this.set("error", e instanceof Error ? `${e.name}: ${e.message}` : String(e)); return; }
    }
    if (this.status !== "error" && this.dir) this.set("synced");
  }
}
