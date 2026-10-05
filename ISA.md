---
phase: complete
progress: 32/33
principal_stated_goal: "start working on /tmp/fieldboard-tier3-handoff.md"
---

# Fieldboard implementation and verification contract

Scope: Tier 1 from `PROMPT.md`, plus mandatory deployment, storage, migration, snapshot, Markdown-security and performance requirements. The IED planning extension was added on request. Release 2 (below) brings Tier 2, themes, responsive layout and milestones into scope.

## Release 2: Tier 2, themes and milestones

Stated goals, in order: *"yes do it and also start implementing it"* (milestones, from the vault note "kanban (fieldboard) improvement idea", 2026-10-05), then *"start working on Tier 2 and bring the Polish one to the Tie 2 scope. I would like to have light/dark themes in the next release."*

Vision: the board stays a pull-based kanban. Planning views (milestones, calendar, timeline) are lenses over the same cards, never a second source of truth, and none of them claims a dependency-aware delivery schedule. Themes make the app comfortable at night without losing any status colour meaning.

Polish scope: themes and responsive layout were shown to the principal and are in. Accessibility (WCAG AA, full keyboard), card covers and colours, and focus mode were omitted from the list shown. They stay out until he confirms them. Offline operation is already mandatory from Tier 1.

Every new field is an optional, additive schema-2 field, like the IED fields. Existing workspaces load unchanged.

