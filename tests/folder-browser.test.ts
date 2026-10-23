// Folder save in a real Chromium: the app's own File System Access code runs against a genuine
// FileSystemDirectoryHandle (the origin-private file system, which Chromium only exposes on an
// http(s) origin, hence the localhost server below), stored in IndexedDB and reused across reloads.
// Only the native folder picker is replaced, by a stub that hands back that handle: a picker dialog
// cannot be driven from a test. The "work laptop" scenario -- browser site data wiped between
// sessions, the folder untouched -- is simulated by deleting IndexedDB and localStorage on the
// origin while the handle's directory keeps its files.
import { expect, test } from "bun:test";
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };
const folderSaved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved to folder" }).waitFor(); };
const opfsFile = (p: Page, name = "fieldboard.json") => p.evaluate(async n => {
  const dir = await navigator.storage.getDirectory();
  try { return await (await (await dir.getFileHandle(n)).getFile()).text(); } catch { return null; }
}, name);
const opfsNames = (p: Page) => p.evaluate(async () => { const dir = await navigator.storage.getDirectory(); const names: string[] = []; for await (const k of (dir as any).keys()) names.push(k); return names.sort(); });
const addCard = async (p: Page, title: string, column = "Backlog") => {
  const col = p.locator(".column").filter({ has: p.getByRole("heading", { name: column, exact: true }) });
  await col.getByRole("button", { name: "Add card at bottom" }).click();
  await col.getByPlaceholder("Card title").fill(title); await col.getByPlaceholder("Card title").press("Enter"); await saved(p);
};
const wipeSiteData = (p: Page) => p.evaluate(async () => {
  localStorage.clear();
  await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase("fieldboard"); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error("blocked")); });
});

test("folder save: the chosen folder receives every acknowledged change, survives a site-data wipe, reconnects after reload and resolves a conflict by asking", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const html = await Bun.file("dist/fieldboard.html").text();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }) });
  const url = `http://127.0.0.1:${server.port}/fieldboard.html`;
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-folder-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const context: BrowserContext = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1440, height: 1000 }, args: ["--enable-features=FileSystemAccessAPI"] });
  context.setDefaultTimeout(8000);
  const errors: string[] = []; const requests: string[] = [];
  await context.route(/^https?:/, r => { const u = r.request().url(); if (u.startsWith(`http://127.0.0.1:${server.port}/`)) return r.continue(); requests.push(u); return r.abort(); });
  await context.addInitScript(() => { (window as any).showDirectoryPicker = () => navigator.storage.getDirectory(); });
  context.on("page", p => p.on("pageerror", e => errors.push(e.message)));
  let page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(url); await saved(page);
    expect(await page.getByTestId("storage-status").textContent()).toContain("Saved on this device");
    expect(await page.locator("#folder-status").textContent()).toContain("browser only");

    // Choose a folder before any project exists: the file is created from the (empty) workspace.
    await page.getByRole("button", { name: "Choose folder", exact: false }).first().click();
    await folderSaved(page);
    expect(JSON.parse((await opfsFile(page))!).projects).toEqual([]);

    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Folder");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);
    await addCard(page, "Lives on disk"); await folderSaved(page);
    await page.waitForFunction(async () => { const d = await navigator.storage.getDirectory(); const t = await (await (await d.getFileHandle("fieldboard.json")).getFile()).text(); return t.includes("Lives on disk"); });
    const written = JSON.parse((await opfsFile(page))!);
    expect(written.cards[0].title).toBe("Lives on disk"); expect(written.schemaVersion).toBe(2);
    const today = new Date().toLocaleDateString("en-CA");
    expect(await opfsNames(page)).toEqual([`fieldboard-${today}.json`, "fieldboard.json"]);
    await page.screenshot({ path: "evidence/folder-connected.png", animations: "disabled" });

    // Reload: the stored handle is picked up again without a click, and keeps mirroring.
    await page.reload(); await folderSaved(page);
    expect(await page.locator("#folder-status").textContent()).not.toContain("browser only");
    await addCard(page, "After reload"); await folderSaved(page);
    await page.waitForFunction(async () => { const d = await navigator.storage.getDirectory(); const t = await (await (await d.getFileHandle("fieldboard.json")).getFile()).text(); return t.includes("After reload"); });

    // The work-laptop case: the browser forgets everything, the folder does not.
    await page.goto("about:blank");
    const blank = await context.newPage(); await blank.goto(url, { waitUntil: "domcontentloaded" });
    await wipeSiteData(blank).catch(async () => { await blank.waitForTimeout(500); await wipeSiteData(blank); });
    await blank.close();
    page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
    await page.goto(url); await saved(page);
    expect(await page.locator("#welcome").isVisible()).toBe(true);
    await page.screenshot({ path: "evidence/folder-welcome.png", animations: "disabled" });
    await page.getByRole("button", { name: "Open workspace folder", exact: true }).click();
    await folderSaved(page);
    await page.getByRole("button", { name: "Open card: Lives on disk", exact: true }).waitFor(); expect(await page.getByRole("button", { name: "Open card: Lives on disk", exact: true }).isVisible()).toBe(true);
    await page.getByRole("button", { name: "Open card: After reload", exact: true }).waitFor(); expect(await page.getByRole("button", { name: "Open card: After reload", exact: true }).isVisible()).toBe(true);

    // Conflict: both sides hold work and differ. The app asks instead of overwriting either silently.
    await page.goto("about:blank");
    const edit = await context.newPage(); await edit.goto(url, { waitUntil: "domcontentloaded" });
    await edit.evaluate(async () => {
      const d = await navigator.storage.getDirectory(); const f = await d.getFileHandle("fieldboard.json");
      const w = JSON.parse(await (await f.getFile()).text()); w.cards[0].title = "Changed on another computer"; w.cards[0].updatedAt = new Date(Date.now() + 60_000).toISOString();
      const s = await f.createWritable(); await s.write(JSON.stringify(w)); await s.close();
    });
    await edit.close();
    page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
    await page.goto(url); await saved(page);
    await page.getByRole("dialog").filter({ hasText: "differs" }).waitFor(); expect(await page.getByRole("dialog").filter({ hasText: "differs" }).isVisible()).toBe(true);
    await page.screenshot({ path: "evidence/folder-conflict.png", animations: "disabled" });
    await page.getByRole("button", { name: "Load the folder's file", exact: true }).click();
    await folderSaved(page);
    await page.getByRole("button", { name: "Open card: Changed on another computer", exact: true }).waitFor(); expect(await page.getByRole("button", { name: "Open card: Changed on another computer", exact: true }).isVisible()).toBe(true);

    // Disconnecting stops mirroring; the file stays where it is.
    await page.getByRole("button", { name: "Stop saving to folder", exact: true }).click();
    await page.getByTestId("storage-status").filter({ hasText: "Saved on this device" }).waitFor();
    await addCard(page, "Browser only now");
    expect((await opfsFile(page))!).not.toContain("Browser only now");
    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); server.stop(true); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 90000);
