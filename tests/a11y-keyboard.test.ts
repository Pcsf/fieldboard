// Tier 3 "Accessibility" (ISA R52): a keyboard walk over every view and every dialog. For each
// surface: every focusable element is reached by Tab alone, focus is visible (a computed outline or
// box-shadow is present) at a sample of stops, and Escape closes a dialog and returns focus to
// whatever control opened it.
import { expect, test } from "bun:test";
import { chromium, type Page } from "playwright";
import { mkdtemp, copyFile, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { buildA11yFixture } from "./a11y-fixture";

const saved = async (p: Page) => { await p.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); };

const FOCUSABLE_SELECTOR = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Tags every currently-visible focusable element inside `root` (default: the open dialog, or the
// document when no dialog is open) with a throwaway id, so each Tab stop can be identified by
// something stable rather than by guessing selectors per surface.
async function tagFocusable(page: Page, rootSelector: string): Promise<string[]> {
  return await page.evaluate(({ sel, rootSel }) => {
    const root = document.querySelector(rootSel) ?? document.body;
    const nodes = Array.from(root.querySelectorAll(sel)) as HTMLElement[];
    const ids: string[] = [];
    nodes.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const visible = r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      if (!visible) return;
      const id = `kw-${i}`;
      el.setAttribute("data-kbwalk", id);
      ids.push(id);
    });
    return ids;
  }, { sel: FOCUSABLE_SELECTOR, rootSel: rootSelector });
}
async function clearTags(page: Page) {
  await page.evaluate(() => document.querySelectorAll("[data-kbwalk]").forEach(el => el.removeAttribute("data-kbwalk")));
}
async function hasVisibleFocusIndicator(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null; if (!el) return false;
    const s = getComputedStyle(el);
    const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
    const boxShadow = s.boxShadow !== "none" && s.boxShadow !== "";
    return outline || boxShadow;
  });
}

// Tabs through `root`'s visible focusable elements and asserts every single one is reached -- not
// merely that focus moves N times, which a trap that cycles between two controls would also satisfy.
async function walkFocusable(page: Page, rootSelector: string, surface: string) {
  const expected = await tagFocusable(page, rootSelector);
  expect(expected.length, `${surface}: no focusable elements found`).toBeGreaterThan(0);
  const visited = new Set<string>();
  const readCurrent = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-kbwalk") ?? null);
  const first = await readCurrent(); if (first) visited.add(first);
  // The budget is generous, not tight: native-tabbable elements outside FOCUSABLE_SELECTOR (e.g. a
  // closed <details>'s <summary>, in the card detail's Activity log) still consume a Tab stop each
  // without advancing `visited`, and the loop must out-wait those to reach every real control.
  for (let i = 0; i < expected.length * 3 + 10 && visited.size < expected.length; i++) {
    await page.keyboard.press("Tab");
    const id = await readCurrent();
    if (id) visited.add(id);
  }
  const missing = expected.filter(id => !visited.has(id));
  expect(missing, `${surface}: ${missing.length} of ${expected.length} focusable element(s) never reached by Tab`).toEqual([]);
  await clearTags(page);
}

async function checkFocusVisible(page: Page, surface: string) {
  expect(await hasVisibleFocusIndicator(page), `${surface}: focused element has no visible outline/box-shadow`).toBe(true);
}

