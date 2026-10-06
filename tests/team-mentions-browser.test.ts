import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };

test("delivered mentions: a comment mentioning a member renders as a chip, in light and dark, desktop and phone", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-mentions-"));
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
    await page.getByLabel("Project name", { exact: true }).fill("Mentions project");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Workspace & members" }).click();
    await page.getByLabel("Member name", { exact: true }).fill("Ana Maria");
    await page.getByRole("button", { name: "Add member", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    const firstColumn = page.locator(".column").first();
    await firstColumn.getByRole("button", { name: "Add card at bottom" }).click();
    await page.getByPlaceholder("Card title").fill("Review this"); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    await page.getByRole("button", { name: "Open card: Review this", exact: true }).click();

    // Also exercises escaping: an unknown trailing name stays plain text next to the real mention.
    await page.getByLabel("Comment body", { exact: true }).fill("Thanks @Ana Maria for the help, @Nobody not so much");
    await page.getByRole("button", { name: "Add comment", exact: true }).click(); await saved(page);

    const chip = page.locator("#detail .comment .mention-chip");
    await chip.waitFor();
    expect(await chip.textContent()).toBe("@Ana Maria");
    expect(await page.locator("#detail .comment").textContent()).toContain("@Nobody");
    await page.screenshot({ path: "evidence/team-mentions-detail-desktop-light.png", fullPage: true, animations: "disabled" });

    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page.getByRole("button", { name: "Open card: Review this", exact: true }).click();
    expect(await page.locator("#detail .comment .mention-chip").textContent()).toBe("@Ana Maria");
    await page.screenshot({ path: "evidence/team-mentions-detail-desktop-dark.png", fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    // Theme lives in the sidebar, behind the phone-width hamburger -- open it to switch, then Escape.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open card: Review this", exact: true }).click();
    expect(await page.locator("#detail .comment .mention-chip").textContent()).toBe("@Ana Maria");
    await page.screenshot({ path: "evidence/team-mentions-detail-phone-dark.png", fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByLabel("Theme", { exact: true }).selectOption("light");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open card: Review this", exact: true }).click();
    await page.screenshot({ path: "evidence/team-mentions-detail-phone-light.png", fullPage: true, animations: "disabled" });

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally {
    await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true });
  }
}, 60000);
