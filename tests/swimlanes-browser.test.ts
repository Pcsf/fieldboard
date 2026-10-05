import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };
const persisted = (p: Page) => p.evaluate(async () => new Promise<any>(resolve => {
  const r = indexedDB.open("fieldboard", 2); r.onsuccess = () => { const db = r.result; const tx = db.transaction("workspace"); const g = tx.objectStore("workspace").get("current"); tx.oncomplete = () => { resolve(g.result); db.close(); }; };
}));
// The grid is flat (one CSS grid, not one per row -- see DECISIONS.md), so a lane's cells are found by
// the "data-lane" id read off its label, not by a wrapping row element.
async function firstLaneCell(page: Page, label: string) {
  const laneId = await page.locator(".lane-label", { hasText: new RegExp(`^${label}$`) }).getAttribute("data-lane");
  return page.locator(`.swimlane-cell[data-lane="${laneId}"]`).first();
}

test("delivered swimlanes: grouping by assignee renders lanes, dragging between lanes reassigns and persists offline", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-swimlanes-"));
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
    await page.getByLabel("Project name", { exact: true }).fill("Swimlane project");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Workspace & members" }).click();
    await page.getByLabel("Member name", { exact: true }).fill("Robin"); await page.getByRole("button", { name: "Add member", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    await page.locator(".column").first().getByRole("button", { name: "Add card at bottom" }).click();
    await page.getByPlaceholder("Card title").fill("Design review"); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    await page.getByRole("button", { name: "Open card: Design review", exact: true }).click();
    await page.getByLabel("Assign to Me", { exact: true }).check(); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await page.getByLabel("Group board by", { exact: true }).selectOption("assignee");
    expect(await page.locator(".lane-label").count()).toBe(3); // Me, Robin, None
    await page.screenshot({ path: "evidence/swimlanes.png", fullPage: true, animations: "disabled" });

    const noneLane = await firstLaneCell(page, "None");
    await page.getByRole("button", { name: "Open card: Design review", exact: true }).dragTo(noneLane); await saved(page);
    expect((await persisted(page)).cards[0].assignees).toEqual([]);
    await page.reload(); await saved(page);
    expect((await persisted(page)).cards[0].assignees).toEqual([]);
    expect(await page.locator(".lane-label").count()).toBe(3); // the grouping choice itself persisted too

    const robinLane = await firstLaneCell(page, "Robin");
    await page.getByRole("button", { name: "Open card: Design review", exact: true }).dragTo(robinLane); await saved(page);
    const after = await persisted(page);
    const robinId = after.members.find((m: any) => m.name === "Robin").id;
    expect(after.cards[0].assignees).toEqual([robinId]);
    await page.reload(); await saved(page);
    expect((await persisted(page)).cards[0].assignees).toEqual([robinId]);
    expect(((await persisted(page)).activities as any[]).filter((a: any) => a.action === "move")).toHaveLength(2);

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 30000);
