import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdtemp, mkdir, copyFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

let context: BrowserContext;
let page: Page;
let isolated: string;
let profile: string;
let url: string;
let temporaryRoot: string;
let socketRoot: string;
const errors: string[]=[];
const requests: string[]=[];
const sandboxException=process.getuid?.()===0;
async function launch(userProfile=profile) {
  const c=await chromium.launchPersistentContext(userProfile, { executablePath:process.env.CHROMIUM_PATH||"/usr/sbin/chromium", headless:true, env:{...process.env,TMPDIR:socketRoot}, chromiumSandbox:!sandboxException, viewport:{width:1440,height:1000}, acceptDownloads:true });
  c.setDefaultTimeout(8000);
  await c.setOffline(true);
  await c.route(/^https?:/,r=>{requests.push(r.request().url());return r.abort()});
  c.on("page",p=>p.on("pageerror",e=>errors.push(e.message)));
  const p=c.pages()[0]??await c.newPage(); p.on("pageerror",e=>errors.push(e.message));
  await p.goto(url); await p.getByTestId("storage-status").filter({hasText:"Saved"}).waitFor();
  return {c,p};
}
async function saved(p=page) { await p.getByTestId("storage-status").filter({hasText:"Saved"}).waitFor(); }
async function reload() { await saved(); await page.reload(); await saved(); }
async function add(title:string,column="Backlog") {
  const col=page.locator(".column").filter({has:page.getByRole("heading",{name:column,exact:true})});
  await col.getByRole("button",{name:"Add card at bottom"}).click();
  await col.getByPlaceholder("Card title").fill(title); await col.getByPlaceholder("Card title").press("Enter"); await saved();
}
async function open(title:string) { await page.getByRole("button",{name:`Open card: ${title}`,exact:true}).click(); }
async function closeDetail() { await page.getByRole("button",{name:"Close card"}).click(); }
async function state(p=page) { return p.evaluate(async()=>new Promise<any>((resolve,reject)=>{const r=indexedDB.open("fieldboard",2);r.onsuccess=()=>{const db=r.result;const tx=db.transaction("workspace");const g=tx.objectStore("workspace").get("current");g.onsuccess=()=>resolve(g.result);tx.oncomplete=()=>db.close()};r.onerror=()=>reject(r.error)})); }

beforeAll(async()=>{
  // Bun 1.3.x drops Playwright's browser pipe mid-suite; the browser exits and later tests hang.
  if(Bun.semver.order(Bun.version,"1.4.0")<0) throw new Error(`Browser tests need Bun 1.4.0 or later; found ${Bun.version}.`);
  const build=Bun.spawn(["bun","scripts/build.ts"],{stdout:"pipe",stderr:"pipe"});
  const status=await build.exited; if(status!==0) throw new Error(await new Response(build.stderr).text());
  temporaryRoot=await mkdtemp(join(process.cwd(),".fieldboard-test-"));
  // Chromium creates its singleton socket under TMPDIR, and Unix socket paths are capped at 108 bytes.
  socketRoot=await mkdtemp(join(tmpdir(),"fb-"));
  isolated=await mkdtemp(join(temporaryRoot,"isolated-"));profile=await mkdtemp(join(temporaryRoot,"profile-"));
  await copyFile("dist/fieldboard.html",join(isolated,"fieldboard.html")); expect(await readdir(isolated)).toEqual(["fieldboard.html"]);
  url=pathToFileURL(join(isolated,"fieldboard.html")).href;
  await mkdir("evidence",{recursive:true});
  ({c:context,p:page}=await launch());
  await Bun.write("evidence/browser-environment.json",JSON.stringify({browser:context.browser()!.version(),platform:process.platform,offline:true,url,rootSandboxException:sandboxException,note:sandboxException?"Root sandbox requires no-sandbox; unflagged Linux acceptance remains open":"Sandbox enabled",testedAt:new Date().toISOString()},null,2));
},60000);
afterAll(async()=>{await context?.close().catch(()=>{});if(temporaryRoot)await rm(temporaryRoot,{recursive:true,force:true});if(socketRoot)await rm(socketRoot,{recursive:true,force:true});});

