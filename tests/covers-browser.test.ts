import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };
const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("delivered card covers and colours: set from the card detail, shown on the face, cleared when the cover attachment is removed, survive offline reload", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-covers-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1024, height: 1000 }, acceptDownloads: true });
  context.setDefaultTimeout(6000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(pathToFileURL(file).href); await saved(page);
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Catalog artwork refresh");
    await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved(page);

    const addTo = async (columnHeading: string, title: string) => {
      const column = page.locator(".column").filter({ has: page.getByRole("heading", { name: columnHeading, exact: true }) });
      await column.getByRole("button", { name: "Add card at bottom" }).click();
      await page.getByPlaceholder("Card title").fill(title);
      await page.getByPlaceholder("Card title").press("Enter");
      await saved(page);
    };
    await addTo("Backlog", "Redraw the clock-domain crossing diagram for the ICD");
    await addTo("To Do", "Photograph the new encoder module on the test bench");
    await addTo("In Progress", "Finalize the front-panel label artwork");
    await addTo("Review", "Export the block diagram at print resolution");

    await page.getByRole("button", { name: "Open card: Photograph the new encoder module on the test bench", exact: true }).click();
    const pngBuffer = Buffer.from(TINY_PNG_BASE64, "base64");
    await page.getByLabel("Choose a file to attach").setInputFiles({ name: "bench-shot.png", mimeType: "image/png", buffer: pngBuffer });
    await saved(page);
    await page.getByLabel("Choose a file to attach").setInputFiles({ name: "closeup.png", mimeType: "image/png", buffer: pngBuffer });
    await saved(page);

    await page.getByLabel("Cover image", { exact: true }).selectOption({ label: "bench-shot.png" }); await saved(page);
    await page.getByRole("button", { name: "Amber", exact: true }).click(); await saved(page);

    // The face shows the cover strip and the colour accent immediately, without reopening the card.
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    const card = page.locator('[data-card]:has-text("Photograph the new encoder module")');
    expect(await card.locator(".card-cover").count()).toBe(1);
    expect(await card.locator(".card-cover").getAttribute("src")).toContain("data:image/png;base64,");
    expect(await card.getAttribute("data-card-color")).not.toBeNull();
    const accentStyle = await card.getAttribute("style");
    expect(accentStyle).toContain("--card-accent");

    // A contrast entry is never needed for this token: it is never used behind text.
    const textColor = await card.locator(".card-title").evaluate(el => getComputedStyle(el).color);
    const accentColor = await card.evaluate(el => getComputedStyle(el).getPropertyValue("--card-accent"));
    expect(textColor.replace(/\s/g, "")).not.toBe(accentColor.replace(/\s/g, ""));

    await page.screenshot({ path: "evidence/covers-1024-light.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/covers-1024-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });

    // Removing the cover's own attachment clears the cover -- the face strip disappears, and the
    // dropdown no longer offers it.
    await page.getByRole("button", { name: "Open card: Photograph the new encoder module on the test bench", exact: true }).click();
    await page.getByRole("button", { name: "Remove attachment bench-shot.png", exact: true }).click();
    await saved(page);
    expect(await page.getByLabel("Cover image", { exact: true }).inputValue()).toBe("");
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    expect(await card.locator(".card-cover").count()).toBe(0);
    expect(await card.getAttribute("data-card-color")).not.toBeNull(); // colour is independent of the cover

    await page.setViewportSize({ width: 390, height: 844 });
    const noPageScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noPageScroll).toBe(true);
    await page.screenshot({ path: "evidence/covers-390-light.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/covers-390-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1024, height: 1000 });

    // Offline reload: the colour (and the fact the cover was cleared) persisted.
    await page.reload(); await saved(page);
    expect(await card.getAttribute("data-card-color")).not.toBeNull();
    expect(await card.locator(".card-cover").count()).toBe(0);

    // Clearing the colour back to "No colour" removes the accent entirely.
    await page.getByRole("button", { name: "Open card: Photograph the new encoder module on the test bench", exact: true }).click();
    await page.getByRole("button", { name: "No colour", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    expect(await card.getAttribute("data-card-color")).toBeNull();

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
