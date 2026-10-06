import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

test("the active view tab is visibly distinct from the inactive ones", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-viewtab-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1024, height: 900 } });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const page = context.pages()[0]!;
  try {
    await page.goto(pathToFileURL(file).href);
    await page.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor();
    await page.getByRole("button", { name: "New project" }).first().click();
    await page.getByLabel("Project name").fill("Tabs"); await page.getByRole("button", { name: "Create project" }).click();
    for (const view of ["List", "Board"]) {
      await page.getByRole("tab", { name: view, exact: true }).click();
      const bg = (name: string) => page.getByRole("tab", { name, exact: true }).evaluate(el => getComputedStyle(el).backgroundColor);
      expect(await bg(view)).not.toBe(await bg(view === "Board" ? "List" : "Board"));
    }
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
});
