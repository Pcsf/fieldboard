import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };
const isoDate = (daysFromNow: number) => { const d = new Date(); d.setDate(d.getDate() + daysFromNow); return d.toISOString().slice(0, 10); };

test("delivered milestones: overview, card chip, delete-unassigns and the milestone filter survive reload offline", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-milestones-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  context.setDefaultTimeout(6000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(pathToFileURL(file).href); await saved(page);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Milestones project");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);
    await page.locator(".column").first().getByRole("button", { name: "Add card at bottom" }).click();
    await page.getByPlaceholder("Card title").fill("Ship"); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);

    await page.getByRole("button", { name: "Milestones", exact: true }).click();
    expect(await page.locator("#project-milestones").textContent()).toContain("capacity check against the project's planning settings, not a delivery schedule");
    await page.getByLabel("New milestone name", { exact: true }).fill("Beta launch");
    await page.getByLabel("New milestone date", { exact: true }).fill(isoDate(120));
    await page.getByRole("button", { name: "Add milestone", exact: true }).click(); await saved(page);
    expect(await page.locator(".milestone-row").textContent()).toContain("Planning not enabled");
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    await page.getByRole("button", { name: "Open card: Ship", exact: true }).click();
    await page.getByLabel("Milestone", { exact: true }).selectOption({ label: "Beta launch" }); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    expect(await page.getByRole("button", { name: "Open card: Ship", exact: true }).locator(".milestone-chip").textContent()).toContain("Beta launch");

    await page.getByRole("button", { name: "Effort & planning", exact: true }).click();
    await page.getByRole("button", { name: "Enable project planning", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    await page.getByRole("button", { name: "Milestones", exact: true }).click();
    expect(await page.locator(".milestone-row").textContent()).toContain("1 unestimated card");
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    await page.getByRole("button", { name: "Open card: Ship", exact: true }).click();
    await page.getByRole("button", { name: "Start IED estimate", exact: true }).click();
    await page.getByLabel("Category", { exact: true }).selectOption({ label: "Register interface (design)" });
    await page.getByLabel("Subcategory", { exact: true }).selectOption({ label: "Hand-written CSR with decode logic" }); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await page.getByRole("button", { name: "Milestones", exact: true }).click();
    const overview = await page.locator(".milestone-row").textContent();
    expect(overview).toContain("Fits"); expect(overview).toContain("3.50 IED"); expect(overview).toContain("0/1 cards done");
    await page.screenshot({ path: "evidence/milestones-overview.png", fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    await page.getByLabel("Filter milestone", { exact: true }).selectOption({ label: "Beta launch" });
    await page.locator(".column").first().getByRole("button", { name: "Add card at bottom" }).click();
    await page.getByPlaceholder("Card title").fill("Unrelated"); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    expect(await page.getByRole("button", { name: "Open card: Ship", exact: true }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "Open card: Unrelated", exact: true }).count()).toBe(0);
    expect(page.url()).toContain("milestone=");
    await page.reload(); await saved(page);
    expect(await page.getByLabel("Filter milestone", { exact: true }).inputValue()).not.toBe("");
    expect(await page.getByRole("button", { name: "Open card: Unrelated", exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click(); await saved(page);

    await page.getByRole("button", { name: "Milestones", exact: true }).click();
    page.once("dialog", d => d.accept());
    await page.getByRole("button", { name: "Delete milestone Beta launch", exact: true }).click(); await saved(page);
    expect(await page.locator("#project-milestones").textContent()).toContain("No milestones yet.");
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    expect(await page.getByRole("button", { name: "Open card: Ship", exact: true }).locator(".milestone-chip").count()).toBe(0);

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
