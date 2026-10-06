// Evidence screenshots for the Tier 3 Accessibility pass (claim R52): visible focus rings and the
// contrast/visual fixes, in both themes. Not a correctness assertion beyond "the page did not error"
// -- tests/a11y-axe.test.ts and tests/theme-contrast.test.ts are the falsifiers; this file is what a
// reviewer opens to see what the fixes actually look like.
import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdtemp, copyFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { buildA11yFixture } from "./a11y-fixture";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };

test("accessibility evidence: focus rings and visual fixes, light and dark", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  await mkdir("evidence", { recursive: true });
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-a11y-shots-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  const url = pathToFileURL(file).href;
  const fixture = buildA11yFixture(new Date());

  const context = await chromium.launchPersistentContext(join(root, "profile"), {
    executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true,
    chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot },
    viewport: { width: 1024, height: 1000 }, acceptDownloads: true,
  });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const errors: string[] = [];
  await context.route(/^https?:/, r => r.abort());
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));

  try {
    await page.goto(url); await saved(page);
    page.once("dialog", d => d.accept());
    await page.getByLabel("Restore JSON backup", { exact: true }).setInputFiles({ name: "a11y-fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
    await saved(page);
    await page.getByRole("link", { name: "Launch readiness", exact: true }).click().catch(() => {});
    await page.getByRole("button", { name: "Open card: Design the onboarding flow", exact: true }).waitFor();

    for (const theme of ["light", "dark"] as const) {
      if (await page.locator("#menu-toggle").isVisible()) await page.locator("#menu-toggle").click();
      await page.locator("#theme-select").selectOption(theme); await saved(page);
      await page.keyboard.press("Escape");

      // Focus ring on a card face (keyboard focus, not the aria-pressed "selected" outline).
      await page.getByRole("button", { name: "Open card: Design the onboarding flow", exact: true }).focus();
      await page.screenshot({ path: `evidence/a11y-focus-card-${theme}.png`, animations: "disabled" });

      // Focus ring on a sidebar button, which previously had the only-just-failing --muted text
      // right next to it (the "LOCAL WORKSPACE" caption and the "No accounts. No network." note).
      await page.locator("#new-project").focus();
      await page.screenshot({ path: `evidence/a11y-focus-sidebar-${theme}.png`, clip: { x: 0, y: 0, width: 260, height: 420 }, animations: "disabled" });

      // Calendar: an out-of-month "outside" cell (previously opacity-dimmed text at ~2:1) and a
      // "done" card (previously opacity-dimmed at ~3.4:1), both now colour-based instead of opacity.
      await page.getByRole("tab", { name: "Calendar", exact: true }).click();
      await page.screenshot({ path: `evidence/a11y-calendar-contrast-${theme}.png`, animations: "disabled" });

      // Insights: the lead/cycle distribution dots, grown from 7px to 10px.
      await page.getByRole("tab", { name: "Insights", exact: true }).click();
      await page.screenshot({ path: `evidence/a11y-insights-dots-${theme}.png`, fullPage: true, animations: "disabled" });
      await page.getByRole("tab", { name: "Board", exact: true }).click();

      // Automation dialog: the "RULES" section label no longer sits flush against the hint above it.
      await page.getByRole("button", { name: "Automation", exact: true }).click();
      await page.locator("#modal[open]").waitFor();
      await page.screenshot({ path: `evidence/a11y-automation-spacing-${theme}.png`, animations: "disabled" });
      await page.keyboard.press("Escape");

      // Card detail: the Recurrence section's intro paragraph, now sized like every other section's.
      await page.getByRole("button", { name: "Open card: Design the onboarding flow", exact: true }).click();
      await page.locator("#detail[open]").waitFor();
      await page.locator("#card-recurrence").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `evidence/a11y-recurrence-text-${theme}.png`, animations: "disabled" });
      await page.keyboard.press("Escape");

      // Help dialog: the merged "Keyboard:" and "Views:" paragraphs (previously duplicated).
      if (await page.locator("#menu-toggle").isVisible()) await page.locator("#menu-toggle").click();
      await page.getByRole("button", { name: "Help & storage safety" }).click();
      await page.locator("#modal[open]").waitFor();
      await page.screenshot({ path: `evidence/a11y-help-merged-text-${theme}.png`, fullPage: true, animations: "disabled" });
      await page.keyboard.press("Escape");
    }

    expect(errors).toEqual([]);
  } finally {
    await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true });
  }
}, 60_000);
