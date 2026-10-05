import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { mkdtemp, copyFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

test("phone width (390x844): no page scroll, the board scrolls, the sidebar stays out of the way, and a card moves via its \"Move to…\" control", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-phone-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  const url = pathToFileURL(file).href;
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 390, height: 844 }, acceptDownloads: true });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  const saved = () => page.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor();
  const persisted = () => page.evaluate(async () => new Promise<any>(resolve => {
    const r = indexedDB.open("fieldboard", 2); r.onsuccess = () => { const db = r.result; const tx = db.transaction("workspace"); const g = tx.objectStore("workspace").get("current"); tx.oncomplete = () => { resolve(g.result); db.close(); }; };
  }));
  const viewport = { width: 390, height: 844 };
  await mkdir("evidence", { recursive: true });
  try {
    await page.goto(url); await saved();
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Mobile"); await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved();
    const col = page.locator(".column").filter({ has: page.getByRole("heading", { name: "Backlog", exact: true }) });
    await col.getByRole("button", { name: "Add card at bottom" }).click();
    await page.getByPlaceholder("Card title").fill("Pocket card"); await page.getByPlaceholder("Card title").press("Enter"); await saved();

    // No page-level horizontal scroll at phone width.
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    expect(innerWidth).toBe(viewport.width);

    // The board itself scrolls horizontally across its columns.
    const overflow = await page.evaluate(() => { const b = document.querySelector(".board")!; return { scrollWidth: b.scrollWidth, clientWidth: b.clientWidth }; });
    expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);
    await page.evaluate(() => { document.querySelector(".board")!.scrollLeft = 200; });
    expect(await page.evaluate(() => document.querySelector(".board")!.scrollLeft)).toBeGreaterThan(0);
    await page.evaluate(() => { document.querySelector(".board")!.scrollLeft = 0; });

    // The sidebar does not dominate the screen: it occupies a small top strip, not the viewport.
    const sidebarBox = await page.locator(".sidebar").boundingBox();
    expect(sidebarBox!.height).toBeLessThan(viewport.height * 0.3);
    const boardBox = await page.locator(".board").boundingBox();
    expect(boardBox!.height).toBeGreaterThan(viewport.height * 0.3);

    await page.screenshot({ path: "evidence/phone-board.png", fullPage: false });

    // A card can be moved to another column through a control visibly labelled "Move to…".
    await page.getByRole("button", { name: "Open card: Pocket card", exact: true }).click();
    const label = await page.locator(".detail-sidebar .form-field").first().locator("span").textContent();
    expect(label).toBe("Move to…");
    await page.getByLabel("Move to column", { exact: true }).selectOption({ label: "Done" });
    await saved();
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    const before = await persisted(); expect(before.cards[0].completedAt).toBeTruthy();
    await page.reload(); await saved();
    const after = await persisted(); expect(after.cards[0].completedAt).toBeTruthy();
    expect(after.cards[0].columnId).toBe(before.cards[0].columnId);

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
