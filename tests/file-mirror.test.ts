import { expect, test } from "bun:test";
import { createWorkspace, createProject, createCard, editCard, type Workspace } from "../src/model";
import { FolderMirror, readFolderWorkspace, writeFolderWorkspace, reconcile, isPristine, lastChange, WORKSPACE_FILE, DAILY_RETENTION, type DirectoryHandleLike, type FileHandleLike } from "../src/file-mirror";

// In-memory stand-in for a FileSystemDirectoryHandle: the same surface the app touches
// (getFileHandle, removeEntry, keys, getFile, createWritable), so the write/prune/read logic runs
// against a real sequence of file operations. The real handle is exercised in tests/folder-browser.test.ts.
class FakeDir implements DirectoryHandleLike {
  files = new Map<string, string>();
  writes = 0;
  failWrites = false;
  constructor(readonly name = "Work") {}
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike> {
    if (!this.files.has(name)) { if (!opts?.create) throw new DOMException(`${name} not found`, "NotFoundError"); this.files.set(name, ""); }
    const dir = this;
    return {
      async getFile() { return { text: async () => dir.files.get(name) ?? "", lastModified: 0, size: (dir.files.get(name) ?? "").length }; },
      async createWritable() {
        let buffer = "";
        return { async write(data: string) { if (dir.failWrites) throw new DOMException("Disk gone", "NotAllowedError"); buffer += data; }, async close() { dir.files.set(name, buffer); dir.writes++; }, async abort() {} };
      },
    };
  }
  async removeEntry(name: string) { if (!this.files.delete(name)) throw new DOMException(`${name} not found`, "NotFoundError"); }
  async *keys() { yield* [...this.files.keys()]; }
}
function populated(title = "Acknowledged"): Workspace { const w = createWorkspace(); createProject(w, "Persisted"); createCard(w, w.columns[0]!.id, title, "bottom"); return w; }
const store = () => { let handle: DirectoryHandleLike | null = null; return { load: async () => handle, save: async (h: DirectoryHandleLike) => { handle = h; }, clear: async () => { handle = null; } }; };

test("read: missing file, invalid JSON, a non-workspace and a valid workspace are told apart", async () => {
  const dir = new FakeDir();
  expect((await readFolderWorkspace(dir)).kind).toBe("missing");
  dir.files.set(WORKSPACE_FILE, "{not json");
  expect((await readFolderWorkspace(dir)).kind).toBe("invalid");
  dir.files.set(WORKSPACE_FILE, JSON.stringify({ schemaVersion: 99 }));
  const bad = await readFolderWorkspace(dir); expect(bad.kind).toBe("invalid"); if (bad.kind === "invalid") expect(bad.error).toContain("schema");
  dir.files.set(WORKSPACE_FILE, JSON.stringify(populated("From disk")));
  const good = await readFolderWorkspace(dir); expect(good.kind).toBe("workspace"); if (good.kind === "workspace") expect(good.workspace.cards[0]!.title).toBe("From disk");
});

