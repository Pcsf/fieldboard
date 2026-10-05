import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { mkdtemp, copyFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

test("medium widths (1024, 1280, 1440): the view bar stays inside the page and nothing scrolls the page sideways", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-medium-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  const url = pathToFileURL(file).href;
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1024, height: 800 }, acceptDownloads: true });
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
    await page.getByLabel("Project name", { exact: true }).fill("Medium"); await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved();
    for (const width of [900, 940, 980, 1024, 1100, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const m = await page.evaluate(() => {
        const main = document.querySelector("main")!.getBoundingClientRect();
        const bar = [...document.querySelectorAll<HTMLElement>(".viewbar button, .viewbar select, .viewbar .count")].filter(e => e.offsetParent).map(e => ({ text: e.textContent?.trim() || e.getAttribute("aria-label"), right: e.getBoundingClientRect().right }));
        return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, mainRight: main.right, worst: bar.sort((a, b) => b.right - a.right)[0]! };
      });
      expect([width, m.scrollWidth <= m.innerWidth]).toEqual([width, true]);
      expect([width, m.worst.text, m.worst.right <= m.mainRight + 0.5]).toEqual([width, m.worst.text, true]);
    }
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.screenshot({ path: "evidence/medium-width-board.png", fullPage: false, animations: "disabled" });
    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
