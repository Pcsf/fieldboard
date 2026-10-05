import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createWorkspace, createProject, createCard, updateColumn, validateWorkspace } from "../src/model";

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

function seedCard(w: ReturnType<typeof createWorkspace>, columnId: string, title: string, ageDays: number) {
  const card = createCard(w, columnId, title, "bottom");
  card.createdAt = daysAgo(ageDays);
  w.activities.find(a => a.cardId === card.id)!.timestamp = daysAgo(ageDays);
  return card;
}

// Backlog carries no threshold; To Do/In Progress/Review all carry 7, at ages below/at/double the
// threshold; Done carries 7 too but is a done column, so its old card must never show a badge.
function buildFixture() {
  const w = createWorkspace();
  const p = createProject(w, "Aging");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const [backlog, todo, doing, review, done] = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  updateColumn(w, todo!.id, { agingDays: 7 });
  updateColumn(w, doing!.id, { agingDays: 7 });
  updateColumn(w, review!.id, { agingDays: 7 });
  updateColumn(w, done!.id, { agingDays: 7 });
  seedCard(w, backlog!.id, "No threshold", 30);
  seedCard(w, todo!.id, "Below threshold", 3);
  seedCard(w, doing!.id, "At threshold", 7);
  seedCard(w, review!.id, "Double threshold", 14);
  seedCard(w, done!.id, "Old but done", 30);
  expect(validateWorkspace(w)).toEqual(w);
  return w;
}

test("Aging: the card face shows its age only past threshold, amber then red, never in a done column, on board and swimlane views", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-aging-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1024, height: 900 }, acceptDownloads: true, colorScheme: "light" });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page: Page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  const saved = async () => { await page.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };
  try {
    await page.goto(pathToFileURL(file).href); await saved();
    const fixturePath = join(root, "aging-fixture.json");
    await Bun.write(fixturePath, JSON.stringify(buildFixture()));
    page.once("dialog", d => d.accept());
    await page.getByLabel("Restore JSON backup").setInputFiles(fixturePath);
    await page.waitForFunction(() => document.querySelectorAll(".card").length === 5); await saved();

    const noThreshold = page.getByRole("button", { name: "Open card: No threshold", exact: true });
    const below = page.getByRole("button", { name: "Open card: Below threshold", exact: true });
    const at = page.getByRole("button", { name: "Open card: At threshold", exact: true });
    const double = page.getByRole("button", { name: "Open card: Double threshold", exact: true });
    const doneOld = page.getByRole("button", { name: "Open card: Old but done", exact: true });

    expect(await noThreshold.locator(".aging-badge").count()).toBe(0);
    expect(await below.locator(".aging-badge").count()).toBe(0);
    expect(await doneOld.locator(".aging-badge").count()).toBe(0);

    expect(await at.locator(".aging-badge").textContent()).toBe("⏳ 7 d in column");
    expect(await at.locator(".aging-badge").getAttribute("class")).toContain("soon");
    expect(await at.locator(".aging-badge").getAttribute("class")).not.toContain("overdue");
    expect(await at.locator(".aging-badge").getAttribute("title")).toContain("7 days in In Progress; flagged after 7");

    expect(await double.locator(".aging-badge").textContent()).toBe("⏳ 14 d in column");
    expect(await double.locator(".aging-badge").getAttribute("class")).toContain("overdue");

    await page.screenshot({ path: "evidence/aging-board.png", fullPage: true, animations: "disabled" });
    await page.locator("#theme-select").selectOption("dark"); await saved();
    await page.screenshot({ path: "evidence/aging-board-dark.png", fullPage: true, animations: "disabled" });
    await page.locator("#theme-select").selectOption("system"); await saved();

    // Swimlane board: the same badges must still render through renderSwimlaneBoard's cardHTML calls.
    await page.locator("#swimlane-select").selectOption("priority"); await saved();
    expect(await page.getByRole("button", { name: "Open card: At threshold", exact: true }).locator(".aging-badge").count()).toBe(1);
    expect(await page.getByRole("button", { name: "Open card: Double threshold", exact: true }).locator(".aging-badge").getAttribute("class")).toContain("overdue");
    expect(await page.getByRole("button", { name: "Open card: Old but done", exact: true }).locator(".aging-badge").count()).toBe(0);

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);

test("Aging: the column settings dialog sets, validates and persists the threshold through reload", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-aging-dialog-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1440, height: 1000 }, acceptDownloads: true, colorScheme: "light" });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page: Page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  const saved = async () => { await page.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };
  try {
    await page.goto(pathToFileURL(file).href); await saved();
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Aging"); await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved();
    await page.getByRole("button", { name: "Edit column Backlog", exact: true }).click();
    await page.getByLabel("Aging threshold", { exact: true }).fill("5"); await page.getByLabel("Aging threshold", { exact: true }).press("Tab"); await saved();
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    await page.reload(); await saved();
    await page.getByRole("button", { name: "Edit column Backlog", exact: true }).click();
    expect(await page.getByLabel("Aging threshold", { exact: true }).inputValue()).toBe("5");
    await page.getByLabel("Aging threshold", { exact: true }).fill("0"); await page.getByLabel("Aging threshold", { exact: true }).press("Tab");
    await page.getByTestId("storage-status").filter({ hasText: "Not saved" }).waitFor();
    await page.getByLabel("Aging threshold", { exact: true }).fill("5"); await page.getByLabel("Aging threshold", { exact: true }).press("Tab"); await saved();
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 30000);
