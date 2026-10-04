# Fieldboard implementation and verification contract

Scope: Tier 1 from `PROMPT.md`, plus mandatory deployment, storage, migration, snapshot, Markdown-security and performance requirements. Tier 2 and Tier 3 remain deferred except for the explicitly requested IED planning extension. This ledger was created before implementation.

## Effort estimation integration

Requested goal: “check the notes under "Effort estimation & planning" in MOC-FPGA at my vault and integrate the methodology of effort estimation and planning in the current kanban web app projet in the current workspace.” Follow-up: “they are copied to this workspace”.

Phase: automated verification passed; visual/desktop acceptance deferred. Progress: 6/6 new functional claims verified within the declared automated probes. The two copied FPGA estimation notes are the source; no vault write is authorized. This request adds bounded planning functionality despite the older tier sequencing constraint. Other deferred features remain deferred.

| ID | Claim | Falsifier / probe | Status |
|---|---|---|---|
| E01 | Module IED uses split RTL/verification baselines, module-local factors and an architecture gate above effective multiplier 4 | planning tests: baseline catalog, formula, ranges, threshold | Verified: `evidence/planning-tests.txt`; all 19 splits, independent-range corner case and threshold probes. |
| E02 | Project totals add contingency once, overhead ranges and adjusted-RTL documentation; calendar and sprint capacity use focus, availability, FTE and team efficiency | planning tests: exact totals, staffing, incomplete scope, sprint overload | Verified: `evidence/planning-tests.txt`; zero-sized tasks cannot produce a quote or a safe sprint verdict. |
| E03 | Whole-program bands apply only top-level maturity, distinguish additive integration, and warn on unexplained divergence | planning tests: bands, maturity, factor-of-two check | Verified: `evidence/planning-tests.txt`; coarse scoping weeks remain distinct from detailed completeness. |
| E04 | Calibration retains estimate inputs and actual effort; planning fields validate and survive audit, undo, storage, snapshots and backups | planning/storage tests: malformed inputs and round trips | Verified: `evidence/planning-tests.txt`; failed-write recovery, frozen calibration, history validation, snapshot and fresh-store round trips. |
| E05 | Existing cards, unitless estimates and source notes remain unchanged until explicit planning edits; no runtime network dependencies | baseline suite, compatibility tests, artifact check, source checksums | Verified: original 43-test baseline, full regression run, legacy estimate browser assertion, artifact probes and unchanged hashes in `evidence/planning-source-checksums.txt`. |
| E06 | Card estimation and project planning are reachable through delivered-file controls, with retained drafts and visible save failures | isolated browser assertions; faithful visual review separately deferred | Verified for asserted offline controls, reload, backup, invalid drafts, denial and hostile-text escaping in `tests/planning-browser.test.ts`. Appearance and motion remain [DEFERRED-VERIFY]. |

Decisions: Keep legacy unitless estimates separate. Planning fields are optional additive schema-2 fields, validated wherever cards occur (including history). Archived cards remain in the program scope to avoid shrinking estimates on completion; deleted cards do not. Report unestimated cards rather than interpreting them as zero. Use the notes' formulas, not rounded or inconsistent worked-example arithmetic. Combined multiplier means adjusted module total divided by baseline total; refuse quotes above 4 rather than silently clipping. Project capacity is a staffing scenario, not a dependency-aware promised finish date. Sprint assignments are numbered allocations, not the deferred full sprint lifecycle. Module contingency follows sprint allocations; overheads and unassigned module effort remain explicitly unallocated. Coarse top-level scenarios are labelled separately from detailed calendar quotes. Zero-sized defaults count as unestimated. The architecture gate checks the worst effective multiplier over independent ranges, including zero lower bounds.

## Source-label fidelity

Follow-up request: “please preserve the names as stated in the notes”. Baseline, program-type, spec-maturity and platform-activity names now retain the source wording and qualifiers, stripping only Markdown emphasis and Obsidian link markup. IDs, numeric defaults, formulas and stored data are unchanged. The separate custom-baseline option remains available.

