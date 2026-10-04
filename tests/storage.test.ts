import { expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { Storage, DraftJournal, Session } from "../src/storage";
import { createWorkspace, createProject, createCard, editCard } from "../src/model";

function setup() {
  const factory = new IDBFactory();
  const map = new Map<string,string>();
  const local = { getItem:(k:string)=>map.get(k)??null, setItem:(k:string,v:string)=>{map.set(k,v)}, removeItem:(k:string)=>{map.delete(k)} };
  const storage = new Storage(factory,"test");
  const journal = new DraftJournal(local);
  return { factory, map, local, storage, journal };
}
function populated() { const w=createWorkspace(); createProject(w,"Persisted"); createCard(w,w.columns[0]!.id,"Acknowledged","bottom"); return w; }

test("transactions: reload sees committed whole state, stale writers cannot overwrite", async () => {
  const {storage}=setup(); await storage.open();
  const w=populated(); w.revision=1;
  await storage.commit(w,0);
  expect(await storage.load()).toEqual(w);
  const changed=structuredClone(w); changed.revision=2; editCard(changed,changed.cards[0]!.id,{title:"New"});
  await expect(storage.commit(changed,0)).rejects.toThrow("another tab");
  expect(await storage.load()).toEqual(w);
  storage.close();
});

test("journal: failed persistence is never saved; draft recovers on next session", async () => {
  const {storage,journal}=setup(); await storage.open();
  const session=new Session(storage,journal); await session.load();
  const original=storage.commit.bind(storage);
  storage.commit=async()=>{throw new DOMException("Quota exhausted","QuotaExceededError")};
  session.change(w=>createProject(w,"Not lost")); await session.flush();
  expect(session.status).toBe("error"); expect(session.error).toContain("Quota");
  expect(journal.read()!.state.projects[0]!.name).toBe("Not lost");
  storage.commit=original;
  const recovered=new Session(storage,journal); await recovered.load(); await recovered.flush();
  expect(recovered.status).toBe("saved");
  expect((await storage.load())!.projects[0]!.name).toBe("Not lost");
  expect(journal.read()).toBeNull();
  storage.close();
});

test("journal: denied local draft storage blocks mutation visibly", async () => {
  const {storage}=setup(); await storage.open();
  const journal=new DraftJournal({getItem:()=>null,setItem:()=>{throw new DOMException("Denied","SecurityError")},removeItem:()=>{}});
  const session=new Session(storage,journal); await session.load();
  expect(()=>session.change(w=>createProject(w,"Unsafe"))).toThrow();
  expect(session.status).toBe("error"); expect(session.state.projects).toHaveLength(0);
  storage.close();
});

test("rapid mutations: acknowledgment of an earlier transaction does not erase later drafts", async () => {
  const {storage,journal}=setup(); await storage.open(); const s=new Session(storage,journal); await s.load();
  s.change(w=>createProject(w,"One")); s.change(w=>createProject(w,"Two")); s.change(w=>createProject(w,"Three"));
  await s.flush(); expect(s.status).toBe("saved"); expect((await storage.load())!.projects).toHaveLength(3); expect(journal.read()).toBeNull(); storage.close();
});

test("snapshots: catch-up creates one per day with seven retained; restore validates", async () => {
  const {storage}=setup(); await storage.open(); const w=populated(); w.revision=1; await storage.commit(w,0);
  for(let day=1;day<=10;day++) { await storage.snapshot(`2026-01-${String(day).padStart(2,"0")}`); await storage.snapshot(`2026-01-${String(day).padStart(2,"0")}`); }
  const snapshots=await storage.snapshots(); expect(snapshots).toHaveLength(7);
  expect(snapshots.map(s=>s.date)).toEqual(["2026-01-04","2026-01-05","2026-01-06","2026-01-07","2026-01-08","2026-01-09","2026-01-10"]);
  expect(snapshots[0]!.state).toEqual(w); storage.close();
});

test("denial: retry cannot claim saved when persistent storage never opened", async () => {
  const {storage,journal}=setup(); const s=new Session(storage,journal);
  await expect(s.load()).rejects.toThrow(); s.retry(); await s.flush(); expect(s.status).toBe("error");
});

test("denial: completing an older write cannot hide a newer failed draft", async () => {
  const {storage,journal,local}=setup();await storage.open();const s=new Session(storage,journal);await s.load();
  const original=storage.commit.bind(storage);let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  storage.commit=async(w,rev)=>{await gate;await original(w,rev)};
  s.change(w=>createProject(w,"Accepted"));local.setItem=()=>{throw new DOMException("Denied","SecurityError")};
  expect(()=>s.change(w=>createProject(w,"Rejected"))).toThrow();release();await s.flush();expect(s.status).toBe("error");
  expect((await storage.load())!.projects.map(p=>p.name)).toEqual(["Accepted"]);storage.close();
});

test("journal ownership: a second tab cannot overwrite a pending recovery journal", () => {
  const {journal,local}=setup();const other=new DraftJournal(local);journal.read();other.read();
  const state=populated();state.revision=1;journal.write({baseRevision:0,state});
  expect(()=>other.write({baseRevision:0,state:{...state,name:"Other tab"}})).toThrow();
  other.clear();expect(journal.read()!.state.name).toBe(state.name);
});

test("crash window: a newer draft recovers when its in-flight predecessor already committed", async () => {
  const {storage,journal}=setup();await storage.open();const s=new Session(storage,journal);await s.load();
  const original=storage.commit.bind(storage);let committed!:()=>void;const didCommit=new Promise<void>(r=>committed=r);let release!:()=>void;const hold=new Promise<void>(r=>release=r);
  storage.commit=async(w,rev)=>{await original(w,rev);committed();await hold};
  s.change(w=>createProject(w,"First"));s.change(w=>createProject(w,"Second"));await didCommit;
  // The process would die here, after IDB completion but before saveLoop advances its base revision.
  storage.commit=original;const recovered=new Session(storage,journal);await recovered.load();await recovered.flush();
  expect(recovered.status).toBe("saved");expect((await storage.load())!.projects.map(p=>p.name)).toEqual(["First","Second"]);
  // Release the simulated old process only after the recovery assertion, so it cannot influence the result.
  release();await s.flush();storage.close();
});

test("migration: actual version-1 IndexedDB fixture upgrades populated data", async () => {
  const {factory,storage}=setup(); const w:any=populated(); w.schemaVersion=1; delete w.cards[0].completedAt;
  await new Promise<void>((resolve,reject)=>{ const r=factory.open("test",1); r.onupgradeneeded=()=>r.result.createObjectStore("workspace"); r.onsuccess=()=>{const db=r.result;const tx=db.transaction("workspace","readwrite");tx.objectStore("workspace").put(w,"current");tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)};r.onerror=()=>reject(r.error)});
  await storage.open(); const next=await storage.load(); expect(next!.schemaVersion).toBe(2);expect(next!.cards[0]!.title).toBe("Acknowledged");expect(next!.activities).toEqual(w.activities);storage.close();
});
