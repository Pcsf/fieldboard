import { expect, test } from "bun:test";
import { migrateWorkspace, validateWorkspace } from "../src/model";
import { estimateProject, sprintLoads, estimateModule } from "../src/planning";

// Backups written by the first release, before any of the optional fields added since.
const board = await Bun.file("tests/fixtures/release1-workspace.json").json();
const planning = await Bun.file("tests/fixtures/release1-planning-workspace.json").json();
// Planning outputs computed by the first-release code on the planning fixture.
const expected = await Bun.file("tests/fixtures/release1-planning-expected.json").json();
// Refactoring reorders some floating-point products (5.525 vs 5.5249999999999995); compare to 1e-9.
function near(actual: unknown, wanted: unknown, path: string) {
  if (typeof wanted === "number") { expect(typeof actual).toBe("number"); expect(Math.abs((actual as number) - wanted) < 1e-9 ? path : `${path}: ${actual} != ${wanted}`).toBe(path); return; }
  if (wanted && typeof wanted === "object") { for (const [k, v] of Object.entries(wanted)) near((actual as any)?.[k], v, `${path}.${k}`); return; }
  expect([path, actual]).toEqual([path, wanted]);
}

test("first-release workspaces load, validate and round-trip byte-for-byte", () => {
  for (const fixture of [board, planning]) {
    const loaded = migrateWorkspace(structuredClone(fixture));
    expect(JSON.stringify(loaded)).toBe(JSON.stringify(fixture));
    expect(JSON.stringify(validateWorkspace(JSON.parse(JSON.stringify(loaded))))).toBe(JSON.stringify(fixture));
  }
});

test("first-release estimates, project totals and sprint loads are unchanged", () => {
  const w = migrateWorkspace(structuredClone(planning));
  for (const [projectId, old] of Object.entries<any>(expected)) {
    const now: Record<string, unknown> = estimateProject(w, projectId);
    near(now, old.project, "project");
    const loads = sprintLoads(w, projectId);
    near(loads, old.sprints, "sprints");
    for (const [cardId, module] of old.modules) near(estimateModule(w.cards.find(c => c.id === cardId)!.effort!), module, `module ${cardId}`);
  }
});
