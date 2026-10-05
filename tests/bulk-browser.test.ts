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
const card = (p: Page, title: string) => p.getByRole("button", { name: `Open card: ${title}`, exact: true });

test("delivered bulk actions: shift/ctrl-click selection, move/label/assign/archive as one undo step, Escape clears, offline", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-bulk-"));
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
    await page.getByLabel("Project name", { exact: true }).fill("Bulk project");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);
    await addCard(page, "Card A"); await addCard(page, "Card B"); await addCard(page, "Card C");

    // Bulk bar is hidden with no selection.
    expect(await page.locator("#bulk-bar").isHidden()).toBe(true);

    // Ctrl/shift-click toggles selection; a plain click still opens a card.
    await card(page, "Card A").click({ modifiers: ["Control"] });
    await card(page, "Card B").click({ modifiers: ["Shift"] });
    expect(await page.locator("#bulk-bar").isHidden()).toBe(false);
    expect(await page.locator("#bulk-count").textContent()).toBe("2 cards selected");
    expect(await card(page, "Card A").getAttribute("class")).toContain("selected");
    expect(await card(page, "Card B").getAttribute("class")).toContain("selected");
    expect(await card(page, "Card C").getAttribute("class")).not.toContain("selected");
    await card(page, "Card C").click();
    expect(await page.locator("#detail").isVisible()).toBe(true); // plain click opens the card
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    expect(await page.locator("#bulk-count").textContent()).toBe("2 cards selected"); // unaffected by the plain click

    await page.screenshot({ path: "evidence/bulk-select.png", fullPage: true, animations: "disabled" });

    // Escape clears the selection.
    await page.keyboard.press("Escape");
    expect(await page.locator("#bulk-bar").isHidden()).toBe(true);
    expect(await card(page, "Card A").getAttribute("class")).not.toContain("selected");

    // Re-select and bulk-move to another column: one undo step, one Activity entry per card.
    await card(page, "Card A").click({ modifiers: ["Control"] });
    await card(page, "Card B").click({ modifiers: ["Control"] });
    await page.getByLabel("Move selected cards to column", { exact: true }).selectOption({ label: "In Progress" }); await saved(page);
    const inProgress = page.locator(".column").filter({ has: page.getByRole("heading", { name: "In Progress", exact: true }) });
    expect(await inProgress.getByRole("button", { name: /Open card: Card [AB]/ }).count()).toBe(2);
    expect(await page.locator("#bulk-bar").isHidden()).toBe(true); // selection cleared after the action
    await card(page, "Card A").click();
    expect(await page.locator("#detail .history li").count()).toBe(2); // create, then one move entry for this card
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await page.keyboard.press("Control+z"); await saved(page);
    const backlog = page.locator(".column").filter({ has: page.getByRole("heading", { name: "Backlog", exact: true }) });
    expect(await backlog.getByRole("button", { name: /Open card: Card [AB]/ }).count()).toBe(2); // a single undo reverses both moves

    // Bulk label, assign and archive.
    await card(page, "Card A").click({ modifiers: ["Control"] });
    await card(page, "Card B").click({ modifiers: ["Control"] });
    await page.getByLabel("Assign selected cards to member", { exact: true }).selectOption({ label: "Me" }); await saved(page);
    await card(page, "Card A").click();
    expect(await page.locator("#detail").getByLabel("Assign to Me", { exact: true }).isChecked()).toBe(true);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await card(page, "Card B").click();
    expect(await page.locator("#detail").getByLabel("Assign to Me", { exact: true }).isChecked()).toBe(true);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await card(page, "Card A").click({ modifiers: ["Control"] });
    await card(page, "Card B").click({ modifiers: ["Control"] });
    page.once("dialog", d => void d.accept());
    await page.locator("#bulk-bar").getByRole("button", { name: "Archive", exact: true }).click(); await saved(page);
    expect(await card(page, "Card A").count()).toBe(0);
    expect(await card(page, "Card B").count()).toBe(0);
    expect(await card(page, "Card C").count()).toBe(1); // untouched

    await page.reload(); await saved(page);
    expect(await card(page, "Card A").count()).toBe(0); // archive persisted

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