test("offline lifecycle: project, inline card, details, filters, archive, restore, delete and undo survive reload",async()=>{
  await page.screenshot({path:"evidence/01-offline-first-launch.png",fullPage:true});
  await page.getByRole("button",{name:"New project",exact:true}).click();
  await page.getByLabel("Project name",{exact:true}).fill("Launch");await page.getByRole("button",{name:"Create project",exact:true}).click();await saved();
  await add("Ship offline"); await reload(); expect((await state()).cards[0].title).toBe("Ship offline");
  await open("Ship offline");
  await page.getByLabel("Title",{exact:true}).fill("Ship safely");
  await page.getByLabel("Description",{exact:true}).fill("# Ready\n**Offline**\n![no image](https://evil.test/pixel)\n<script>window.pwned=1</script>");
  await page.getByLabel("Priority",{exact:true}).selectOption("high");
  await page.getByLabel("Due date",{exact:true}).fill("2026-01-01");
  await page.getByLabel("Label names",{exact:true}).fill("Release, Bug"); await page.getByLabel("Label names",{exact:true}).press("Tab");
  await page.getByLabel("Assign to Me",{exact:true}).check();
  await page.getByPlaceholder("Add subtask").fill("Verify backup");await page.getByPlaceholder("Add subtask").press("Enter");
  await page.getByLabel("Complete subtask: Verify backup",{exact:true}).check();
  await page.getByPlaceholder("Write a comment").fill("Looks **good**");await page.getByRole("button",{name:"Add comment",exact:true}).click();
  await saved();expect(await page.locator(".markdown strong").first().textContent()).toBe("Offline");
  expect(await page.locator(".markdown img,.markdown script").count()).toBe(0);
  await page.screenshot({path:"evidence/06-card-details.png",fullPage:true});
  await closeDetail();await reload();
  await page.screenshot({path:"evidence/07-card-metadata.png",fullPage:true});
  let w=await state();expect(w.cards[0].priority).toBe("high");expect(w.cards[0].subtasks[0].done).toBe(true);expect(w.cards[0].comments).toHaveLength(1);expect(w.cards[0].labels).toHaveLength(2);expect(w.cards[0].assignees).toHaveLength(1);
  await page.getByPlaceholder("Search cards").fill("nothere");expect(await page.locator(".card").count()).toBe(0);
  await page.getByPlaceholder("Search cards").fill("Offline");expect(await page.locator(".card").count()).toBe(1);
  await page.getByLabel("Filter priority").selectOption("urgent");expect(await page.locator(".card").count()).toBe(0);
  expect(page.url()).toContain("priority=urgent");await page.reload();await saved();expect(await page.getByLabel("Filter priority").inputValue()).toBe("urgent");
  await page.getByRole("button",{name:"Clear filters",exact:true}).click();
  await open("Ship safely");await page.getByLabel("Move to column").selectOption({label:"Done"});await saved();await closeDetail();await reload();w=await state();expect(w.cards[0].completedAt).toBeTruthy();
  await open("Ship safely");await page.getByRole("button",{name:"Archive card",exact:true}).click();await reload();expect((await state()).cards[0].archived).toBe(true);expect(await page.locator(".card").count()).toBe(0);
  await page.getByRole("button",{name:"Archive",exact:true}).click();await page.getByRole("button",{name:"Restore Ship safely",exact:true}).click();await saved();await page.getByRole("button",{name:"Close archive"}).click();await reload();
  expect((await state()).cards[0].archived).toBe(false);
  await open("Ship safely");page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"Delete card permanently",exact:true}).click();await saved();expect((await state()).cards).toHaveLength(0);
  await page.keyboard.press("Control+z");await saved();expect((await state()).cards[0].title).toBe("Ship safely");
  await open("Ship safely");page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"Delete card permanently",exact:true}).click();await reload();expect((await state()).cards).toHaveLength(0);
  expect((await state()).activities.some((a:any)=>a.action==="undo")).toBe(true);
  await add("Drag A");await add("Drag B");await add("Drag C");
  await page.screenshot({path:"evidence/02-board.png",fullPage:true});
  expect(errors).toEqual([]);expect(requests).toEqual([]);
},60000);

