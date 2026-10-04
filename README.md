# Fieldboard

A local kanban workspace delivered as one HTML file. Tier 1 is implemented, but the release is **not accepted** against every requirement in `PROMPT.md`. The remaining acceptance limits are listed below. Tier 2 and Tier 3 remain deferred except for the explicitly requested IED estimation and capacity-planning extension below.

External runtime dependencies: zero. The HTML embeds its JavaScript and CSS, uses system fonts, and makes no application network requests. No library, server, account, installation, extension or asset directory is required by the application.

## Open the application

1. Copy `dist/fieldboard.html` to a stable location on your computer.
2. Open it directly in your browser using `file://`. Do not use a private browsing window for durable work.
3. Check the storage indicator. If storage is unavailable, the app shows an error and refuses edits.
4. Create a project and add cards. Download a JSON backup regularly.

The HTML is the application, not the workspace data. It does not rewrite itself. Copying the HTML alone does not move your work.

### Browser verification and release limits

| Browser | Direct-file evidence | Support status |
|---|---|---|
| Chromium 152.0.7977.82, Linux | Automated offline `file://` workflow, browser restart, process crash, backups, quota handling and screenshots | Full suite passes headless on an unprivileged Linux desktop with the Chromium sandbox enabled, and in a root container with `--no-sandbox`; a normal headed launch is not yet recorded |
| Firefox 155.0.1, Linux | Binary available; application acceptance suite not run | Unverified |
| Other browsers, operating systems or profiles | No acceptance evidence | Unverified |

The automated suite passes with Chromium’s sandbox enabled on an unprivileged Linux desktop (Bun 1.4.0; `evidence/desktop-sandbox-tests.txt`). It still runs headless under Playwright’s automation flags, so the mandatory Linux desktop run **without special browser flags remains open** until a normal headed launch is recorded. Do not disable your browser sandbox to use the application. The application itself contains no flag-dependent file access, fetches or server calls.

Additional open checks:

- 60 fps scrolling on a mid-range physical laptop has not been measured. `evidence/performance.json` records the latest headless 1,000-card move and drag-feedback timing, not a physical-device certification. Threshold tests remain enabled.
- Screenshots were captured from the isolated delivered file. Full visual, accessibility and motion review is not certified; the installation’s faithful visual verifier is unavailable.
- Populated schema migration has a fake-IndexedDB automated fixture. A deployed prior-version browser profile migration is not yet certified.
- Tests were written before the core implementation and regression fixes. Some supplemental browser scenarios were first observed passing after implementation. The prompt’s every-feature-red-first requirement therefore remains open. Initial package configuration also preceded its tests; this ordering error was corrected for subsequent work, not retroactively erased.

A passing `bun test` is the declared verdict on the implemented suite. It does not close these untested release claims. No browser test is silently skipped when Chromium is unavailable; the suite fails.

## Use the board

### Projects and columns

Choose **New project**, enter a name and color, then create it. The default board is Backlog → To Do → In Progress → Review → Done. Project settings edit the name, description, color and active/archived status. Archived projects remain reachable in the sidebar.

Use **Add column** to create a column. Its `…` menu renames it, flags its cards as done, moves it left/right, or deletes it. Existing settings persist automatically. Drag a column heading to reorder columns. When the source or target is off screen, scroll until both are visible or use the left/right buttons.

Deleting a populated column requires a destination, including for archived cards. The final column cannot be deleted. Multiple columns may be done columns. Entering one sets `completedAt`; leaving clears it. Changing a column’s done flag updates its cards and records their activity.

### Cards

