import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };

test("delivered time tracking: start, reload, still running, stop, total and badge shown, manual entry, overlap rejected", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-time-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1024, height: 1100 }, acceptDownloads: true });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(pathToFileURL(file).href); await saved(page);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Time tracking project");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);
    await page.locator(".column").first().getByRole("button", { name: "Add card at bottom" }).click();
    await page.getByPlaceholder("Card title").fill("Timed card"); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);

    await page.getByRole("button", { name: "Open card: Timed card", exact: true }).click();
    await page.getByRole("button", { name: "Start timer", exact: true }).click(); await saved(page);
    expect(await page.getByRole("button", { name: "Stop timer", exact: true }).count()).toBe(1);
    await page.screenshot({ path: "evidence/planning3-time-card-light.png", animations: "disabled" });
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    // The card face shows a running badge before any reload.
    expect(await page.locator(".card .time-badge.running").count()).toBe(1);
    await page.screenshot({ path: "evidence/planning3-time-board-light.png", fullPage: true, animations: "disabled" });

    // Reload: the timer is still running (only its start was ever stored).
    await page.reload(); await saved(page);
    await page.getByRole("button", { name: "Open card: Timed card", exact: true }).click();
    expect(await page.getByRole("button", { name: "Stop timer", exact: true }).count()).toBe(1);

    // Stop it: the entry gets an end, a total appears, and the running badge disappears from the card face.
    await page.getByRole("button", { name: "Stop timer", exact: true }).click(); await saved(page);
    expect(await page.getByRole("button", { name: "Start timer", exact: true }).count()).toBe(1);
    const trackedText = await page.locator(".tracked-total").textContent();
    expect(trackedText).toContain("Tracked:");
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    expect(await page.locator(".card .time-badge.running").count()).toBe(0);
    expect(await page.locator(".card .time-badge").count()).toBe(1); // a non-running total badge remains

    // A manual entry is added through the visible form.
    await page.getByRole("button", { name: "Open card: Timed card", exact: true }).click();
    await page.getByLabel("Entry date", { exact: true }).fill("2026-01-05");
    await page.getByLabel("Entry duration", { exact: true }).fill("1:30");
    await page.getByLabel("Entry note", { exact: true }).fill("Investigated the issue");
    await page.getByRole("button", { name: "Add entry", exact: true }).click(); await saved(page);
    expect(await page.locator(".time-entry").count()).toBe(2); // the stopped timer entry plus this manual one
    expect(await page.locator(".time-entry", { hasText: "Investigated the issue" }).count()).toBe(1);

    // A second manual entry overlapping the first is rejected, with the first entry still present.
    await page.getByLabel("Entry date", { exact: true }).fill("2026-01-05");
    await page.getByLabel("Entry duration", { exact: true }).fill("30");
    await page.getByRole("button", { name: "Add entry", exact: true }).click();
    await page.waitForTimeout(200);
    expect(await page.locator(".time-entry").count()).toBe(2); // rejected, nothing added
    await page.screenshot({ path: "evidence/planning3-time-entries-light.png", animations: "disabled" });

    // Delete an entry.
    await page.locator(".time-entry").first().getByRole("button", { name: "Delete time entry", exact: true }).click(); await saved(page);
    expect(await page.locator(".time-entry").count()).toBe(1);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.getByRole("button", { name: "Open card: Timed card", exact: true }).click();
    await page.screenshot({ path: "evidence/planning3-time-card-dark.png", animations: "disabled" });
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.emulateMedia({ colorScheme: "light" });

    await page.setViewportSize({ width: 390, height: 844 });
    const noPageScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noPageScroll).toBe(true);
    await page.getByRole("button", { name: "Open card: Timed card", exact: true }).click();
    await page.screenshot({ path: "evidence/planning3-time-card-phone-light.png", animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/planning3-time-card-phone-dark.png", animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
