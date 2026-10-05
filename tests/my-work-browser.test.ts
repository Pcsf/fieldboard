import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };
const addCard = async (p: Page, title: string) => {
  await p.locator(".column").first().getByRole("button", { name: "Add card at bottom" }).click();
  await p.getByPlaceholder("Card title").fill(title); await p.getByPlaceholder("Card title").press("Enter"); await saved(p);
};

test("delivered My work: cross-project grouping by due state, and opening a row switches to its own project and board, offline", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-mywork-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1440, height: 1100 }, acceptDownloads: true, colorScheme: "light" });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(pathToFileURL(file).href); await saved(page);

    // Nothing assigned anywhere yet.
    await page.getByRole("button", { name: "My work", exact: true }).click();
    expect(await page.locator("#my-work-list").textContent()).toContain("Nothing assigned to you right now.");
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Alpha");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);
    await addCard(page, "Alpha overdue");
    await page.getByRole("button", { name: "Open card: Alpha overdue", exact: true }).click();
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    await page.getByLabel("Due date", { exact: true }).fill(yesterday); await page.getByLabel("Due date", { exact: true }).press("Tab"); await saved(page);
    await page.getByLabel("Assign to Me", { exact: true }).check(); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await addCard(page, "Alpha unassigned"); // stays out of My work entirely

    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Beta");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);
    await addCard(page, "Beta no date");
    await page.getByRole("button", { name: "Open card: Beta no date", exact: true }).click();
    await page.getByLabel("Assign to Me", { exact: true }).check(); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await page.getByRole("button", { name: "My work", exact: true }).click();
    const list = page.locator("#my-work-list");
    expect(await list.locator(".my-work-group", { hasText: "Overdue" }).count()).toBe(1);
    expect(await list.locator(".my-work-row", { hasText: "Alpha overdue" }).textContent()).toContain("Alpha");
    expect(await list.locator(".my-work-group", { hasText: "No date" }).locator(".my-work-row").count()).toBe(1);
    expect(await list.getByRole("button", { name: "Open card: Alpha unassigned" }).count()).toBe(0);

    await page.screenshot({ path: "evidence/my-work.png", fullPage: true, animations: "disabled" });

    // Opening a row from the OTHER project switches context and opens that card.
    await list.getByRole("button", { name: "Open card: Beta no date" }).click();
    expect(await page.locator("#breadcrumb-project").textContent()).toBe("Beta");
    expect(await page.locator("#detail").isVisible()).toBe(true);
    expect(await page.locator("#detail .title-input").inputValue()).toBe("Beta no date");
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    // Completing the overdue card moves it into the collapsed Done group.
    await page.locator("#projects [data-project]", { hasText: "Alpha" }).click(); await saved(page);
    await page.getByRole("button", { name: "Open card: Alpha overdue", exact: true }).click();
    await page.getByLabel("Move to column", { exact: true }).selectOption({ label: "Done" }); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.getByRole("button", { name: "My work", exact: true }).click();
    expect(await page.locator("#my-work-list .my-work-group", { hasText: "Overdue" }).count()).toBe(0);
    await page.locator("#my-work-list summary").click();
    expect(await page.locator("#my-work-list .my-work-row", { hasText: "Alpha overdue" }).count()).toBe(1);

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
