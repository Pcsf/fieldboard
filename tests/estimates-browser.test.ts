import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };

test("delivered estimates: workspace unit, column sums, swimlane sums, archive/move update, unit switch relabels", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-estimates-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(pathToFileURL(file).href); await saved(page);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Estimates project");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Workspace & members" }).click();
    await page.getByLabel("Member name", { exact: true }).fill("Robin"); await page.getByRole("button", { name: "Add member", exact: true }).click(); await saved(page);

    // Default unit is points; no explicit selection needed yet.
    expect(await page.getByLabel("Estimate unit", { exact: true }).inputValue()).toBe("points");
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    const firstColumn = page.locator(".column").first();
    await firstColumn.getByRole("button", { name: "Add card at bottom" }).click();
    await page.getByPlaceholder("Card title").fill("Card A"); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    await firstColumn.getByRole("button", { name: "Add card at bottom" }).click();
    await page.getByPlaceholder("Card title").fill("Card B"); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);

    await page.getByRole("button", { name: "Open card: Card A", exact: true }).click();
    await page.getByLabel("Estimate", { exact: true }).fill("5"); await page.getByLabel("Estimate", { exact: true }).blur(); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.getByRole("button", { name: "Open card: Card B", exact: true }).click();
    await page.getByLabel("Estimate", { exact: true }).fill("2.5"); await page.getByLabel("Estimate", { exact: true }).blur(); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    const firstColumnHeader = page.locator(".column").first().locator(".column-heading");
    expect(await firstColumnHeader.locator(".estimate-sum").textContent()).toBe("Σ 7.5 pts");
    await page.screenshot({ path: "evidence/planning3-estimates-board-light.png", fullPage: true, animations: "disabled" });

    // Archive Card B: the column sum drops back to just Card A's estimate, matching WIP-count
    // behaviour (counts non-archived cards regardless of filter).
    await page.getByRole("button", { name: "Open card: Card B", exact: true }).click();
    await page.getByRole("button", { name: "Archive card", exact: true }).click(); await saved(page);
    expect(await firstColumnHeader.locator(".estimate-sum").textContent()).toBe("Σ 5 pts");

    // Move Card A to the next column: the sum follows it.
    await page.getByRole("button", { name: "Open card: Card A", exact: true }).click();
    const columnNames = await page.locator(".column .column-heading h2").allTextContents();
    await page.getByLabel("Move to column", { exact: true }).selectOption({ label: columnNames[1]! });
    await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    expect(await firstColumnHeader.locator(".estimate-sum").isHidden()).toBe(true);
    const secondColumnHeader = page.locator(".column").nth(1).locator(".column-heading");
    expect(await secondColumnHeader.locator(".estimate-sum").textContent()).toBe("Σ 5 pts");

    // Swimlane sums: group by assignee, assign Card A to Robin, lane shows the sum; the unassigned
    // lane (holding nothing estimated) shows no sum badge.
    await page.getByLabel("Group board by", { exact: true }).selectOption("assignee");
    await page.getByRole("button", { name: "Open card: Card A", exact: true }).click();
    await page.getByLabel("Assign to Robin", { exact: true }).check(); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    const robinLaneLabel = page.locator(".lane-label", { hasText: /^Robin/ });
    const robinLaneId = await robinLaneLabel.getAttribute("data-lane");
    expect(await page.locator(`[data-lane-sum="${robinLaneId}"]`).textContent()).toBe("Σ 5 pts");
    const noneLaneLabel = page.locator(".lane-label", { hasText: /^None/ });
    const noneLaneId = await noneLaneLabel.getAttribute("data-lane");
    expect(await page.locator(`[data-lane-sum="${noneLaneId}"]`).count()).toBe(0);
    await page.screenshot({ path: "evidence/planning3-estimates-swimlanes-light.png", fullPage: true, animations: "disabled" });
    await page.getByLabel("Group board by", { exact: true }).selectOption("none");

    // Switching the workspace unit to hours relabels both the column sum and the card detail field.
    await page.getByRole("button", { name: "Workspace & members" }).click();
    await page.getByLabel("Estimate unit", { exact: true }).selectOption("hours");
    await saved(page);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    expect(await secondColumnHeader.locator(".estimate-sum").textContent()).toBe("Σ 5 h");
    await page.getByRole("button", { name: "Open card: Card A", exact: true }).click();
    expect(await page.getByText("Estimate · h", { exact: true }).count()).toBe(1);
    await page.screenshot({ path: "evidence/planning3-estimates-card-light.png", animations: "disabled" });
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/planning3-estimates-board-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });

    await page.setViewportSize({ width: 390, height: 844 });
    const noPageScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noPageScroll).toBe(true);
    await page.screenshot({ path: "evidence/planning3-estimates-phone-light.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/planning3-estimates-phone-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