test("restart: actual drag order persists after browser shutdown and same-profile file reopen",async()=>{
  await page.getByRole("button",{name:"Open card: Drag C",exact:true}).dragTo(page.getByRole("button",{name:"Open card: Drag A",exact:true})); await saved();
  const before=await state();const order=before.cards.slice().sort((a:any,b:any)=>a.position-b.position).map((c:any)=>c.title);expect(order).toEqual(["Drag C","Drag A","Drag B"]);
  await context.close();({c:context,p:page}=await launch()); expect(await state()).toEqual(before);
  await page.screenshot({path:"evidence/03-restarted.png",fullPage:true});
},30000);

test("backup: downloaded workspace restores losslessly into a fresh offline profile",async()=>{
  await open("Drag B");await page.getByLabel("Description",{exact:true}).fill("Backup fixture with **metadata**");await page.getByLabel("Label names",{exact:true}).fill("Release");await page.getByLabel("Label names",{exact:true}).press("Tab");await page.getByLabel("Assign to Me",{exact:true}).check();await page.getByPlaceholder("Add subtask").fill("Roundtrip checklist");await page.getByPlaceholder("Add subtask").press("Enter");await saved();await page.getByPlaceholder("Write a comment").fill("Roundtrip comment");await page.getByRole("button",{name:"Add comment",exact:true}).click();await saved();await closeDetail();
  const before=await state();const download=page.waitForEvent("download");await page.getByRole("button",{name:"Download backup",exact:true}).click();const backup=await download;await backup.saveAs("evidence/workspace-backup.json");
  const fresh=await mkdtemp(join(temporaryRoot,"restore-"));const {c,p}=await launch(fresh);
  try { p.once("dialog",d=>d.accept());await p.getByLabel("Restore JSON backup").setInputFiles("evidence/workspace-backup.json");await saved(p);
    const restored=await state(p);expect({...restored,revision:before.revision}).toEqual(before);
    await p.reload();await saved(p);expect({...await state(p),revision:before.revision}).toEqual(before);
    await p.screenshot({path:"evidence/04-restored.png",fullPage:true});
  } finally {await c.close();}
},30000);

test("quota and denial: failed writes show error, preserve local draft and recover",async()=>{
  await open("Drag A");
  await page.evaluate(()=>{IDBObjectStore.prototype.put=function(){throw new DOMException("Injected quota exhaustion","QuotaExceededError")}});
  await page.getByLabel("Title",{exact:true}).fill("Retained draft");
  await page.getByTestId("storage-status").filter({hasText:"Not saved"}).waitFor();
  expect(await page.evaluate(()=>!!localStorage.getItem("fieldboard-draft"))).toBe(true);
  expect((await state()).cards.some((c:any)=>c.title==="Retained draft")).toBe(false);
  await page.screenshot({path:"evidence/05-write-error.png",fullPage:true});
  await page.reload();await saved();expect((await state()).cards.some((c:any)=>c.title==="Retained draft")).toBe(true);
  await open("Retained draft");
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException("Injected storage denial","SecurityError")}});
  await page.getByLabel("Title",{exact:true}).fill("Denied edit");await page.getByTestId("storage-status").filter({hasText:"Not saved"}).waitFor();
  expect((await state()).cards.some((c:any)=>c.title==="Denied edit")).toBe(false);
  await page.reload();await saved();expect((await state()).cards.some((c:any)=>c.title==="Retained draft")).toBe(true);
},30000);

test("crash: termination during active strict transaction preserves acknowledged state atomically",async()=>{
  const before=await state();
  await page.evaluate(async()=>new Promise<void>((resolve,reject)=>{const r=indexedDB.open("fieldboard",2);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const tx=db.transaction("workspace","readwrite",{durability:"strict"});const store=tx.objectStore("workspace");const g=store.get("current");g.onsuccess=()=>{const next=g.result;next.name="Unacknowledged crash write";next.revision++;store.put(next,"current");let n=0;const keepAlive=()=>{const q=store.get("current");q.onsuccess=()=>{n++;if(n===1)resolve();keepAlive()}};keepAlive()}}}));
  const browserPids: number[]=[];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    // Some Linux Chromium builds rewrite their argv into one space-joined string.
    try { const args=(await Bun.file(`/proc/${entry}/cmdline`).text()).split(/[\0 ]/); if(args.includes(`--user-data-dir=${profile}`) && !args.some(a=>a.startsWith("--type="))) browserPids.push(Number(entry)); } catch { /* process exited */ }
  }
  expect(browserPids).toHaveLength(1);
  process.kill(browserPids[0]!,"SIGKILL");
  await Promise.race([context.close().catch(()=>{}),new Promise(r=>setTimeout(r,1500))]);
  ({c:context,p:page}=await launch());expect(await state()).toEqual(before);
  await Bun.write("evidence/crash-result.json",JSON.stringify({activeStrictTransaction:true,previousAcknowledgmentSurvived:true,atomicOldState:true,revision:before.revision},null,2));
},30000);

