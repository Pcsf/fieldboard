import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createWorkspace, createProject, addMilestone, validateWorkspace, id as newId, type Card, type Activity, type Workspace } from "../src/model";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };

// --- Fixture: real multi-week Activity history, built directly (model mutation functions all stamp
// "now", so a historical timeline has to be fabricated) and restored into the browser as a JSON backup,
// the same way a real recovered workspace would be. ---
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

function buildHistoryFixture(now: Date) {
  const w = createWorkspace();
  const actor = w.settings.actorId;
  const p = createProject(w, "Burnup history");
  const board = w.boards.find(b => b.projectId === p.id)!;
  const cols = w.columns.filter(c => c.boardId === board.id).sort((a, b) => a.position - b.position);
  const backlog = cols[0]!.id, done = cols[4]!.id;
  const beta = addMilestone(w, p.id, "Beta launch", isoDateAt(now, 27)); // future: today should land mid-chart
  const alpha = addMilestone(w, p.id, "Alpha release", isoDateAt(now, -10)); // already passed

  // Scope climbs 1 -> 8 in steps as cards are created and assigned, two finish early, one leaves the
  // milestone (F, unassigned on day -3) and one is archived but stays in scope (D).
  const betaCards = [
    timeline(now, actor, newId(), backlog, 28, { milestoneId: beta.id }, [{ daysAgo: 20, action: "move", patch: toDone(done) }]),
    timeline(now, actor, newId(), backlog, 25, { milestoneId: beta.id }, [{ daysAgo: 15, action: "move", patch: toDone(done) }]),
    timeline(now, actor, newId(), backlog, 22, { milestoneId: beta.id }, [{ daysAgo: 10, action: "move", patch: toDone(done) }]),
    timeline(now, actor, newId(), backlog, 18, { milestoneId: beta.id }, [{ daysAgo: 8, action: "archive", patch: () => ({ archived: true }) }]),
    timeline(now, actor, newId(), backlog, 13, { milestoneId: beta.id }, [{ daysAgo: 5, action: "move", patch: toDone(done) }]),
    timeline(now, actor, newId(), backlog, 10, { milestoneId: beta.id }, [{ daysAgo: 3, action: "edit", patch: () => ({ milestoneId: undefined }) }]),
    timeline(now, actor, newId(), backlog, 8, { milestoneId: beta.id }, [{ daysAgo: 2, action: "move", patch: toDone(done) }]),
    timeline(now, actor, newId(), backlog, 6, { milestoneId: beta.id }, []),
  ];
  const alphaCards = [
    timeline(now, actor, newId(), backlog, 12, { milestoneId: alpha.id }, [{ daysAgo: 4, action: "move", patch: toDone(done) }]),
    timeline(now, actor, newId(), backlog, 11, { milestoneId: alpha.id }, [{ daysAgo: 3, action: "move", patch: toDone(done) }]),
  ];
  const all = [...betaCards, ...alphaCards];
  const finals = all.map(t => t.final);
  const byColumn = new Map<string, Card[]>();
  for (const c of finals) { const list = byColumn.get(c.columnId) ?? []; list.push(c); byColumn.set(c.columnId, list); }
  for (const list of byColumn.values()) list.forEach((c, i) => c.position = i);
  w.cards = finals;
  w.activities = all.flatMap(t => t.activities);
  validateWorkspace(w); // fail fast here, not as a mysterious browser-side rejection
  return { w, betaName: "Beta launch", alphaName: "Alpha release" };
}