test("write: the workspace file plus one dated copy per day, pruned to the retention and never touching other files", async () => {
  const dir = new FakeDir(); dir.files.set("notes.txt", "mine"); dir.files.set("fieldboard-2020-01-01.json.bak", "mine too");
  const w = populated();
  for (let day = 1; day <= DAILY_RETENTION + 3; day++) {
    await writeFolderWorkspace(dir, w, `2026-03-${String(day).padStart(2, "0")}`);
    await writeFolderWorkspace(dir, w, `2026-03-${String(day).padStart(2, "0")}`); // same day twice: one copy
  }
  const dated = [...dir.files.keys()].filter(n => /^fieldboard-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  expect(dated).toHaveLength(DAILY_RETENTION);
  expect(dated[0]).toBe("fieldboard-2026-03-04.json"); expect(dated.at(-1)).toBe("fieldboard-2026-03-10.json");
  expect(dir.files.get("notes.txt")).toBe("mine"); expect(dir.files.get("fieldboard-2020-01-01.json.bak")).toBe("mine too");
  expect(JSON.parse(dir.files.get(WORKSPACE_FILE)!).cards[0].title).toBe("Acknowledged");
  // The dated copy is the same backup format as the main file, restorable with "Restore JSON backup".
  expect(dir.files.get("fieldboard-2026-03-10.json")).toBe(dir.files.get(WORKSPACE_FILE));
});

test("reconcile: missing writes, identical is a no-op, a pristine browser adopts the file, two populated sides ask with the newer side named", () => {
  const local = populated();
  expect(reconcile(local, { kind: "missing" }).action).toBe("write");
  expect(reconcile(local, { kind: "invalid", error: "x" }).action).toBe("invalid");
  const sameButRevision = structuredClone(local); sameButRevision.revision = 42;
  expect(reconcile(local, { kind: "workspace", workspace: sameButRevision, text: "" }).action).toBe("none");
  const fresh = createWorkspace(); expect(isPristine(fresh)).toBe(true); expect(isPristine(local)).toBe(false);
  expect(reconcile(fresh, { kind: "workspace", workspace: local, text: "" }).action).toBe("adopt");
  const older = populated("Older"); const olderChange = lastChange(older)!;
  const newer = structuredClone(local); editCard(newer, newer.cards[0]!.id, { title: "Edited later" });
  newer.cards[0]!.updatedAt = new Date(Date.parse(olderChange) + 60_000).toISOString(); newer.activities.at(-1)!.timestamp = newer.cards[0]!.updatedAt;
  const ask = reconcile(older, { kind: "workspace", workspace: newer, text: "" });
  expect(ask.action).toBe("ask"); if (ask.action === "ask") { expect(ask.fileNewer).toBe(true); expect(ask.fileChanged).toBe(newer.cards[0]!.updatedAt); expect(ask.localChanged).toBe(olderChange); }
  const askBack = reconcile(newer, { kind: "workspace", workspace: older, text: "" });
  expect(askBack.action).toBe("ask"); if (askBack.action === "ask") expect(askBack.fileNewer).toBe(false);
});

test("mirror: rapid changes coalesce into one write of the latest state; an unchanged state is not rewritten; a failed write is reported and retried", async () => {
  const dir = new FakeDir(); const mirror = new FolderMirror(store()); const seen: string[] = [];
  mirror.onStatus = () => seen.push(mirror.status);
  expect(mirror.status).toBe("off");
  await mirror.connect(dir); expect(mirror.status).toBe("synced"); expect(mirror.folderName).toBe("Work");
  const w1 = populated("One"); const w2 = structuredClone(w1); editCard(w2, w2.cards[0]!.id, { title: "Two" }); const w3 = structuredClone(w2); editCard(w3, w3.cards[0]!.id, { title: "Three" });
  mirror.schedule(w1); mirror.schedule(w2); mirror.schedule(w3);
  expect(mirror.status).toBe("writing");
  await mirror.flush();
  expect(dir.writes).toBe(2); // the workspace file and today's dated copy, once
  expect(JSON.parse(dir.files.get(WORKSPACE_FILE)!).cards[0].title).toBe("Three");
  expect(mirror.status).toBe("synced"); expect(seen).toContain("writing");
  mirror.schedule(structuredClone(w3)); await mirror.flush(); expect(dir.writes).toBe(2);
  dir.failWrites = true; const w4 = structuredClone(w3); editCard(w4, w4.cards[0]!.id, { title: "Four" });
  mirror.schedule(w4); await mirror.flush();
  expect(mirror.status).toBe("error"); expect(mirror.error).toContain("Disk gone");
  dir.failWrites = false; mirror.retry(); await mirror.flush();
  expect(mirror.status).toBe("synced"); expect(JSON.parse(dir.files.get(WORKSPACE_FILE)!).cards[0].title).toBe("Four");
  await mirror.disconnect(); expect(mirror.status).toBe("off"); expect(mirror.folderName).toBe("");
});

test("mirror: restore reports a stored handle, and a handle that needs permission is surfaced rather than used", async () => {
  const none = new FolderMirror(store()); expect(await none.restore()).toBe("none");
  const s = store(); const dir = new FakeDir("Granted"); await s.save(dir);
  const granted = new FolderMirror(s); expect(await granted.restore()).toBe("ready"); expect(granted.folderName).toBe("Granted");
  const needsPrompt = Object.assign(new FakeDir("Locked"), { queryPermission: async () => "prompt" as PermissionState, requestPermission: async () => "granted" as PermissionState });
  const s2 = store(); await s2.save(needsPrompt);
  const locked = new FolderMirror(s2); expect(await locked.restore()).toBe("prompt"); expect(locked.status).toBe("prompt");
  expect(await locked.requestAccess()).toBe(true); expect(locked.status).toBe("synced");
});
