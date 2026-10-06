import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };

// Time-boxed sprints: a non-estimated card can join a sprint, a sprint's name/dates/scope are
// editable with sensible defaults, and closing a sprint moves unfinished cards to the next one
// (created on the fly) while completed cards and the closed sprint's own record stay put --
// surviving an offline reload.
test("delivered sprint lifecycle: dates, non-estimated membership, close-out and the sprint burnup survive offline reload", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-sprint-lifecycle-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1024, height: 1400 }, acceptDownloads: true });
  context.setDefaultTimeout(6000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(pathToFileURL(file).href); await saved(page);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Level sensor firmware");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);

    const addTo = async (columnHeading: string, title: string) => {
      const column = page.locator(".column").filter({ has: page.getByRole("heading", { name: columnHeading, exact: true }) });
      await column.getByRole("button", { name: "Add card at bottom" }).click();
      await page.getByPlaceholder("Card title").fill(title);
      await page.getByPlaceholder("Card title").press("Enter");
      await saved(page);
    };
    await addTo("Backlog", "Review vendor IP licensing terms before tape-out");
    await addTo("To Do", "Investigate intermittent ADC glitch seen during burn-in");
    await addTo("In Progress", "Migrate the register map generator to the new schema");
    await addTo("Review", "Schedule the shared lab slot for SERDES characterization");
    await addTo("To Do", "Draft the field-update rollback runbook");

    // A plain card with no IED effort can carry a sprint number, set from its own detail view.
    await page.getByRole("button", { name: "Open card: Investigate intermittent ADC glitch seen during burn-in", exact: true }).click();
    await page.getByLabel("Sprint", { exact: true }).fill("1");
    await page.getByLabel("Sprint", { exact: true }).press("Tab"); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await page.getByRole("button", { name: "Open card: Draft the field-update rollback runbook", exact: true }).click();
    await page.getByLabel("Sprint", { exact: true }).fill("1");
    await page.getByLabel("Sprint", { exact: true }).press("Tab"); await saved(page);
    await page.getByLabel("Move to column", { exact: true }).selectOption({ label: "Done" }); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    // An estimated card keeps using its own effort.sprint field, unchanged from before this release.
    await page.getByRole("button", { name: "Open card: Migrate the register map generator to the new schema", exact: true }).click();
    await page.getByRole("button", { name: "Start IED estimate", exact: true }).click();
    await page.getByLabel("Sprint number", { exact: true }).fill("1");
    await page.getByLabel("Sprint number", { exact: true }).press("Tab"); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    await page.getByRole("button", { name: "Sprints", exact: true }).click();
    const sprints = page.locator("#project-sprints");
    const sprint1 = sprints.locator('[data-sprint="1"]');
    await sprint1.waitFor();
    expect(await sprint1.textContent()).toContain("Investigate intermittent ADC glitch seen during burn-in");
    expect(await sprint1.textContent()).toContain("Draft the field-update rollback runbook");
    expect(await sprint1.textContent()).toContain("Migrate the register map generator to the new schema");
    expect(await sprint1.textContent()).toContain("Not sized");

    // Dates default to a sensible window and are editable per sprint.
    const startInput = sprint1.getByLabel("Sprint 1 start date", { exact: true });
    const endInput = sprint1.getByLabel("Sprint 1 end date", { exact: true });
    expect(await startInput.inputValue()).not.toBe("");
    expect(await endInput.inputValue()).not.toBe("");
    await sprint1.getByLabel("Sprint 1 name", { exact: true }).fill("Burn-in investigation");
    await sprint1.getByLabel("Sprint 1 name", { exact: true }).press("Tab"); await saved(page);
    await startInput.fill("2026-02-02"); await startInput.press("Tab"); await saved(page);
    await endInput.fill("2026-02-15"); await endInput.press("Tab"); await saved(page);
    await sprint1.getByLabel("Sprint 1 scope", { exact: true }).fill("Chase the burn-in glitch and ship the rollback runbook.");
    await sprint1.getByLabel("Sprint 1 scope", { exact: true }).press("Tab"); await saved(page);

    // A sprint burnup chart is drawn, reusing the same chart engine as the milestone one.
    expect(await sprint1.locator("[data-sprint-burnup]").count()).toBe(1);

    // Close the sprint: the unfinished cards move to sprint 2 (created on the fly); the completed
    // card and the closed sprint's own record stay exactly where they are.
    await sprint1.getByLabel("What was completed in sprint 1", { exact: true }).fill("Shipped the rollback runbook; the glitch investigation carries over.");
    await sprint1.getByRole("button", { name: "Close sprint", exact: true }).click(); await saved(page);
    expect(await sprint1.textContent()).toContain("Closed");
    expect(await sprint1.textContent()).toContain("Shipped the rollback runbook; the glitch investigation carries over.");
    expect(await sprint1.getByLabel("Sprint 1 name", { exact: true }).isDisabled()).toBe(true);

    const sprint2 = sprints.locator('[data-sprint="2"]');
    await sprint2.waitFor();
    expect(await sprint2.textContent()).toContain("Investigate intermittent ADC glitch seen during burn-in");
    expect(await sprint2.textContent()).toContain("Migrate the register map generator to the new schema");
    expect(await sprint2.textContent()).not.toContain("Draft the field-update rollback runbook"); // completed, stayed in sprint 1
    expect(await sprint1.textContent()).toContain("Draft the field-update rollback runbook");
    await sprint2.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "evidence/sprints-lifecycle-1024-light.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/sprints-lifecycle-1024-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });

    await page.setViewportSize({ width: 390, height: 844 });
    const noPageScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noPageScroll).toBe(true);
    await sprint2.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "evidence/sprints-lifecycle-390-light.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/sprints-lifecycle-390-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1024, height: 1400 });

    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    // Offline reload: the close-out, the window edits and the card moves all persisted.
    await page.reload(); await saved(page);
    await page.getByRole("button", { name: "Sprints", exact: true }).click();
    const reopened = page.locator("#project-sprints");
    const reopenedSprint1 = reopened.locator('[data-sprint="1"]');
    const reopenedSprint2 = reopened.locator('[data-sprint="2"]');
    await reopenedSprint2.waitFor();
    expect(await reopenedSprint1.textContent()).toContain("Closed");
    // The name lives in an <input value="…">, which .textContent() never sees -- read the value directly.
    expect(await reopenedSprint1.getByLabel("Sprint 1 name", { exact: true }).inputValue()).toBe("Burn-in investigation");
    expect(await reopenedSprint2.textContent()).toContain("Investigate intermittent ADC glitch seen during burn-in");
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    // The moved card's own detail view agrees with the sprint board.
    await page.getByRole("button", { name: "Open card: Investigate intermittent ADC glitch seen during burn-in", exact: true }).click();
    expect(await page.getByLabel("Sprint", { exact: true }).inputValue()).toBe("2");

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
