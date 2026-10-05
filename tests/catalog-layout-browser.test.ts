import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { mkdtemp, copyFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

test("the IED catalog editor is readable: no sideways scroll, no letter-by-letter wrapping, full subcategory names", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-catalog-layout-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  const url = pathToFileURL(file).href;
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
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
    await page.getByLabel("Project name", { exact: true }).fill("Catalog"); await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved();
    await page.getByRole("button", { name: "Effort & planning", exact: true }).click();
    await page.getByRole("button", { name: "Enable project planning", exact: true }).click(); await saved();
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
      for (const width of [1440, 1024]) {
        await page.setViewportSize({ width, height: 1000 });
        const m = await page.evaluate(() => {
          const root = document.querySelector<HTMLElement>("#catalog-editor")!;
          const tallest = [...root.querySelectorAll<HTMLElement>("button, .catalog-kind")].map(e => ({ text: e.textContent!.trim(), h: e.getBoundingClientRect().height })).sort((a, b) => b.h - a.h)[0]!;
          const names = [...root.querySelectorAll<HTMLInputElement>(".sub-name")].map(i => ({ v: i.value, fits: i.scrollWidth <= i.clientWidth + 1 }));
          const modal = document.querySelector<HTMLElement>("#modal")!;
          return { overflow: root.scrollWidth - root.clientWidth, modalOverflow: modal.scrollWidth - modal.clientWidth, tallest, clipped: names.filter(n => !n.fits).map(n => n.v) };
        });
        expect([theme, width, "overflow", m.overflow <= 1, m.modalOverflow <= 1]).toEqual([theme, width, "overflow", true, true]);
        expect([theme, width, m.tallest.text, m.tallest.h <= 40]).toEqual([theme, width, m.tallest.text, true]);
        if (width === 1440) expect([theme, m.clipped]).toEqual([theme, []]);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator("#catalog-editor").scrollIntoViewIfNeeded();
      await page.locator("#catalog-editor .catalog-category").nth(8).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `evidence/catalog-editor-${theme}.png`, animations: "disabled" });
    }
    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 90000);
