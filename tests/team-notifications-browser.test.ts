import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };
// The same launch/interval/visibility schedule `checkRecurrences` already runs on -- firing a
// synthetic visibilitychange is how a test provokes an immediate check without waiting 60s for real.
const kick = (p: Page) => p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

test("delivered notifications: mention, assignment and due reminders reach the inbox, are dedupe-stable across reloads, and mark-all-read clears the count", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-notifications-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1024, height: 1000 }, acceptDownloads: true });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(pathToFileURL(file).href); await saved(page);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Notify project");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Workspace & members" }).click();
    await page.getByLabel("Member name", { exact: true }).fill("Bob");
    await page.getByRole("button", { name: "Add member", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    const firstColumn = page.locator(".column").first();
    await firstColumn.getByRole("button", { name: "Add card at bottom" }).click();
    await page.getByPlaceholder("Card title").fill("Ship it"); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    await page.getByRole("button", { name: "Open card: Ship it", exact: true }).click();
    await page.getByLabel("Description", { exact: true }).fill("Hey @Bob please take a look"); await page.getByLabel("Description", { exact: true }).blur(); await saved(page);
    await page.getByLabel("Assign to Bob", { exact: true }).check(); await saved(page);
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel("Due date", { exact: true }).fill(today); await page.getByLabel("Due date", { exact: true }).dispatchEvent("change"); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await kick(page); await saved(page); // provokes the due-reminder pass on today's due date

    // Switch the acting member to Bob -- the inbox is always the acting member's own.
    await page.getByRole("button", { name: "Workspace & members" }).click();
    await page.getByLabel("Acting as", { exact: true }).selectOption({ label: "Bob" }); await saved(page);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    const inboxCount = page.locator("#inbox-count");
    await inboxCount.waitFor();
    expect(await inboxCount.isVisible()).toBe(true);
    const firstCount = Number(await inboxCount.textContent());
    expect(firstCount).toBeGreaterThanOrEqual(2); // at least the mention and the assignment

    // Theme lives in the sidebar, which is only reachable through the phone-width hamburger, so every
    // theme/viewport switch below closes the inbox dialog first and reopens it to screenshot.
    await page.getByRole("button", { name: "Notifications" }).click();
    expect(await page.locator(".inbox-row").count()).toBe(firstCount);
    await page.screenshot({ path: "evidence/team-notifications-inbox-desktop-light.png", fullPage: true, animations: "disabled" });
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page.screenshot({ path: "evidence/team-notifications-inbox-desktop-dark.png", fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Notifications" }).click();
    await page.screenshot({ path: "evidence/team-notifications-inbox-phone-dark.png", fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByLabel("Theme", { exact: true }).selectOption("light");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Notifications" }).click();
    await page.screenshot({ path: "evidence/team-notifications-inbox-phone-light.png", fullPage: true, animations: "disabled" });

    await page.setViewportSize({ width: 1024, height: 1000 });
    await page.getByRole("button", { name: "Mark all read", exact: true }).click(); await saved(page);
    expect(await inboxCount.isHidden()).toBe(true);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    // Reload twice, re-provoking the schedule each time: a dedupe-stable due reminder must never
    // reappear as a fresh unread notification once already generated.
    await page.reload(); await saved(page); await kick(page); await saved(page);
    expect(await page.locator("#inbox-count").isHidden()).toBe(true);
    await page.reload(); await saved(page); await kick(page); await saved(page);
    expect(await page.locator("#inbox-count").isHidden()).toBe(true);

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally {
    await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true });
  }
}, 60000);
