---
tags:
  - fpga
  - fpga/estimation
  - professional/planning
created: 2026-07-18
---
**Summary:** Top-level, first-pass effort bands for whole FPGA firmware programs — coarse enough for scoping conversations and budget requests, before the block-level IED model is run. Use the bands to sanity-check a detailed estimate, not to replace it.

**Details:**

## When to use which level

| Level | Question answered | Tool |
|---|---|---|
| **This note** | "Is this a weeks, months, or quarters program?" | Whole-program bands + spec-maturity multiplier |
| [[FPGA-FW-Effort-Estimation-Model]] | "How many IED per block, what factors, what calendar schedule?" | IED baseline tables, per-module factors, derating |

Rule of thumb: the top-level band should be **±2× the detailed IED result**. If a detailed estimate lands outside that band, one of them has a wrong assumption — trust the one whose assumptions are stated.

## Whole-program bands (senior engineer, 1.0 dedicated FTE, nominal conditions)

| Program type | Scope markers | Effort (IED) | Calendar @ 1.0 FTE |
|---|---|---|---|
| Feature add to existing element | 1–3 new blocks, existing register map extended, no new interfaces | 15–35 | 1–3 months |
| New element, standard interfaces | 3–6 blocks, AXI + register map, 1–2 clock domains, no novel algorithms | 35–70 | 3–6 months |
| New element, novel datapath | Includes CORDIC/FFT/DSP pipeline or SERDES framing, golden model required | 70–120 | 6–10 months |
| EOL device migration of existing element | Port RTL + legacy debug + re-closure on new device | 45–90 | 4–8 months |
| System-level integration (multi-element) | Top-level wiring, cross-element CDC, shared memory map, system bring-up | +30–60 IED on top of element work | +1–3 months |
| Debug / bring-up of unknown or failing system | No known-good baseline | 10–40 | 1–3 months — do not quote a single number |

The bands assume nominal spec (×1.0–1.25), self-checking verification (×1.0), and 25% contingency already inside. They do not include formal verification, compliance, or multi-site deployment — each of those is its own program.

## Spec-maturity multiplier (top-level only)

| Spec state | × |
|---|---|
| Frozen, signed off, measurable limits | 1.0 |
| Mostly clear, parameters shifting | 1.25–1.5 |
| Concept stage, architecture open | 2.0–2.5 |
| "We'll figure it out in design" | don't quote — run the architecture first |

## Quick scoping questions (ask before quoting a number)

1. What's the clock-domain picture? (1 domain vs. ≥3 async changes the answer by ~35–60%.)
2. Is there a bit-accurate reference, or does one need to be built? (+3–10 IED, often overlooked.)
3. What's the verification bar: directed sanity vs. constrained-random + coverage? (×0.8–1.8 on the verification share.)
4. Is the device new, familiar, or EOL-migrating?
5. Who owns the spec, and is it frozen? (The single biggest variance driver.)
6. Is hardware available for bring-up, and is it a shared lab?

## Worked scoping example

*Request: "We need a new element with an FFT-based phase pipeline, AXI-Lite control, running on the 250 MHz DSP clock; spec is mostly written but the error budget is still open."*

- Program type: **new element, novel datapath** → 70–120 IED base
- Spec: error budget open → ×1.5 (concept-stage on the precision part)
- 2 clock domains (control 100 MHz / DSP 250 MHz) → inside the band, no addition
- ×1.5 → **105–180 IED** → quote as **"7–13 months at 1.0 FTE; expect ~9–10 if we hold the error budget in the first sprint"**
- First action: close the precision spec (budget allocation per [[ASML-Element-Design-Specification-EDS-Guide]]) — this converts the ×1.5 back toward ×1.0–1.25 and is the cheapest schedule improvement available.

Contrast with the detailed model: running [[FPGA-FW-Effort-Estimation-Model]] block-by-block on the same scope (FFT datapath 10, golden model 3, [[CSR-Is-the-Control-and-Status-Register-Bank|CSR]] 3.5, FIFO 3.5, top-level 5, overheads ~12, contingency 30%) lands around 65–75 IED pre-multiplier — inside the top-level band after the spec factor, confirming both levels agree.

## Common top-level mistakes

- Quoting a single number without stating the spec state — the spec factor is worth 1.5–2.5× more than any other factor.
- Treating "it's just a port" as a feature add (use the migration band; legacy debug is half the cost).
- Slicing one program into sprints before applying the spec-maturity multiplier — the sprint plan inherits the optimism.
- Excluding bring-up and documentation from the total — they are 15–25% of real program duration.
- Forgetting staffing: the same IED total stretches to ~7.5 months at 0.5 FTE (η_team 0.80), and two engineers don't halve the calendar (η_team 0.85–0.90).

---
*Related: [[FPGA-FW-Effort-Estimation-Model]] (block-level IED model — use after this one), [[ASML-Element-Design-Specification-EDS-Guide]], [[Design-Iteration-and-Exponential-Cost-of-Change]]*
