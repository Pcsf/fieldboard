import { editCard, id, type Card, type Workspace } from "./model";

export type Range = [number, number];
export interface Factors { spec: number; clock: number; utilization: number; reuse: number; verification: number; lab?: number }
export interface Effort {
  baseline: string; rtl: Range; verification: Range; other: Range; factors: Factors;
  scope: string; assumptions: string; sprint: number | null;
  category?: string; subcategory?: string; subcategoryFactor?: number;
}
export interface Planning {
  program: string; maturity: string; contingency: number;
  build: Range; timing: Range; bringup: Range; documentation: number;
  focus: number; availability: number; fte: number; team: number; sprintWeeks: number;
  assumptions: string;
  capacityMode?: "derived" | "direct"; directCapacity?: number | null; sprintOverrides?: Record<string, number>;
}
export interface Subcategory { id: string; name: string; factor: number }
export interface Category { id: string; name: string; kind: "design" | "lab"; rtl?: number; verification?: number; other?: Range; subcategories: Subcategory[] }
export const labAccess = [
  { name: "Dedicated bench", factor: 1 },
  { name: "Shared lab", factor: 1.25 },
  { name: "Booked or remote lab", factor: 1.5 },
];
export interface ModuleEstimate { ied: Range; rtl: Range; multiplier: number; architectureGap: boolean }
export interface Calibration { timestamp: string; inputs: Effort; estimate: ModuleEstimate; actualIED: number; missedFactor: string }
interface Baseline { id: string; name: string; rtl: number; verification: number; other?: Range }
export const baselines: Baseline[] = [
  { id: "generated-registers", name: "Register map, auto-generated (SystemRDL/CSV → AXI-Lite)", rtl: .5, verification: .5 },
  { id: "csr", name: "Hand-written register bank / CSR with decode logic", rtl: 2, verification: 1.5 },
  { id: "fsm", name: "Standard FSM controller (5–10 states, sequencing/handshakes)", rtl: 2, verification: 2 },
  { id: "complex-fsm", name: "Complex hierarchical / multi-engine FSM (>15 states)", rtl: 4, verification: 4 },
  { id: "synchronizer", name: "Simple 2-FF / pulse synchronizer + constraints", rtl: .5, verification: .5 },
  { id: "async-fifo", name: "Async FIFO / handshake / Gray-code crossing", rtl: 1.5, verification: 2 },
  { id: "clock-switch", name: "Dynamic clock switching / PLL reconfiguration logic", rtl: 2.5, verification: 2.5 },
  { id: "filter", name: "Fixed-point FIR/IIR filter pipeline (standard coeffs)", rtl: 2, verification: 2 },
  { id: "algorithm", name: "Algorithmic datapath (CORDIC, FFT, matrix engine)", rtl: 5, verification: 5 },
  { id: "golden-model", name: "Python/MATLAB bit-accurate golden reference model", rtl: 0, verification: 3 },
  { id: "vendor-ip", name: "Vendor IP integration incl. fidelity verification (configure, stub parity TB, real-IP capture, IP-grounded profiling)", rtl: 3, verification: 4 },
  { id: "low-speed", name: "Low-speed controller (SPI, I2C, UART) from scratch", rtl: 1.5, verification: 1.5 },
  { id: "high-speed", name: "High-speed vendor IP wrapper (PCIe, 10GbE, Aurora, AXI-DMA)", rtl: 3, verification: 3 },
  { id: "memory", name: "External memory controller integration (DDR4/5 MIG wrapper)", rtl: 4, verification: 4 },
  { id: "serdes", name: "Custom high-speed ADC/DAC SERDES framing interface", rtl: 4, verification: 5 },
  { id: "top-level", name: "Top-level structural RTL / block-design wiring", rtl: 2, verification: 3 },
  { id: "pinout", name: "Pinout, IO standards, primary clock constraints", rtl: 1.5, verification: 1 },
  { id: "legacy-debug", name: "Debug of existing / legacy design (reproduce, root-cause, fix)", rtl: 0, verification: 0, other: [2, 10] },
  { id: "timing-closure", name: "Timing closure beyond initial pass (as distinct task)", rtl: 0, verification: 0, other: [2, 8] },
];
export const programs = [
  { id: "feature", name: "Feature add to existing element", band: [15, 35] as Range },
  { id: "standard", name: "New element, standard interfaces", band: [35, 70] as Range },
  { id: "novel", name: "New element, novel datapath", band: [70, 120] as Range },
  { id: "migration", name: "EOL device migration of existing element", band: [45, 90] as Range },
  { id: "integration", name: "System-level integration (multi-element)", band: [30, 60] as Range },
  { id: "debug", name: "Debug / bring-up of unknown or failing system", band: [10, 40] as Range },
];
export const maturities = [
  { id: "frozen", name: "Frozen, signed off, measurable limits", factor: [1, 1] as Range },
  { id: "clear", name: "Mostly clear, parameters shifting", factor: [1.25, 1.5] as Range },
  { id: "concept", name: "Concept stage, architecture open", factor: [2, 2.5] as Range },
  { id: "unknown", name: "\"We'll figure it out in design\"", factor: null },
];
const scale = (r: Range, n: number): Range => [r[0] * n, r[1] * n];
const plus = (a: Range, b: Range): Range => [a[0] + b[0], a[1] + b[1]];
export function defaultEffort(baseline = "custom"): Effort {
  const b = baselines.find(b => b.id === baseline);
  if (!b && baseline !== "custom") throw new Error("Unknown baseline");
  return { baseline, rtl: [b?.rtl ?? 0, b?.rtl ?? 0], verification: [b?.verification ?? 0, b?.verification ?? 0], other: b?.other ? [...b.other] : [0, 0], factors: { spec: 1, clock: 1, utilization: 1, reuse: 1, verification: 1, lab: 1 }, scope: "", assumptions: "", sprint: null, category: "custom", subcategory: "custom" };
}
export function defaultPlanning(): Planning {
  return { program: "feature", maturity: "frozen", contingency: .25, build: [2, 4], timing: [3, 8], bringup: [4, 10], documentation: .1, focus: .65, availability: .85, fte: 1, team: 1, sprintWeeks: 2, assumptions: "", capacityMode: "derived", directCapacity: null, sprintOverrides: {} };
}