- **Add at top** or **Add card** opens a title-only input. Enter creates the card; Escape closes the input while retaining its draft.
- Drag a card onto another card to insert before it. Drop on a column’s heading or background to append. Ordering persists.
- Open a card to edit its title, Markdown description, priority, due date and estimate. Text edits save automatically. Labels commit when leaving their input; separate names with commas. Unknown names create project-scoped labels.
- Choose assignees from the workspace’s local members. Add identities or change the activity actor in **Workspace & members**. These are not authenticated accounts.
- Enter adds a subtask. Check it to complete it, or use its × control to remove it. Write a comment and select **Add comment** to publish it locally.
- The **Column** menu moves a card without dragging. **Archive card** hides it. **Archive** on the board restores it. **Delete permanently…** requires confirmation; retained activity still records the deletion.
- Activity shows the actor, action, timestamp and before/after data. Reopen the detail view to refresh its history after editing. Position changes to neighbouring cards also have audit entries.

Card faces show labels, priority, due date, checklist progress, assignee initials and comment count. Dates are interpreted in local time through the end of the due day. Overdue dates are red; dates within 48 hours are amber. Completed cards are not marked overdue.

Markdown supports headings, bold, italics, code, fenced code, lists, blockquotes and HTTP(S) links. Raw HTML is escaped. Images become text placeholders and are never fetched. Opening an external link is a deliberate browser navigation.

### Effort estimation and planning

The planning extension follows the two copied reference notes, `FPGA-FW-Effort-Estimation-Model.md` and `FPGA-Project-Effort-Estimation-Top-Level.md`. They are development references, not runtime dependencies. The notes remain unchanged.

An Ideal Engineering Day (IED) is 6–7 uninterrupted engineering hours. It measures work volume, not elapsed time. Existing values in **Legacy estimate · unitless** remain untouched and never enter IED calculations.

1. Open **Effort & planning** above the board and choose **Enable project planning**. Select the whole-program type and spec maturity. Read the scoping questions and record assumptions. Whole-program bands include 25% contingency already; this setting does not apply contingency again to those bands. The coarse staffing scenario converts the band to weeks even before cards exist, separately from the completeness-gated detailed quote.
2. Open each card and choose **Start IED estimate**. Select one of 19 FPGA baselines or enter a custom range under **Baseline split (IED)**. Record requested scope, assumptions and module-local factors. The verification factor multiplies only the verification share. Changing the split marks it as a custom baseline.
3. Review the project's contingency and platform overheads. Defaults are 25% contingency, build/CI 2–4 IED, initial timing 3–8 IED, bring-up 4–10 IED and documentation at 10% of adjusted RTL effort. Concept scope normally needs 30–50% contingency. If an overhead is already a card, remove its project-level budget and document why to avoid counting it twice.
4. Set focus, availability, allocated FTE, team efficiency and sprint length. The nominal dedicated-engineer scenario provides 5.525 IED per two-week sprint. Half an FTE with team efficiency 0.8 provides 2.21 IED. These are editable planning assumptions, not measurements of productivity.
5. Assign a **Sprint number** on each estimated card. The project table includes each module's contingency and flags loads whose upper bound exceeds capacity. Overheads stay in the explicit unallocated reserve; they are not silently placed in the last sprint. Split oversized work into separately estimated cards. The app does not automatically slice tasks or assign dates.
6. After completing work, enter **Actual IED**, record the missed factor or learning, and choose **Log calibration**. Calibration freezes the current scope, baseline, factors and estimated range alongside the actual effort. Later estimate edits cannot rewrite that observation. Multiple observations on one card are revisions, not additive time entries. The project table shows the latest per task; the card keeps all observations. Review baseline tables after about 10 tasks; the app never changes multipliers automatically.

The implemented equations are:

```text
module IED = (RTL + verification × verification factor + unsplit work)
             × spec × clock × utilization × reuse
project IED = sum(module IED) × (1 + contingency) + platform overheads
weeks      = project IED / (5 × focus × availability × FTE × team efficiency)
sprint IED = 5 × sprint weeks × focus × availability × FTE × team efficiency
```

Unsplit work preserves the 2–10 IED legacy-debug and 2–8 IED beyond-initial-timing ranges, for which the source supplies no RTL/verification split. Documentation uses adjusted RTL before contingency. Ranges propagate through the calculations without replacing them by a midpoint; they are planning bounds, not statistical confidence intervals. The source formulas take precedence over rounded worked examples. Display values round to two decimals; calculations retain full precision.

