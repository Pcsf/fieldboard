import { expect, test } from "bun:test";
import { programs, maturities, defaultCatalog, labAccess } from "../src/planning";

async function section(path: string, heading: string): Promise<string> {
  const note = await Bun.file(path).text();
  const start = note.indexOf(heading); expect(start).toBeGreaterThanOrEqual(0);
  return note.slice(start + heading.length).split(/\n## /)[0]!;
}
function rows(text: string): string[][] {
  return text.split("\n").filter(l => l.trim().startsWith("|")).slice(2)
    .map(l => l.split("|").slice(1, -1).map(c => c.trim()));
}
async function sourceLabels(path: string, heading: string): Promise<string[]> {
  const body = await section(path, heading);
  return rows(body.replace(/\[\[[^\]]*?\\?\|([^\]]+)\]\]/g, "$1").replace(/\*\*/g, "")).map(r => r[0]!);
}

test("IED catalog doc tables match the code's default catalog by name and number", async () => {
  const doc = await section("FPGA-FW-Effort-Estimation-Model.md", "## Table 1 — IED catalog: category × subcategory (nominal complexity)");
  const splitRows = rows(doc.split("**Design categories**")[1]!.split("**Unsplit design categories**")[0]!);
  const unsplitRows = rows(doc.split("**Unsplit design categories**")[1]!.split("**Lab categories**")[0]!);
  const labRows = rows(doc.split("**Lab categories**")[1]!.split("Every category and subcategory above")[0]!);

  const split = defaultCatalog.filter(c => c.rtl !== undefined);
  const unsplit = defaultCatalog.filter(c => c.other !== undefined && c.kind === "design");
  const lab = defaultCatalog.filter(c => c.kind === "lab");

  expect(splitRows.map(r => [r[0], Number(r[1]), Number(r[2]), r[3], Number(r[4])])).toEqual(
    split.flatMap(c => c.subcategories.map(s => [c.name, c.rtl, c.verification, s.name, s.factor])),
  );
  expect(unsplitRows.map(r => [r[0], Number(r[1]), Number(r[2]), r[3], Number(r[4])])).toEqual(
    unsplit.flatMap(c => c.subcategories.map(s => [c.name, c.other![0], c.other![1], s.name, s.factor])),
  );
  expect(labRows.map(r => [r[0], Number(r[1]), Number(r[2]), r[3], Number(r[4])])).toEqual(
    lab.flatMap(c => c.subcategories.map(s => [c.name, c.other![0], c.other![1], s.name, s.factor])),
  );
});

test("Lab access correction-factor rows match the code's labAccess values", async () => {
  const doc = await section("FPGA-FW-Effort-Estimation-Model.md", "## Table 2 — Correction factors (per module)");
  const all = rows(doc.replace(/\*\*[^*]*\*\*/g, ""));
  let dimension = "";
  const labRows = all.filter(r => { if (r[0]) dimension = r[0]; return dimension === "Lab access"; });
  expect(labRows.map(r => [r[1], Number(r[2])])).toEqual(labAccess.map(l => [l.name, l.factor]));
});

test("project program and maturity dropdown names preserve the source wording", async () => {
  expect(programs.map(p => p.name)).toEqual(await sourceLabels("FPGA-Project-Effort-Estimation-Top-Level.md", "## Whole-program bands (senior engineer, 1.0 dedicated FTE, nominal conditions)"));
  expect(maturities.map(m => m.name)).toEqual(await sourceLabels("FPGA-Project-Effort-Estimation-Top-Level.md", "## Spec-maturity multiplier (top-level only)"));
});

test("platform activity labels retain the full source names", async () => {
  const labels = await sourceLabels("FPGA-FW-Effort-Estimation-Model.md", "## Table 3 — Fixed platform & lifecycle overheads");
  expect(labels).toHaveLength(4);
  const ui = await Bun.file("src/planning-ui.ts").text();
  for (const label of labels) expect(ui).toContain(label);
});
