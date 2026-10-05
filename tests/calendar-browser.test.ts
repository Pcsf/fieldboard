import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };
const today = () => new Date().toLocaleDateString("en-CA");

test("delivered calendar view: drag from No due date onto today, persisted dueDate survives reload, offline", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-calendar-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  context.setDefaultTimeout(6000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(pathToFileURL(file).href); await saved(page);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Calendar project");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);

    await page.locator(".column").first().getByRole("button", { name: "Add card at bottom" }).click();
    await page.getByPlaceholder("Card title").fill("Plan the release"); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);

    await page.getByRole("button", { name: "Calendar", exact: true }).click();
    expect(page.url()).toContain("view=calendar");
    expect(await page.locator("#board").isHidden()).toBe(true);
    expect(await page.getByRole("button", { name: "Calendar", exact: true }).getAttribute("aria-pressed")).toBe("true");
    const sidebarCard = page.locator('[data-calendar-nodate]').getByRole("button", { name: "Open card: Plan the release", exact: true });
    await sidebarCard.waitFor();

    const todayCell = page.locator(`[data-calendar-day="${today()}"]`);
    await todayCell.waitFor();
    await sidebarCard.dragTo(todayCell); await saved(page);
    expect(await sidebarCard.count()).toBe(0);
    const chipOnToday = todayCell.getByRole("button", { name: "Open card: Plan the release", exact: true });
    await chipOnToday.waitFor();

    await chipOnToday.click();
    expect(await page.getByLabel("Due date", { exact: true }).inputValue()).toBe(today());
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.screenshot({ path: "evidence/calendar-view.png", fullPage: true, animations: "disabled" });

    await page.reload(); await saved(page);
    expect(page.url()).toContain("view=calendar");
    const persistedChip = page.locator(`[data-calendar-day="${today()}"]`).getByRole("button", { name: "Open card: Plan the release", exact: true });
    await persistedChip.waitFor();
    expect(await page.locator('[data-calendar-nodate]').getByRole("button", { name: "Open card: Plan the release", exact: true }).count()).toBe(0);

    // Dropping back on the "No due date" list clears it through the same card-mutation path.
    await persistedChip.dragTo(page.locator('[data-calendar-nodate]')); await saved(page);
    expect(await page.locator('[data-calendar-nodate]').getByRole("button", { name: "Open card: Plan the release", exact: true }).count()).toBe(1);

    await page.getByRole("button", { name: "Board", exact: true }).click();
    expect(page.url()).not.toContain("view=");
    expect(await page.locator("#board").isHidden()).toBe(false);

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
