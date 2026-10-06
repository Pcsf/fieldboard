import { expect, test } from "bun:test";
import { chromium, type Page, type BrowserContext } from "playwright";
import { mkdir, mkdtemp, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function launch() {
  const build = Bun.spawn(["bun", "scripts/build.ts"], { stdout: "pipe", stderr: "pipe" }); expect(await build.exited).toBe(0);
  const root = await mkdtemp(join(process.cwd(), ".fieldboard-test-integration-"));
  const socketRoot = await mkdtemp(join(tmpdir(), "fb-"));
  const file = join(root, "fieldboard.html"); await copyFile("dist/fieldboard.html", file);
  await mkdir("evidence", { recursive: true });
  const context = await chromium.launchPersistentContext(join(root, "profile"), { executablePath: process.env.CHROMIUM_PATH || "/usr/sbin/chromium", headless: true, chromiumSandbox: process.getuid?.() !== 0, env: { ...process.env, TMPDIR: socketRoot }, viewport: { width: 1024, height: 900 }, acceptDownloads: true, colorScheme: "light" });
  context.setDefaultTimeout(8000); await context.setOffline(true);
  const errors: string[] = []; const requests: string[] = [];
  await context.route(/^https?:/, r => { requests.push(r.request().url()); return r.abort(); });
  const page: Page = context.pages()[0]!; page.on("pageerror", e => errors.push(e.message));
  return { context, page, root, socketRoot, errors, requests };
}
async function cleanup(context: BrowserContext, root: string, socketRoot: string) {
  await context.close(); await rm(root, { recursive: true, force: true }); await rm(socketRoot, { recursive: true, force: true });
}
async function saved(page: Page) { await page.getByTestId("storage-status").filter({ hasText: "Saved" }).waitFor(); }
async function newProject(page: Page, name: string) {
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await saved(page);
}
test("Attachments: PNG gets a thumbnail, SVG with a script stays a chip (never executes), an oversized file is refused, removal and backup round-trip the bytes", async () => {
  const { context, page, root, socketRoot, errors, requests } = await launch();
  try {
    await page.goto(pathToFileURL(join(root, "fieldboard.html")).href); await saved(page);
    await newProject(page, "Attachments");
    await page.getByRole("button", { name: "Add card at bottom", exact: true }).first().click();
    await page.getByPlaceholder("Card title").fill("Card with files");
    await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    await page.getByRole("button", { name: "Open card: Card with files", exact: true }).click();

    // Oversized file: refused, writes nothing.
    await page.getByLabel("Choose a file to attach").setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(3 * 1024 * 1024) });
    expect(await page.locator("#attachment-error").textContent()).toContain("Refused");
    expect(await page.locator(".attachment-item").count()).toBe(0);

    // PNG: added via the file input, shown with a thumbnail image.
    const pngBuffer = Buffer.from(TINY_PNG_BASE64, "base64");
    await page.getByLabel("Choose a file to attach").setInputFiles({ name: "diagram.png", mimeType: "image/png", buffer: pngBuffer });
    await saved(page);
    expect(await page.locator(".attachment-item").count()).toBe(1);
    expect(await page.locator(".attachment-item .attachment-thumb").count()).toBe(1);
    expect(await page.locator(".attachment-item .attachment-thumb").getAttribute("src")).toContain("data:image/png;base64,");

    // SVG containing a <script>: added, but rendered only as a chip, never as an <img> and never
    // executed. The script, if it ran, would set window.__xss__ -- it must stay unset.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>window.__xss__=true;</script></svg>`;
    await page.getByLabel("Choose a file to attach").setInputFiles({ name: "evil.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
    await saved(page);
    expect(await page.locator(".attachment-item").count()).toBe(2);
    expect(await page.locator(".attachment-item:has-text(\"evil.svg\") .attachment-thumb").count()).toBe(0);
    expect(await page.locator(".attachment-item:has-text(\"evil.svg\") .attachment-icon").count()).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { __xss__?: boolean }).__xss__)).toBeUndefined();

    await page.locator(".attachment-list").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "evidence/integration-attachments-1024-light.png", fullPage: true, animations: "disabled" });
    await page.locator("#theme-select").selectOption("dark"); await saved(page);
    await page.locator(".attachment-list").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "evidence/integration-attachments-1024-dark.png", fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".attachment-list").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "evidence/integration-attachments-390-dark.png", fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.locator("#theme-select").selectOption("light"); await saved(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".attachment-list").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "evidence/integration-attachments-390-light.png", fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 1024, height: 900 });

    // Remove the SVG; one fewer attachment, undoable (Activity-backed) edit.
    await page.locator(".attachment-item:has-text(\"evil.svg\") [data-remove]").click();
    await saved(page);
    expect(await page.locator(".attachment-item").count()).toBe(1);

    // Backup round trip: the PNG's data URL survives byte-for-byte.
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Close card", exact: true }).click();
    await page.getByRole("button", { name: "Download backup", exact: true }).click();
    const file = await download; const backupPath = join(root, "backup.json"); await file.saveAs(backupPath);
    const backupJson = await Bun.file(backupPath).json();
    const attachmentData = backupJson.cards.find((c: { title: string }) => c.title === "Card with files").attachments[0].data;
    expect(attachmentData).toBe(`data:image/png;base64,${TINY_PNG_BASE64}`);

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await cleanup(context, root, socketRoot); }
}, 60000);

