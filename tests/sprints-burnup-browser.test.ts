import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createWorkspace, createProject, validateWorkspace, id as newId, type Card, type Activity, type Workspace } from "../src/model";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };

// --- Fixture: real multi-day Activity history across a ~2-week closed sprint and a still-open
// sprint with today mid-window, built the same way tests/burnup-browser.test.ts builds its milestone
// history (model mutation functions all stamp "now", so a historical timeline has to be fabricated),
// restored into the browser as a JSON backup. ---
function isoAt(now: Date, daysAgo: number, hour = 10): string {
  const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(hour, 0, 0, 0); return d.toISOString();
}
function isoDateAt(now: Date, daysFromNow: number): string {
  const d = new Date(now); d.setDate(d.getDate() + daysFromNow); return d.toISOString().slice(0, 10);
}
function baseCard(cardId: string, columnId: string, createdAt: string, patch: Partial<Card> = {}): Card {
  return {
    id: cardId, columnId, position: 0, title: `Card ${cardId.slice(0, 4)}`, description: "", priority: "none", dueDate: null, estimate: null,
    labels: [], assignees: [], subtasks: [], comments: [], attachments: [], links: [],
    createdAt, updatedAt: createdAt, completedAt: null, archived: false, ...patch,
  };
}
interface Step { daysAgo: number; action: string; patch: (ts: string) => Partial<Card> }
function timeline(now: Date, actor: string, cardId: string, columnId: string, createdDaysAgo: number, initialPatch: Partial<Card>, steps: Step[]) {
  const createdAt = isoAt(now, createdDaysAgo);
  let state = baseCard(cardId, columnId, createdAt, initialPatch);
  const activities: Activity[] = [{ id: newId(), cardId, actor, action: "create", before: null, after: state, timestamp: createdAt }];
  for (const step of steps) {
    const ts = isoAt(now, step.daysAgo); const before = state;
    state = { ...state, ...step.patch(ts), updatedAt: ts };
    activities.push({ id: newId(), cardId, actor, action: step.action, before, after: state, timestamp: ts });
  }
  return { activities, final: state };
}
const toDone = (columnId: string) => (ts: string): Partial<Card> => ({ columnId, completedAt: ts });

function buildFixture(now: Date) {
  const w = createWorkspace();
  const actor = w.settings.actorId;
  const p = createProject(w, "Sprint burnup history");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const cols = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  const backlog = cols[0]!.id, done = cols[4]!.id;

  // Sprint 1: closed, a 13-day window that ended 3 days ago -- cards join and finish on different
  // days across it, so scope and done both step up more than once.
  const sprint1Start = isoDateAt(now, -15);
  const sprint1End = isoDateAt(now, -3);
  const sprint1Cards = [
    timeline(now, actor, newId(), backlog, 15, { sprint: 1 }, [{ daysAgo: 9, action: "move", patch: toDone(done) }]),
    timeline(now, actor, newId(), backlog, 13, { sprint: 1 }, [{ daysAgo: 7, action: "move", patch: toDone(done) }]),
    timeline(now, actor, newId(), backlog, 10, { sprint: 1 }, []),
    timeline(now, actor, newId(), backlog, 8, { sprint: 1 }, [{ daysAgo: 4, action: "move", patch: toDone(done) }]),
    timeline(now, actor, newId(), backlog, 5, { sprint: 1 }, []),
  ];

  // Sprint 2: still open, a 14-day window with today sitting 7 days in -- more cards join after
  // today than before it, and only some are done so far.
  const sprint2Start = isoDateAt(now, -7);
  const sprint2End = isoDateAt(now, 7);
  const sprint2Cards = [
    timeline(now, actor, newId(), backlog, 6, { sprint: 2 }, [{ daysAgo: 2, action: "move", patch: toDone(done) }]),
    timeline(now, actor, newId(), backlog, 4, { sprint: 2 }, []),
    timeline(now, actor, newId(), backlog, 1, { sprint: 2 }, [{ daysAgo: 0, action: "move", patch: toDone(done) }]),
  ];

  const all = [...sprint1Cards, ...sprint2Cards];
  const finals = all.map(t => t.final);
  const byColumn = new Map<string, Card[]>();
  for (const c of finals) { const list = byColumn.get(c.columnId) ?? []; list.push(c); byColumn.set(c.columnId, list); }
  for (const list of byColumn.values()) list.forEach((c, i) => c.position = i);
  w.cards = finals;
  w.activities = all.flatMap(t => t.activities);
  p.sprints = [
    { number: 1, name: "Bring-up sprint", startDate: sprint1Start, endDate: sprint1End, scope: "Initial bring-up", closedAt: isoAt(now, 3), completedSummary: "Three of five cards shipped; two carried into sprint 2." },
    { number: 2, name: "Characterization sprint", startDate: sprint2Start, endDate: sprint2End, scope: "SERDES characterization" },
  ];
  validateWorkspace(w); // fail fast here, not as a mysterious browser-side rejection
  return w as Workspace;
}

