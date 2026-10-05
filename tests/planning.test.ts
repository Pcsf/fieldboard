import { expect, test } from "bun:test";
import { baselines, defaultEffort, defaultPlanning, estimateModule, estimateProject, programBand, sprintLoads, recordCalibration, defaultCatalog, catalogEffort, effectiveCatalog, validateCatalog, addCategory, editCategory, deleteCategory, addSubcategory, editSubcategory, deleteSubcategory, capacityPerWorkingDay, validatePlanning, sprintBoard, setSprintOverride, type Range } from "../src/planning";
import { createWorkspace, createProject, createCard, editCard, moveCard, archiveCard, undoWorkspace, validateWorkspace, migrateWorkspace } from "../src/model";
import { Storage, Session, DraftJournal } from "../src/storage";
import { IDBFactory } from "fake-indexeddb";

function fixture() {
  const w = createWorkspace(); const p = createProject(w, "FPGA");
  const c = createCard(w, w.columns[0]!.id, "Register bank", "bottom");
  return { w, p, c };
}

test("IED catalog covers all 19 source baselines and keeps uncertainty ranges", () => {
  expect(baselines).toHaveLength(19);
  expect(estimateModule(defaultEffort("vendor-ip")).ied).toEqual([7, 7]);
  expect(estimateModule(defaultEffort("legacy-debug")).ied).toEqual([2, 10]);
  expect(estimateModule(defaultEffort("timing-closure")).ied).toEqual([2, 8]);
  expect(estimateModule(defaultEffort("golden-model")).rtl).toEqual([0, 0]);
});

test("module formula applies verification only to verification and factors per module", () => {
  const e = defaultEffort("csr"); e.factors = { spec: 1.25, clock: 1.35, utilization: 1, reuse: 1, verification: 1.8 };
  const result = estimateModule(e);
  expect(result.ied[0]).toBeCloseTo((2 + 1.5 * 1.8) * 1.25 * 1.35);
  expect(result.rtl[0]).toBeCloseTo(2 * 1.25 * 1.35);
  expect(estimateModule(defaultEffort("csr")).ied).toEqual([3.5, 3.5]);
  e.baseline = "custom"; e.rtl = [1, 2]; e.verification = [2, 3]; e.other = [1, 4];
  expect(estimateModule(e).ied[1]).toBeCloseTo((2 + 3 * 1.8 + 4) * 1.25 * 1.35);
});

test("architecture gate includes verification share and never silently clamps", () => {
  const e = defaultEffort("golden-model"); e.factors.spec = 2; e.factors.utilization = 2; e.factors.verification = 1.8;
  expect(estimateModule(e).architectureGap).toBe(true);
  expect(estimateModule(e).multiplier).toBeCloseTo(7.2);
  e.factors.verification = 1;
  expect(estimateModule(e).architectureGap).toBe(false);
  e.factors.spec = 2.01;
  expect(estimateModule(e).architectureGap).toBe(true);
});

test("architecture gate handles zero lower bounds without inventing a non-verification share", () => {
  const e = defaultEffort("golden-model"); e.verification = [0, 3]; e.factors.verification = .8; e.factors.spec = 5;
  expect(estimateModule(e).multiplier).toBeCloseTo(4);
  expect(estimateModule(e).architectureGap).toBe(false);
  e.rtl = [0, 1]; expect(estimateModule(e).multiplier).toBeCloseTo(5);
});