test("columns: create, rename, drag, flag done and relocate cards on deletion",async()=>{
  await page.getByRole("button",{name:"+ Add column",exact:true}).click();
  await page.getByLabel("Column name",{exact:true}).fill("Waiting");await page.getByRole("button",{name:"Create column",exact:true}).click();await saved();
  await page.getByRole("button",{name:"Edit column Waiting",exact:true}).click();await page.getByLabel("Column name",{exact:true}).fill("Accepted");await page.getByLabel("Cards here are done").check();await saved();await page.getByRole("button",{name:"Close dialog",exact:true}).click();
  const col=page.locator(".column").filter({has:page.getByRole("heading",{name:"Accepted",exact:true})});
  await col.getByRole("button",{name:"Add card at top"}).click();await col.getByPlaceholder("Card title").fill("Top card");await col.getByPlaceholder("Card title").press("Enter");await saved();
  expect((await state()).cards.find((c:any)=>c.title==="Top card").completedAt).toBeTruthy();
  await page.setViewportSize({width:2200,height:1000});
  await col.locator(".column-heading").dragTo(page.locator(".column").filter({has:page.getByRole("heading",{name:"Backlog",exact:true})}).locator(".column-heading"));await saved();await reload();
  expect((await state()).columns.find((c:any)=>c.name==="Accepted").position).toBe(0);
  await page.getByRole("button",{name:"Edit column Accepted",exact:true}).click();
  await page.getByLabel("Column deletion destination").selectOption({label:"To Do"});page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"Delete column",exact:true}).click();await reload();
  const w=await state();const card=w.cards.find((c:any)=>c.title==="Top card");expect(card.columnId).toBe(w.columns.find((c:any)=>c.name==="To Do").id);expect(card.completedAt).toBeNull();expect(w.columns.some((c:any)=>c.name==="Accepted")).toBe(false);
},30000);

test("existing column name and done flag save automatically without an apply button",async()=>{
  await page.getByRole("button",{name:"Edit column Review",exact:true}).click();
  await page.getByLabel("Column name",{exact:true}).fill("Quality review");await page.getByLabel("Cards here are done").check();
  await state();expect((await state()).columns.some((c:any)=>c.name==="Quality review" && c.done)).toBe(true);
  await page.getByRole("button",{name:"Close dialog",exact:true}).click();await reload();expect((await state()).columns.some((c:any)=>c.name==="Quality review" && c.done)).toBe(true);
},20000);

test("draft text survives reload before submission; invalid restore never replaces data",async()=>{
  const col=page.locator(".column").filter({has:page.getByRole("heading",{name:"Backlog",exact:true})});
  await col.getByRole("button",{name:"Add card at bottom"}).click();await col.getByPlaceholder("Card title").fill("Unsubmitted text");await page.reload();await saved();
  await col.getByRole("button",{name:"Add card at bottom"}).click();expect(await col.getByPlaceholder("Card title").inputValue()).toBe("Unsubmitted text");await col.getByPlaceholder("Card title").press("Escape");
  const before=await state();await page.getByLabel("Restore JSON backup").setInputFiles({name:"broken.json",mimeType:"application/json",buffer:Buffer.from('{"schemaVersion":999}')});
  await page.getByTestId("storage-status").filter({hasText:"Not saved"}).waitFor();expect(await state()).toEqual(before);
  await page.reload();await saved();
},20000);