| ID | Claim | Falsifier / probe | Status |
|---|---|---|---|
| R01 | Theme follows `prefers-color-scheme` by default; a manual System/Light/Dark override persists across reload and backup | browser: emulate dark and light media, toggle override, reload; model: settings validation | Verified: `tests/theme.test.ts`, `tests/theme-browser.test.ts` |
| R02 | Dark theme keeps every status colour (overdue, soon, priority, WIP, blocked, errors) distinguishable at WCAG AA text contrast | contrast check over the theme token table; viewed screenshots of both themes | Verified for existing status colours: `tests/theme-contrast.test.ts`; dark render confirmed by computed-style probe and viewed screenshots |
| R03 | Projects hold dated milestones; a card belongs to at most one milestone of its own project | Verified: `tests/milestones.test.ts`, `tests/milestones-browser.test.ts` |
| R04 | Milestone overview shows each milestone's date, done/total cards, remaining IED and whether remaining effort fits the capacity before the date | Verified: `tests/milestones.test.ts` (fit includes module contingency), `tests/milestones-browser.test.ts` |
| R05 | Column WIP limits: header shows `n / limit`, amber at the limit, red above; exceeding is allowed | model + browser: set limit, add cards past it, read classes | Verified: `tests/flow.test.ts`, `tests/flow-browser.test.ts` |
| R06 | A card can be marked blocked with a reason, renders distinctly and can be filtered | model + browser: block, filter, reload | Verified: `tests/flow.test.ts`, `tests/flow-browser.test.ts` |
| R07 | Card dependencies: a card blocked by an unfinished card shows that on its face; self-reference and unknown references are rejected; deleting a card removes it from dependents | model tests; browser face assertion | Verified: `tests/flow.test.ts` (cycles, cross-project, delete cleanup), `tests/flow-browser.test.ts` |
| R08 | Epics: a card can parent other cards and shows aggregate child progress; no parent cycles | model tests; browser face assertion | Verified: `tests/flow.test.ts` (parent cycles, delete clears children), `tests/flow-browser.test.ts` |
| R09 | Swimlanes group a board by assignee, priority, label or epic; dragging between lanes changes that attribute | model + browser drag | Verified: `tests/swimlanes.test.ts`, `tests/swimlanes-browser.test.ts` (red: `evidence/swimlanes-browser-red.txt`) |
| R10 | A project can hold several boards (add, rename, delete with destination); "My Work" lists every card assigned to the acting member across projects, grouped by due date | model + browser | Verified: `tests/boards.test.ts`, `tests/my-work.test.ts`, `tests/boards-browser.test.ts`, `tests/my-work-browser.test.ts` (browser tests not red-first) |
| R11 | Card templates (description + subtasks) and board templates (columns + WIP limits) can be saved and reused | model + browser | Verified: `tests/boards.test.ts`, `tests/boards-browser.test.ts` (browser test not red-first) |
| R12 | Keyboard: `n` new card, `/` search, `e` edit, `←/→` move, `j/k` navigate, `?` cheatsheet | browser key presses with persisted-state assertions | Verified: `tests/keyboard.test.ts`, `tests/speed-browser.test.ts` |
| R13 | `Ctrl+K` command palette fuzzy-reaches projects, boards, cards and actions | unit test on the matcher; browser open, type, Enter | Verified: `tests/palette.test.ts`, `tests/speed-browser.test.ts` |
| R14 | Bulk actions: shift/ctrl-click multi-select, then move, label, assign or archive together, as one undo step | browser + persisted state | Verified: `tests/boards.test.ts`, `tests/bulk-browser.test.ts` (browser test not red-first) |
| R15 | Quick-add `Fix login #bug @paulo !high ^friday` creates the card with label, assignee, priority and due date | parser unit tests incl. unknown member and bad date; browser inline add | Verified: `tests/quickadd.test.ts`, `tests/quickadd-model.test.ts`, `tests/speed-browser.test.ts` |
| R16 | List view shows the board's cards as a sortable, groupable table | browser sort/group assertions | Verified: `tests/list-view.test.ts`, `tests/list-view-browser.test.ts` (red: `evidence/list-view-browser-red.txt`) |
| R17 | Calendar view places dated cards on a month/week grid; dropping a card on a day changes its due date | browser drag + persisted state | Verified: `tests/calendar-model.test.ts` (month/week grids, leap years, Monday-first weeks, placement), `tests/calendar-browser.test.ts` (drag onto a day, persisted `dueDate` after reload; red: `evidence/calendar-view-browser-red.txt`; screenshot `evidence/calendar-view.png`) |
| R18 | Timeline view draws cards with start and due dates as bars, with dependency arrows | browser: bar geometry and arrow count | Verified: `tests/timeline-model.test.ts` (bar geometry, row order, grouping, arrow endpoints, conflict flag and date-axis ticks on fixed fixtures), `tests/timeline-browser.test.ts` (bar `data-start-offset`/`data-span`, arrow count and `.conflict` class, date-axis week label, chart-fills-panel width ratio, bar `title`/z-index above arrows; red: `evidence/timeline-view-browser-red.txt`; screenshots `evidence/timeline-view.png`, `evidence/timeline-view-dark.png`); `startDate` validation: `tests/model.test.ts` |
| R19 | Phone width (390 px): no page-level horizontal scroll, the board scrolls horizontally, cards move via a "Move to…" menu | browser at 390×844: scrollWidth checks, move via menu | Verified: `tests/phone-browser.test.ts`, `tests/phone-menu-browser.test.ts` (all sidebar actions behind Menu; red: `evidence/phone-menu-red.txt`) |
| R20 | The release keeps every prior guarantee: single offline HTML, full suite green, existing workspaces load unchanged | `bun run build`, `bun test`, artifact test, schema-2 fixture round trip | Verified: `evidence/release2-build.txt`, 221/221 tests, `tests/release-compat.test.ts` (first-release data and IED numbers unchanged), real Brave via Interceptor: file:// load, storage, project creation and reload persistence; found and fixed view-bar overflow at 900–1020 px (`tests/medium-width-browser.test.ts`, red: `evidence/medium-width-red.txt`) |
| R21 | Sprint capacity can be entered directly in IED per sprint, as an alternative to the derived staffing formula, with per-sprint overrides (holidays, lab weeks) | planning tests: direct mode, override, validation; browser entry + reload | Verified: `tests/planning.test.ts` (direct mode, overrides), `tests/planning-browser.test.ts` |
| R22 | Sprint allocation is reachable from the board as its own view: per sprint, the cards, load vs capacity and the remaining headroom | browser: open view, assert loads and over/under verdicts | Verified: `tests/sprints-browser.test.ts`, `evidence/sprints-view.png` |
| R23 | A custom task gets its IED entered directly (single value or range) without opening a collapsed section | browser: choose Custom, enter IED, result shows it | Verified: `tests/planning-browser.test.ts` (Custom task) |
| R24 | The IED catalog is two-level: a generic work category with a base RTL/verification IED, and a subcategory whose factor multiplies it; categories and subcategories can be added and edited per workspace | planning tests: seeded catalog, add/edit, factor applied once; browser add flow | Verified: `tests/planning.test.ts`, `tests/planning-labels.test.ts` (doc/code parity; red: `evidence/catalog-labels-red.txt`) |
| R25 | Existing estimates and calibration records keep their IED numbers through the catalog change | migration test on a workspace holding every old baseline id | Verified: `tests/planning.test.ts` (all 19 legacy baselines + calibrations unchanged) |