test("delivered sprint burnup: real multi-day history across a closed and an open sprint, step lines and markers readable in both themes at 1024 and 390", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-sprint-burnup-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1024, height: 1500 }, acceptDownloads: true });
  context.setDefaultTimeout(6000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    const now = new Date();
    const fixture = buildFixture(now);
    await page.goto(pathToFileURL(file).href); await saved(page);
    page.once("dialog", d => d.accept());
    await page.getByLabel("Restore JSON backup", { exact: true }).setInputFiles({ name: "sprint-burnup-history.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
    await saved(page);
    await page.getByRole("button", { name: "Sprints", exact: true }).click();
    const sprints = page.locator("#project-sprints");
    const sprint1 = sprints.locator('[data-sprint="1"]'); const sprint2 = sprints.locator('[data-sprint="2"]');
    await sprint2.waitFor();

    // --- Sprint 1 (closed): a real, multi-day step shape ending at its own end date, not today ---
    const chart1 = sprint1.locator("[data-sprint-burnup]");
    const points1 = JSON.parse((await chart1.getAttribute("data-burnup-points"))!) as { date: string; scope: number; done: number }[];
    expect(points1.length).toBe(13); // the sprint's own 13-day window, not extended to today
    expect(points1.at(-1)!.scope).toBe(5); expect(points1.at(-1)!.done).toBe(3);
    expect(points1[0]!.scope).toBeLessThan(5); // scope climbs in steps, not already full on day one
    const scopeBox1 = await chart1.locator(".burnup-line-scope").evaluate(el => { const b = (el as unknown as SVGPathElement).getBBox(); return { width: b.width, height: b.height }; });
    const doneBox1 = await chart1.locator(".burnup-line-done").evaluate(el => { const b = (el as unknown as SVGPathElement).getBBox(); return { width: b.width, height: b.height }; });
    expect(scopeBox1.width).toBeGreaterThan(50); expect(scopeBox1.height).toBeGreaterThan(0); // a real step shape, not a flat or zero-length line
    expect(doneBox1.width).toBeGreaterThan(50); expect(doneBox1.height).toBeGreaterThan(0);
    expect(await chart1.locator(".burnup-today-marker").count()).toBe(0); // today is long past this closed sprint's window
    expect(await chart1.locator(".burnup-milestone-marker").count()).toBe(1); // the end-date marker still shows, at the window's own end

    // --- Sprint 2 (open): today sits mid-window, more scope arrives after it ---
    const chart2 = sprint2.locator("[data-sprint-burnup]");
    const points2 = JSON.parse((await chart2.getAttribute("data-burnup-points"))!) as { date: string; scope: number; done: number }[];
    expect(points2.length).toBe(15); // inclusive span from 7 days ago through 7 days ahead
    const todayLeftPct2 = parseFloat((await chart2.locator(".burnup-today-marker").getAttribute("style"))!.match(/left:([\d.]+)%/)![1]!);
    expect(todayLeftPct2).toBeGreaterThan(30); expect(todayLeftPct2).toBeLessThan(70); // roughly mid-chart
    expect(await chart2.locator(".burnup-milestone-marker").count()).toBe(1); // the future end date still shows

    await chart1.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "evidence/sprints-burnup-1024-light.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/sprints-burnup-1024-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });

    await page.setViewportSize({ width: 390, height: 844 });
    const noPageScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noPageScroll).toBe(true);
    await chart1.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "evidence/sprints-burnup-390-light.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/sprints-burnup-390-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1024, height: 1500 });

    // --- A single-day sprint still draws a visible mark, not a zero-length invisible path ---
    await sprints.locator('[data-sprint="2"] .card-sprint').first().fill("3");
    await sprints.locator('[data-sprint="2"] .card-sprint').first().press("Tab"); await saved(page);
    const sprint3Start = sprints.locator('[data-sprint="3"] .sprint-start');
    await sprint3Start.fill(isoDateAt(now, 0)); await sprint3Start.press("Tab"); await saved(page);
    const sprint3End = sprints.locator('[data-sprint="3"] .sprint-end');
    await sprint3End.fill(isoDateAt(now, 0)); await sprint3End.press("Tab"); await saved(page);
    const chart3 = sprints.locator('[data-sprint="3"] [data-sprint-burnup]');
    const points3 = JSON.parse((await chart3.getAttribute("data-burnup-points"))!) as { date: string; scope: number; done: number }[];
    expect(points3.length).toBe(1);
    const scopeBox3 = await chart3.locator(".burnup-line-scope").evaluate(el => (el as unknown as SVGPathElement).getBBox().width);
    expect(scopeBox3).toBeGreaterThan(0); // a visible stub, not a zero-length path
    await chart3.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "evidence/sprints-burnup-singleday.png", animations: "disabled" });

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