test("project formula adds contingency once and overheads after contingency", () => {
  const { w, p, c } = fixture(); p.planning = defaultPlanning();
  editCard(w, c.id, { effort: defaultEffort("csr") });
  const result = estimateProject(w, p.id);
  expect(result.modules).toEqual([3.5, 3.5]);
  expect(result.documentation).toEqual([0.2, 0.2]);
  expect(result.overheads).toEqual([9.2, 22.2]);
  expect(result.total).toEqual([13.575, 26.575]);
  expect(result.capacity).toBeCloseTo(5.525);
  expect(result.weeks![0]).toBeCloseTo(13.575 / (.65 * .85 * 5));
  expect(result.sprints![1]).toBe(Math.ceil(26.575 / 5.525));
  p.planning.fte = .5; p.planning.team = .8;
  expect(estimateProject(w, p.id).capacity).toBeCloseTo(2.21);
  expect(estimateProject(w, p.id).weeks![0]).toBeCloseTo(result.weeks![0] / .4);
});

test("totals ignore board filters, include archived work and isolate projects", () => {
  const { w, p, c } = fixture(); p.planning = defaultPlanning(); editCard(w, c.id, { effort: defaultEffort("csr") });
  const other = createProject(w, "Other"); const board = w.boards.find(b => b.projectId === other.id)!;
  createCard(w, w.columns.find(col => col.boardId === board.id)!.id, "Not this scope", "bottom");
  const before = estimateProject(w, p.id);
  moveCard(w, c.id, w.columns[4]!.id, 0); archiveCard(w, c.id, true);
  expect(estimateProject(w, p.id).total).toEqual(before.total);
  expect(estimateProject(w, p.id).unestimated).toBe(0);
  expect(estimateProject(w, p.id).remaining).toEqual([0, 0]);
});

test("unestimated scope and architecture gaps suppress calendar quotes", () => {
  const { w, p, c } = fixture(); p.planning = defaultPlanning(); c.estimate = 123;
  expect(estimateProject(w, p.id).unestimated).toBe(1);
  expect(estimateProject(w, p.id).weeks).toBeNull();
  const e = defaultEffort("csr"); e.factors.spec = 5; editCard(w, c.id, { effort: e });
  expect(estimateProject(w, p.id).architectureGaps).toBe(1);
  expect(estimateProject(w, p.id).weeks).toBeNull();
  editCard(w, c.id, { effort: defaultEffort("csr") }); p.planning.maturity = "unknown";
  expect(estimateProject(w, p.id).weeks).toBeNull();
});

test("unsized zero defaults never produce a quote or a calibration baseline", () => {
  const { w, p, c } = fixture(); p.planning = defaultPlanning();
  const e = defaultEffort(); e.sprint = 1;
  editCard(w, c.id, { effort: e });
  expect(sprintLoads(w, p.id)[0]!.unestimated).toBe(1);
  expect(estimateProject(w, p.id).unestimated).toBe(1);
  expect(estimateProject(w, p.id).weeks).toBeNull();
  expect(() => recordCalibration(w, c.id, 4, "Not sized")).toThrow();
});

test("all source baseline splits and top-level bands match the copied tables", () => {
  expect(baselines.map(b => [b.rtl, b.verification, b.other ?? [0, 0]])).toEqual([
    [.5,.5,[0,0]], [2,1.5,[0,0]], [2,2,[0,0]], [4,4,[0,0]], [.5,.5,[0,0]],
    [1.5,2,[0,0]], [2.5,2.5,[0,0]], [2,2,[0,0]], [5,5,[0,0]], [0,3,[0,0]],
    [3,4,[0,0]], [1.5,1.5,[0,0]], [3,3,[0,0]], [4,4,[0,0]], [4,5,[0,0]],
    [2,3,[0,0]], [1.5,1,[0,0]], [0,0,[2,10]], [0,0,[2,8]],
  ]);
  for (const [program, band] of [["feature", [15,35]], ["standard", [35,70]], ["novel", [70,120]], ["migration", [45,90]], ["integration", [30,60]], ["debug", [10,40]]] as const) {
    expect(programBand({ ...defaultPlanning(), program })).toEqual([...band]);
  }
});

