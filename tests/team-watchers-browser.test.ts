import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };

test("delivered watchers: watching a card notifies the watcher when someone else edits it, in light and dark, desktop and phone", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-watchers-"));
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
    await page.getByLabel("Project name", { exact: true }).fill("Watchers project");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Workspace & members" }).click();
    await page.getByLabel("Member name", { exact: true }).fill("Bob");
    await page.getByRole("button", { name: "Add member", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    const firstColumn = page.locator(".column").first();
    await firstColumn.getByRole("button", { name: "Add card at bottom" }).click();
    await page.getByPlaceholder("Card title").fill("Watch me"); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);

    // Acting as the default member ("Me"), start watching.
    await page.getByRole("button", { name: "Open card: Watch me", exact: true }).click();
    await page.getByRole("button", { name: "Watch this card", exact: true }).click(); await saved(page);
    const unwatch = page.getByRole("button", { name: "Unwatch this card", exact: true }); await unwatch.waitFor();
    expect(await unwatch.isVisible()).toBe(true);
    await page.screenshot({ path: "evidence/team-watchers-detail-desktop-light.png", fullPage: true, animations: "disabled" });
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page.screenshot({ path: "evidence/team-watchers-detail-desktop-dark.png", fullPage: true, animations: "disabled" });
    await page.getByLabel("Theme", { exact: true }).selectOption("light");
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open card: Watch me", exact: true }).click();
    await page.screenshot({ path: "evidence/team-watchers-detail-phone-light.png", fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open card: Watch me", exact: true }).click();
    await page.screenshot({ path: "evidence/team-watchers-detail-phone-dark.png", fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByLabel("Theme", { exact: true }).selectOption("light");
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1024, height: 1000 });

    // Switch to Bob and edit the card -- this is "another member changing a watched card".
    await page.getByRole("button", { name: "Workspace & members" }).click();
    await page.getByLabel("Acting as", { exact: true }).selectOption({ label: "Bob" }); await saved(page);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    await page.getByRole("button", { name: "Open card: Watch me", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Watch me, updated"); await page.getByLabel("Title", { exact: true }).blur(); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    // Bob himself is not watching, so his own inbox stays empty.
    expect(await page.locator("#inbox-count").isHidden()).toBe(true);

    // Switch back to the watcher: the notification is there and opens the card.
    await page.getByRole("button", { name: "Workspace & members" }).click();
    await page.getByLabel("Acting as", { exact: true }).selectOption({ label: "Me" }); await saved(page);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    const inboxCount = page.locator("#inbox-count"); await inboxCount.waitFor();
    expect(await inboxCount.isVisible()).toBe(true);
    await page.getByRole("button", { name: "Notifications" }).click();
    expect(await page.locator(".inbox-row").textContent()).toContain("Watch me, updated");
    await page.screenshot({ path: "evidence/team-watchers-inbox-light.png", fullPage: true, animations: "disabled" });
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page.screenshot({ path: "evidence/team-watchers-inbox-dark.png", fullPage: true, animations: "disabled" });
    await page.getByLabel("Theme", { exact: true }).selectOption("light");
    await page.locator(".inbox-row").first().click(); await saved(page);
    expect(await page.locator("#detail").isVisible()).toBe(true);
    expect(await page.getByLabel("Title", { exact: true }).inputValue()).toBe("Watch me, updated");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.screenshot({ path: "evidence/team-watchers-board-phone.png", fullPage: true, animations: "disabled" });

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally {
    await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true });
  }
}, 60000);
