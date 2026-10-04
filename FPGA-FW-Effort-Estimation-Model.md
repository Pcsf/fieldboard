---
tags:
  - fpga
  - fpga/estimation
  - professional/planning
created: 2026-07-18
---
**Summary:** The canonical effort-estimation model for FPGA firmware work: size discrete blocks in Ideal Engineering Days (IED) from baseline tables, apply per-module multiplicative correction factors, add flat platform overheads and contingency, then derate into calendar time and sprints. Merged from two shared reference documents with their internal inconsistencies fixed.

**Details:**

## The unit: Ideal Engineering Day (IED)

1 IED = 6–7 hours of uninterrupted, flow-state engineering by an experienced digital designer focused exclusively on the task. IED measures *work volume*, decoupled from availability, meetings, tool turnaround, and FTE. Calendar conversion happens at the end (see "IED to calendar" below).

## Table 1 — Baseline effort by task type (nominal complexity)

Baselines assume a single synchronous clock domain, a mature spec, and standard self-checking directed testbench verification. RTL and verification are split because the verification factor applies only to verification (see the formula).

| Task type                                                                                                                 | RTL (IED) | Verif (IED) | Total (IED) |
| ------------------------------------------------------------------------------------------------------------------------- | --------- | ----------- | ----------- |
| Register map, auto-generated (SystemRDL/CSV → AXI-Lite)                                                                   | 0.5       | 0.5         | 1.0         |
| Hand-written register bank / [[CSR-Is-the-Control-and-Status-Register-Bank\|CSR]] with decode logic                       | 2.0       | 1.5         | 3.5         |
| Standard FSM controller (5–10 states, sequencing/handshakes)                                                              | 2.0       | 2.0         | 4.0         |
| Complex hierarchical / multi-engine FSM (>15 states)                                                                      | 4.0       | 4.0         | 8.0         |
| Simple 2-FF / pulse synchronizer + constraints                                                                            | 0.5       | 0.5         | 1.0         |
| Async FIFO / handshake / Gray-code crossing                                                                               | 1.5       | 2.0         | 3.5         |
| Dynamic clock switching / PLL reconfiguration logic                                                                       | 2.5       | 2.5         | 5.0         |
| Fixed-point FIR/IIR filter pipeline (standard coeffs)                                                                     | 2.0       | 2.0         | 4.0         |
| Algorithmic datapath (CORDIC, FFT, matrix engine)                                                                         | 5.0       | 5.0         | 10.0        |
| Python/MATLAB bit-accurate golden reference model                                                                         | —         | 3.0         | 3.0         |
| **Vendor IP integration incl. fidelity verification** (configure, stub parity TB, real-IP capture, IP-grounded profiling) | 3.0       | 4.0         | 7.0         |
| Low-speed controller (SPI, I2C, UART) from scratch                                                                        | 1.5       | 1.5         | 3.0         |
| High-speed vendor IP wrapper (PCIe, 10GbE, Aurora, AXI-DMA)                                                               | 3.0       | 3.0         | 6.0         |
| External memory controller integration (DDR4/5 MIG wrapper)                                                               | 4.0       | 4.0         | 8.0         |
| Custom high-speed ADC/DAC SERDES framing interface                                                                        | 4.0       | 5.0         | 9.0         |
| Top-level structural RTL / block-design wiring                                                                            | 2.0       | 3.0         | 5.0         |
| Pinout, IO standards, primary clock constraints                                                                           | 1.5       | 1.0         | 2.5         |
| **Debug of existing / legacy design** (reproduce, root-cause, fix)                                                        | —         | —           | 2–10        |
| **Timing closure beyond initial pass** (as distinct task)                                                                 | —         | —           | 2–8         |

The bolded rows (vendor-IP fidelity, legacy debug, closure-beyond-initial) were added to the source documents: they are the highest-variance lines in real ASML-style work and have no baseline in the originals.

## Table 2 — Correction factors (per module)

Apply to the module, not the whole project. Baseline conditions = 1.00.