test("Links: each kind renders the documented chip text, only http/https is clickable, javascript: is refused, and nothing ever hits the network", async () => {
  const { context, page, root, socketRoot, errors, requests } = await launch();
  try {
    await page.goto(pathToFileURL(join(root, "fieldboard.html")).href); await saved(page);
    await newProject(page, "Links");
    await page.getByRole("button", { name: "Add card at bottom", exact: true }).first().click();
    await page.getByPlaceholder("Card title").fill("Card with links");
    await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    await page.getByRole("button", { name: "Open card: Card with links", exact: true }).click();

    // Plain URL.
    await page.getByLabel("URL", { exact: true }).fill("https://example.com/docs");
    await page.getByRole("button", { name: "Add link", exact: true }).click(); await saved(page);
    expect(await page.locator(".link-chip").count()).toBe(1);

    // javascript: is refused -- no chip is added, and the error is shown.
    await page.getByLabel("URL", { exact: true }).fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Add link", exact: true }).click();
    expect(await page.locator(".link-chip").count()).toBe(1);
    expect(await page.locator("#link-error").textContent()).toContain("http");
    await page.getByLabel("URL", { exact: true }).fill("");

    // GitHub PR, by kind select.
    await page.getByLabel("Link kind", { exact: true }).selectOption("pr");
    await page.getByLabel("Repository (owner/repo)", { exact: true }).fill("acme/widgets");
    await page.getByLabel("Issue or PR number", { exact: true }).fill("42");
    await page.getByRole("button", { name: "Add link", exact: true }).click(); await saved(page);
    const prChip = page.locator(".link-chip", { hasText: "PR #42" });
    expect(await prChip.locator("a").getAttribute("href")).toBe("https://github.com/acme/widgets/pull/42");
    expect(await prChip.locator("a").getAttribute("rel")).toBe("noopener noreferrer");
    expect(await prChip.locator("a").getAttribute("target")).toBe("_blank");

    // GitHub commit.
    await page.getByLabel("Link kind", { exact: true }).selectOption("commit");
    await page.getByLabel("Repository (owner/repo)", { exact: true }).fill("acme/widgets");
    await page.getByLabel("Commit SHA", { exact: true }).fill("1a2b3c4d5e6f");
    await page.getByRole("button", { name: "Add link", exact: true }).click(); await saved(page);
    expect(await page.locator(".link-chip", { hasText: "commit 1a2b3c4" }).count()).toBe(1);

    // Pasting a GitHub issue URL into the URL field auto-switches the kind and fills the fields.
    await page.getByLabel("Link kind", { exact: true }).selectOption("url");
    await page.getByLabel("URL", { exact: true }).fill("https://github.com/acme/widgets/issues/7");
    expect(await page.getByLabel("Link kind", { exact: true }).inputValue()).toBe("issue");
    expect(await page.getByLabel("Repository (owner/repo)", { exact: true }).inputValue()).toBe("acme/widgets");
    expect(await page.getByLabel("Issue or PR number", { exact: true }).inputValue()).toBe("7");
    await page.getByRole("button", { name: "Add link", exact: true }).click(); await saved(page);
    expect(await page.locator(".link-chip", { hasText: "Issue #7" }).count()).toBe(1);

    expect(await page.locator(".link-chip").count()).toBe(4);
    await page.locator(".link-chip-list").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "evidence/integration-links-1024-light.png", fullPage: true, animations: "disabled" });
    await page.locator("#theme-select").selectOption("dark"); await saved(page);
    await page.locator(".link-chip-list").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "evidence/integration-links-1024-dark.png", fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".link-chip-list").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "evidence/integration-links-390-dark.png", fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.locator("#theme-select").selectOption("light"); await saved(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".link-chip-list").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "evidence/integration-links-390-light.png", fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 1024, height: 900 });

    expect(errors).toEqual([]); expect(requests).toEqual([]);
  } finally { await cleanup(context, root, socketRoot); }
}, 60000);