test("top-level bands already contain contingency; integration is additive", () => {
  const p = defaultPlanning(); p.program = "novel"; p.maturity = "clear";
  expect(programBand(p)).toEqual([87.5, 180]);
  p.contingency = .5; expect(programBand(p)).toEqual([87.5, 180]);
  p.program = "integration"; p.maturity = "frozen";
  expect(programBand(p)).toEqual([30, 60]);
  p.maturity = "unknown"; expect(programBand(p)).toBeNull();
});

test("coarse scoping has a staffing scenario before cards exist, without pretending detail is complete", () => {
  const w = createWorkspace(); const p = createProject(w, "Scope first"); p.planning = defaultPlanning();
  const r = estimateProject(w, p.id);
  expect(r.weeks).toBeNull();
  expect(r.bandWeeks![0]).toBeCloseTo(15 / (5 * .65 * .85));
  expect(r.bandWeeks![1]).toBeCloseTo(35 / (5 * .65 * .85));
  p.planning.maturity = "unknown"; expect(estimateProject(w, p.id).bandWeeks).toBeNull();
});

test("sanity comparison flags only estimates outside factor-of-two expanded band", () => {
  const { w, p, c } = fixture(); p.planning = defaultPlanning(); p.planning.program = "novel";
  editCard(w, c.id, { effort: defaultEffort("csr") });
  expect(estimateProject(w, p.id).bandMismatch).toBe(true);
  p.planning.program = "feature"; expect(estimateProject(w, p.id).bandMismatch).toBe(false);
  p.planning.program = "integration"; expect(estimateProject(w, p.id).bandMismatch).toBeNull();
});

test("sprint loads include contingency, flag overcapacity and leave overhead reserve visible", () => {
  const { w, p, c } = fixture(); p.planning = defaultPlanning();
  const e = defaultEffort("algorithm"); e.sprint = 1; editCard(w, c.id, { effort: e });
  const loads = sprintLoads(w, p.id);
  expect(loads[0]!.ied).toEqual([12.5, 12.5]); expect(loads[0]!.overloaded).toBe(true);
  expect(estimateProject(w, p.id).unallocated).toEqual(estimateProject(w, p.id).overheads);
});

test("calibration freezes estimate inputs and retains multiple observations in activity and undo", () => {
  const { w, c } = fixture(); editCard(w, c.id, { effort: defaultEffort("csr") });
  const before = structuredClone(w);
  recordCalibration(w, c.id, 6, "Legacy reset behavior");
  expect(c.calibrations![0]!.estimate.ied).toEqual([3.5, 3.5]);
  expect(c.calibrations![0]!.actualIED).toBe(6);
  const changed = defaultEffort("csr"); changed.factors.spec = 2;
  editCard(w, c.id, { effort: changed });
  expect(c.calibrations![0]!.inputs.factors.spec).toBe(1);
  expect(w.activities.some(a => a.after?.calibrations?.length === 1)).toBe(true);
  expect(() => recordCalibration(w, c.id, -1, "bad")).toThrow();
  undoWorkspace(w, before); expect(w.cards[0]!.calibrations).toBeUndefined();
  expect(validateWorkspace(w)).toEqual(w);
});

test("optional schema fields preserve old data including unitless estimates and history", () => {
  const { w, c } = fixture(); editCard(w, c.id, { estimate: 42 });
  const text = JSON.stringify(w); expect(JSON.stringify(migrateWorkspace(JSON.parse(text)))).toBe(text);
  expect(w.cards[0]!.effort).toBeUndefined(); expect(w.projects[0]!.planning).toBeUndefined();
});

