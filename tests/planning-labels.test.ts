import { expect, test } from "bun:test";
import { baselines, programs, maturities } from "../src/planning";

async function sourceLabels(path: string, heading: string): Promise<string[]> {
  const note = await Bun.file(path).text();
  const start = note.indexOf(heading); expect(start).toBeGreaterThanOrEqual(0);
  const section = note.slice(start + heading.length).split("\n## ")[0]!;
  return section.replace(/\[\[[^\]]*?\\?\|([^\]]+)\]\]/g, "$1").replace(/\*\*/g, "")
    .split("\n").filter(line => line.startsWith("|")).slice(2)
    .map(line => line.split("|")[1]!.trim());
}

test("IED baseline names preserve every source task description and qualifier", async () => {
  const labels = await sourceLabels("FPGA-FW-Effort-Estimation-Model.md", "## Table 1 — Baseline effort by task type (nominal complexity)");
  expect(labels).toHaveLength(19);
  expect(baselines.map(b => b.name)).toEqual(labels);
  expect(baselines.map(b => b.id)).toEqual(["generated-registers", "csr", "fsm", "complex-fsm", "synchronizer", "async-fifo", "clock-switch", "filter", "algorithm", "golden-model", "vendor-ip", "low-speed", "high-speed", "memory", "serdes", "top-level", "pinout", "legacy-debug", "timing-closure"]);
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