An effective module multiplier above 4 produces an **Architecture gap**, not a capped estimate. For independent ranges, the gate uses the highest possible effective multiplier. Unestimated cards, zero-sized defaults, an empty project, architecture gaps or undefined top-level specs withhold the calendar quote. The numeric subtotal remains diagnostic, not a complete quote. The detailed total is checked against the factor-of-two envelope around the top-level band; disagreement asks for a scope review. System integration is an additive band and is not compared as if it described the whole program.

Totals include all project cards, across boards and regardless of filters, including archived and completed cards. Deleting a card removes it from current scope; retained activity still records its estimate. Subtasks are not independently added. “Unfinished modules” is their full estimate, not a measured effort-to-complete. Sprint loads represent original allocated scope, including done cards. Working days are effort-equivalent days before staffing conversion. The calendar result is not a dependency-aware delivery schedule: parallelism, lab access, holidays and scope exclusions still need engineering review.

Planning text autosaves; numeric fields and selections commit when changed or left. Invalid values retain their raw drafts and show a save error. IED fields, calibration observations and project settings use the same journal, strict transactions, undo, snapshots and JSON backup path as the board. Old schema-2 workspaces need no conversion: planning fields are optional and missing fields mean unestimated work. A populated schema-1 migration also remains supported. Reopening an older application build is not a supported downgrade path for newly added planning data; keep the current HTML and an external backup.

The extension adds numbered sprint allocations only. Sprint dates, automatic scheduling, dependencies, rollover, time tracking and the rest of Tier 2/3 remain deferred.

### Find work

Search matches title and description as you type. Label, assignee, priority and due filters combine with AND. “Due this week” means the local Monday–Sunday calendar week. Completed cards do not match “overdue.”

Filters and the selected project live in the URL fragment. Bookmark the file URL to keep that view. A fragment does not contain workspace data, so it cannot share the workspace with another person.

### Keyboard

| Key | Action |
|---|---|
| Ctrl+Z / Cmd+Z outside text fields | Undo the latest workspace action, up to 50 actions in this session |
| Ctrl+Z / Cmd+Z inside text fields | Native text undo; the resulting input is autosaved |
| `/` outside dialogs and text fields | Focus search |
| Enter in a new-card or subtask input | Add the item |
| Escape | Close the dialog or inline input |
| Tab / Shift+Tab | Move through native controls |

Undo restores moves, edits and deletes without removing activity. A referenced member identity is retained when undoing its creation, so historical actors remain valid. Undo does not survive a reload, and restoring a workspace clears the undo stack.

## Storage and recovery

### What “Saved” means

The system of record is IndexedDB database `fieldboard`, version 2. The `workspace` object store contains the current workspace as one atomic record; `snapshots` contains daily copies. Every mutation uses a `readwrite` transaction with `durability: "strict"`. The app acknowledges a change only on transaction completion and refuses browsers that do not expose strict durability.

An exclusive Web Locks lock allows one editing tab per storage identity. A second tab reports an error. Save and close the first tab, then reload the second. Revision checks provide a second defence against stale writers.

Workspace recovery drafts and unfinished text are journalled in localStorage (`fieldboard-draft` and `fieldboard-text`) before submission to IndexedDB. A journal can include the in-flight predecessor to recover a crash between transaction completion and acknowledgment bookkeeping. Committed state is never replaced by a volatile-memory fallback.

If a write fails:

1. The red **Not saved** banner identifies the failure. Do not close the tab.
2. **Retry write** retries a pending workspace transaction. An initial storage-open failure requires a reload after resolving the cause.
3. **Download drafts** exports the journal, retained text and currently displayed input values. This recovery envelope is not a normal workspace backup. Its `journal` value is a JSON string whose `state` is a candidate workspace; validate/review that data before restoring it. Text-only fields can be copied back manually.
4. If even the draft journal is denied or full, text remains visible in memory and the error stays visible. Download or copy it before closing. Persistence cannot be promised when both browser storage mechanisms reject writes.