| Dimension                                                        | Condition                                      | C         |
| ---------------------------------------------------------------- | ---------------------------------------------- | --------- |
| Spec                                                             | Mature / frozen                                | 1.00      |
|                                                                  | Minor gaps, evolving parameters                | 1.25      |
|                                                                  | Concept stage / algorithm in flux              | 1.60–2.00 |
| Clock & CDC                                                      | Single clock domain                            | 1.00      |
|                                                                  | 2–3 related/synchronous clocks                 | 1.15      |
|                                                                  | ≥3 asynchronous domains                        | 1.35–1.60 |
| Timing & utilization                                             | LUT/BRAM/DSP <65%, f_clk <60% limit            | 1.00      |
|                                                                  | 65–80% or tight setup paths                    | 1.25      |
|                                                                  | >80% or high-frequency                         | 1.60–2.20 |
| Code reuse                                                       | Clean sheet                                    | 1.00      |
|                                                                  | In-house verified IP, parameterized            | 0.30–0.50 |
|                                                                  | Untrusted legacy / 3rd-party RTL               | 1.30–1.50 |
| Verification rigor — **applies to the verification column only** | Basic directed sanity TB                       | 0.80      |
|                                                                  | Self-checking directed TB, full edge cases     | 1.00      |
|                                                                  | Constrained-random (UVM/UVVM/OSVVM) + coverage | 1.50–1.80 |

**Cap the combined multiplier at ~4.0.** Beyond that the number is an architecture gap, not an estimate — flag the spec and don't quote hours.

## Formula (fixed)

```text
Module effort_k  = (RTL_k + Verif_k × C_verif,k) × C_spec,k × C_clk,k × C_util,k × C_code,k
Project total    = Σ_k Module effort_k × (1 + contingency) + platform overheads
Contingency      = 20–30% for defined scope; 30–50% at concept stage
```

Fixes vs. the source documents: (1) C_verif no longer double-counts RTL — it multiplies only the verification column, since the baseline total already contains a unit-verification figure; (2) factors are applied per module, so a single-domain register bank does not pay the project's CDC factor; (3) contingency is explicit, because the flat baseline sum silently assumes both no risk and no parallelism.

## Table 3 — Fixed platform & lifecycle overheads

Added to the project total; they scale with system complexity, not per module.

| Activity                                              | IED             |
| ----------------------------------------------------- | --------------- |
| Build system / CI automation                          | 2–4             |
| Initial timing closure pass                           | 3–8             |
| Hardware bring-up spike (ILA/SignalTap, probing, lab) | 4–10            |
| Documentation (register manual, block diagrams)       | 10% of RTL time |

