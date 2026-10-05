import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };

test("delivered timeline view: bar geometry, dependency arrows and not-scheduled cards, light and dark, offline", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-timeline-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  context.setDefaultTimeout(6000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(pathToFileURL(file).href); await saved(page);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Timeline project");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);

    const addCard = async (title: string) => {
      await page.locator(".column").first().getByRole("button", { name: "Add card at bottom" }).click();
      await page.getByPlaceholder("Card title").fill(title); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    };
    const schedule = async (title: string, start: string, due: string, blockedBy?: string) => {
      await page.getByRole("button", { name: `Open card: ${title}`, exact: true }).click();
      await page.getByLabel("Start date", { exact: true }).fill(start); await page.getByLabel("Start date", { exact: true }).press("Tab"); await saved(page);
      await page.getByLabel("Due date", { exact: true }).fill(due); await page.getByLabel("Due date", { exact: true }).press("Tab"); await saved(page);
      if (blockedBy) { await page.getByLabel(`Blocked by ${blockedBy}`, { exact: true }).check(); await saved(page); }
      await page.getByRole("button", { name: "Close card", exact: true }).click();
    };
    await addCard("Design"); await addCard("Loose end"); await addCard("Ship"); await addCard("Rush");
    await schedule("Design", addDays(0), addDays(5));
    await schedule("Ship", addDays(6), addDays(7), "Design");   // starts exactly when Design ends: no conflict
    await schedule("Rush", addDays(2), addDays(3), "Design");   // starts while Design is still open: conflict

    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    expect(page.url()).toContain("view=timeline");
    expect(await page.locator("#board").isHidden()).toBe(true);

    const designBar = page.locator('[data-timeline-bar]').filter({ hasText: "Design" });
    const shipBar = page.locator('[data-timeline-bar]').filter({ hasText: "Ship" });
    const rushBar = page.locator('[data-timeline-bar]').filter({ hasText: "Rush" });
    await designBar.waitFor(); await shipBar.waitFor(); await rushBar.waitFor();

    const designStart = Number(await designBar.getAttribute("data-start-offset"));
    const designSpan = Number(await designBar.getAttribute("data-span"));
    const shipStart = Number(await shipBar.getAttribute("data-start-offset"));
    const shipSpan = Number(await shipBar.getAttribute("data-span"));
    const rushStart = Number(await rushBar.getAttribute("data-start-offset"));
    const rushSpan = Number(await rushBar.getAttribute("data-span"));
    expect(designSpan).toBe(6); // 2026-xx-x0 through +5 inclusive
    expect(shipSpan).toBe(2); expect(rushSpan).toBe(2);
    expect(shipStart - designStart).toBe(6); // Ship starts 6 days after Design
    expect(rushStart - designStart).toBe(2); // Rush starts 2 days after Design, well before Design's bar ends

    expect(await page.locator(".timeline-arrow").count()).toBe(2);
    expect(await page.locator(".timeline-arrow.conflict").count()).toBe(1);
    const conflictArrow = page.locator(".timeline-arrow.conflict");
    expect(await conflictArrow.getAttribute("data-arrow-to")).not.toBeNull();
    expect(await page.locator(".timeline-arrow:not(.conflict)").count()).toBe(1);

    const notScheduled = page.locator(".timeline-notscheduled");
    expect(await notScheduled.textContent()).toContain("Loose end");
    expect(await notScheduled.locator('[data-timeline-card]').count()).toBe(1);

    // Date axis: the first scheduled week's gridline carries a full, locale-formatted date label.
    const rangeStartLabel = (() => {
      const now = new Date(); const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(monday);
      const month = new Intl.DateTimeFormat(undefined, { month: "short" }).format(monday);
      return { weekday, month, day: String(monday.getDate()) };
    })();
    const firstWeekTick = page.locator(".timeline-axis-tick.week").first();
    const firstWeekTickText = await firstWeekTick.textContent();
    expect(firstWeekTickText).toContain(rangeStartLabel.weekday);
    expect(firstWeekTickText).toContain(rangeStartLabel.month);
    expect(firstWeekTickText).toContain(rangeStartLabel.day);
    expect(await page.locator(".timeline-axis-tick").count()).toBeGreaterThan(1);

    // Width fill: a short, ~2-week range should stretch to use the available panel width, not a sliver of it.
    const chartBox = await page.locator(".timeline-chart").boundingBox();
    const scrollBox = await page.locator(".timeline-scroll").boundingBox();
    expect(chartBox!.width / scrollBox!.width).toBeGreaterThanOrEqual(0.85);

    // Readability: a bar's visible label is truncation-safe and carries a full-text tooltip; arrows
    // paint behind bars/labels (DOM order and z-index) so a label is never obscured by an arrowhead.
    expect(await rushBar.getAttribute("title")).toBe("Rush");
    expect(await rushBar.evaluate(el => getComputedStyle(el).textOverflow)).toBe("ellipsis");
    const [arrowZ, barZ] = await Promise.all([
      page.locator(".timeline-arrows").evaluate(el => Number(getComputedStyle(el).zIndex)),
      rushBar.evaluate(el => Number(getComputedStyle(el).zIndex)),
    ]);
    expect(barZ).toBeGreaterThan(arrowZ);

    await page.screenshot({ path: "evidence/timeline-view.png", fullPage: true, animations: "disabled" });

    await designBar.click();
    expect(await page.locator("#card-title").inputValue()).toBe("Design");
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await page.getByRole("button", { name: "By epic", exact: true }).click();
    expect(await page.getByRole("button", { name: "By epic", exact: true }).getAttribute("aria-pressed")).toBe("true");
    await page.locator('[data-timeline-bar]').filter({ hasText: "Design" }).waitFor();

    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/timeline-view-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });

    await page.getByRole("button", { name: "Board", exact: true }).click();
    expect(page.url()).not.toContain("view=");

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