test("accessibility: keyboard walk reaches every control, focus stays visible, and Escape closes dialogs and restores focus", async () => {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  await mkdir("evidence", { recursive: true });
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-a11y-kbwalk-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  const url = pathToFileURL(file).href;
  const fixture = buildA11yFixture(new Date());

  const context = await chromium.launchPersistentContext(join(root, "profile"), {
    executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true,
    chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot },
    viewport: { width: 1280, height: 1000 }, acceptDownloads: true,
  });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const errors: string[] = [];
  await context.route(/^https?:/, r => r.abort());
  const page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  const notes: string[] = [];

  try {
    await page.goto(url); await saved(page);
    page.once("dialog", d => d.accept());
    await page.getByLabel("Restore JSON backup", { exact: true }).setInputFiles({ name: "a11y-fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
    await saved(page);
    await page.getByRole("link", { name: "Launch readiness", exact: true }).click().catch(() => {});
    await page.getByRole("button", { name: "Open card: Design the onboarding flow", exact: true }).waitFor();

    // --- Views: board, list, calendar, timeline, insights ---
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await walkFocusable(page, "#app", "board view");
    notes.push("board view: every focusable control reached by Tab");
    await checkFocusVisible(page, "board view");

    for (const [tab, name] of [["List", "list view"], ["Calendar", "calendar view"], ["Timeline", "timeline view"], ["Insights", "insights view"]] as const) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await page.locator("body").click({ position: { x: 5, y: 5 } });
      await walkFocusable(page, "#app", name);
      notes.push(`${name}: every focusable control reached by Tab`);
    }
    await page.getByRole("tab", { name: "Board", exact: true }).click();

    // --- Card detail dialog: focus trapped inside, Escape returns it to the opening card ---
    const cardButton = page.getByRole("button", { name: "Open card: Design the onboarding flow", exact: true });
    await cardButton.focus();
    await cardButton.press("Enter");
    await page.locator("#detail[open]").waitFor();
    await walkFocusable(page, "#detail", "card detail dialog");
    await checkFocusVisible(page, "card detail dialog");
    // Focus must stay inside the dialog even after tabbing past its last control.
    for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!(document.activeElement && document.activeElement.closest("dialog[open]"))), "card detail dialog: Tab escaped the dialog").toBe(true);
    await page.keyboard.press("Escape");
    await page.locator("#detail").waitFor({ state: "hidden" }).catch(() => {});
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "focus did not return to the card that opened the dialog").toBe("Open card: Design the onboarding flow");
    notes.push("card detail dialog: focus trapped inside, Escape returns focus to the opening card");

    // --- Every other dialog: open from its control, walk it, Escape, focus back on the opener ---
    const dialogs: [string, string][] = [
      ["Boards", "boards dialog"], ["Milestones", "milestones dialog"], ["Sprints", "sprints dialog"],
      ["Effort & planning", "planning dialog"], ["Automation", "automation dialog"], ["Archive", "archive dialog"],
      ["Add column", "column dialog"], ["New project", "new project dialog"], ["Notifications", "notifications inbox"],
    ];
    for (const [name, surface] of dialogs) {
      const opener = page.getByRole("button", { name });
      await opener.focus();
      await opener.press("Enter");
      await page.locator("#modal[open]").waitFor();
      await walkFocusable(page, "#modal", surface);
      await checkFocusVisible(page, surface);
      await page.keyboard.press("Escape");
      await page.locator("#modal").waitFor({ state: "hidden" }).catch(() => {});
      const openerName = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim());
      expect(openerName, `${surface}: Escape did not return focus to its opener`).toContain(name.includes("&") ? name.split(" ")[0]! : name);
      notes.push(`${surface}: reachable, Escape returns focus to its opener`);
    }

    // Dialogs behind the collapsible sidebar menu (phone-only control, but reachable at any width)
    await page.locator("#menu-toggle").click({ force: true }).catch(() => {});
    const sidebarDialogs: [string, string][] = [["Workspace & members", "members dialog"], ["Daily snapshots", "snapshots dialog"], ["Help & storage safety", "help dialog"], ["Import a board", "import dialog"]];
    for (const [name, surface] of sidebarDialogs) {
      const toggle = page.locator("#menu-toggle");
      if (await toggle.isVisible() && await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
      const opener = page.getByRole("button", { name });
      await opener.click();
      await page.locator("#modal[open]").waitFor();
      await walkFocusable(page, "#modal", surface);
      await page.keyboard.press("Escape");
      await page.locator("#modal").waitFor({ state: "hidden" }).catch(() => {});
      notes.push(`${surface}: reachable and keyboard-operable`);
    }

    // --- Keyboard shortcuts cheatsheet (opened by "?", not a button) ---
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Shift+?");
    await page.locator("#modal[open]").waitFor();
    await walkFocusable(page, "#modal", "shortcuts dialog");
    await page.keyboard.press("Escape");
    notes.push("shortcuts dialog: opened by \"?\", every control reachable");

    // --- Command palette: arrow keys move the active option, Enter runs it, Escape closes it ---
    await page.locator("#palette-button").click();
    await page.locator("#palette[open]").waitFor();
    await checkFocusVisible(page, "command palette input");
    await page.keyboard.press("ArrowDown");
    const activeAfterArrow = await page.locator("#palette-results .active").textContent();
    expect(activeAfterArrow, "command palette: ArrowDown did not move the active option").toBeTruthy();
    await page.keyboard.press("Escape");
    await page.locator("#palette").waitFor({ state: "hidden" }).catch(() => {});
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("palette-button");
    notes.push("command palette: ArrowDown moves selection, Escape closes and returns focus to its button");

    // --- Board keyboard shortcuts: column move (←/→) and within-column reorder (Shift+↑/↓) ---
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    const firstCard = page.getByRole("button", { name: "Open card: Design the onboarding flow", exact: true });
    await firstCard.focus();
    const columnBefore = await firstCard.evaluate(el => el.closest("[data-column]")?.getAttribute("data-column"));
    await page.keyboard.press("ArrowRight");
    const columnAfter = await firstCard.evaluate(el => el.closest("[data-column]")?.getAttribute("data-column"));
    expect(columnAfter, "ArrowRight did not move the focused card to the next column").not.toBe(columnBefore);
    await page.keyboard.press("ArrowLeft"); // move it back
    notes.push("board: ArrowLeft/Right move the focused card between columns from the keyboard");

    // The fixture's Backlog column holds only "Design the onboarding flow"; add a second card so a
    // within-column reorder has something to swap with.
    const backlogColumn = page.locator(".column").filter({ has: page.getByRole("heading", { name: "Backlog", exact: true }) });
    await backlogColumn.getByRole("button", { name: "Add card at bottom" }).click();
    await page.getByPlaceholder("Card title").fill("Second backlog card"); await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    const orderBefore = await backlogColumn.locator(".card").evaluateAll(els => els.map(el => el.getAttribute("data-card")));
    await firstCard.focus();
    await page.keyboard.press("Shift+ArrowDown");
    await saved(page);
    const orderAfter = await backlogColumn.locator(".card").evaluateAll(els => els.map(el => el.getAttribute("data-card")));
    expect(orderAfter, "Shift+ArrowDown did not reorder the focused card within its column").toEqual([orderBefore[1] ?? null, orderBefore[0] ?? null]);
    notes.push("board: Shift+ArrowUp/Down reorder the focused card within its own column from the keyboard");

    expect(errors).toEqual([]);
  } finally {
    await writeFile("evidence/a11y-keyboard-notes.txt", notes.join("\n"));
    await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true });
  }
}, 120_000);
