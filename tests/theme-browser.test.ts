import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdtemp, copyFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const LIGHT_BG = "rgb(251, 252, 250)";
const DARK_BG = "rgb(18, 22, 27)";
const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };
const bg = (p: Page) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
// Theme application follows storage acknowledgement and media changes asynchronously; wait for the settled colour.
const bgIs = async (p: Page, expected: string) => { await p.waitForFunction(c => getComputedStyle(document.body).backgroundColor === c, expected, { timeout: 3000 }).catch(() => {}); expect(await bg(p)).toBe(expected); };
const persisted = (p: Page) => p.evaluate(async () => new Promise<any>(resolve => {
  const r = indexedDB.open("fieldboard", 2); r.onsuccess = () => { const db = r.result; const tx = db.transaction("workspace"); const g = tx.objectStore("workspace").get("current"); tx.oncomplete = () => { resolve(g.result); db.close(); }; };
}));
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

test("theme: follows system live, a manual System/Light/Dark override persists and travels in backups, and no flash when the override matches the system", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-theme-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  const url = pathToFileURL(file).href;
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1440, height: 1000 }, acceptDownloads: true, colorScheme: "light" });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  let page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  await mkdir("evidence", { recursive: true });
  try {
    // Fresh profile, system light, no override yet: the pre-load page already renders in the
    // system theme via CSS alone, before any workspace data or JS theme logic has run.
    await page.goto(url, { waitUntil: "domcontentloaded" });
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
    await bgIs(page, LIGHT_BG);
    await saved(page);
    expect(await page.locator("#theme-select").inputValue()).toBe("system");
    expect(await page.locator('meta[name="color-scheme"]').getAttribute("content")).toBe("light dark");
    await bgIs(page, LIGHT_BG);

    // Populate a real board: several cards, labels, priorities and a due date, for both screenshots.
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Showcase");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);
    const add = async (column: string, title: string) => {
      const col = page.locator(".column").filter({ has: page.getByRole("heading", { name: column, exact: true }) });
      await col.getByRole("button", { name: "Add card at bottom" }).click();
      await page.getByPlaceholder("Card title").fill(title); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    };
    await add("Backlog", "Design review"); await add("To Do", "Ship release"); await add("In Progress", "Fix flaky test"); await add("Done", "Write docs");
    const edit = async (title: string, priority: string, due: string, labels: string) => {
      await page.getByRole("button", { name: `Open card: ${title}`, exact: true }).click();
      await page.getByLabel("Priority", { exact: true }).selectOption({ label: priority });
      await page.getByLabel("Due date", { exact: true }).fill(due); await page.getByLabel("Due date", { exact: true }).press("Tab");
      await page.getByLabel("Label names", { exact: true }).fill(labels); await page.getByLabel("Label names", { exact: true }).press("Tab");
      await saved(page); await page.getByRole("button", { name: "Close card", exact: true }).click();
    };
    await edit("Design review", "High", iso(-1), "Design");
    await edit("Ship release", "Urgent", iso(1), "Release");
    await edit("Fix flaky test", "Medium", "", "Bug");
    await page.screenshot({ path: "evidence/theme-light-board.png", fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Open card: Ship release", exact: true }).click();
    await page.screenshot({ path: "evidence/theme-light-card.png", fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    // A manual override is visible, applies instantly and overrides the live system preference.
    await page.locator("#theme-select").selectOption("dark"); await saved(page);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
    expect(await page.locator('meta[name="color-scheme"]').getAttribute("content")).toBe("dark");
    await bgIs(page, DARK_BG);
    await page.screenshot({ path: "evidence/theme-dark-board.png", fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Open card: Ship release", exact: true }).click();
    await page.screenshot({ path: "evidence/theme-dark-card.png", fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    expect((await persisted(page)).settings.theme).toBe("dark");

    // The override survives reload.
    await page.reload(); await saved(page);
    expect(await page.locator("#theme-select").inputValue()).toBe("dark");
    await bgIs(page, DARK_BG);

    // When the override equals the live system theme, the pre-load CSS render already matches it:
    // no flash from pre-load to post-load.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload({ waitUntil: "domcontentloaded" });
    const preLoad = await bg(page); expect(preLoad).toBe(DARK_BG);
    await saved(page);
    await bgIs(page, preLoad);

    // System mode tracks the OS preference live, with no reload needed.
    await page.locator("#theme-select").selectOption("system"); await saved(page);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
    expect(await page.locator('meta[name="color-scheme"]').getAttribute("content")).toBe("light dark");
    await bgIs(page, DARK_BG);
    await page.emulateMedia({ colorScheme: "light" });
    await bgIs(page, LIGHT_BG);
    await page.emulateMedia({ colorScheme: "dark" });
    await bgIs(page, DARK_BG);

    // The choice travels in JSON backups and restores into a fresh profile.
    await page.locator("#theme-select").selectOption("light"); await saved(page);
    const current = await persisted(page); expect(current.settings.theme).toBe("light");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download backup", exact: true }).click();
    const backup = await download; const backupPath = join(root, "backup.json"); await backup.saveAs(backupPath);
    expect(JSON.parse(await Bun.file(backupPath).text()).settings.theme).toBe("light");
    const fresh = await context.browser()!.newContext({ offline: true, colorScheme: "dark" });
    try {
      const restored = await fresh.newPage();
      await restored.goto(url); await saved(restored);
      restored.once("dialog", d => d.accept());
      await restored.getByLabel("Restore JSON backup").setInputFiles(backupPath);
      await restored.getByRole("button", { name: "Open card: Ship release", exact: true }).waitFor(); await saved(restored);
      expect((await persisted(restored)).settings.theme).toBe("light");
      expect(await restored.locator("#theme-select").inputValue()).toBe("light");
      expect(await restored.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
    } finally { await fresh.close(); }

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
