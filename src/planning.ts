import { editCard, type Card, type Workspace } from "./model";

export type Range = [number, number];
export interface Factors { spec: number; clock: number; utilization: number; reuse: number; verification: number }
export interface Effort {
  baseline: string; rtl: Range; verification: Range; other: Range; factors: Factors;
  scope: string; assumptions: string; sprint: number | null;
}
export interface Planning {
  program: string; maturity: string; contingency: number;
  build: Range; timing: Range; bringup: Range; documentation: number;
  focus: number; availability: number; fte: number; team: number; sprintWeeks: number;
  assumptions: string;
}
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
  return { baseline, rtl: [b?.rtl ?? 0, b?.rtl ?? 0], verification: [b?.verification ?? 0, b?.verification ?? 0], other: b?.other ? [...b.other] : [0, 0], factors: { spec: 1, clock: 1, utilization: 1, reuse: 1, verification: 1 }, scope: "", assumptions: "", sprint: null };
}
export function defaultPlanning(): Planning {
  return { program: "feature", maturity: "frozen", contingency: .25, build: [2, 4], timing: [3, 8], bringup: [4, 10], documentation: .1, focus: .65, availability: .85, fte: 1, team: 1, sprintWeeks: 2, assumptions: "" };
}

function object(x: unknown): Record<string, unknown> { if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("Invalid planning object"); return x as Record<string, unknown>; }
function number(x: unknown, min = 0, max = 1e6): asserts x is number { if (typeof x !== "number" || !Number.isFinite(x) || x < min || x > max) throw new Error(`Planning value must be finite and within ${min}–${max}`); }
function text(x: unknown) { if (typeof x !== "string") throw new Error("Planning text required"); }
function range(x: unknown) { if (!Array.isArray(x) || x.length !== 2) throw new Error("Expected IED range"); number(x[0]); number(x[1]); if (x[0] > x[1]) throw new Error("IED minimum exceeds maximum"); }
export function validateEffort(input: unknown): asserts input is Effort {
  const e = object(input); if (e.baseline !== "custom" && !baselines.some(b => b.id === e.baseline)) throw new Error("Unknown baseline");
  range(e.rtl); range(e.verification); range(e.other); text(e.scope); text(e.assumptions);
  if (e.sprint !== null) { number(e.sprint, 1, 10000); if (!Number.isInteger(e.sprint)) throw new Error("Sprint must be an integer"); }
  const f = object(e.factors); for (const key of ["spec", "clock", "utilization", "reuse", "verification"]) number(f[key], .01, 10);
}
export function validatePlanning(input: unknown): asserts input is Planning {
  const p = object(input);
  if (!programs.some(b => b.id === p.program) || !maturities.some(m => m.id === p.maturity)) throw new Error("Unknown program or spec maturity");
  number(p.contingency, 0, 1); number(p.documentation, 0, 1);
  range(p.build); range(p.timing); range(p.bringup);
  for (const key of ["focus", "availability", "team"]) number(p[key], .01, 1);
  number(p.fte, .01, 1000); number(p.sprintWeeks, .1, 52); text(p.assumptions);
}
export function estimateModule(e: Effort): ModuleEstimate {
  validateEffort(e);
  const f = e.factors; const common = f.spec * f.clock * f.utilization * f.reuse;
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
  const capacity = 5 * p.sprintWeeks * p.focus * p.availability * p.fte * p.team;
  const band = programBand(p);
  const bandWeeks = band && project.planning ? scale(band, 1 / (5 * p.focus * p.availability * p.fte * p.team)) : null;
  const quotable = cards.length > 0 && !!project.planning && unestimated === 0 && architectureGaps === 0 && band !== null;
  const workingDays = quotable ? scale(total, 1 / (p.focus * p.availability)) : null;
  const weeks = workingDays ? scale(workingDays, 1 / (5 * p.fte * p.team)) : null;
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