test("validation rejects malformed planning in live records and historical snapshots", () => {
  const { w, p, c } = fixture(); p.planning = defaultPlanning(); editCard(w, c.id, { effort: defaultEffort("csr") });
  recordCalibration(w, c.id, 4, "None");
  const bads: ((x: any) => void)[] = [
    x => x.projects[0].planning.focus = 0, x => x.projects[0].planning.team = 1.1,
    x => x.projects[0].planning.fte = NaN, x => x.projects[0].planning.contingency = -1,
    x => x.projects[0].planning.build = [4, 2], x => x.projects[0].planning.program = "missing",
    x => x.cards[0].effort.rtl = [-1, 0], x => x.cards[0].effort.sprint = 1.2,
    x => x.cards[0].effort.factors.reuse = 0, x => x.cards[0].effort.factors.spec = Infinity,
    x => x.cards[0].calibrations[0].actualIED = -1,
    x => x.cards[0].calibrations[0].inputs.factors.clock = 0,
    x => x.cards[0].calibrations[0].estimate.ied = [100, 100],
    x => x.activities.at(-1).after.effort.verification = "bad",
  ];
  for (const bad of bads) { const next = structuredClone(w); bad(next); expect(() => validateWorkspace(next)).toThrow(); }
  expect(validateWorkspace(JSON.parse(JSON.stringify(w)))).toEqual(w);
});

test("planning survives journal recovery, snapshot and fresh-storage backup restore", async () => {
  const factory = new IDBFactory(); const store = new Storage(factory, "planning"); await store.open();
  const map = new Map<string, string>(); const journal = new DraftJournal({ getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }, removeItem: k => { map.delete(k); } });
  const session = new Session(store, journal); await session.load();
  const commit = store.commit.bind(store); store.commit = async () => { throw new Error("write denied"); };
  session.change(w => { const p = createProject(w, "Planning"); p.planning = defaultPlanning(); const c = createCard(w, w.columns[0]!.id, "IP", "bottom"); editCard(w, c.id, { effort: defaultEffort("vendor-ip") }); recordCalibration(w, c.id, 8, "Fidelity"); });
  await session.flush(); expect(session.status).toBe("error"); store.commit = commit;
  const recovered = new Session(store, journal); await recovered.load(); expect(recovered.status).toBe("saved");
  const committed = await store.load(); await store.snapshot("2026-10-04");
  expect((await store.snapshots())[0]!.state).toEqual(committed!);
  const other = new Storage(factory, "fresh"); await other.open();
  await other.commit(migrateWorkspace(JSON.parse(JSON.stringify(committed))), 0);
  expect(await other.load()).toEqual(committed); store.close(); other.close();
});

test("default catalog has 18 workspace-editable categories split between design and lab work", () => {
  expect(defaultCatalog).toHaveLength(18);
  expect(defaultCatalog.filter(c => c.kind === "lab")).toHaveLength(7);
  expect(defaultCatalog.filter(c => c.kind === "design")).toHaveLength(11);
  for (const c of defaultCatalog) {
    expect(c.subcategories.length).toBeGreaterThan(0);
    expect((c.rtl !== undefined) !== (c.other !== undefined)).toBe(true);
  }
  expect(() => validateCatalog(defaultCatalog)).not.toThrow();
});

test("catalog base × subcategory factor fills the baseline split and records provenance once", () => {
  const spi = catalogEffort(defaultCatalog, "serial-link", "spi");
  expect(spi.rtl).toEqual([1.5, 1.5]); expect(spi.verification).toEqual([1.5, 1.5]); expect(spi.subcategoryFactor).toBe(1);
  const clockSwitch = catalogEffort(defaultCatalog, "cdc", "clock-switch");
  expect(clockSwitch.rtl).toEqual([1.5 * 1.4, 1.5 * 1.4]); expect(clockSwitch.verification).toEqual([2 * 1.4, 2 * 1.4]);
  const bringup = catalogEffort(defaultCatalog, "board-bringup", "new-custom-board");
  expect(bringup.other).toEqual([4 * 1.5, 10 * 1.5]); expect(bringup.rtl).toEqual([0, 0]);
  expect(bringup.baseline).toBe("custom"); expect(bringup.category).toBe("board-bringup"); expect(bringup.subcategory).toBe("new-custom-board");
  expect(() => catalogEffort(defaultCatalog, "missing", "spi")).toThrow();
  expect(() => catalogEffort(defaultCatalog, "serial-link", "missing")).toThrow();
});

