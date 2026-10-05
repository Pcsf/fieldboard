import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { mkdtemp, copyFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

test("phone width (390x844): every sidebar action is reachable through the Menu button", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-phone-menu-"));
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
    const items = ["Workspace & members", "Daily snapshots", "Download backup", "Restore JSON backup", "Help & storage safety"];
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    expect(await menu.getAttribute("aria-expanded")).toBe("false");
    for (const name of items) expect(await page.getByText(name, { exact: false }).first().isVisible()).toBe(false);
    await menu.click(); expect(await menu.getAttribute("aria-expanded")).toBe("true");
    for (const name of items) expect(await page.getByText(name, { exact: false }).first().isVisible()).toBe(true);
    expect(await page.getByLabel("Theme", { exact: true }).isVisible()).toBe(true);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    await page.screenshot({ path: "evidence/phone-menu.png", fullPage: false, animations: "disabled" });
    await page.getByRole("button", { name: /Help & storage safety/ }).click();
    expect(await page.getByRole("heading", { name: "Your work stays here" }).isVisible()).toBe(true);
    expect(await menu.getAttribute("aria-expanded")).toBe("false");
    await page.keyboard.press("Escape");
    await menu.click(); await page.keyboard.press("Escape"); expect(await menu.getAttribute("aria-expanded")).toBe("false");
    await menu.click(); await page.getByRole("button", { name: /Workspace & members/ }).click();
    expect(await page.getByLabel("Workspace name", { exact: true }).isVisible()).toBe(true);
    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