A conflict journal is not automatically discarded. Export it before manual recovery. Do not clear browser data as a first troubleshooting step.

### Backups and another computer

**Download backup** exports acknowledged workspace data as JSON: projects, boards, columns, cards, labels, members, settings, subtasks, comments, reserved attachment/link data and all activity, including deleted cards’ history. Session undo, raw text drafts and the snapshot archive are not workspace entities and are not included. The local concurrency revision is reassigned during restore; entity data is preserved.

To move the workspace:

1. Download a backup and wait for the browser download to finish.
2. Copy the backup and `dist/fieldboard.html` to the other computer.
3. Open the HTML in the intended browser/profile.
4. Select **Restore JSON backup**, choose the JSON and confirm replacement.
5. Check the restored board and the saved indicator before removing any old copy.

Follow the same procedure before renaming/moving the HTML, changing browser or profile, or using a static-hosted copy. Direct-file storage identity is browser-defined and is not assumed to travel with the file. Files may share a browser storage identity; Fieldboard deliberately uses one database name rather than promising per-file isolation.

Restore validates schema, types, positions, dates, relationships and identifiers before changing stored data. Invalid or future schemas are rejected. JSON imports are capped at 50 MiB. Restoring a valid file replaces the whole workspace only after confirmation.

### Daily snapshots

The app captures one local snapshot per active day and retains the last seven snapshot dates. It checks on launch and once per minute while open. After an inactive period it captures the current day, not invented historical states for days when it was closed.

Choose **Daily snapshots**, select a date’s **Restore** button and confirm to replace the workspace. Download a backup first if you need the present state.

Snapshots share the same browser storage and failure domain. They do not protect against eviction, private browsing cleanup, clearing site data, profile loss or device failure. Neither strict transactions nor local drafts guarantee survival of disk failure or operating-system power loss on untested hardware.

localStorage typically has a much smaller quota than IndexedDB. Because this version journals whole workspace states and retains append-only activity, very large histories may hit that limit before IndexedDB fills. The app reports failure rather than accepting unjournalled edits. Keep external backups; no automatic history truncation is performed.

## Data model and tier status

Workspace owns members, settings and projects. A project owns labels and boards. Boards own ordered columns. Columns own ordered cards. Cards contain subtasks, comments, label/member references, optional IED effort and calibration records, and reserved attachment/link arrays. Projects may contain optional estimation and capacity settings. Activity references card IDs and retains complete before/after records after deletion.

| Scope | Status |
|---|---|
| Tier 1 board/column operations, card details, ordering, archive/delete, filters, undo, local identities and activity | Implemented; domain and direct-file browser coverage |
| Automatic persistence, draft failure handling, JSON backup/restore | Implemented; transactional, reload, crash and browser failure tests |
| Mandatory snapshots, versioned schema, escaped Markdown, standalone build | Implemented; see acceptance limitations above |
| Tier 2 WIP limits, blocked state, dependencies, swimlanes, epics, additional board management, My Work, templates, expanded shortcuts, palette, bulk actions, quick-add, list/calendar/timeline | Deferred |
| Requested IED estimates, top-level bands, capacity scenarios, numbered sprint allocation and calibration | Implemented extension; domain, persistence and offline interaction tests |
| Tier 3 insight, full sprint lifecycle, recurrence, time tracking, automation, notifications, watchers, attachments/link editing, import formats, board exports, themes and advanced polish | Deferred |
| Authenticated collaboration, synchronization, hosted APIs, external CLI/webhooks, service-worker packaging | Outside this standalone architecture; not implemented |

Basic native keyboard controls and a narrow-screen layout are present for usability, without claiming Tier 3 accessibility or responsive acceptance.

## Development

Bun 1.4.0 was used for installation, build and tests. A development browser is needed only to run browser tests.

