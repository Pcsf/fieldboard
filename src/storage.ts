import { createWorkspace, migrateWorkspace, validateWorkspace, undoWorkspace, type Workspace } from "./model";
export interface Snapshot { date: string; state: Workspace }
export interface Draft { baseRevision: number; state: Workspace; inFlight?: Workspace | null }
export type LocalJournal = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export class DraftJournal {
  private observed: string | null = null;
  constructor(private local: LocalJournal) {}
  write(draft: Draft) {
    if (this.local.getItem("fieldboard-draft") !== this.observed) throw new Error("Another tab owns a pending draft. Close that tab only after saving or exporting its drafts.");
    const text = JSON.stringify(draft); this.local.setItem("fieldboard-draft", text); this.observed = text;
  }
  read(): Draft | null {
    const text = this.local.getItem("fieldboard-draft"); this.observed = text; if (!text) return null;
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object" || !("baseRevision" in data) || !("state" in data) || typeof data.baseRevision !== "number" || !Number.isInteger(data.baseRevision)) throw new Error("Invalid draft journal. Download it before recovery.");
    return { baseRevision: data.baseRevision, state: validateWorkspace(data.state), inFlight: "inFlight" in data && data.inFlight ? validateWorkspace(data.inFlight) : null };
  }
  clear() { if (this.local.getItem("fieldboard-draft") === this.observed) { this.local.removeItem("fieldboard-draft"); this.observed = null; } }
}
export class Storage {
  private db: IDBDatabase | null = null;
  constructor(private factory: IDBFactory = indexedDB, private name = "fieldboard") {}
  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const request = this.factory.open(this.name, 2);
      request.onblocked = () => reject(new Error("Database upgrade blocked. Close other Fieldboard tabs and reload."));
      request.onerror = () => reject(request.error ?? new Error("Browser storage unavailable"));
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("workspace")) db.createObjectStore("workspace");
        if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots", { keyPath: "date" });
        const store = request.transaction!.objectStore("workspace"); const get = store.get("current");
        get.onsuccess = () => { if (get.result) { try { store.put(migrateWorkspace(get.result), "current"); } catch { request.transaction!.abort(); } } };
      };
      request.onsuccess = () => { this.db = request.result; this.db.onversionchange = () => this.close(); resolve(); };
    });
  }
  private transaction(stores: string | string[], write = false): IDBTransaction {
    if (!this.db) throw new Error("Persistent storage is unavailable. Reload to retry.");
    const tx = this.db.transaction(stores, write ? "readwrite" : "readonly", write ? { durability: "strict" } : undefined);
    if (write && tx.durability !== "strict") { tx.abort(); throw new Error("This browser does not support strict storage durability."); }
    return tx;
  }
  async load(): Promise<Workspace | null> {
    return new Promise((resolve, reject) => {
      const tx = this.transaction("workspace"); const request = tx.objectStore("workspace").get("current");
      tx.oncomplete = () => { try { resolve(request.result ? migrateWorkspace(request.result) : null); } catch (e) { reject(e); } };
      tx.onabort = () => reject(tx.error ?? new Error("Read aborted")); tx.onerror = () => reject(tx.error);
    });
  }
  async commit(state: Workspace, expectedRevision: number): Promise<void> {
    const valid = validateWorkspace(state);
    return new Promise((resolve, reject) => {
      const tx = this.transaction("workspace", true); const store = tx.objectStore("workspace"); let cause: unknown;
      const read = store.get("current");
      read.onsuccess = () => {
        try {
          const revision: unknown = read.result?.revision ?? 0;
          if (revision !== expectedRevision) throw new Error("Workspace changed in another tab. Download your drafts, then reload before editing.");
          store.put(valid, "current");
        } catch (e) { cause = e; tx.abort(); }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(cause ?? tx.error ?? new Error("Write transaction aborted"));
      tx.onerror = () => { cause ??= tx.error; };
    });
  }
  async snapshot(date = new Date().toLocaleDateString("en-CA")): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.transaction(["workspace", "snapshots"], true); const store = tx.objectStore("snapshots");
      const existing = store.get(date);
      existing.onsuccess = () => {
        if (existing.result) return;
        const current = tx.objectStore("workspace").get("current");
        current.onsuccess = () => {
          if (!current.result) return;
          store.put({ date, state: current.result });
          const keys = store.getAllKeys(); keys.onsuccess = () => keys.result.sort().slice(0, -7).forEach(key => store.delete(key));
        };
      };
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error("Snapshot failed")); tx.onerror = () => reject(tx.error);
    });
  }
  async snapshots(): Promise<Snapshot[]> {
    return new Promise((resolve, reject) => {
      const tx = this.transaction("snapshots"); const request = tx.objectStore("snapshots").getAll();
      tx.oncomplete = () => resolve(request.result as Snapshot[]); tx.onabort = () => reject(tx.error);
    });
  }
  close() { this.db?.close(); this.db = null; }
}
export class Session {
  state: Workspace = createWorkspace();
  status: "saving" | "saved" | "error" = "saving";
  error = "";
  onStatus: () => void = () => {};
  private acknowledged = 0;
  private running: Promise<void> | null = null;
  private inFlight: Workspace | null = null;
  private undoStack: Workspace[] = [];
  constructor(readonly storage: Storage, readonly journal: DraftJournal) {}
  async load() {
    try {
      const persisted = await this.storage.load();
      if (persisted) this.state = persisted;
      else await this.storage.commit(this.state, 0);
      this.acknowledged = this.state.revision;
      const draft = this.journal.read();
      if (draft) {
        if (JSON.stringify(draft.state) === JSON.stringify(this.state)) this.journal.clear();
        else if (draft.baseRevision === this.acknowledged || (draft.inFlight && JSON.stringify(draft.inFlight) === JSON.stringify(this.state))) { this.state = draft.state; this.start(); await this.flush(); return; }
        else throw new Error("A draft conflicts with stored data. Download drafts before reloading or restoring a backup.");
      }
      this.status = "saved"; this.onStatus();
    } catch (e) { this.report(e); throw e; }
  }
  report(error: unknown) { this.status = "error"; this.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error); this.onStatus(); }
  change(mutate: (w: Workspace) => unknown, remember = true) {
    try {
      const next = structuredClone(this.state); mutate(next); next.revision = this.state.revision + 1;
      validateWorkspace(next, false); this.journal.write({ baseRevision: this.acknowledged, state: next, inFlight: this.inFlight });
      if (remember) { this.undoStack.push(this.state); if (this.undoStack.length > 50) this.undoStack.shift(); }
      this.state = next; this.error = ""; this.status = "saving"; this.onStatus(); this.start();
    } catch (e) { this.report(e); throw e; }
  }
  private start() {
    if (this.running) return;
    this.running = this.saveLoop().finally(() => { this.running = null; });
  }
  private async saveLoop() {
    try {
      while (this.state.revision > this.acknowledged) {
        const target = this.state; this.inFlight = target; this.status = "saving"; this.onStatus();
        await this.storage.commit(target, this.acknowledged); this.acknowledged = target.revision; this.inFlight = null;
        if (this.state.revision === this.acknowledged) this.journal.clear();
        else this.journal.write({ baseRevision: this.acknowledged, state: this.state });
      }
      this.status = this.error ? "error" : "saved"; this.onStatus();
    } catch (e) { this.report(e); }
  }
  async flush() { await this.running; }
  retry() { if (this.state.revision <= this.acknowledged) return; this.error = ""; this.start(); }
  undo() { const before = this.undoStack.at(-1); if (!before) return; this.change(w => undoWorkspace(w, before), false); this.undoStack.pop(); }
  replace(workspace: Workspace) {
    const valid = validateWorkspace(workspace);
    this.change(w => { const revision = w.revision; Object.assign(w, valid, { revision }); }, false); this.undoStack = [];
  }
}
