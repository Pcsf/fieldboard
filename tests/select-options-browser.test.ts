import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { mkdtemp, copyFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

test("dropdown options are readable in both themes: every option paints its own background with AA-contrast text", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-select-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  const url = pathToFileURL(file).href;
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  const saved = () => page.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor();
  const persisted = () => page.evaluate(async () => new Promise<any>(resolve => {
    const r = indexedDB.open("fieldboard", 2); r.onsuccess = () => { const db = r.result; const tx = db.transaction("workspace"); const g = tx.objectStore("workspace").get("current"); tx.oncomplete = () => { resolve(g.result); db.close(); }; };
  }));
  const viewport = { width: 390, height: 844 };
  await mkdir("evidence", { recursive: true });
  try {
    await page.goto(url); await saved();
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("Selects"); await page.getByRole("button", { name: "Create project", exact: true }).click(); await saved();
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      const bad = await page.evaluate(() => {
        const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
        const lum = (c: number[]) => { const [r, g, b] = c.slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r! + .7152 * g! + .0722 * b!; };
        const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + .05) / (y! + .05); };
        return [...document.querySelectorAll("option")].map(o => { const s = getComputedStyle(o); const bg = rgb(s.backgroundColor); return { text: o.textContent, select: o.parentElement?.getAttribute("aria-label") ?? o.parentElement?.id, painted: bg.length >= 3 && (bg[3] ?? 1) > 0, ratio: ratio(rgb(s.color), bg) }; })
          .filter(o => !o.painted || o.ratio < 4.5).slice(0, 3);
      });
      expect([theme, bad]).toEqual([theme, []]);
    }
    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
