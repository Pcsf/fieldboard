import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };
const addCard = async (p: Page, column: string, title: string) => {
  const col = p.locator(".column").filter({ has: p.getByRole("heading", { name: column, exact: true }) });
  await col.getByRole("button", { name: "Add card at bottom" }).click();
  await p.getByPlaceholder("Card title").fill(title); await p.getByPlaceholder("Card title").press("Enter"); await saved(p);
};
const focusedLabel = (p: Page) => p.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null);
const tomorrowISO = () => new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA");

test("keyboard shortcuts, the command palette and quick-add syntax work offline and persist", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-speed-"));
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
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Speed");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);

    // Quick-add: a label, an assignee (matched against the default "Me" member), a priority and a due date
    // all parse out of one inline-add submission, and the card lands with exactly one Activity entry.
    await addCard(page, "Backlog", "Fix login #bug @me !high ^tomorrow");
    const fixLogin = page.getByRole("button", { name: "Open card: Fix login", exact: true });
    expect(await fixLogin.count()).toBe(1);
    expect(await fixLogin.locator(".label-chip").textContent()).toBe("bug");
    expect(await fixLogin.locator(".priority").textContent()).toContain("high");
    expect(await fixLogin.locator(".due").getAttribute("title")).toBe(`Due ${tomorrowISO()}`);
    expect(await fixLogin.locator(".avatar").getAttribute("aria-label")).toBe("Assigned to Me");
    await fixLogin.click();
    expect(await page.locator("#detail .history li").count()).toBe(1);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    // One undo step removes the whole quick-added card, label included.
    await page.keyboard.press("Control+z"); await saved(page);
    expect(await page.getByRole("button", { name: "Open card: Fix login", exact: true }).count()).toBe(0);
    // No redo shortcut is specified; recreate the card for the rest of the test.
    await addCard(page, "Backlog", "Fix login #bug @me !high ^tomorrow");
    await saved(page);

    // An unresolved token (unknown member) is left exactly as typed in the title.
    await addCard(page, "Backlog", "Investigate @nobody");
    expect(await page.getByRole("button", { name: "Open card: Investigate @nobody", exact: true }).count()).toBe(1);

    await addCard(page, "Backlog", "Second card");
    await addCard(page, "To Do", "Third card");

    // j/k move focus through cards in visual order without opening anything; e opens the focused card.
    await page.locator("#board-summary").click();
    await page.keyboard.press("j");
    expect(await focusedLabel(page)).toBe("Open card: Fix login");
    expect(await page.locator("#detail").isVisible()).toBe(false);
    await page.keyboard.press("j");
    expect(await focusedLabel(page)).toBe("Open card: Investigate @nobody");
    await page.keyboard.press("k");
    expect(await focusedLabel(page)).toBe("Open card: Fix login");
    await page.keyboard.press("e");
    expect(await page.locator("#detail").isVisible()).toBe(true);
    expect(await page.locator("#detail #card-title").inputValue()).toBe("Fix login");
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    expect(await focusedLabel(page)).toBe("Open card: Fix login");

    // ArrowRight/ArrowLeft move the focused card to the next/previous column, persisted across reload.
    const backlog = page.locator(".column").filter({ has: page.getByRole("heading", { name: "Backlog", exact: true }) });
    const todo = page.locator(".column").filter({ has: page.getByRole("heading", { name: "To Do", exact: true }) });
    expect(await backlog.getByRole("button", { name: "Open card: Fix login", exact: true }).count()).toBe(1);
    await page.keyboard.press("ArrowRight"); await saved(page);
    expect(await todo.getByRole("button", { name: "Open card: Fix login", exact: true }).count()).toBe(1);
    await page.reload(); await saved(page);
    expect(await todo.getByRole("button", { name: "Open card: Fix login", exact: true }).count()).toBe(1);
    await page.getByRole("button", { name: "Open card: Fix login", exact: true }).click();
    expect(await page.locator("#detail .history li").count()).toBe(2);
    // Opening the card focused it; closing it restores that focus, so ArrowLeft now targets it.
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.keyboard.press("ArrowLeft"); await saved(page);
    expect(await backlog.getByRole("button", { name: "Open card: Fix login", exact: true }).count()).toBe(1);

    // A single Ctrl+Z reverts the whole keyboard-triggered move as one undo step.
    await page.keyboard.press("ArrowRight"); await saved(page);
    expect(await todo.getByRole("button", { name: "Open card: Fix login", exact: true }).count()).toBe(1);
    await page.keyboard.press("Control+z"); await saved(page);
    expect(await backlog.getByRole("button", { name: "Open card: Fix login", exact: true }).count()).toBe(1);

    // n opens an inline add at the top of the focused card's column.
    await page.keyboard.press("n");
    const backlogAddTop = backlog.locator(".inline-add").first();
    expect(await backlogAddTop.count()).toBe(1);
    expect(await backlogAddTop.locator("small").textContent()).toContain("#label");
    await page.keyboard.press("Escape");
    expect(await backlog.locator(".inline-add").count()).toBe(0);

    // ? opens the shortcut cheatsheet.
    await page.keyboard.press("?");
    expect(await page.locator("#modal").textContent()).toContain("Open the focused card");
    await page.getByRole("button", { name: "Close shortcuts", exact: true }).click();

    // The command palette fuzzy-matches a card by title and opens it.
    await page.keyboard.press("Control+k");
    expect(await page.locator("#palette").isVisible()).toBe(true);
    await page.locator("#palette-input").fill("fxlgn");
    expect(await page.locator(".palette-result").first().textContent()).toContain("Fix login");
    await page.keyboard.press("Enter");
    expect(await page.locator("#detail").isVisible()).toBe(true);
    expect(await page.locator("#detail #card-title").inputValue()).toBe("Fix login");
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    // The palette also runs actions, by fuzzy name, through the same Enter flow.
    await page.keyboard.press("Control+k");
    await page.locator("#palette-input").fill("help");
    await page.keyboard.press("Enter");
    expect(await page.locator("#modal").textContent()).toContain("Fieldboard runs from this single HTML file");
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    // Escape closes the palette without side effects.
    await page.keyboard.press("Control+k");
    expect(await page.locator("#palette").isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    expect(await page.locator("#palette").isVisible()).toBe(false);

    await page.screenshot({ path: "evidence/speed-board.png", fullPage: true, animations: "disabled" });

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
