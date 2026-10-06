import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };

test("delivered list view: sortable, groupable table honours filters, keeps sort/group in the URL and reopens a card", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-listview-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(pathToFileURL(file).href); await saved(page);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("List project");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);
    for (const title of ["Zebra task", "Apple task", "Mango task"]) {
      await page.locator(".column").first().getByRole("button", { name: "Add card at bottom" }).click();
      await page.getByPlaceholder("Card title").fill(title); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    }
    await page.getByRole("button", { name: "Open card: Apple task", exact: true }).click();
    await page.getByLabel("Priority", { exact: true }).selectOption("urgent"); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.getByRole("button", { name: "Open card: Mango task", exact: true }).click();
    await page.getByLabel("Priority", { exact: true }).selectOption("high"); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await page.getByRole("tab", { name: "List", exact: true }).click();
    expect(await page.locator(".list-row").count()).toBe(3);
    // Default sort is by title ascending.
    expect(await page.locator(".list-row td:first-child").allTextContents()).toEqual(["Apple task", "Mango task", "Zebra task"]);
    expect(await page.locator("#board").isHidden()).toBe(true);

    await page.getByRole("button", { name: "Sort by Priority", exact: true }).click();
    expect(await page.locator(".list-row td:first-child").allTextContents()).toEqual(["Zebra task", "Mango task", "Apple task"]);
    expect(page.url()).toContain("sort=priority%3Aasc");
    await page.getByRole("button", { name: "Sort by Priority", exact: true }).click();
    expect(await page.locator(".list-row td:first-child").allTextContents()).toEqual(["Apple task", "Mango task", "Zebra task"]);
    expect(page.url()).toContain("sort=priority%3Adesc");

    await page.getByLabel("Group list by", { exact: true }).selectOption("priority");
    expect(await page.locator(".list-group-row").count()).toBe(3);
    expect(page.url()).toContain("group=priority");
    await page.screenshot({ path: "evidence/list-view.png", fullPage: true, animations: "disabled" });

    await page.reload(); await saved(page);
    expect(page.url()).toContain("view=list");
    expect(await page.locator(".list-group-row").count()).toBe(3);
    // Groups keep their own canonical (priority-rank) order independent of the active sort direction,
    // which the sort itself still governs within each single-card group here.
    expect(await page.locator(".list-row td:first-child").allTextContents()).toEqual(["Zebra task", "Mango task", "Apple task"]);

    await page.getByPlaceholder("Search cards").fill("Mango");
    expect(await page.locator(".list-row").count()).toBe(1);
    await page.getByPlaceholder("Search cards").fill("");

    await page.getByRole("button", { name: "Open card: Mango task", exact: true }).click();
    expect(await page.getByLabel("Title", { exact: true }).inputValue()).toBe("Mango task");
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await page.getByRole("tab", { name: "Board", exact: true }).click();
    expect(await page.locator("#board").isVisible()).toBe(true);
    expect(page.url()).not.toContain("view=");

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 30000);