test("catalog CRUD edits the workspace's own copy, validates inputs and refuses deleting an in-use entry", () => {
  const { w, c } = fixture();
  const cat = addCategory(w, "Power sequencing", "design", { rtl: 1, verification: 1 });
  const subA = addSubcategory(w, cat.id, "Basic", 1);
  const subB = addSubcategory(w, cat.id, "Redundant", 1.5);
  editCategory(w, cat.id, { name: "Power sequencing FSM", rtl: 1.2 });
  editSubcategory(w, cat.id, subA.id, { factor: 1.1 });
  expect(effectiveCatalog(w).find(x => x.id === cat.id)!.name).toBe("Power sequencing FSM");
  expect(defaultCatalog.some(x => x.id === cat.id)).toBe(false);
  editCard(w, c.id, { effort: { ...defaultEffort(), ...catalogEffort(effectiveCatalog(w), cat.id, subA.id) } });
  expect(() => deleteCategory(w, cat.id)).toThrow();
  expect(() => deleteSubcategory(w, cat.id, subA.id)).toThrow();
  deleteSubcategory(w, cat.id, subB.id);
  expect(effectiveCatalog(w).find(x => x.id === cat.id)!.subcategories).toHaveLength(1);
  expect(() => deleteSubcategory(w, cat.id, subA.id)).toThrow(); // last remaining subcategory
  editCard(w, c.id, { effort: defaultEffort() });
  deleteCategory(w, cat.id);
  expect(effectiveCatalog(w).some(x => x.id === cat.id)).toBe(false);
  expect(() => addCategory(w, "  ", "design", { rtl: 1, verification: 1 })).toThrow();
  expect(() => addSubcategory(w, defaultCatalog[0]!.id, "x", 0)).toThrow();
  expect(() => editCategory(w, "missing", { name: "x" })).toThrow();
});

test("validateCatalog rejects malformed categories and subcategories", () => {
  const bads: ((c: any[]) => void)[] = [
    c => c[0].kind = "weird", c => c[0].rtl = -1, c => c[0].other = [1, 2],
    c => c[0].subcategories = [], c => c[0].subcategories[0].factor = 0, c => c[1].id = c[0].id,
    c => c[0].subcategories[1] = c[0].subcategories[0],
  ];
  for (const bad of bads) { const clone = structuredClone(defaultCatalog); bad(clone); expect(() => validateCatalog(clone)).toThrow(); }
});

test("lab access factor multiplies the common factor and counts toward the architecture gate", () => {
  const e = defaultEffort("csr"); e.factors.lab = 1.5;
  const withLab = estimateModule(e).ied;
  const withoutLab = estimateModule({ ...e, factors: { ...e.factors, lab: 1 } }).ied;
  expect(withLab).toEqual([withoutLab[0] * 1.5, withoutLab[1] * 1.5]);
  expect(estimateModule(e).architectureGap).toBe(false);
  e.factors.spec = 2; e.factors.utilization = 1.4;
  expect(estimateModule(e).multiplier).toBeCloseTo(4.2);
  expect(estimateModule(e).architectureGap).toBe(true);
  delete (e.factors as any).lab; // old data without the field behaves exactly as factor 1
  expect(estimateModule(e).multiplier).toBeCloseTo(2.8);
});