test("initial IndexedDB denial stays visibly unavailable after retry",async()=>{
  const fresh=await mkdtemp(join(temporaryRoot,"denied-"));const {c,p}=await launch(fresh);
  try {await p.addInitScript(()=>{IDBFactory.prototype.open=function(){throw new DOMException("Storage denied","SecurityError")}});await p.reload();
    await p.getByTestId("storage-status").filter({hasText:"Not saved"}).waitFor();await p.getByRole("button",{name:"Retry write",exact:true}).click();
    expect(await p.getByTestId("storage-status").textContent()).toContain("Not saved");
  } finally {await c.close();}
},20000);

test("second tab cannot edit the same browser workspace concurrently",async()=>{
  const other=await context.newPage();try {await other.goto(url);await other.getByTestId("storage-status").filter({hasText:"Not saved"}).waitFor();expect(await other.locator("#error-message").textContent()).toContain("another tab");}finally{await other.close()}
},15000);

test("failed text draft remains visible through unrelated edits and is never reported saved",async()=>{
  await open("Top card");await page.getByPlaceholder("Add subtask").fill("Retain text");await page.getByPlaceholder("Add subtask").press("Enter");await saved();
  await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==="fieldboard-text" && value.includes("Rejected description"))throw new DOMException("Text journal full","QuotaExceededError");set.call(this,key,value)}});
  await page.getByLabel("Description",{exact:true}).fill("Rejected description must survive");await page.getByLabel("Complete subtask: Retain text",{exact:true}).check();
  await state();expect(await page.getByLabel("Description",{exact:true}).inputValue()).toBe("Rejected description must survive");expect(await page.getByTestId("storage-status").textContent()).toContain("Not saved");
  await page.getByLabel("Description",{exact:true}).fill("Recovered description");await saved();await closeDetail();
},20000);

test("snapshot startup failure does not duplicate the undo keyboard handler",async()=>{
  const fresh=await mkdtemp(join(temporaryRoot,"snapshot-failure-"));const {c,p}=await launch(fresh);
  try {
    await p.addInitScript(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args:Parameters<typeof original>){if(Array.isArray(args[0]) && args[0].includes("snapshots"))throw new DOMException("Snapshot quota","QuotaExceededError");return original.apply(this,args)}});
    await p.reload();await p.getByTestId("storage-status").filter({hasText:"Not saved"}).waitFor();
    for(const title of ["First project","Second project"]){await p.getByRole("button",{name:"New project",exact:true}).click();await p.getByLabel("Project name",{exact:true}).fill(title);await p.getByRole("button",{name:"Create project",exact:true}).click();await saved(p)}
    await p.keyboard.press("Control+z");await saved(p);expect((await state(p)).projects.map((x:any)=>x.name)).toEqual(["First project"]);
  } finally {await c.close();}
},20000);

