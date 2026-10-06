import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createWorkspace, createProject, validateWorkspace, id as newId, type Card, type Activity, type Workspace } from "../src/model";
import { cfdSeries, cfdBands } from "../src/cfd";
import { boardCycleStats } from "../src/cycletime";
import { weeklyThroughput } from "../src/throughput";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };

// --- Realistic multi-week fixture, built directly (model mutation functions stamp "now", so a real
// historical timeline has to be fabricated) and restored as a JSON backup, same approach as
// tests/burnup-browser.test.ts. ---
function isoAt(now: Date, daysAgo: number, hour = 10): string {
  const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(hour, 0, 0, 0); return d.toISOString();
}
function baseCard(cardId: string, title: string, columnId: string, createdAt: string, patch: Partial<Card> = {}): Card {
  return {
    id: cardId, columnId, position: 0, title, description: "", priority: "none", dueDate: null, estimate: null,
    labels: [], assignees: [], subtasks: [], comments: [], attachments: [], links: [],
    createdAt, updatedAt: createdAt, completedAt: null, archived: false, ...patch,
  };
}
interface Step { daysAgo: number; action: string; patch: (ts: string) => Partial<Card> }
function timeline(now: Date, actor: string, cardId: string, title: string, columnId: string, createdDaysAgo: number, steps: Step[]) {
  const createdAt = isoAt(now, createdDaysAgo);
  let state = baseCard(cardId, title, columnId, createdAt);
  const activities: Activity[] = [{ id: newId(), cardId, actor, action: "create", before: null, after: state, timestamp: createdAt }];
  for (const step of steps) {
    const ts = isoAt(now, step.daysAgo); const before = state;
    state = { ...state, ...step.patch(ts), updatedAt: ts };
    activities.push({ id: newId(), cardId, actor, action: step.action, before, after: state, timestamp: ts });
  }
  return { activities, final: state };
}
const moveTo = (columnId: string) => (_ts: string): Partial<Card> => ({ columnId });
const complete = (columnId: string) => (ts: string): Partial<Card> => ({ columnId, completedAt: ts });

function buildFixture(now: Date): { w: Workspace; boardId: string; cols: string[] } {
  const w = createWorkspace();
  const actor = w.settings.actorId;
  const p = createProject(w, "Insights project");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const cols = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position).map(c => c.id);
  const [backlog, todo, inProgress, review, done] = cols as [string, string, string, string, string];

  const specs: ReturnType<typeof timeline>[] = [
    timeline(now, actor, newId(), "Design review", backlog, 65, [
      { daysAgo: 60, action: "move", patch: moveTo(todo) }, { daysAgo: 50, action: "move", patch: moveTo(inProgress) },
      { daysAgo: 40, action: "move", patch: moveTo(review) }, { daysAgo: 35, action: "move", patch: complete(done) },
    ]),
    timeline(now, actor, newId(), "Spec doc", backlog, 60, [
      { daysAgo: 45, action: "move", patch: moveTo(inProgress) }, { daysAgo: 30, action: "move", patch: complete(done) },
      { daysAgo: 5, action: "archive", patch: () => ({ archived: true }) },
    ]),
    timeline(now, actor, newId(), "Bring-up", backlog, 50, [
      { daysAgo: 44, action: "move", patch: moveTo(todo) }, { daysAgo: 20, action: "move", patch: moveTo(inProgress) },
      { daysAgo: 18, action: "move", patch: complete(done) },
    ]),
    timeline(now, actor, newId(), "Timing closure", backlog, 45, [
      { daysAgo: 30, action: "move", patch: moveTo(inProgress) }, { daysAgo: 12, action: "move", patch: complete(done) },
    ]),
    timeline(now, actor, newId(), "Driver fix", backlog, 40, [
      { daysAgo: 5, action: "move", patch: complete(done) }, // skipped intermediate columns
    ]),
    timeline(now, actor, newId(), "Old legacy task", backlog, 95, [
      { daysAgo: 90, action: "move", patch: complete(done) }, // completed ~13 weeks ago: outside the 12-week throughput window
    ]),
    timeline(now, actor, newId(), "In progress now", backlog, 25, [
      { daysAgo: 20, action: "move", patch: moveTo(todo) }, { daysAgo: 10, action: "move", patch: moveTo(inProgress) },
    ]),
    timeline(now, actor, newId(), "Still backlog", backlog, 15, []),
    timeline(now, actor, newId(), "Backlog archived", backlog, 10, [
      { daysAgo: 2, action: "archive", patch: () => ({ archived: true }) },
    ]),
    timeline(now, actor, newId(), "This week done", backlog, 8, [
      { daysAgo: 1, action: "move", patch: complete(done) },
    ]),
  ];
  const finals = specs.map(t => t.final);
  const byColumn = new Map<string, Card[]>();
  for (const c of finals) { const list = byColumn.get(c.columnId) ?? []; list.push(c); byColumn.set(c.columnId, list); }
  for (const list of byColumn.values()) list.forEach((c, i) => c.position = i);
  w.cards = finals;
  w.activities = specs.flatMap(t => t.activities);
  validateWorkspace(w); // fail fast here, not as a mysterious browser-side rejection
  return { w, boardId: board.id, cols };
}

