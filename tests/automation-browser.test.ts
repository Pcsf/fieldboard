import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createWorkspace, createProject, createCard, editCard, validateWorkspace, type Workspace } from "../src/model";
import { addRule, setAutoArchiveDays, DEFAULT_OVERDUE_LABEL } from "../src/automation";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };

// A board with an enabled overdue-label rule and auto-archive set, plus one card overdue and one
// long-done card, so launch-time reconciliation (R41's overdue rule, R42's auto-archive) can be
// observed from a cold restore the same way tests/recurring-browser.test.ts observes a missed
// recurrence, instead of waiting a real minute for the schedule timer.
function launchFixture(): { w: Workspace; projectName: string; doneName: string } {
  const w = createWorkspace(); const p = createProject(w, "Launch automation");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const columns = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  const backlog = columns[0]!, done = columns.at(-1)!;
  addRule(w, board.id, { kind: "overdue-label", enabled: true, labelName: DEFAULT_OVERDUE_LABEL });
  setAutoArchiveDays(w, board.id, 14);
  const overdue = createCard(w, backlog.id, "Overdue task", "bottom");
  editCard(w, overdue.id, { dueDate: "2020-01-01" });
  const oldDone = createCard(w, done.id, "Ancient done card", "bottom");
  w.cards.find(c => c.id === oldDone.id)!.completedAt = new Date(Date.now() - 30 * 86_400_000).toISOString();
  validateWorkspace(w);
  return { w, projectName: p.name, doneName: done.name };
}