Verified by source-table comparisons in `tests/planning-labels.test.ts` and delivered-file option/label assertions in `tests/planning-browser.test.ts`. All three source-label checks failed before the correction (`evidence/planning-labels-red.txt`). Source-note checksums remain unchanged. Faithful appearance verification remains deferred.

## Current verdict

`bun run build` passed strict TypeScript checking and emitted only `dist/fieldboard.html` (90,181 bytes). The latest declared `bun test` verdict is **65 pass, 0 fail**, with 341 assertions across nine files. Source: `evidence/planning-labels-build.txt` and `evidence/planning-labels-tests.txt`. The pre-extension same-session baseline was 43 pass, 0 fail (`evidence/planning-baseline.txt`).

**Release acceptance remains open.** A green implementation suite does not establish normal unflagged desktop-browser operation, physical 60 fps behavior or every-feature-red-first provenance.

| ID | Binary claim | Named probe | Verdict and boundary |
|---|---|---|---|
| C01 | Build emits one self-contained HTML artifact | tests/artifact.test.ts | Verified, declared. Also checks the embedded script’s CSP hash. Original missing-artifact failure recorded. |
| C02 | New projects have the required default columns | tests/model.test.ts: project | Verified, declared; observed failing against the API scaffold. |
| C03 | Column operations preserve card ownership | tests/model.test.ts: columns; browser: columns | Verified, declared. Populated deletion explicitly chooses a destination. |
| C04 | Card mutations retain complete activity history | tests/model.test.ts: lifecycle | Verified for create, edit, move, archive, restore, delete and positional neighbours. Declared. |
| C05 | Done-column transitions maintain completedAt | tests/model.test.ts: completion; browser: columns | Verified, declared. Enter, leave and column-flag changes covered. |
| C06 | Undo retains prior audit history | tests/model.test.ts: undo; browser lifecycle | Verified, declared. Historical-member regression was observed red before its fix. |
| C07 | Combined filters round-trip through the fragment | tests/model.test.ts: filters; browser lifecycle | Verified, declared. Model covers AND semantics; direct-file UI covers search, priority and fragment reload. |
| C08 | Backup validation rejects malformed workspaces before replacement | tests/model.test.ts: backup; browser invalid restore | Verified, declared. Unknown schemas, malformed fields and broken references covered. |
| C09 | Markdown cannot emit executable or remote-loading markup | tests/model.test.ts: Markdown; browser security | Verified for the malicious fixtures and allowlisted renderer, declared. Not a universal proof of all security properties. |
| C10 | IndexedDB acknowledges only completed strict transactions | tests/storage.test.ts; browser lifecycle/crash | Verified for the tested strict-mode transactions, declared. No hardware-power-loss certification. |
| C11 | Failed writes cannot hide lost drafts behind Saved | tests/storage.test.ts: journal/denial/ownership/crash window; browser quota/denial/text/second tab | Verified for enumerated failure paths, declared. Actual localStorage exhaustion and injected IndexedDB quota errors covered. |
| C12 | A populated prior schema migrates without losing entities | tests/storage.test.ts: migration | Verified against the version-1 fake-IndexedDB fixture, declared. Built-file migration from a deployed older profile remains open. |
| C13 | Daily snapshots retain the last seven dates | tests/storage.test.ts: snapshots; browser daily snapshots | Verified, declared. Browser clock advances exercise catch-up, retention and UI restoration. Browser supplement was first observed passing after implementation. |
| C14 | Isolated offline file launch supports Tier 1 interactions | tests/browser.test.ts: offline lifecycle and supplemental scenarios | Verified within the Chromium container boundary, declared. Broader per-feature visual and red-first acceptance remains open. |
| C15 | Card lifecycle mutations survive fresh reloads | tests/browser.test.ts: lifecycle | Verified for create, edit, move, archive, restore and delete, declared. |
| C16 | Drag order survives a browser process restart | tests/browser.test.ts: restart | Verified, declared. Actual drag, shutdown, same-profile/path reopen. |
| C17 | An interrupted transaction preserves acknowledged state atomically | tests/browser.test.ts: crash | Verified for a held strict transaction interrupted by SIGKILL of the browser PID, declared. |
| C18 | JSON recovery preserves workspace entities in a fresh profile | tests/browser.test.ts: backup | Verified, declared. Includes live subtasks, comments, labels, assignments and retained deleted-card activity. Local concurrency revision is intentionally reassigned. |
| C19 | One standard Linux browser passes without special flags | normal desktop-browser launch and full direct-file suite | **Open.** Root container requires a Playwright sandbox exception. Chromium 152.0.7977.82 was tested; normal desktop acceptance was unavailable. |
| C20 | Delivered-file screenshots document visual states | evidence/01–07 PNG captures from browser tests | Capture provenance verified, declared. These are real isolated-file screenshots, not development-server captures. Faithful visual/motion certification remains unavailable. |
| C21 | A 1,000-card board meets the specified performance bounds | tests/browser.test.ts: performance; physical-laptop scrolling probe | **Open.** Latest headless move acknowledgment is below 100 ms and drag feedback below 50 ms. Physical 60 fps scrolling is unmeasured. See performance.json for actual values. |
| C22 | README documents usage and deployment limits | tests/docs.test.ts; README/DECISIONS file review | Verified for documented commands, data model, tier scope, dependencies, licences, backup path and explicit acceptance gaps. |