function object(x: unknown): Record<string, unknown> { if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("Invalid planning object"); return x as Record<string, unknown>; }
function number(x: unknown, min = 0, max = 1e6): asserts x is number { if (typeof x !== "number" || !Number.isFinite(x) || x < min || x > max) throw new Error(`Planning value must be finite and within ${min}–${max}`); }
function text(x: unknown) { if (typeof x !== "string") throw new Error("Planning text required"); }
function nonempty(x: unknown, label: string): asserts x is string { text(x); if (!(x as string).trim()) throw new Error(`${label} is required`); }
function range(x: unknown) { if (!Array.isArray(x) || x.length !== 2) throw new Error("Expected IED range"); number(x[0]); number(x[1]); if (x[0] > x[1]) throw new Error("IED minimum exceeds maximum"); }
export function validateEffort(input: unknown): asserts input is Effort {
  const e = object(input); if (e.baseline !== "custom" && !baselines.some(b => b.id === e.baseline)) throw new Error("Unknown baseline");
  range(e.rtl); range(e.verification); range(e.other); text(e.scope); text(e.assumptions);
  if (e.sprint !== null) { number(e.sprint, 1, 10000); if (!Number.isInteger(e.sprint)) throw new Error("Sprint must be an integer"); }
  const f = object(e.factors); for (const key of ["spec", "clock", "utilization", "reuse", "verification"]) number(f[key], .01, 10);
  if (f.lab !== undefined) number(f.lab, .01, 10);
  if (e.category !== undefined) nonempty(e.category, "Category reference");
  if (e.subcategory !== undefined) nonempty(e.subcategory, "Subcategory reference");
  if (e.subcategoryFactor !== undefined) number(e.subcategoryFactor, .01, 10);
}
export function validatePlanning(input: unknown): asserts input is Planning {
  const p = object(input);
  if (!programs.some(b => b.id === p.program) || !maturities.some(m => m.id === p.maturity)) throw new Error("Unknown program or spec maturity");
  number(p.contingency, 0, 1); number(p.documentation, 0, 1);
  range(p.build); range(p.timing); range(p.bringup);
  for (const key of ["focus", "availability", "team"]) number(p[key], .01, 1);
  number(p.fte, .01, 1000); number(p.sprintWeeks, .1, 52); text(p.assumptions);
  if (p.capacityMode !== undefined && p.capacityMode !== "derived" && p.capacityMode !== "direct") throw new Error("Unknown capacity mode");
  if (p.directCapacity !== undefined && p.directCapacity !== null) number(p.directCapacity, 0, 1e6);
  if (p.sprintOverrides !== undefined) {
    const overrides = object(p.sprintOverrides);
    for (const [key, value] of Object.entries(overrides)) { if (!/^[1-9]\d*$/.test(key)) throw new Error("Sprint override key must be a positive integer"); number(value, 0, 1e6); }
  }
}
export const defaultCatalog: Category[] = [
  { id: "register-interface", name: "Register interface", kind: "design", rtl: 2, verification: 1.5, subcategories: [
    { id: "hand-written-csr", name: "Hand-written CSR with decode logic", factor: 1 },
    { id: "auto-register-map", name: "Auto-generated register map (SystemRDL/CSV → AXI-Lite)", factor: .3 },
  ] },
  { id: "control-fsm", name: "Control logic / FSM", kind: "design", rtl: 2, verification: 2, subcategories: [
    { id: "standard-fsm", name: "Standard FSM (5–10 states)", factor: 1 },
    { id: "complex-fsm", name: "Complex hierarchical / multi-engine FSM (>15 states)", factor: 2 },
  ] },
  { id: "cdc", name: "Clock-domain crossing", kind: "design", rtl: 1.5, verification: 2, subcategories: [
    { id: "simple-sync", name: "Simple 2-FF / pulse synchronizer", factor: .3 },
    { id: "async-fifo", name: "Async FIFO / handshake / Gray-code crossing", factor: 1 },
    { id: "clock-switch", name: "Dynamic clock switching / PLL reconfiguration", factor: 1.4 },
  ] },
  { id: "dsp-datapath", name: "DSP datapath", kind: "design", rtl: 2, verification: 2, subcategories: [
    { id: "fir-iir", name: "Fixed-point FIR/IIR filter", factor: 1 },
    { id: "algorithmic-datapath", name: "Algorithmic datapath (CORDIC, FFT, matrix engine)", factor: 2.5 },
  ] },
  { id: "serial-link", name: "Serial link RTL design", kind: "design", rtl: 1.5, verification: 1.5, subcategories: [
    { id: "spi", name: "SPI", factor: 1 },
    { id: "i2c", name: "I2C", factor: 1 },
    { id: "uart", name: "UART", factor: 1 },
  ] },
  { id: "high-speed-interface", name: "High-speed interface", kind: "design", rtl: 3, verification: 3, subcategories: [
    { id: "vendor-ip-wrapper", name: "Vendor IP wrapper (PCIe, 10GbE, Aurora, AXI-DMA)", factor: 1 },
    { id: "external-memory-controller", name: "External memory controller (DDR4/5 MIG)", factor: 1.33 },
    { id: "adc-dac-serdes", name: "Custom ADC/DAC SERDES framing", factor: 1.5 },
  ] },
  { id: "vendor-ip-integration", name: "Vendor IP integration", kind: "design", rtl: 3, verification: 4, subcategories: [
    { id: "vendor-ip-fidelity", name: "Integration incl. fidelity verification", factor: 1 },
  ] },
  { id: "top-level-constraints", name: "Top level and constraints", kind: "design", rtl: 2, verification: 3, subcategories: [
    { id: "structural-rtl", name: "Structural RTL / block-design wiring", factor: 1 },
    { id: "pinout-io", name: "Pinout, IO standards, primary clocks", factor: .5 },
  ] },
  { id: "reference-models", name: "Reference models", kind: "design", rtl: 0, verification: 3, subcategories: [
    { id: "golden-model", name: "Bit-accurate golden model (Python/MATLAB)", factor: 1 },
  ] },
  { id: "legacy-debug", name: "Legacy debug", kind: "design", other: [2, 10], subcategories: [
    { id: "reproduce-root-cause", name: "Reproduce, root-cause and fix", factor: 1 },
  ] },
  { id: "timing-closure", name: "Timing closure beyond first pass", kind: "design", other: [2, 8], subcategories: [
    { id: "distinct-timing-task", name: "As a distinct task", factor: 1 },
  ] },
  { id: "board-bringup", name: "Board bring-up", kind: "lab", other: [4, 10], subcategories: [
    { id: "known-board", name: "Known board or reference design", factor: .6 },
    { id: "soft-processor-system", name: "Soft-processor system with peripherals", factor: 1 },
    { id: "new-custom-board", name: "New custom board, first hardware", factor: 1.5 },
  ] },
  { id: "hw-testbench", name: "Hardware testbench verification", kind: "lab", other: [3, 6], subcategories: [
    { id: "scripted-register-tests", name: "Scripted register tests (JTAG-to-AXI, System Console)", factor: .7 },
    { id: "embedded-test-firmware", name: "Embedded test firmware on target", factor: 1 },
    { id: "automated-hw-regression", name: "Automated hardware regression rig", factor: 1.6 },
  ] },
  { id: "interface-characterization", name: "Interface characterization", kind: "lab", other: [2, 5], subcategories: [
    { id: "serdes-eye-scan", name: "SERDES eye scan / IBERT", factor: 1 },
    { id: "timing-margin-boundary", name: "Timing margin at the system boundary", factor: 1.2 },
    { id: "adc-dac-capture", name: "ADC/DAC capture with SNR/ENOB analysis", factor: 1.4 },
  ] },
  { id: "onchip-debug", name: "On-chip debug instrumentation", kind: "lab", other: [1, 3], subcategories: [
    { id: "single-domain-ila", name: "Single-domain ILA / SignalTap capture", factor: .5 },
    { id: "cross-domain-capture", name: "Cross-domain or multi-trigger capture", factor: 1.3 },
  ] },
  { id: "config-field-update", name: "Configuration and field update", kind: "lab", other: [2, 4], subcategories: [
    { id: "flash-programming", name: "Flash programming flow", factor: .6 },
    { id: "golden-update-image", name: "Golden/update image with fallback validation", factor: 1.5 },
  ] },
  { id: "qualification-compliance", name: "Qualification and compliance", kind: "lab", other: [5, 15], subcategories: [
    { id: "environmental-testing", name: "Environmental / temperature testing", factor: 1 },
    { id: "emc-precompliance", name: "EMC pre-compliance", factor: 1 },
    { id: "metrology-certification", name: "Metrology certification (e.g. INMETRO)", factor: 2 },
  ] },
  { id: "production-test-support", name: "Production test support", kind: "lab", other: [3, 6], subcategories: [
    { id: "boundary-scan-test", name: "Boundary-scan test", factor: .7 },
    { id: "manufacturing-test-image", name: "Manufacturing test image", factor: 1 },
  ] },
];
export function validateCatalog(input: unknown): asserts input is Category[] {
  if (!Array.isArray(input)) throw new Error("Invalid catalog");
  const catIds = new Set<string>();
  for (const value of input) {
    const c = object(value);
    nonempty(c.id, "Category id"); if (catIds.has(c.id as string)) throw new Error("Duplicate category id"); catIds.add(c.id as string);
    nonempty(c.name, "Category name");
    if (c.kind !== "design" && c.kind !== "lab") throw new Error("Unknown category kind");
    const split = c.rtl !== undefined || c.verification !== undefined;
    if (c.other !== undefined === split) throw new Error("Category must be either split or unsplit");
    if (split) { number(c.rtl, 0, 1e6); number(c.verification, 0, 1e6); } else range(c.other);
    const subs = c.subcategories; if (!Array.isArray(subs) || !subs.length) throw new Error("Category needs at least one subcategory");
    const subIds = new Set<string>();
    for (const sv of subs) {
      const s = object(sv);
      nonempty(s.id, "Subcategory id"); if (subIds.has(s.id as string)) throw new Error("Duplicate subcategory id"); subIds.add(s.id as string);
      nonempty(s.name, "Subcategory name"); number(s.factor, .01, 10);
    }
  }
}
export function effectiveCatalog(w: Workspace): Category[] { return w.catalog ?? defaultCatalog; }
function writableCatalog(w: Workspace): Category[] { if (!w.catalog) w.catalog = structuredClone(defaultCatalog); return w.catalog; }
export function catalogEffort(catalog: Category[], categoryId: string, subcategoryId: string): Pick<Effort, "baseline" | "rtl" | "verification" | "other" | "category" | "subcategory" | "subcategoryFactor"> {
  const cat = catalog.find(c => c.id === categoryId); if (!cat) throw new Error("Unknown category");
  const sub = cat.subcategories.find(s => s.id === subcategoryId); if (!sub) throw new Error("Unknown subcategory");
  const rtl: Range = cat.rtl !== undefined ? [cat.rtl * sub.factor, cat.rtl * sub.factor] : [0, 0];
  const verification: Range = cat.verification !== undefined ? [cat.verification * sub.factor, cat.verification * sub.factor] : [0, 0];
  const other: Range = cat.other ? scale(cat.other, sub.factor) : [0, 0];
  return { baseline: "custom", category: cat.id, subcategory: sub.id, subcategoryFactor: sub.factor, rtl, verification, other };
}
export function addCategory(w: Workspace, name: string, kind: "design" | "lab", base: { rtl: number; verification: number } | { other: Range }): Category {
  nonempty(name, "Category name");
  const cat: Category = "other" in base
    ? { id: id(), name: name.trim(), kind, other: base.other, subcategories: [] }
    : { id: id(), name: name.trim(), kind, rtl: base.rtl, verification: base.verification, subcategories: [] };
  writableCatalog(w).push(cat); return cat;
}
export function editCategory(w: Workspace, categoryId: string, patch: Partial<Pick<Category, "name" | "rtl" | "verification" | "other">>) {
  const cat = writableCatalog(w).find(c => c.id === categoryId); if (!cat) throw new Error("Category not found");
  if (patch.name !== undefined) { nonempty(patch.name, "Category name"); cat.name = patch.name.trim(); }
  if (patch.rtl !== undefined) { number(patch.rtl, 0, 1e6); cat.rtl = patch.rtl; }
  if (patch.verification !== undefined) { number(patch.verification, 0, 1e6); cat.verification = patch.verification; }
  if (patch.other !== undefined) { range(patch.other); cat.other = patch.other; }
}
export function deleteCategory(w: Workspace, categoryId: string) {
  const catalog = writableCatalog(w); if (!catalog.some(c => c.id === categoryId)) throw new Error("Category not found");
  if (w.cards.some(c => c.effort?.category === categoryId)) throw new Error("Cards use this category. Reassign them before deleting it.");
  w.catalog = catalog.filter(c => c.id !== categoryId);
}
export function addSubcategory(w: Workspace, categoryId: string, name: string, factor: number): Subcategory {
  const cat = writableCatalog(w).find(c => c.id === categoryId); if (!cat) throw new Error("Category not found");
  nonempty(name, "Subcategory name"); number(factor, .01, 10);
  const sub: Subcategory = { id: id(), name: name.trim(), factor }; cat.subcategories.push(sub); return sub;
}
export function editSubcategory(w: Workspace, categoryId: string, subcategoryId: string, patch: Partial<Pick<Subcategory, "name" | "factor">>) {
  const cat = writableCatalog(w).find(c => c.id === categoryId); if (!cat) throw new Error("Category not found");
  const sub = cat.subcategories.find(s => s.id === subcategoryId); if (!sub) throw new Error("Subcategory not found");
  if (patch.name !== undefined) { nonempty(patch.name, "Subcategory name"); sub.name = patch.name.trim(); }
  if (patch.factor !== undefined) { number(patch.factor, .01, 10); sub.factor = patch.factor; }
}
export function deleteSubcategory(w: Workspace, categoryId: string, subcategoryId: string) {
  const cat = writableCatalog(w).find(c => c.id === categoryId); if (!cat) throw new Error("Category not found");
  if (!cat.subcategories.some(s => s.id === subcategoryId)) throw new Error("Subcategory not found");
  if (cat.subcategories.length < 2) throw new Error("Keep at least one subcategory");
  if (w.cards.some(c => c.effort?.category === categoryId && c.effort?.subcategory === subcategoryId)) throw new Error("Cards use this subcategory. Reassign them before deleting it.");
  cat.subcategories = cat.subcategories.filter(s => s.id !== subcategoryId);
}
export function estimateModule(e: Effort): ModuleEstimate {
  validateEffort(e);
  const f = e.factors; const common = f.spec * f.clock * f.utilization * f.reuse * (f.lab ?? 1);
  const ied = scale(plus(plus(e.rtl, scale(e.verification, f.verification)), e.other), common);
  // Independent ranges: the highest verification share determines the worst effective multiplier.
  const verification = f.verification >= 1 ? e.verification[1] : e.verification[0];
  const nonVerification = f.verification >= 1 ? e.rtl[0] + e.other[0] : e.rtl[1] + e.other[1];
  const base = verification + nonVerification;
  const zeroBoundFactor = e.rtl[1] + e.other[1] === 0 && e.verification[1] > 0 ? f.verification : 1;
  const multiplier = base ? common * (nonVerification + verification * f.verification) / base : common * zeroBoundFactor;
  return { ied, rtl: scale(e.rtl, common), multiplier, architectureGap: multiplier > 4 + 1e-10 };
}
export function validateCalibrations(input: unknown) {
  if (!Array.isArray(input)) throw new Error("Invalid calibration log");
  for (const value of input) {
    const c = object(value); text(c.timestamp); if (!Number.isFinite(Date.parse(c.timestamp as string))) throw new Error("Invalid calibration timestamp");
    validateEffort(c.inputs); number(c.actualIED); text(c.missedFactor);
    const calculated = estimateModule(c.inputs); const stored = object(c.estimate);
    range(stored.ied); range(stored.rtl);
    if (JSON.stringify(stored.ied) !== JSON.stringify(calculated.ied) || JSON.stringify(stored.rtl) !== JSON.stringify(calculated.rtl) || stored.multiplier !== calculated.multiplier || stored.architectureGap !== calculated.architectureGap) throw new Error("Calibration estimate contradicts its inputs");
  }
}
export function recordCalibration(w: Workspace, cardId: string, actualIED: number, missedFactor: string) {
  number(actualIED); text(missedFactor);
  const c = w.cards.find(c => c.id === cardId); if (!c?.effort) throw new Error("Estimate this card before logging actual effort");
  const estimate = estimateModule(c.effort);
  if (estimate.ied[1] === 0) throw new Error("Size the work before logging calibration");
  if (estimate.architectureGap) throw new Error("Resolve the architecture gap before calibration");
  editCard(w, cardId, { calibrations: [...(c.calibrations ?? []), { timestamp: new Date().toISOString(), inputs: structuredClone(c.effort), estimate, actualIED, missedFactor }] });
}
export function projectCards(w: Workspace, projectId: string): Card[] {
  const boards = new Set(w.boards.filter(b => b.projectId === projectId).map(b => b.id));
  const columns = new Set(w.columns.filter(c => boards.has(c.boardId)).map(c => c.id));
  return w.cards.filter(c => columns.has(c.columnId));
}
export function capacityPerWorkingDay(p: Planning): number {
  if (p.capacityMode === "direct") return (p.directCapacity ?? 0) / (5 * p.sprintWeeks);
  return p.focus * p.availability * p.fte * p.team;
}
export function programBand(p: Planning): Range | null {
  validatePlanning(p); const b = programs.find(b => b.id === p.program)!.band; const f = maturities.find(m => m.id === p.maturity)!.factor;
  return f ? [b[0] * f[0], b[1] * f[1]] : null;
}
export function estimateProject(w: Workspace, projectId: string) {
  const project = w.projects.find(p => p.id === projectId); if (!project) throw new Error("Project not found");
  const p = project.planning ?? defaultPlanning(); validatePlanning(p);
  const cards = projectCards(w, projectId);
  let modules: Range = [0, 0], rtl: Range = [0, 0], remaining: Range = [0, 0], unassigned: Range = [0, 0];
  let unestimated = 0, architectureGaps = 0;
  for (const c of cards) {
    if (!c.effort) { unestimated++; continue; }
    const e = estimateModule(c.effort); modules = plus(modules, e.ied); rtl = plus(rtl, e.rtl);
    if (e.ied[1] === 0) unestimated++;
    if (e.architectureGap) architectureGaps++;
    if (!c.completedAt) remaining = plus(remaining, e.ied);
    if (c.effort.sprint === null) unassigned = plus(unassigned, e.ied);
  }
  const documentation = scale(rtl, p.documentation);
  const overheads = plus(plus(plus(p.build, p.timing), p.bringup), documentation);
  const contingency = scale(modules, p.contingency);
  const total = plus(plus(modules, contingency), overheads);
  const perWeek = 5 * capacityPerWorkingDay(p); const capacity = p.sprintWeeks * perWeek;
  const band = programBand(p);
  const bandWeeks = band && project.planning && perWeek > 0 ? scale(band, 1 / perWeek) : null;
  const quotable = cards.length > 0 && !!project.planning && unestimated === 0 && architectureGaps === 0 && band !== null && perWeek > 0;
  // Effort-equivalent days need focus and availability, which a directly entered capacity does not separate out.
  const workingDays = quotable && p.capacityMode !== "direct" ? scale(total, 1 / (p.focus * p.availability)) : null;
  const weeks = quotable ? scale(total, 1 / perWeek) : null;
  const sprints: Range | null = quotable ? [Math.ceil(total[0] / capacity), Math.ceil(total[1] / capacity)] : null;
  const bandMismatch = quotable && p.program !== "integration" ? total[1] < band![0] / 2 || total[0] > band![1] * 2 : null;
  return { modules, rtl, documentation, overheads, contingency, total, remaining, unestimated, architectureGaps, capacity, workingDays, weeks, sprints, band, bandWeeks, bandMismatch, unallocated: plus(scale(unassigned, 1 + p.contingency), overheads), cardCount: cards.length };
}
export function sprintLoads(w: Workspace, projectId: string) {
  const p = w.projects.find(p => p.id === projectId)?.planning ?? defaultPlanning();
  const capacity = estimateProject(w, projectId).capacity;
  const groups = new Map<number, { sprint: number; ied: Range; cards: number; architectureGap: boolean; unestimated: number }>();
  for (const c of projectCards(w, projectId)) {
    if (!c.effort || c.effort.sprint === null) continue;
    const n = c.effort.sprint, e = estimateModule(c.effort);
    const g = groups.get(n) ?? { sprint: n, ied: [0, 0], cards: 0, architectureGap: false, unestimated: 0 };
    g.ied = plus(g.ied, scale(e.ied, 1 + p.contingency)); g.cards++; g.architectureGap ||= e.architectureGap;
    if (e.ied[1] === 0) g.unestimated++;
    groups.set(n, g);
  }
  return [...groups.values()].sort((a, b) => a.sprint - b.sprint).map(g => ({ ...g, capacity, overloaded: g.ied[1] > capacity }));
}
export type CapacitySource = "derived" | "direct" | "overridden";
export interface SprintCard { card: Card; estimate: ModuleEstimate }
export interface SprintGroup { sprint: number; capacity: number; capacitySource: CapacitySource; ied: Range; cards: SprintCard[]; architectureGap: boolean; unestimated: number; verdict: "within" | "over" | "not quotable" }
export function sprintBoard(w: Workspace, projectId: string): { sprints: SprintGroup[]; unassigned: Card[] } {
  const project = w.projects.find(p => p.id === projectId); const p = project?.planning ?? defaultPlanning();
  const baseCapacity = 5 * p.sprintWeeks * capacityPerWorkingDay(p);
  const groups = new Map<number, SprintCard[]>(); const unassigned: Card[] = [];
  for (const c of projectCards(w, projectId)) {
    if (!c.effort) continue;
    if (c.effort.sprint === null) { unassigned.push(c); continue; }
    const list = groups.get(c.effort.sprint) ?? []; list.push({ card: c, estimate: estimateModule(c.effort) }); groups.set(c.effort.sprint, list);
  }
  const sprints = [...groups.keys()].sort((a, b) => a - b).map(n => {
    const list = groups.get(n)!;
    let ied: Range = [0, 0]; let architectureGap = false; let unestimated = 0;
    for (const { estimate } of list) { ied = plus(ied, scale(estimate.ied, 1 + p.contingency)); architectureGap ||= estimate.architectureGap; if (estimate.ied[1] === 0) unestimated++; }
    const override = p.sprintOverrides?.[String(n)];
    const capacity = override ?? baseCapacity;
    const capacitySource: CapacitySource = override !== undefined ? "overridden" : p.capacityMode === "direct" ? "direct" : "derived";
    const verdict: SprintGroup["verdict"] = architectureGap || unestimated ? "not quotable" : ied[1] > capacity ? "over" : "within";
    return { sprint: n, capacity, capacitySource, ied, cards: list, architectureGap, unestimated, verdict };
  });
  return { sprints, unassigned };
}
export function setSprintOverride(w: Workspace, projectId: string, sprint: number, capacity: number | null) {
  const project = w.projects.find(p => p.id === projectId); if (!project) throw new Error("Project not found");
  if (!project.planning) throw new Error("Enable project planning first");
  if (!Number.isInteger(sprint) || sprint < 1) throw new Error("Sprint must be a positive integer");
  const overrides = { ...(project.planning.sprintOverrides ?? {}) };
  if (capacity === null) delete overrides[String(sprint)]; else { number(capacity, 0, 1e6); overrides[String(sprint)] = capacity; }
  project.planning = { ...project.planning, sprintOverrides: overrides };
}
export function setCardSprint(w: Workspace, cardId: string, sprint: number | null) {
  const c = w.cards.find(c => c.id === cardId); if (!c?.effort) throw new Error("Estimate this card before assigning a sprint");
  if (sprint !== null && (!Number.isInteger(sprint) || sprint < 1)) throw new Error("Sprint must be a positive integer");
  editCard(w, cardId, { effort: { ...c.effort, sprint } });
}