Not red-first, stated: browser tests for R10, R11, R14 and the pure-function tests of R12–R18 were written alongside or after their code; R09, R16, R17 and R18 browser tests were observed red first.

Anti-claims: no claim closes on a test written after its feature was observed passing without saying so; no runtime network access or second file; no planning view writes a date the user did not set; no hand-edited dist output.

## Release 3: milestone burnup and card aging

Stated goal: *"start working on /tmp/fieldboard-tier3-handoff.md"* (2026-10-05). Asked to choose among the handoff's options, the principal picked **Burnup + aging** as the first Tier 3 batch and chose to let the two post-tag visual fixes (`562e416`, `1ac0741`) ride with this batch's release rather than cutting `v0.2.0-rc.2` now.

Vision: two insight lenses from `PROMPT.md` § Tier 3 Insight that need no new history store. The append-only Activity log already holds a full before/after card snapshot for every card change, undo included (`audit()` in `src/model.ts`), so a milestone's past scope and progress can be rebuilt from it. Aging answers "what has been stuck?" on the board itself; burnup answers "is this milestone's scope growing faster than we finish it?" Both stay lenses: they read history, they never write it, and neither claims a delivery date.

Out of scope for this batch: sprint burnup (sprints are numbered allocations without dates), IED-weighted burnup, cumulative flow, cycle/lead time, throughput, and every other Tier 3 item.