test("Import: Trello, GitHub Issues and CSV each create a new project; a malformed file is refused and nothing is written", async () => {
  const { context, page, root, socketRoot, errors, requests } = await launch();
  try {
    await page.goto(pathToFileURL(join(root, "fieldboard.html")).href); await saved(page);

    const projectCount = () => page.locator("#projects .project-link").count();
    // Importing reads the file and commits asynchronously; wait for the project count to
    // actually reach each target rather than trusting the "Saved" status alone, which can
    // still read the previous (already-saved) state the instant the new import starts.
    const waitForProjectCount = (n: number) => page.waitForFunction(count => document.querySelectorAll("#projects .project-link").length === count, n);
    const waitForImportError = () => page.waitForFunction(() => (document.querySelector("#import-error")?.textContent ?? "") !== "");
    expect(await projectCount()).toBe(0);

    await page.getByRole("button", { name: "Import a board", exact: true }).click();
    await page.screenshot({ path: "evidence/integration-import-dialog.png", fullPage: true, animations: "disabled" });

    await page.getByLabel("Import Trello board JSON").setInputFiles("tests/fixtures/trello-board.json");
    await waitForProjectCount(1); await saved(page);
    expect(await page.locator(".project-link", { hasText: "Field Trial" }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "Open card: Write report", exact: true }).count()).toBe(1);

    await page.getByRole("button", { name: "Import a board", exact: true }).click();
    await page.getByLabel("Import GitHub Issues JSON").setInputFiles("tests/fixtures/github-issues.json");
    await waitForProjectCount(2); await saved(page);
    expect(await page.locator(".project-link", { hasText: "GitHub Issues import" }).count()).toBe(1);

    await page.getByRole("button", { name: "Import a board", exact: true }).click();
    await page.getByLabel("Import CSV").setInputFiles("tests/fixtures/import-board.csv");
    await waitForProjectCount(3); await saved(page);
    expect(await page.locator(".project-link", { hasText: "CSV import" }).count()).toBe(1);
    await page.screenshot({ path: "evidence/integration-import-result.png", fullPage: true, animations: "disabled" });

    // Malformed Trello export (missing lists): refused, no fourth project created.
    await page.getByRole("button", { name: "Import a board", exact: true }).click();
    await page.getByLabel("Import Trello board JSON").setInputFiles("tests/fixtures/trello-board-malformed.json");
    await waitForImportError();
    expect(await page.locator("#import-error").textContent()).not.toBe("");
    expect(await projectCount()).toBe(3);

    // Malformed CSV (no title column): refused, no fourth project created.
    await page.getByLabel("Import CSV").setInputFiles("tests/fixtures/import-board-no-title.csv");
    await page.waitForFunction(() => (document.querySelector("#import-error")?.textContent ?? "").toLowerCase().includes("title"));
    expect(await page.locator("#import-error").textContent()).toContain("title");
    expect(await projectCount()).toBe(3);

    expect(errors).toEqual([]);
    void requests;
  } finally { await cleanup(context, root, socketRoot); }
}, 60000);

test("Export: CSV and Markdown downloads carry the board's cards, and the CSV re-imports to the same data", async () => {
  const { context, page, root, socketRoot, errors } = await launch();
  try {
    await page.goto(pathToFileURL(join(root, "fieldboard.html")).href); await saved(page);
    await newProject(page, "Export");
    await page.getByRole("button", { name: "Add card at bottom", exact: true }).first().click();
    await page.getByPlaceholder("Card title").fill("Ship release !high ^2026-11-01");
    await page.getByPlaceholder("Card title").press("Enter"); await saved(page);
    await page.getByRole("button", { name: "Open card: Ship release", exact: true }).click();
    await page.getByLabel("Label names", { exact: true }).fill("release"); await page.getByLabel("Label names", { exact: true }).press("Tab"); await saved(page);
    await page.getByRole("button", { name: "Close card", exact: true }).click();

    const csvDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV", exact: true }).click();
    const csvFile = await csvDownload; const csvPath = join(root, "export.csv"); await csvFile.saveAs(csvPath);
    const csvText = await Bun.file(csvPath).text();
    expect(csvText.split("\r\n")[0]).toBe("title,description,column,labels,priority,due,estimate");
    expect(csvText).toContain("Ship release");
    expect(csvText).toContain("high");
    expect(csvText).toContain("release");

    const mdDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Markdown", exact: true }).click();
    const mdFile = await mdDownload; const mdPath = join(root, "export.md"); await mdFile.saveAs(mdPath);
    const mdText = await Bun.file(mdPath).text();
    expect(mdText).toContain("# Board");
    expect(mdText).toContain("## Backlog");
    expect(mdText).toContain("Ship release");

    // Round trip: importing the exported CSV reproduces the same card data in a new project.
    await page.getByRole("button", { name: "Import a board", exact: true }).click();
    await page.getByLabel("Import CSV").setInputFiles(csvPath);
    await saved(page);
    await page.getByRole("button", { name: "Open card: Ship release", exact: true }).click();
    expect(await page.locator("#card-priority").inputValue()).toBe("high");
    expect(await page.locator("#card-due").inputValue()).toBe("2026-11-01");
    expect(await page.locator("#card-labels").inputValue()).toBe("release");

    expect(errors).toEqual([]);
  } finally { await cleanup(context, root, socketRoot); }
}, 60000);
