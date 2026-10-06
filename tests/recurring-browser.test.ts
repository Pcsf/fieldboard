import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createWorkspace, createProject, createCard, editCard, validateWorkspace, type Workspace } from "../src/model";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };

function fixture(): { w: Workspace; backlogName: string; todoName: string } {
  const w = createWorkspace(); const p = createProject(w, "Recurring project");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const columns = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  const backlog = columns[0]!, todo = columns[1]!;
  const source = createCard(w, backlog.id, "Daily standup", "bottom");
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
  const next = `${threeDaysAgo.getFullYear()}-${String(threeDaysAgo.getMonth() + 1).padStart(2, "0")}-${String(threeDaysAgo.getDate()).padStart(2, "0")}`;
  editCard(w, source.id, { recurrence: { frequency: "daily", columnId: todo.id, next } });
  validateWorkspace(w);
  return { w, backlogName: backlog.name, todoName: todo.name };
}

test("delivered recurring cards: seeded 3-days-missed recurrence generates on load, stays stable on reload, and a second tab does not duplicate", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-recurring-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1024, height: 1000 }, acceptDownloads: true });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    const { w: seed, todoName } = fixture();
    await page.goto(pathToFileURL(file).href); await saved(page);
    page.once("dialog", d => d.accept());
    await page.getByLabel("Restore JSON backup", { exact: true }).setInputFiles({ name: "recurring-seed.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(seed)) });
    await saved(page);
    await page.getByRole("link", { name: "Recurring project", exact: true }).click().catch(() => {});

    // next was seeded 3 days in the past, so 4 due dates (that day through today, inclusive) generate
    // on load, all in the chosen column, each exactly once.
    const todoColumn = page.locator(".column", { has: page.locator(".column-heading h2", { hasText: todoName }) });
    await page.waitForFunction(name => {
      const heading = [...document.querySelectorAll(".column-heading h2")].find(h => h.textContent === name);
      const column = heading?.closest(".column"); return column ? column.querySelectorAll(".card").length === 4 : false;
    }, todoName);
    expect(await todoColumn.locator(".card").count()).toBe(4);
    await page.screenshot({ path: "evidence/planning3-recurring-board-light.png", fullPage: true, animations: "disabled" });

    // Reload: still exactly 4 -- the advance and the creation committed together, so a reload cannot
    // regenerate what was already made.
    await page.reload(); await saved(page);
    expect(await todoColumn.locator(".card").count()).toBe(4);

    // A second tab on the same file is locked out (one editor at a time), which is itself the
    // no-duplication guarantee for concurrent tabs: it never reaches a state where it could generate.
    const second = await context.newPage();
    await second.goto(pathToFileURL(file).href);
    await second.waitForFunction(() => (document.querySelector('[data-testid="storage-status"]')?.textContent ?? "").includes("Not saved"));
    await second.close();
    await page.reload(); await saved(page);
    expect(await todoColumn.locator(".card").count()).toBe(4);

    // The source card carries a recurrence chip; a generated copy does not. Copies share the source's
    // title, so the source is found by its chip, not by name.
    expect(await page.locator(".card .recurrence-chip").count()).toBe(1);
    await page.locator(".card", { has: page.locator(".recurrence-chip") }).click();
    const nextValue = await page.getByLabel("Next occurrence date", { exact: true }).inputValue();
    const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(nextValue > todayStr || nextValue === todayStr).toBe(true); // advanced to today or later, never stuck in the past
    await page.screenshot({ path: "evidence/planning3-recurring-card-light.png", animations: "disabled" });
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    // Setting up a fresh recurrence from a plain card, through the visible UI.
    await page.locator(".column").first().getByRole("button", { name: "Add card at bottom" }).click();
    await page.getByPlaceholder("Card title").fill("Weekly retro"); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    await page.getByRole("button", { name: "Open card: Weekly retro", exact: true }).click();
    await page.getByRole("button", { name: "Make this card recurring", exact: true }).click(); await saved(page);
    await page.getByLabel("Recurrence frequency", { exact: true }).selectOption("monthly"); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    expect(await page.locator(".card .recurrence-chip", { hasText: "Monthly" }).count()).toBe(1);

    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/planning3-recurring-board-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });

    await page.setViewportSize({ width: 390, height: 844 });
    const noPageScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noPageScroll).toBe(true);
    await page.screenshot({ path: "evidence/planning3-recurring-phone-light.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/planning3-recurring-phone-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
