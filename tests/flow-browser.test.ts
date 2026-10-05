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

test("delivered flow control: WIP limits, blocked state, dependencies and epics survive reload offline", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-flow-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1440, height: 1200 }, acceptDownloads: true, colorScheme: "light" });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(pathToFileURL(file).href); await saved(page);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Flow");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);

    // WIP limit: set Backlog to 2, then go from at-limit to over-limit.
    await page.getByRole("button", { name: "Edit column Backlog", exact: true }).click();
    await page.getByLabel("WIP limit", { exact: true }).fill("2"); await page.getByLabel("WIP limit", { exact: true }).press("Tab"); await saved(page);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    const backlog = page.locator(".column").filter({ has: page.getByRole("heading", { name: "Backlog", exact: true }) });
    await addCard(page, "Backlog", "Backlog one"); await addCard(page, "Backlog", "Backlog two");
    expect(await backlog.locator(".count").textContent()).toBe("2 / 2");
    expect(await backlog.locator(".count").getAttribute("class")).toContain("wip-at");
    await addCard(page, "Backlog", "Backlog three");
    expect(await backlog.locator(".count").textContent()).toBe("3 / 2");
    expect(await backlog.locator(".count").getAttribute("class")).toContain("wip-over");
    await page.reload(); await saved(page);
    expect(await backlog.locator(".count").textContent()).toBe("3 / 2");
    expect(await backlog.locator(".count").getAttribute("class")).toContain("wip-over");

    // Blocked state: a required reason, shown on the card face, filterable.
    await addCard(page, "To Do", "Ship release");
    await page.getByRole("button", { name: "Open card: Ship release", exact: true }).click();
    await page.getByLabel("Mark card as blocked", { exact: true }).check();
    await page.getByLabel("Blocked reason", { exact: true }).fill("Waiting on vendor part");
    await page.getByLabel("Blocked reason", { exact: true }).press("Tab"); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    const shipCard = page.getByRole("button", { name: "Open card: Ship release", exact: true });
    expect(await shipCard.locator(".blocked-badge").textContent()).toBe("⛔ Blocked");
    expect(await shipCard.locator(".blocked-badge").getAttribute("title")).toBe("Blocked: Waiting on vendor part");
    await page.getByLabel("Filter blocked", { exact: true }).selectOption("yes");
    expect(await page.getByRole("button", { name: "Open card: Ship release", exact: true }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "Open card: Backlog one", exact: true }).count()).toBe(0);
    expect(page.url()).toContain("blocked=yes");
    await page.reload(); await saved(page);
    expect(await page.getByLabel("Filter blocked", { exact: true }).inputValue()).toBe("yes");
    await page.getByRole("button", { name: "Clear filters", exact: true }).click(); await saved(page);

    // Dependencies: Task B is blocked by Task A until A is done; detail lists blockers/blocked-of.
    await addCard(page, "To Do", "Task A"); await addCard(page, "To Do", "Task B");
    await page.getByRole("button", { name: "Open card: Task B", exact: true }).click();
    await page.getByLabel("Blocked by Task A", { exact: true }).check(); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    const taskB = page.getByRole("button", { name: "Open card: Task B", exact: true });
    expect(await taskB.locator(".waiting-badge").textContent()).toBe("⧗ Waiting on: Task A");
    await page.getByRole("button", { name: "Open card: Task A", exact: true }).click();
    expect(await page.locator("#detail").textContent()).toContain("BLOCKS");
    expect(await page.locator("#detail .dialog-list").filter({ hasText: "Task B" }).count()).toBe(1);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    // Epics: two children under one parent, with aggregate progress and a chip back to the parent.
    await addCard(page, "To Do", "Launch epic"); await addCard(page, "To Do", "Child one"); await addCard(page, "To Do", "Child two");
    await page.getByRole("button", { name: "Open card: Child one", exact: true }).click();
    await page.getByLabel("Parent epic", { exact: true }).selectOption({ label: "Launch epic" }); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.getByRole("button", { name: "Open card: Child two", exact: true }).click();
    await page.getByLabel("Parent epic", { exact: true }).selectOption({ label: "Launch epic" }); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    const epicCard = page.getByRole("button", { name: "Open card: Launch epic", exact: true });
    expect(await epicCard.locator(".epic-progress-row").textContent()).toContain("0/2");
    expect(await page.getByRole("button", { name: "Open card: Child one", exact: true }).locator(".epic-chip").textContent()).toBe("⛩ Launch epic");

    await page.getByRole("button", { name: "Open card: Child one", exact: true }).click();
    await page.getByLabel("Move to column", { exact: true }).selectOption({ label: "Done" }); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.getByRole("button", { name: "Open card: Launch epic", exact: true }).click();
    expect(await page.locator("#detail").textContent()).toContain("1/2");
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    expect(await epicCard.locator(".epic-progress-row").textContent()).toContain("1/2");

    // Epic filter: the epic plus its children, nothing else.
    await page.getByLabel("Filter epic", { exact: true }).selectOption({ label: "Launch epic" });
    expect(await page.getByRole("button", { name: "Open card: Launch epic", exact: true }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "Open card: Child two", exact: true }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "Open card: Task A", exact: true }).count()).toBe(0);
    expect(page.url()).toContain("epic=");
    await page.reload(); await saved(page);
    expect(await page.getByLabel("Filter epic", { exact: true }).inputValue()).not.toBe("");
    await page.getByRole("button", { name: "Clear filters", exact: true }).click(); await saved(page);

    // Screenshots: WIP-limited column over its limit, a blocked card, a waiting card and an epic with children, together.
    await page.screenshot({ path: "evidence/flow-board.png", fullPage: true, animations: "disabled" });
    await page.locator("#theme-select").selectOption("dark"); await saved(page);
    await page.screenshot({ path: "evidence/flow-board-dark.png", fullPage: true, animations: "disabled" });
    await page.locator("#theme-select").selectOption("system"); await saved(page);

    // Completing the blocker clears the waiting indicator.
    await page.getByRole("button", { name: "Open card: Task A", exact: true }).click();
    await page.getByLabel("Move to column", { exact: true }).selectOption({ label: "Done" }); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    expect(await taskB.locator(".waiting-badge").count()).toBe(0);

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