test("daily snapshots catch up, retain seven days and restore through the delivered UI",async()=>{
  const fresh=await mkdtemp(join(temporaryRoot,"snapshots-"));const {c,p}=await launch(fresh);
  const snapshots=()=>p.evaluate(async()=>new Promise<any[]>((resolve,reject)=>{const r=indexedDB.open("fieldboard",2);r.onsuccess=()=>{const db=r.result;const tx=db.transaction("snapshots");const g=tx.objectStore("snapshots").getAll();g.onsuccess=()=>resolve(g.result);tx.oncomplete=()=>db.close();tx.onabort=()=>reject(tx.error)}}));
  try {
    const imported=await state();p.once("dialog",d=>d.accept());await p.getByLabel("Restore JSON backup").setInputFiles({name:"snapshot-fixture.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(imported))});await p.getByRole("button",{name:`Open card: ${imported.cards[0].title}`,exact:true}).waitFor();await saved(p);
    const start=Date.parse("2030-01-01T12:00:00Z");await p.clock.install({time:start});await p.reload();await saved(p);
    for(let day=1;day<=8;day++){await p.clock.setSystemTime(start+day*86400000);await p.clock.fastForward(61000);await snapshots()}
    const kept=await snapshots();expect(kept).toHaveLength(7);expect(kept[0].date).toBe("2030-01-03");
    await p.getByRole("button",{name:`Open card: ${imported.cards[0].title}`,exact:true}).click();await p.getByLabel("Title",{exact:true}).fill("Changed after snapshot");await saved(p);await p.getByRole("button",{name:"Close card"}).click();
    await p.getByRole("button",{name:/Daily snapshots/}).click();p.once("dialog",d=>d.accept());await p.getByRole("button",{name:`Restore ${kept[0].date}`,exact:true}).click();await p.getByRole("button",{name:`Open card: ${imported.cards[0].title}`,exact:true}).waitFor();await saved(p);
    expect({...await state(p),revision:kept[0].state.revision}).toEqual(kept[0].state);
  } finally {await c.close();}
},30000);

test("actual localStorage quota exhaustion is visibly unsaved",async()=>{
  const fresh=await mkdtemp(join(temporaryRoot,"quota-"));const {c,p}=await launch(fresh);
  try {
    const exhausted=await p.evaluate(()=>{let i=0;let quota=false;for(const size of [16384,1024,100]){try{for(let j=0;j<10000;j++)localStorage.setItem(`quota-fill-${i++}`,"x".repeat(size))}catch(e){quota=e instanceof DOMException && e.name==="QuotaExceededError"}}return quota});expect(exhausted).toBe(true);
    await p.getByRole("button",{name:"New project",exact:true}).click();await p.getByLabel("Project name",{exact:true}).fill("Long unsaved project name ".repeat(20));await p.getByRole("button",{name:"Create project",exact:true}).click();
    await p.getByTestId("storage-status").filter({hasText:"Not saved"}).waitFor();expect((await state(p)).projects).toHaveLength(0);
  } finally {await c.close();}
},30000);

test("performance: built file renders 1000 cards and measures local move acknowledgment",async()=>{
  const fixture=await state();const template=fixture.cards[0];const columns=fixture.columns.slice().sort((a:any,b:any)=>a.position-b.position);
  fixture.cards=Array.from({length:1000},(_,i)=>({...structuredClone(template),id:`perf-${i}`,title:`Performance card ${i}`,columnId:columns[i%columns.length].id,position:Math.floor(i/columns.length),completedAt:columns[i%columns.length].done?template.updatedAt:null}));
  fixture.activities=fixture.cards.map((card:any)=>({id:`activity-${card.id}`,cardId:card.id,actor:fixture.settings.actorId,action:"create",before:null,after:structuredClone(card),timestamp:card.createdAt}));
  const fresh=await mkdtemp(join(temporaryRoot,"perf-"));const {c,p}=await launch(fresh);
  try {
    await Bun.write("evidence/1000-card-fixture.json",JSON.stringify(fixture));
    p.once("dialog",d=>d.accept());await p.getByLabel("Restore JSON backup").setInputFiles("evidence/1000-card-fixture.json");
    await p.waitForFunction(()=>document.querySelectorAll(".card").length===1000);await saved(p);
    expect(await p.locator(".card").count()).toBe(1000);
    await p.evaluate(()=>{
      const values={start:0,commitMs:0,feedbackMs:0};(window as any).__perf=values;
      document.addEventListener("drop",()=>values.start=performance.now(),true);
      document.addEventListener("dragstart",()=>{const start=performance.now();requestAnimationFrame(()=>values.feedbackMs=performance.now()-start)},true);
      const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args:Parameters<typeof original>){const tx=original.apply(this,args);if(args[1]==="readwrite")tx.addEventListener("complete",()=>{if(values.start)values.commitMs=performance.now()-values.start});return tx};
    });
    await p.getByRole("button",{name:"Open card: Performance card 0",exact:true}).dragTo(p.locator(".column").nth(1).locator(".column-heading"));await saved(p);
    const metrics=await p.evaluate(()=>({...(window as any).__perf,userAgent:navigator.userAgent,cardCount:document.querySelectorAll(".card").length}));
    await Bun.write("evidence/performance.json",JSON.stringify({...metrics,note:"Headless container measurement, not a mid-range laptop 60 fps certification."},null,2));
    expect(metrics.commitMs).toBeGreaterThan(0);expect(metrics.commitMs).toBeLessThan(100);expect(metrics.feedbackMs).toBeLessThan(50);
  } finally {await c.close();}
},30000);

test("security: CSP and Markdown cause zero external resource requests or application errors",async()=>{
  expect(requests).toEqual([]);expect(errors).toEqual([]);
  const csp=await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");expect(csp).toContain("connect-src 'none'");expect(csp).toContain("img-src 'none'");
});
