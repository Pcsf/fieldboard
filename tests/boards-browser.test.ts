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
// Board names live inside an <input value>, not as rendered text, so rows are matched by that attribute, not hasText.
const boardRow = (p: Page, name: string) => p.locator(".board-row").filter({ has: p.locator(`input.board-name[value="${name}"]`) });

test("delivered boards: add, switch, rename, delete with destination, board/card templates and move-to-board survive reload offline", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-boards-"));
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
    await page.getByLabel("Project name", { exact: true }).fill("Boards project");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);

    // A fresh project has exactly one board, and deleting it is not offered.
    await page.getByRole("button", { name: "Boards", exact: true }).click();
    expect(await page.locator(".board-row").count()).toBe(1);
    expect(await page.locator(".board-delete").count()).toBe(0);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    await addCard(page, "First-board card");

    // Add a second board.
    await page.getByRole("button", { name: "Boards", exact: true }).click();
    await page.getByLabel("New board name", { exact: true }).fill("Backend");
    await page.getByRole("button", { name: "Create board", exact: true }).click(); await saved(page);
    expect(await page.locator(".board-row").count()).toBe(2);

    // Switch to it from the dialog; the board selector and URL fragment follow.
    await boardRow(page, "Backend").getByRole("button", { name: "Switch to board Backend" }).click();
    expect(await page.locator("#board-select").locator("option:checked").textContent()).toBe("Backend");
    expect(page.url()).toContain("board=");
    expect(await page.locator(".column").count()).toBe(5); // Backend's own default columns
    expect(await page.getByRole("button", { name: "Open card: First-board card", exact: true }).count()).toBe(0); // scoped to Backend

    // Switching back through the dropdown itself also works and survives reload.
    await page.locator("#board-select").selectOption({ label: "Board" }); await saved(page);
    expect(await page.getByRole("button", { name: "Open card: First-board card", exact: true }).count()).toBe(1);
    const urlAfterSwitch = page.url();
    await page.reload(); await saved(page);
    expect(page.url()).toBe(urlAfterSwitch);
    expect(await page.locator("#board-select").locator("option:checked").textContent()).toBe("Board");

    // The command palette jumps to a board by name and opens My work by action.
    await page.keyboard.press("Control+k"); await page.locator("#palette-input").fill("Backend"); await page.keyboard.press("Enter");
    expect(await page.locator("#board-select").locator("option:checked").textContent()).toBe("Backend");
    expect(await page.getByRole("button", { name: "Open card: First-board card", exact: true }).count()).toBe(0);
    await page.keyboard.press("Control+k"); await page.locator("#palette-input").fill("my work"); await page.keyboard.press("Enter");
    expect(await page.getByRole("heading", { name: "My work", exact: true }).isVisible()).toBe(true);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    await page.locator("#board-select").selectOption({ label: "Board" }); await saved(page);

    // Rename the second board.
    await page.getByRole("button", { name: "Boards", exact: true }).click();
    const backendName = boardRow(page, "Backend").getByLabel("Board name", { exact: true });
    await backendName.fill("Infra"); await backendName.press("Tab"); await saved(page);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    // Save the active (first) board as a template, then create a new board from it.
    await page.getByRole("button", { name: "Boards", exact: true }).click();
    await boardRow(page, "Board").getByLabel(/Template name for board/).fill("Standard flow");
    await boardRow(page, "Board").getByRole("button", { name: /Save as template: board .*/ }).click(); await saved(page);
    expect(await page.locator(".section-label", { hasText: "BOARD TEMPLATES" }).count()).toBe(1);
    await page.getByLabel("New board name", { exact: true }).fill("From template");
    await page.getByLabel("Start new board from template", { exact: true }).selectOption({ label: "Standard flow" });
    await page.getByRole("button", { name: "Create board", exact: true }).click(); await saved(page);
    expect(await page.locator(".board-row").count()).toBe(3);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    // Card templates: save one from a card, then create a card from it in a column.
    await page.getByRole("button", { name: "Open card: First-board card", exact: true }).click();
    await page.getByLabel("Description", { exact: true }).fill("Template body");
    await page.getByLabel("Description", { exact: true }).press("Tab"); await saved(page);
    await page.getByLabel("Add subtask", { exact: true }).fill("Step one");
    await page.getByLabel("Add subtask", { exact: true }).press("Enter"); await saved(page);
    await page.getByLabel("Template name", { exact: true }).fill("Card template");
    await page.getByRole("button", { name: "Save as template", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.locator(".column").first().getByRole("button", { name: "Create card from template" }).click();
    expect(await page.getByText("Card template", { exact: true }).count()).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Use", exact: true }).click(); await saved(page);
    const newFromTemplate = page.getByRole("button", { name: "Open card: Card template", exact: true });
    expect(await newFromTemplate.count()).toBe(1);
    await newFromTemplate.click();
    expect(await page.locator("#description-preview").textContent()).toContain("Template body");
    expect(await page.locator(".subtask").count()).toBe(1);

    // Move this card to another board directly from its detail view.
    await page.getByLabel("Move to board", { exact: true }).selectOption({ label: "Infra" }); await saved(page);
    expect(page.url()).toContain("board=");
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    expect(await page.locator("#board-select").locator("option:checked").textContent()).toBe("Infra");
    expect(await page.getByRole("button", { name: "Open card: Card template", exact: true }).count()).toBe(1);

    await page.screenshot({ path: "evidence/boards-switch.png", fullPage: true, animations: "disabled" });

    // Deleting a populated board without a destination is rejected, surfaced through the normal error banner.
    await page.getByRole("button", { name: "Boards", exact: true }).click();
    page.once("dialog", d => void d.accept());
    await boardRow(page, "Infra").getByRole("button", { name: "Delete board Infra" }).click();
    await page.getByTestId("storage-status").filter({ hasText: "Not saved" }).waitFor();
    expect(await page.locator("#error-banner").isHidden()).toBe(false);
    expect(await page.locator(".board-row").count()).toBe(3); // nothing was deleted

    // Choosing a destination and retrying succeeds; the card relocates to its first column.
    await boardRow(page, "Infra").getByLabel("Move Infra's cards to", { exact: true }).selectOption({ label: "Board" });
    page.once("dialog", d => void d.accept());
    await boardRow(page, "Infra").getByRole("button", { name: "Delete board Infra" }).click(); await saved(page);
    expect(await page.locator(".board-row").count()).toBe(2);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    expect(await page.getByRole("button", { name: "Open card: Card template", exact: true }).count()).toBe(1);

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