Bring-up is the single most variance-prone line — always price the full 4–10 range, never the low end, and never hide the overrun in the final sprint (one of the source documents' worked examples budgeted 2.0 IED and silently carried a 3.0 IED spike; do not copy that).

## Worked example A — 8-channel FIR pipeline (new design)

AXI4-Stream datapath, AXI-Lite coefficient register map, 100 MHz control / 250 MHz DSP, mostly clear spec with minor gaps, self-checking TB + Python golden model, medium utilization, greenfield.

| Module                                                                 | Baseline | C applied                  | Adjusted (IED) |
| ---------------------------------------------------------------------- | -------- | -------------------------- | -------------- |
| Python golden model                                                    | 3.0      | ×1.25 spec                 | 3.75           |
| Hand-written [[CSR-Is-the-Control-and-Status-Register-Bank\|CSR]] bank | 3.5      | ×1.25 spec (single domain) | 4.38           |
| Async FIFO CDC bridge                                                  | 3.5      | ×1.25 spec ×1.35 CDC       | 5.91           |
| FIR datapath + AXI-Stream wrapper                                      | 4.0      | ×1.25 spec ×1.35 CDC       | 6.75           |
| **Sum**                                                                | 14.0     |                            | **20.8**       |

- Contingency 25% → 26.0
- Overheads: documentation ≈ 2.0, bring-up spike 7.0 (mid of 4–10) → 9.0
- **Total ≈ 35 IED** → 35 / (0.65 × 0.85) = 35 × 1.81 ≈ 63 working days → **~12.7 weeks at 1.0 dedicated FTE** (≈ 6–7 sprints at 5.5 IED/sprint capacity). The 1.81 factor is 1/(η_focus × η_avail) = 1/0.5525 — the inverse derating: 1 IED of ideal focus ≈ 1.81 actual working days. η_team is deliberately excluded here; it enters only in the staffing scenarios below.

Per-module discipline: the [[CSR-Is-the-Control-and-Status-Register-Bank|CSR]] bank paid only the spec factor; the CDC factor is charged only to the FIFO and the DSP-side datapath. The source document's global-multiplier method would have overcharged the register bank.

## Worked example B — Cyclone IV → Cyclone 10 port (EOL migration)

Port an existing element: hand-written [[CSR-Is-the-Control-and-Status-Register-Bank|CSR]] block, 8-state sequencer FSM, AXI bridge. Spec frozen (mature), single domain, tight setup paths on the new device, untrusted legacy RTL to reverse-engineer first.

| Module                                                    | Baseline          | C applied                | Adjusted (IED) |
| --------------------------------------------------------- | ----------------- | ------------------------ | -------------- |
| [[CSR-Is-the-Control-and-Status-Register-Bank\|CSR]] bank | 3.5               | ×1.4 legacy ×1.25 timing | 6.1            |
| Sequencer FSM                                             | 4.0               | ×1.4 legacy ×1.25 timing | 7.0            |
| AXI bridge                                                | 6.0               | ×1.4 legacy ×1.25 timing | 10.5           |
| Legacy debug / reverse-engineering                        | 5.0 (mid of 2–10) | ×1.4 legacy              | 7.0            |
| **Sum**                                                   |                   |                          | **30.6**       |

- Contingency 25% → 38.3
- Overheads: initial timing closure on new device 5.0 (3–8), bring-up 7.0, documentation ≈ 2.0 → 14.0
- **Total ≈ 52 IED** → ~94 working days → **~19 weeks at 1.0 FTE (~4.5 months)**.

This is why EOL migrations always slip when quoted as "it's just a port": the legacy-debug baseline and the new-device timing factor are not in the original scope line, but they are half the cost.

## IED to calendar

Three cascaded derating factors:

```text
Working days (WD)  = Total IED / (η_focus × η_avail)
Calendar weeks     = WD / (5 × N_FTE × η_team)
```

| Factor  | Value                                                                                        | Meaning                                                                   |
| ------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| η_focus | 0.65 nominal (0.60–0.70)                                                                     | EDA tool turnaround, lab contention, standups/reviews erode a nominal day |
| η_avail | 0.85 standard; 0.75 in Q3/Q4                                                                 | Holidays, PTO, training, sick days                                        |
| η_team  | 1.00 (1 dedicated senior); 0.80 (0.5 FTE split); 0.75 (2 × 0.5 FTE); 0.85–0.90 (2 × 1.0 FTE) | Context-switching tax and Brooks's-law handoff cost                       |

**Rule of thumb:** a fully dedicated 1.0 FTE delivers **5–6 IED per 2-week sprint**. Quick conversion: **1 IED ≈ 1.8 working days ≈ 0.09 FTE-month**.

Scenario comparison for example A (35 IED, 63 WD):

| Staffing | Effective WD/day | Duration |
|---|---|---|
| 1.0 FTE dedicated (η 1.00) | 1.00 | 12.7 weeks |
| 0.5 FTE split (η 0.80) | 0.40 | ~32 weeks (~7.5 months) |
| 2 × 1.0 FTE (η 0.85) | 1.70 | ~7.4 weeks |

Slicing example A across sprints at 5.5 IED/sprint (6–7 sprints total):

1. Golden model (3.75) + [[CSR]] RTL start (~1.7)
2. [[CSR]] done + verification (~2.6) + async FIFO RTL (~2.5)
3. FIFO verification (~3.4) + FIR RTL start (~2.1)
4. FIR datapath done + wrapper (~4.5)
5. Integration TB + golden-vector sweep (~5.0)
6. Initial synthesis/timing pass (~4.5) + documentation (1.0)
7. Bring-up spike — **budgeted explicitly at 4–10 IED; this is the buffer, not an afterthought**

If bring-up exceeds budget, the schedule absorbs it here — do not borrow from sprints 1–6.

## Calibration loop (make it *your* table)

After each completed task, log: requested scope → baseline chosen → factors applied → estimate IED → actual IED → which factor was missed. Use the template at `template/IED-Estimate-Log-Template.md` (one note per task, linked from here). After ~10 tasks, replace the generic multipliers with measured ones. The log doubles as interview evidence: "I estimated X, delivered in Y, here's why" is a Principal-level story, not just bookkeeping.

**Calibration log:**
- (empty — first entry goes here)

**Action Items:**
- [ ] Log the first real estimate into the calibration log as it comes in.

---
*Related: [[FPGA-Project-Effort-Estimation-Top-Level]] (whole-program bands — use this one first), [[ASML-Element-Design-Specification-EDS-Guide]], [[Design-Iteration-and-Exponential-Cost-of-Change]], [[Test-Vee-Every-Design-Level-Has-A-Test-Level]]*
