import { expect, test } from "bun:test";

test("README documents standalone usage, verification limits and backup safety", async () => {
  const file=Bun.file("README.md");expect(await file.exists()).toBe(true);const text=await file.text();
  for(const required of ["dist/fieldboard.html","bun install","bun run build","bun test","IndexedDB","localStorage","file://","Chromium","152.0.7977.82","Tier 2","Tier 3","Ctrl+Z","eviction","profile","strict","External runtime dependencies: zero","not accepted","Apache-2.0","MIT"]) expect(text).toContain(required);
});

test("planning documentation explains IED, formulas, legacy compatibility and scope limits", async () => {
  const text = await Bun.file("README.md").text();
  for (const required of ["Effort & planning", "Start IED estimate", "Ideal Engineering Day", "Calibration", "FPGA-FW-Effort-Estimation-Model.md", "FPGA-Project-Effort-Estimation-Top-Level.md", "adjusted RTL", "unallocated", "unitless", "factor-of-two", "not a dependency-aware"]) expect(text).toContain(required);
});

test("technical decisions document storage, security and single-file bundling", async () => {
  const file=Bun.file("DECISIONS.md");expect(await file.exists()).toBe(true);const text=await file.text();
  for(const required of ["IndexedDB","strict","Bun","CSP","Web Locks","journal","snapshot"])expect(text).toContain(required);
});