test("delivered Insights view: cumulative flow, lead/cycle time and throughput match the model, readable in both themes at 1024 and 390", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-insight-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1024, height: 1400 }, acceptDownloads: true });
  context.setDefaultTimeout(6000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    const now = new Date();
    const { w: fixture, boardId, cols } = buildFixture(now);
    await page.goto(pathToFileURL(file).href); await saved(page);
    page.once("dialog", d => d.accept());
    await page.getByLabel("Restore JSON backup", { exact: true }).setInputFiles({ name: "insight-fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
    await saved(page);
    await page.getByRole("link", { name: "Insights project", exact: true }).click().catch(() => {});

    await page.getByRole("tab", { name: "Insights", exact: true }).click();
    expect(page.url()).toContain("view=insights");
    expect(await page.locator("#board").isHidden()).toBe(true);
    expect(await page.locator("#insights-view").isHidden()).toBe(false);

    // --- R34: cumulative flow diagram — last day's per-band values match the model exactly ---
    const expectedCfd = cfdSeries(fixture, boardId, now).at(-1)!;
    const expectedBands = cfdBands(fixture.columns.filter(c => c.boardId === boardId));
    const lastDaySegs = page.locator('[data-cfd-day="last"]');
    await lastDaySegs.first().waitFor();
    const rendered = await lastDaySegs.evaluateAll(els => els.map(el => ({ band: el.getAttribute("data-band")!, count: Number(el.getAttribute("data-count")) })));
    for (const band of expectedBands) {
      const expectedCount = band.columnId === null ? expectedCfd.removed : expectedCfd.byColumn[band.columnId] ?? 0;
      const found = rendered.find(r => r.band === band.key);
      if (expectedCount > 0) { expect(found, band.label).toBeDefined(); expect(found!.count, band.label).toBe(expectedCount); }
    }
    expect(rendered.reduce((s, r) => s + r.count, 0)).toBe(fixture.cards.filter(c => cols.includes(c.columnId)).length);

    // Switching the range re-renders a different-length chart, proving the control actually works.
    const dayCountFor = () => page.locator(".cfd-day").count();
    const before90 = await dayCountFor();
    await page.selectOption("#insights-range", "14");
    await page.waitForFunction(() => document.querySelectorAll(".cfd-day").length <= 14);
    const after14 = await dayCountFor();
    expect(after14).toBeLessThan(before90);
    expect(after14).toBeLessThanOrEqual(14);
    await page.selectOption("#insights-range", "30");
    await saved(page);

    // --- R35: lead/cycle time distributions match the model for the selected (30-day) range ---
    const expectedStats = boardCycleStats(fixture.cards.filter(c => cols.includes(c.columnId)), (() => {
      const m = new Map<string, Activity[]>(); for (const a of fixture.activities) { const l = m.get(a.cardId); if (l) l.push(a); else m.set(a.cardId, [a]); } return m;
    })(), fixture.columns.filter(c => cols.includes(c.id)), 30, now);
    const leadDist = page.locator('[data-dist="lead"]'); const cycleDist = page.locator('[data-dist="cycle"]');
    await leadDist.waitFor();
    expect(Number(await leadDist.getAttribute("data-count"))).toBe(expectedStats.lead.count);
    expect(Number(await leadDist.getAttribute("data-median"))).toBeCloseTo(expectedStats.lead.medianDays!, 1);
    expect(Number(await cycleDist.getAttribute("data-count"))).toBe(expectedStats.cycle.count);
    expect(Number(await cycleDist.getAttribute("data-median"))).toBeCloseTo(expectedStats.cycle.medianDays!, 1);

    // --- R36: throughput bars match the model for the last 12 weeks ---
    const expectedWeeks = weeklyThroughput(fixture.cards.filter(c => cols.includes(c.columnId)), 12, now);
    const bars = await page.locator("[data-week]").evaluateAll(els => els.map(el => ({ week: el.getAttribute("data-week")!, count: Number(el.getAttribute("data-count")) })));
    expect(bars.length).toBe(12);
    for (const w of expectedWeeks) {
      const found = bars.find(b => b.week === w.weekStart);
      expect(found, w.weekStart).toBeDefined(); expect(found!.count, w.weekStart).toBe(w.count);
    }
    expect(expectedWeeks.some(w => w.count > 0)).toBe(true); // the fixture actually exercises a non-empty week

    // The oldest completion (~13 weeks ago) must not appear anywhere in the 12-week window.
    const oldCard = fixture.cards.find(c => c.title === "Old legacy task")!;
    const oldWeekMonday = new Date(oldCard.completedAt!); oldWeekMonday.setHours(0, 0, 0, 0); oldWeekMonday.setDate(oldWeekMonday.getDate() - ((oldWeekMonday.getDay() + 6) % 7));
    expect(expectedWeeks.some(w => w.weekStart === oldWeekMonday.toLocaleDateString("en-CA"))).toBe(false);

    // No forecast/projection claim anywhere in the view.
    const viewText = ((await page.locator("#insights-view").textContent()) ?? "").toLocaleLowerCase();
    expect(viewText).not.toContain("forecast"); expect(viewText).not.toContain("projected"); expect(viewText).not.toContain("eta");

    // --- Per-card lead/cycle time in the card detail view ---
    await page.getByRole("tab", { name: "Board", exact: true }).click();
    await page.getByRole("button", { name: "Open card: This week done", exact: true }).click();
    const detailText = await page.locator("#detail").textContent();
    expect(detailText).toContain("Lead time");
    expect(detailText).toContain("Cycle time");
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.getByRole("button", { name: "Open card: In progress now", exact: true }).click();
    const openText = await page.locator("#detail").textContent();
    expect(openText).toContain("In progress for");
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.getByRole("tab", { name: "Insights", exact: true }).click();
    await lastDaySegs.first().waitFor();

    // --- Screenshots: light/dark at 1024 and 390 ---
    await page.screenshot({ path: "evidence/insight-1024-light.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/insight-1024-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });

    await page.setViewportSize({ width: 390, height: 844 });
    const noPageScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noPageScroll).toBe(true);
    await page.screenshot({ path: "evidence/insight-390-light.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/insight-390-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1024, height: 1400 });

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