test("delivered milestone burnup: real multi-week history, two milestones, markers and legend distinct, readable in both themes at 1024 and 390", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-burnup-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1024, height: 1500 }, acceptDownloads: true });
  context.setDefaultTimeout(6000); await context.setOffline(true);
  const errors: string[] = [], requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  try {
    const { w: fixture, betaName, alphaName } = buildHistoryFixture(new Date());
    await page.goto(pathToFileURL(file).href); await saved(page);
    page.once("dialog", d => d.accept());
    await page.getByLabel("Restore JSON backup", { exact: true }).setInputFiles({ name: "burnup-history.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
    await saved(page);
    await page.getByRole("link", { name: "Burnup history", exact: true }).click().catch(() => {});
    await page.getByRole("button", { name: "Milestones", exact: true }).click();

    // The milestone name lives in an <input value="…">, which .textContent()/hasText never sees —
    // match the rendered value attribute directly instead.
    const rows = page.locator(".milestone-row");
    await rows.first().waitFor();
    const betaRow = page.locator(`.milestone-row:has(.milestone-name[value="${betaName}"])`);
    const alphaRow = page.locator(`.milestone-row:has(.milestone-name[value="${alphaName}"])`);
    expect(await betaRow.textContent()).toContain("5/7 cards done");
    expect(await alphaRow.textContent()).toContain("2/2 cards done");

    // --- Beta (future milestone): a real, multi-day step shape, not a single invisible tick ---
    const betaChart = betaRow.locator("[data-milestone-burnup]");
    const betaPoints = JSON.parse((await betaChart.getAttribute("data-burnup-points"))!) as { date: string; scope: number; done: number }[];
    expect(betaPoints.length).toBeGreaterThan(20); // ~29 days of real history
    expect(Math.max(...betaPoints.map(p => p.scope))).toBe(8); // scope peaked at 8 before F left
    expect(betaPoints.at(-1)!.scope).toBe(7); expect(betaPoints.at(-1)!.done).toBe(5);
    expect(betaPoints[0]!.scope).toBeLessThanOrEqual(3); // starts low, climbs in steps

    const betaLineScope = betaChart.locator(".burnup-line-scope");
    const betaLineDone = betaChart.locator(".burnup-line-done");
    const bbox = (el: Element) => { const b = (el as unknown as SVGPathElement).getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const scopeBox = await betaLineScope.evaluate(bbox);
    const doneBox = await betaLineDone.evaluate(bbox);
    expect(scopeBox.width).toBeGreaterThan(50); // a real drawn line, not a point
    expect(doneBox.width).toBeGreaterThan(50);

    // Today sits roughly mid-chart (the axis extends out to the future milestone date).
    const todayLeftPct = parseFloat((await betaChart.locator(".burnup-today-marker").getAttribute("style"))!.match(/left:([\d.]+)%/)![1]!);
    expect(todayLeftPct).toBeGreaterThan(25); expect(todayLeftPct).toBeLessThan(75);
    expect(await betaChart.locator(".burnup-milestone-marker").count()).toBe(1);

    // Today and milestone-date markers are visually distinct from each other and from the series.
    const [todayBg, milestoneBgImage, doneStroke, scopeStroke] = await Promise.all([
      betaChart.locator(".burnup-today-marker").evaluate(el => getComputedStyle(el).backgroundColor),
      betaChart.locator(".burnup-milestone-marker").evaluate(el => getComputedStyle(el).backgroundImage),
      betaLineDone.evaluate(el => getComputedStyle(el).stroke),
      betaLineScope.evaluate(el => getComputedStyle(el).stroke),
    ]);
    expect(todayBg).not.toBe(doneStroke);
    expect(todayBg).not.toBe(scopeStroke);
    expect(milestoneBgImage).not.toBe("none"); // a gradient (dashed), never a flat fill like the markers aren't lines
    expect(doneStroke).not.toBe(scopeStroke);

    // The scope/done dots (today's value on each line) sit apart — the visible "remaining" gap.
    const scopeDotBox = await betaChart.locator(".burnup-dot-scope").boundingBox();
    const doneDotBox = await betaChart.locator(".burnup-dot-done").boundingBox();
    expect(scopeDotBox).not.toBeNull(); expect(doneDotBox).not.toBeNull();
    expect(Math.abs(scopeDotBox!.y - doneDotBox!.y)).toBeGreaterThan(5);
    const [scopeDotColor, doneDotColor] = await Promise.all([
      betaChart.locator(".burnup-dot-scope").evaluate(el => getComputedStyle(el).backgroundColor),
      betaChart.locator(".burnup-dot-done").evaluate(el => getComputedStyle(el).backgroundColor),
    ]);
    expect(scopeDotColor).not.toBe(doneDotColor);

    // Legend names every drawn element, not just the two series.
    const legendText = await betaChart.locator(".burnup-legend").textContent();
    for (const label of ["Scope", "Done", "Today", "Milestone date"]) expect(legendText).toContain(label);

    // Date axis ticks never overlap horizontally.
    const tickBoxes = (await betaChart.locator(".burnup-xaxis-tick").evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON())))
      .sort((a, b) => a.x - b.x);
    expect(tickBoxes.length).toBeGreaterThan(2);
    for (let i = 1; i < tickBoxes.length; i++) expect(tickBoxes[i]!.x).toBeGreaterThanOrEqual(tickBoxes[i - 1]!.x + tickBoxes[i - 1]!.width - 1);

    // --- Alpha (past milestone): its date marker sits inside the already-plotted range, not extended ---
    const alphaChart = alphaRow.locator("[data-milestone-burnup]");
    const alphaPoints = JSON.parse((await alphaChart.getAttribute("data-burnup-points"))!) as { date: string; scope: number; done: number }[];
    expect(alphaPoints.at(-1)!.scope).toBe(2); expect(alphaPoints.at(-1)!.done).toBe(2);
    expect(await alphaChart.locator(".burnup-milestone-marker").count()).toBe(1);
    const alphaMilestoneLeftPct = parseFloat((await alphaChart.locator(".burnup-milestone-marker").getAttribute("style"))!.match(/left:([\d.]+)%/)![1]!);
    const alphaTodayLeftPct = parseFloat((await alphaChart.locator(".burnup-today-marker").getAttribute("style"))!.match(/left:([\d.]+)%/)![1]!);
    expect(alphaMilestoneLeftPct).toBeLessThan(alphaTodayLeftPct); // the past date sits left of today, inside the range
    expect(alphaTodayLeftPct).toBeCloseTo(100, 0); // today is the chart's last plotted day (no extension)

    // No forecast/projection claim anywhere in either chart.
    const chartText = ((await betaChart.textContent() ?? "") + (await alphaChart.textContent() ?? "")).toLocaleLowerCase();
    expect(chartText).not.toContain("forecast"); expect(chartText).not.toContain("projected"); expect(chartText).not.toContain("eta");

    // Scroll the dialog's own overflow so the richer (Beta) chart — not just Alpha's — is actually
    // visible in the screenshot, not just present in the DOM for the attribute assertions above.
    await betaChart.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "evidence/burnup-1024-light.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/burnup-1024-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });

    await page.setViewportSize({ width: 390, height: 844 });
    const noPageScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noPageScroll).toBe(true);
    // The milestone name field is not clipped at phone width even with the chart in the same row.
    const nameBox = await page.locator(".milestone-row").first().locator(".milestone-name").boundingBox();
    expect(nameBox!.width).toBeGreaterThan(150);
    await betaChart.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "evidence/burnup-390-light.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(18, 22, 27)").catch(() => {});
    await page.screenshot({ path: "evidence/burnup-390-dark.png", fullPage: true, animations: "disabled" });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1024, height: 1000 });

    // --- A milestone assigned to a card for the very first time today still draws a visible mark ---
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    await page.locator(".column").first().getByRole("button", { name: "Add card at bottom" }).click();
    await page.getByPlaceholder("Card title").fill("Fresh"); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    await page.getByRole("button", { name: "Milestones", exact: true }).click();
    await page.getByLabel("New milestone name", { exact: true }).fill("Gamma same-day");
    await page.getByLabel("New milestone date", { exact: true }).fill(isoDateAt(new Date(), 10));
    await page.getByRole("button", { name: "Add milestone", exact: true }).click(); await saved(page);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();
    await page.getByRole("button", { name: "Open card: Fresh", exact: true }).click();
    await page.getByLabel("Milestone", { exact: true }).selectOption({ label: "Gamma same-day" }); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.getByRole("button", { name: "Milestones", exact: true }).click();
    const gammaChart = page.locator('.milestone-row:has(.milestone-name[value="Gamma same-day"])').locator("[data-milestone-burnup]");
    await gammaChart.waitFor();
    const gammaDot = gammaChart.locator(".burnup-dot-scope");
    expect(await gammaDot.count()).toBe(1);
    const gammaDotBox = await gammaDot.boundingBox();
    expect(gammaDotBox).not.toBeNull();
    expect(gammaDotBox!.width).toBeGreaterThan(0); expect(gammaDotBox!.height).toBeGreaterThan(0);
    const gammaRowBox = await page.locator('.milestone-row:has(.milestone-name[value="Gamma same-day"])').boundingBox();
    await page.screenshot({ path: "evidence/burnup-singleday.png", clip: gammaRowBox ? { x: gammaRowBox.x, y: gammaRowBox.y, width: gammaRowBox.width, height: gammaRowBox.height } : undefined, animations: "disabled" });

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true }); }
}, 60000);