test("delivered automation: rules fire on entry with a history entry, toggle off stops them, undo reverts the effect, and overdue/auto-archive reconcile on launch", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-automation-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(pathToFileURL(file).href); await saved(page);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Automation project");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);

    // Create each rule kind through the visible Automation dialog.
    await page.getByRole("button", { name: "Automation", exact: true }).click();
    expect(await page.locator(".dialog-body").textContent()).toContain("no background service");
    await page.getByLabel("New rule kind", { exact: true }).selectOption({ label: "Entering a column: check all subtasks" });
    await page.getByLabel("New rule column", { exact: true }).selectOption({ label: "Review" });
    await page.getByRole("button", { name: "Add rule", exact: true }).click(); await saved(page);
    expect(await page.locator("#rule-list").textContent()).toContain("When a card enters “Review”, check all its subtasks");

    await page.getByLabel("New rule kind", { exact: true }).selectOption({ label: "Entering a column: assign a member" });
    await page.getByLabel("New rule column", { exact: true }).selectOption({ label: "Done" });
    await page.getByLabel("New rule member", { exact: true }).selectOption({ label: "Me" });
    await page.getByRole("button", { name: "Add rule", exact: true }).click(); await saved(page);
    expect(await page.locator("#rule-list").textContent()).toContain("When a card enters “Done”, assign Me");

    await page.getByLabel("New rule kind", { exact: true }).selectOption({ label: "Overdue: add a label" });
    await page.getByRole("button", { name: "Add rule", exact: true }).click(); await saved(page);
    expect(await page.locator("#rule-list").textContent()).toContain(`add the label “${DEFAULT_OVERDUE_LABEL}”`);
    await page.screenshot({ path: "evidence/automation-dialog-light.png", animations: "disabled" });
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    // Trigger the check-subtasks rule by entering "Review".
    await page.locator(".column").first().getByRole("button", { name: "Add card at bottom" }).click();
    await page.getByPlaceholder("Card title").fill("Ship"); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    await page.getByRole("button", { name: "Open card: Ship", exact: true }).click();
    await page.getByLabel("Add subtask", { exact: true }).fill("Write tests"); await page.getByLabel("Add subtask", { exact: true }).press("Enter"); await saved(page);
    await page.getByLabel("Move to column", { exact: true }).selectOption({ label: "Review" }); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.getByRole("button", { name: "Open card: Ship", exact: true }).click();
    expect(await page.getByLabel("Complete subtask: Write tests", { exact: true }).isChecked()).toBe(true);
    const history = await page.locator(".history").textContent();
    expect(history).toContain("rule: entering Review checks all subtasks");
    await page.screenshot({ path: "evidence/automation-card-history-light.png", animations: "disabled" });
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    // Trigger the assign-member rule by entering "Done", logged with the member's name.
    await page.getByRole("button", { name: "Open card: Ship", exact: true }).click();
    await page.getByLabel("Move to column", { exact: true }).selectOption({ label: "Done" }); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.getByRole("button", { name: "Open card: Ship", exact: true }).click();
    expect(await page.getByLabel("Assign to Me", { exact: true }).isChecked()).toBe(true);
    expect(await page.locator(".history").textContent()).toContain("rule: entering Done assigns Me");
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    expect(await page.getByRole("button", { name: "Open card: Ship", exact: true }).locator(".avatar").count()).toBe(1);

    // Undo the move: the rule's assignment reverts along with the column, as one step.
    await page.keyboard.press("Control+z"); await saved(page);
    await page.getByRole("button", { name: "Open card: Ship", exact: true }).click();
    expect(await page.getByLabel("Assign to Me", { exact: true }).isChecked()).toBe(false);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    // Toggle the assign-member rule off: a second card entering "Done" is left alone.
    await page.getByRole("button", { name: "Automation", exact: true }).click();
    await page.getByLabel(/Enabled: When a card enters .Done., assign Me/, { exact: true }).uncheck(); await saved(page);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    await page.locator(".column").first().getByRole("button", { name: "Add card at bottom" }).click();
    await page.getByPlaceholder("Card title").fill("Untouched"); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    await page.getByRole("button", { name: "Open card: Untouched", exact: true }).click();
    await page.getByLabel("Move to column", { exact: true }).selectOption({ label: "Done" }); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.getByRole("button", { name: "Open card: Untouched", exact: true }).click();
    expect(await page.getByLabel("Assign to Me", { exact: true }).isChecked()).toBe(false);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.getByRole("button", { name: "Automation", exact: true }).click();
    await page.screenshot({ path: "evidence/automation-dialog-dark.png", animations: "disabled" });
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    await page.emulateMedia({ colorScheme: "light" });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Automation", exact: true }).click();
    const noPageScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noPageScroll).toBe(true);
    await page.screenshot({ path: "evidence/automation-dialog-phone.png", fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1100 });

    // --- Launch reconciliation: overdue-label and auto-archive, from a cold restore ---
    const { w: seed, doneName } = launchFixture();
    page.once("dialog", d => d.accept());
    await page.getByLabel("Restore JSON backup", { exact: true }).setInputFiles({ name: "automation-seed.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(seed)) });
    await saved(page);
    await page.getByRole("link", { name: "Launch automation", exact: true }).click().catch(() => {});

    // The overdue card picked up the label the moment the workspace loaded, with no interaction.
    const overdueCard = page.getByRole("button", { name: "Open card: Overdue task", exact: true });
    expect(await overdueCard.locator(".label-chip").textContent()).toContain(DEFAULT_OVERDUE_LABEL);

    // The ancient done card archived itself on load: it is off the board and sits in Archive.
    expect(await page.getByRole("button", { name: "Open card: Ancient done card", exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    expect(await page.locator(".dialog-body").textContent()).toContain("Ancient done card");
    await page.screenshot({ path: "evidence/automation-archive-light.png", animations: "disabled" });

    // Restoring resets its clock: after restore and a fresh reload (simulating the next launch),
    // the 30-day-old completion no longer applies, so it is not immediately re-archived.
    await page.getByRole("button", { name: "Restore Ancient done card", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Close archive", exact: true }).click();
    const doneColumn = page.locator(".column", { has: page.locator(".column-heading h2", { hasText: doneName }) });
    expect(await doneColumn.getByRole("button", { name: "Open card: Ancient done card", exact: true }).isVisible()).toBe(true);
    await page.reload(); await saved(page);
    expect(await doneColumn.getByRole("button", { name: "Open card: Ancient done card", exact: true }).isVisible()).toBe(true);

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
