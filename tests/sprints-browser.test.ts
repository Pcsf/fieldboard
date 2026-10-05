import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };

test("delivered sprints view: capacity source, load, verdict, overrides and card reassignment survive offline reload", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-sprints-"));
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
    await page.getByLabel("Project name", { exact: true }).fill("Sprints project");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Effort & planning", exact: true }).click();
    await page.getByRole("button", { name: "Enable project planning", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    for (const title of ["Card A", "Card B", "Card C"]) {
      await page.locator(".column").first().getByRole("button", { name: "Add card at bottom" }).click();
      await page.getByPlaceholder("Card title").fill(title); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    }

    await page.getByRole("button", { name: "Open card: Card A", exact: true }).click();
    await page.getByRole("button", { name: "Start IED estimate", exact: true }).click();
    await page.getByLabel("Category", { exact: true }).selectOption({ label: "DSP datapath (design)" });
    await page.getByLabel("Subcategory", { exact: true }).selectOption({ label: "Algorithmic datapath (CORDIC, FFT, matrix engine)" });
    await page.getByLabel("Sprint number", { exact: true }).fill("1"); await page.getByLabel("Sprint number", { exact: true }).press("Tab"); await saved(page);
    expect(await page.locator("#effort-result").textContent()).toContain("10.00 IED");
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await page.getByRole("button", { name: "Open card: Card B", exact: true }).click();
    await page.getByRole("button", { name: "Start IED estimate", exact: true }).click();
    expect(await page.getByLabel("Category", { exact: true }).inputValue()).toBe("custom");
    await page.getByLabel("Unsplit work minimum IED", { exact: true }).fill("1"); await page.getByLabel("Unsplit work minimum IED", { exact: true }).press("Tab");
    await page.getByLabel("Unsplit work maximum IED", { exact: true }).fill("1"); await page.getByLabel("Unsplit work maximum IED", { exact: true }).press("Tab");
    await page.getByLabel("Sprint number", { exact: true }).fill("2"); await page.getByLabel("Sprint number", { exact: true }).press("Tab"); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await page.getByRole("button", { name: "Open card: Card C", exact: true }).click();
    await page.getByRole("button", { name: "Start IED estimate", exact: true }).click();
    await page.getByLabel("Category", { exact: true }).selectOption({ label: "Serial link RTL design (design)" });
    await page.getByLabel("Subcategory", { exact: true }).selectOption({ label: "SPI" }); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await page.getByRole("button", { name: "Sprints", exact: true }).click();
    const sprintsBody = page.locator("#project-sprints");
    expect(await sprintsBody.textContent()).toContain("Sprint 1");
    expect(await sprintsBody.textContent()).toContain("Over capacity");
    expect(await sprintsBody.textContent()).toContain("Sprint 2");
    expect(await sprintsBody.textContent()).toContain("Within capacity");
    expect(await sprintsBody.textContent()).toContain("Derived from staffing");
    expect(await sprintsBody.textContent()).toContain("Card C");
    expect(await sprintsBody.locator("#sprint-unassigned").textContent()).toContain("Card C");

    await sprintsBody.getByLabel("Assign sprint for Card C", { exact: true }).fill("2");
    await sprintsBody.getByLabel("Assign sprint for Card C", { exact: true }).press("Tab"); await saved(page);
    expect(await sprintsBody.locator("#sprint-unassigned").textContent()).toContain("Nothing unassigned");
    expect(await sprintsBody.locator("[data-sprint=\"2\"]").textContent()).toContain("Card C");

    await sprintsBody.getByLabel("Sprint 1 capacity", { exact: true }).fill("20");
    await sprintsBody.getByLabel("Sprint 1 capacity", { exact: true }).press("Tab"); await saved(page);
    expect(await sprintsBody.locator("[data-sprint=\"1\"]").textContent()).toContain("Overridden");
    expect(await sprintsBody.locator("[data-sprint=\"1\"]").textContent()).toContain("Within capacity");
    await page.screenshot({ path: "evidence/sprints-view.png", fullPage: true, animations: "disabled" });

    await sprintsBody.getByLabel("Use default capacity for sprint 1", { exact: true }).click(); await saved(page);
    expect(await sprintsBody.locator("[data-sprint=\"1\"]").textContent()).toContain("Derived from staffing");
    expect(await sprintsBody.locator("[data-sprint=\"1\"]").textContent()).toContain("Over capacity");
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    await page.reload(); await saved(page);
    await page.getByRole("button", { name: "Sprints", exact: true }).click();
    const reopened = page.locator("#project-sprints");
    expect(await reopened.locator("[data-sprint=\"1\"]").textContent()).toContain("Over capacity");
    expect(await reopened.locator("[data-sprint=\"2\"]").textContent()).toContain("Card C");
    expect(await reopened.locator("#sprint-unassigned").textContent()).toContain("Nothing unassigned");

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