test("direct capacity mode and per-sprint overrides size sprints without touching the staffing formula", () => {
  const { w, p, c } = fixture(); p.planning = defaultPlanning();
  p.planning.capacityMode = "direct"; p.planning.directCapacity = 8; p.planning.sprintWeeks = 2;
  expect(capacityPerWorkingDay(p.planning)).toBeCloseTo(.8);
  editCard(w, c.id, { effort: { ...defaultEffort("csr"), sprint: 1 } });
  expect(estimateProject(w, p.id).capacity).toBeCloseTo(8);
  setSprintOverride(w, p.id, 1, 3);
  let board = sprintBoard(w, p.id);
  expect(board.sprints[0]!.capacity).toBe(3); expect(board.sprints[0]!.capacitySource).toBe("overridden"); expect(board.sprints[0]!.verdict).toBe("over");
  setSprintOverride(w, p.id, 1, null);
  board = sprintBoard(w, p.id);
  expect(board.sprints[0]!.capacitySource).toBe("direct"); expect(board.sprints[0]!.capacity).toBe(8); expect(board.sprints[0]!.verdict).toBe("within");
  expect(() => validatePlanning({ ...p.planning, capacityMode: "bogus" })).toThrow();
  expect(() => validatePlanning({ ...p.planning, directCapacity: -1 })).toThrow();
  expect(() => validatePlanning({ ...p.planning, sprintOverrides: { "0": 1 } })).toThrow();
  expect(() => setSprintOverride(w, p.id, 0, 1)).toThrow();
  expect(() => setSprintOverride(w, "missing", 1, 1)).toThrow();
});

test("sprintBoard marks architecture gaps and unsized cards as not quotable and lists unassigned estimated cards", () => {
  const { w, p, c } = fixture(); p.planning = defaultPlanning();
  const other = createCard(w, w.columns[0]!.id, "Unassigned work", "bottom");
  editCard(w, other.id, { effort: defaultEffort("csr") });
  const e = defaultEffort("csr"); e.sprint = 2; e.factors.spec = 5; editCard(w, c.id, { effort: e });
  const board = sprintBoard(w, p.id);
  expect(board.sprints[0]!.verdict).toBe("not quotable");
  expect(board.unassigned.map(x => x.id)).toEqual([other.id]);
});

test("legacy baseline cards and calibrations keep their IED numbers through the catalog change", () => {
  const w = createWorkspace(); createProject(w, "Legacy");
  const before: Record<string, Range> = {};
  for (const b of baselines) {
    const card = createCard(w, w.columns[0]!.id, b.id, "bottom");
    const effort = defaultEffort(b.id);
    delete (effort as any).category; delete (effort as any).subcategory; delete (effort as any).factors.lab;
    editCard(w, card.id, { effort });
    recordCalibration(w, card.id, 1, "baseline check");
    before[b.id] = estimateModule(w.cards.find(x => x.id === card.id)!.effort!).ied;
  }
  const text = JSON.stringify(w);
  const reloaded = migrateWorkspace(JSON.parse(text));
  for (const c of reloaded.cards) expect(estimateModule(c.effort!).ied).toEqual(before[c.title]!);
  expect(JSON.stringify(reloaded)).toBe(text);
});

test("direct capacity drives the calendar quote: weeks, sprints and the coarse band all use the entered IED per sprint", () => {
  const { w, p, c } = fixture(); p.planning = defaultPlanning();
  p.planning.capacityMode = "direct"; p.planning.directCapacity = 8; p.planning.sprintWeeks = 2;
  editCard(w, c.id, { effort: defaultEffort("csr") });
  const r = estimateProject(w, p.id);
  expect(r.total[0]).toBeCloseTo(13.575); expect(r.total[1]).toBeCloseTo(26.575);
  expect(r.sprints).toEqual([2, 4]);
  expect(r.weeks![0]).toBeCloseTo(13.575 / 8 * 2); expect(r.weeks![1]).toBeCloseTo(26.575 / 8 * 2);
  expect(r.workingDays).toBeNull();
  expect(r.bandWeeks![0]).toBeCloseTo(15 / 4); expect(r.bandWeeks![1]).toBeCloseTo(35 / 4);
  p.planning.capacityMode = "derived";
  const d = estimateProject(w, p.id);
  expect(d.weeks![0]).toBeCloseTo(13.575 / (.65 * .85) / 5); expect(d.workingDays![0]).toBeCloseTo(13.575 / (.65 * .85));
});