```sh
bun install
bun run build
bun test
```

`bun run build` first checks strict TypeScript, then produces only `dist/fieldboard.html`. `bun run typecheck` runs the compiler separately. `bun run dev` builds and starts an optional localhost preview; `bun run start` previews the existing artifact at port 3000. Preview storage is separate from direct-file storage. Neither command is an end-user requirement.

Browser tests default to `/usr/sbin/chromium`. To use an installed Linux Chromium elsewhere:

```sh
CHROMIUM_PATH=/path/to/chromium bun test
```

Tests copy only the HTML into an empty directory, use fresh persistent profiles, disable page networking and run without a preview server. They restart the same profile and path, send SIGKILL to the test-owned Chromium process during a held strict transaction, verify backup recovery in another profile, inject IndexedDB write failures, and actually fill localStorage to its quota. Real IndexedDB quota exhaustion remains fault-injected rather than physically filled.

Temporary browser data uses a test-owned directory under the project root, removed by test teardown. This avoids the development container’s small `/tmp` mount. Only Chromium’s `TMPDIR`, which holds its singleton socket, goes in a short directory under the system temp folder: Unix socket paths are capped at 108 bytes, and a long checkout path would exceed that. The tests disable Chromium’s sandbox only when the harness runs as root; this exception is recorded in `evidence/browser-environment.json` and does not qualify as unflagged desktop acceptance.

Browser tests need Bun 1.4.0 or later. Under Bun 1.3.14, Playwright’s pipe to the browser closes mid-suite, the browser exits and the remaining tests hang, so `tests/browser.test.ts` refuses to start on older versions.

### Dependencies and licences

No third-party library is bundled into the HTML. Development-only packages are pinned in `package.json` and resolved in `bun.lock`.

| Development component | Version tested | Licence |
|---|---|---|
| Bun | 1.4.0 | MIT; upstream bundled components have their own notices |
| TypeScript, platform compiler package | 7.0.2 | Apache-2.0 |
| @types/bun, bun-types | 1.4.2 | MIT |
| Playwright, playwright-core | 1.63.0 | Apache-2.0 |
| fake-indexeddb | 6.2.5 | Apache-2.0 |
| @types/node | 26.6.3 | MIT |
| undici-types | 8.9.0 | MIT |

The installed Chromium test browser is a development tool and is not redistributed with the application. Package licence texts remain in their installed package directories. There are no bundled runtime dependency notices to carry into the HTML.

## Evidence

- `ISA.md`: claim ledger, probe names and remaining acceptance gaps.
- `evidence/test-results.txt`: original implementation suite output.
- `evidence/planning-tests.txt`: full suite after the planning extension.
- `evidence/planning-baseline.txt`: original 43-test regression baseline in this session.
- `evidence/planning-red.txt`, `planning-ui-red.txt`, `planning-zero-red.txt`, `planning-scoping-red.txt`, `planning-docs-red.txt`: observed planning test failures before their implementations or corrections.
- `evidence/planning-project.png`, `planning-card.png`: delivered-file captures; faithful visual review remains deferred.
- `evidence/initial-red.txt`, `domain-red.txt`, `denial-red.txt`, `review-red.txt`, `review-ui-red.txt`, `autosave-red.txt`: observed failing baselines and regressions.
- `evidence/01-offline-first-launch.png`: isolated offline first launch.
- `evidence/02-board.png`, `03-restarted.png`: board before/after process restart.
- `evidence/04-restored.png`, `workspace-backup.json`: fresh-profile recovery.
- `evidence/05-write-error.png`: failed write, not a saved acknowledgment.
- `evidence/06-card-details.png`, `07-card-metadata.png`: Markdown, details and card-face information.
- `evidence/crash-result.json`: acknowledged state survived the held-transaction process kill.
- `evidence/performance.json`: latest headless move/feedback measurement.

Evidence and development files are not deployment dependencies. Only the HTML is needed to launch the application.