| ID | Claim | Falsifier / probe | Status |
|---|---|---|---|
| R26 | A column can carry an optional aging threshold in whole days, set in column settings beside the WIP limit: a positive integer, or empty for off. It is validated like the WIP limit, kept by board templates, and absent on existing workspaces, which load unchanged | model tests: 0, −1, 1.5 and non-numbers rejected; template save/apply round trip; `tests/release-compat.test.ts` green; browser: set, reload, read back | Verified: `tests/aging.test.ts`, `tests/aging-browser.test.ts`, `tests/release-compat.test.ts` (red: `evidence/aging-red.txt`, `evidence/aging-browser-red.txt`); merge `5c86c11`, 236/236 |
| R27 | A card's age is the whole days since it entered its current column: the latest Activity entry whose `after` is in that column and whose `before` is absent or in another column (create, move, board move, column delete, undo). A card with no such entry falls back to `createdAt`. Edits that leave the column unchanged never reset it | model tests on crafted Activity fixtures: edit keeps age, move out and back resets it, history-less card uses `createdAt` | Verified: `tests/aging.test.ts` (edit keeps age, move out and back, undo, `createdAt` fallback, incremental index equals full rebuild); `src/aging.ts` |
| R28 | The card face shows its age only when its column has a threshold, the column is not a done column, and age ≥ threshold: amber from the threshold, red from twice the threshold. It renders on plain and swimlane boards, uses existing theme tokens, and reads at WCAG AA in both themes | browser with seeded old timestamps: badge presence, classes and text per case; screenshots viewed in light and dark at 1024 px | Verified: `tests/aging-browser.test.ts` (plain and swimlane, red: `evidence/aging-browser-red.txt`); amber 7 d and red 14 d/19 d badges viewed in light and dark on a four-week fixture at 1500 px |
| R29 | Aging adds no per-card scan of the Activity log: column entry times come from one index extended incrementally as entries are appended. The 1,000-card move still commits in under 100 ms with thresholds on every column | code read of the index; `tests/browser.test.ts` performance with thresholds enabled | Verified: `agingIndex()` in `src/app.ts` extends from the last processed length; performance test with thresholds on every column and badges asserted rendering, 55–92 ms (red: `evidence/aging-performance-red.txt`) |
| R30 | For each milestone, a daily burnup series runs from the first day any card carried it through today. Scope counts non-deleted cards assigned to it at the end of each day, archived included; done counts those of them in a done column. It is rebuilt from Activity snapshots, using `createdAt`/`completedAt` for cards with no history | model tests over fixture timelines: assign and unassign, archive, delete, undo, column done-flag toggle, card without history | Verified: `tests/burnup.test.ts` (red: `evidence/burnup-red.txt`); pre-history dated from `createdAt` after a 1970-start defect (red: `evidence/burnup-prehistory-red.txt`, fix `bd937e3`) |
| R31 | Today's burnup point equals the milestone row's `done/total` for every milestone | model test across all fixtures; browser assertion against the rendered row | Verified: `tests/burnup.test.ts` today-point test; `tests/burnup-browser.test.ts` row assertion; four-week fixture shows 3/7 on both |
| R32 | The milestone overview draws each milestone's burnup: scope and done lines, a labelled date axis, a count axis, a milestone-date marker, a today marker and a legend, plus a text summary for screen readers. It reads in both themes at 1024 px and at phone width | browser: chart data attributes match the series; screenshots viewed in light and dark at 1024 and 390 px | Verified: `tests/burnup-browser.test.ts` (red: `evidence/burnup-browser-red.txt`, `evidence/burnup-history-red.txt`); `evidence/burnup-{1024,390}-{light,dark}.png` viewed |
| R33 | The release keeps every prior guarantee: single offline HTML, full suite green, existing workspaces load unchanged, and both features checked in real Brave with the test browser closed afterwards | `bun run build`, `bun test`, `tests/release-compat.test.ts`, Interceptor capture, `CloseTestProfile.sh` | **Partly.** Build, 250/250 tests and `tests/release-compat.test.ts` green at `bd937e3`. Real Brave: file load, threshold saved and read back after reload, milestone row and empty burnup state rendered; test browser closed. Aged cards and multi-week history could not be loaded in Brave (restore needs a native `confirm()` the browser-only Interceptor cannot accept), so those views were checked in headless Chromium only |

Anti-claims: the burnup draws no projected, ideal or forecast line and states no completion date; no history field or store is added, since both features are derived; aging never writes to the workspace (only the threshold setting does); no card render scans all activities or all cards; no colour outside the theme tokens, and any new token lands in both byte-identical dark blocks with a contrast check.

Learned: a card whose first Activity entry already had a `before` snapshot was dated to 1970, stretching its burnup across 56 years. Green suites missed it because every fixture began with a create entry; a fixture built for the real-browser check exposed it.

Not yet specified: whether age should count working days instead of calendar days (calendar days for now); whether undoing a move should restore the card's earlier age (for now an undo counts as entering the column).

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
| C19 | One standard Linux browser passes without special flags | normal desktop-browser launch and full direct-file suite | **Partly.** Full suite passes headless with the sandbox enabled as an unprivileged desktop user (Chromium 152.0.7977.82, Bun 1.4.0; `evidence/desktop-sandbox-tests.txt`). The root container still needs the sandbox exception. A normal headed desktop launch is not recorded. |
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

The built-in faithful visual verifier is unavailable. Browser test automation here establishes the explicitly asserted behavior only. Firefox, other profiles/file identities, actual IndexedDB quota exhaustion, physical-device motion and a headed unflagged desktop launch remain unverified. No Tier 2 or Tier 3 feature was started to substitute for these open gates.
