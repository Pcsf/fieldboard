import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };
const open = (title: string) => `Open card: ${title}`;

// Focus mode hides every card not assigned to the acting member, in Board, List, Calendar and
// Timeline, and survives reload via the URL fragment like every other filter.
test("delivered focus mode: hides cards not assigned to me across every view, kept in the URL fragment, reload-stable", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-focus-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1024, height: 1000 }, acceptDownloads: true });
  context.setDefaultTimeout(6000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  const mine = "Characterize the SERDES eye pattern at full rate";
  const minePlain = "Close out the open timing violations on the clock domain crossing";
  const theirs = "Hand off the field-update rollback runbook";
  try {
    await page.goto(pathToFileURL(file).href); await saved(page);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Bring-up schedule");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);

    await page.getByRole("button", { name: "Workspace & members" }).click();
    await page.getByLabel("Member name", { exact: true }).fill("Dana");
    await page.getByRole("button", { name: "Add member", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    const addTo = async (columnHeading: string, title: string) => {
      const column = page.locator(".column").filter({ has: page.getByRole("heading", { name: columnHeading, exact: true }) });
      await column.getByRole("button", { name: "Add card at bottom" }).click();
      await page.getByPlaceholder("Card title").fill(title);
      await page.getByPlaceholder("Card title").press("Enter");
      await saved(page);
    };
    await addTo("Backlog", mine);
    await addTo("To Do", minePlain);
    await addTo("In Progress", theirs);

    const openDetail = (title: string) => page.getByRole("button", { name: open(title), exact: true }).click();
    await openDetail(mine);
    await page.getByLabel("Assign to Me", { exact: true }).check(); await saved(page);
    await page.getByLabel("Start date", { exact: true }).fill("2026-10-07");
    await page.getByLabel("Due date", { exact: true }).fill("2026-10-08"); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await openDetail(minePlain);
    await page.getByLabel("Assign to Me", { exact: true }).check(); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await openDetail(theirs);
    await page.getByLabel("Assign to Dana", { exact: true }).check(); await saved(page);
    await page.getByLabel("Start date", { exact: true }).fill("2026-10-07");
    await page.getByLabel("Due date", { exact: true }).fill("2026-10-08"); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    const countOpen = (title: string) => page.getByRole("button", { name: open(title), exact: true }).count();

    // --- Board: all three visible before toggling on ---
    expect(await countOpen(mine)).toBe(1); expect(await countOpen(minePlain)).toBe(1); expect(await countOpen(theirs)).toBe(1);
    await page.getByLabel("Focus: my cards", { exact: true }).check(); await saved(page);
    expect(await countOpen(mine)).toBe(1); expect(await countOpen(minePlain)).toBe(1); expect(await countOpen(theirs)).toBe(0);
    expect(page.url()).toContain("focus=mine");

    await page.screenshot({ path: "evidence/focus-1024-light.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/focus-1024-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });

    // --- List ---
    await page.getByRole("tab", { name: "List", exact: true }).click();
    expect(await countOpen(mine)).toBe(1); expect(await countOpen(theirs)).toBe(0);

    // --- Calendar: both dated cards fall this week, so no month navigation is needed ---
    await page.getByRole("tab", { name: "Calendar", exact: true }).click();
    expect(await countOpen(mine)).toBe(1); expect(await countOpen(theirs)).toBe(0);

    // --- Timeline: the range already spans the current week, which both dated cards fall in ---
    await page.getByRole("tab", { name: "Timeline", exact: true }).click();
    expect(await countOpen(mine)).toBe(1); expect(await countOpen(theirs)).toBe(0);

    await page.setViewportSize({ width: 390, height: 844 });
    const noPageScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noPageScroll).toBe(true);
    await page.getByRole("tab", { name: "Board", exact: true }).click();
    await page.screenshot({ path: "evidence/focus-390-light.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/focus-390-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1024, height: 1000 });

    // --- Reload: focus stays on, from the URL fragment, same as every other filter ---
    await page.reload(); await saved(page);
    expect(await page.getByLabel("Focus: my cards", { exact: true }).isChecked()).toBe(true);
    expect(await countOpen(mine)).toBe(1); expect(await countOpen(theirs)).toBe(0);

    // --- Toggle off: everything is back ---
    await page.getByLabel("Focus: my cards", { exact: true }).uncheck(); await saved(page);
    expect(await countOpen(mine)).toBe(1); expect(await countOpen(minePlain)).toBe(1); expect(await countOpen(theirs)).toBe(1);
    expect(page.url()).not.toContain("focus=mine");

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