## Red-first provenance

Planning extension: `planning-red.txt` records the absent calculation module before implementation; this is an API-presence failure, not individual arithmetic red-first proof. `planning-ui-red.txt` records the missing delivered-file control. `planning-docs-red.txt` records missing usage documentation. `planning-zero-red.txt`, `planning-scoping-red.txt`, `planning-sprint-zero-red.txt` and `planning-range-red.txt` record specific behavioral failures before their fixes. Supplemental catalog/security assertions passed on first execution; they are not retrospective red-first evidence. All files are under `evidence/`.

- `evidence/initial-red.txt`: missing deployment artifact and source/build entry points.
- `evidence/domain-red.txt`: 17 domain/storage tests failed against explicit unimplemented API scaffolds before behavior was written.
- `evidence/denial-red.txt`: two distinct false-Saved paths failed before correction.
- `evidence/review-red.txt` and `review-ui-red.txt`: historical-member undo, recovery-journal ownership, commit/bookkeeping crash window, failed-text preservation, duplicate undo handler and multi-tab editing regressions.
- `evidence/autosave-red.txt`: existing column settings required an explicit apply action before the autosave correction.
- The performance probe failed its 100 ms bound before keyed DOM reconciliation and redundant-copy reductions. Earlier Chromium temporary-space exhaustion was a separate runner failure; test-owned temporary storage now uses the project filesystem.
- Strict configuration, dependency-pinning and documentation tests were also observed failing before their corresponding changes.

The initial `package.json` and lockfile were created before their checks. Supplemental browser coverage for columns, snapshots, actual journal quota exhaustion, richer backup fixtures and artifact hardening was not uniformly observed red before the original implementation. These are passing checks, not retrospective red-first proof. The prompt’s strict per-feature provenance gate is therefore not closed.

## Safety review scope

The review enumerated five concrete defect classes: competing journal writers, the commit/bookkeeping crash gap, text-journal failure followed by unrelated edits, removal of historical actors during undo, and duplicate keyboard binding after snapshot startup failure. Each has a regression probe and a passing result in the final suite. Separate IndexedDB-unavailable, stale-revision, raw-draft denial and actual localStorage-quota paths are also covered.

The built-in faithful visual verifier is unavailable. Browser test automation here establishes the explicitly asserted behavior only. Firefox, other profiles/file identities, actual IndexedDB quota exhaustion, physical-device motion and unflagged desktop browser acceptance remain unverified. No Tier 2 or Tier 3 feature was started to substitute for these open gates.
