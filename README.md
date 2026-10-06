# Fieldboard

A local kanban workspace delivered as one HTML file. Every in-scope item of Tiers 1, 2 and 3 in `PROMPT.md` is implemented. The release is still **not accepted** against every acceptance requirement in that prompt: the limits listed below are about how widely it has been verified (per-feature red-first provenance, a mid-range laptop, Firefox, a real screen reader), not about missing features.

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
| Brave, Arch Linux (Hyprland) | Manual direct-file check of the release build: first load, CSV import, card faces with estimate sums, a real image attachment thumbnail, Insights, settings surviving reload (`evidence/release-brave-*.png`) | Checked by hand; the automated suite does not drive Brave |
| Firefox 155.0.1, Linux | Binary available; application acceptance suite not run | Unverified |
| Other browsers, operating systems or profiles | No acceptance evidence | Unverified |

The automated suite passes with Chromium’s sandbox enabled on an unprivileged Linux desktop (Bun 1.4.0; `evidence/desktop-sandbox-tests.txt`). It still runs headless under Playwright’s automation flags, so the mandatory Linux desktop run **without special browser flags remains open** until a normal headed launch is recorded. Do not disable your browser sandbox to use the application. The application itself contains no flag-dependent file access, fetches or server calls.

Additional open checks:

- Scrolling a 1,000-card board holds 60 fps (no frame over 20 ms) in a headed Chromium window on the development machine, an AMD Ryzen AI 9 HX 470 with integrated Radeon 890M (`evidence/scroll-fps-headed.txt`). A mid-range laptop has not been measured. `evidence/performance.json` records the latest headless move and drag-feedback timing; the threshold tests stay enabled.
- Accessibility is checked automatically: axe-core reports no violations across every view and dialog in both themes at desktop and phone widths, and a keyboard walk reaches every control and closes every dialog back to its opener (`tests/a11y-*.test.ts`). It has not been tried with a real screen reader. Screenshots come from the isolated delivered file and were reviewed by eye; motion is not certified.
- Populated schema migration has a fake-IndexedDB automated fixture. A deployed prior-version browser profile migration is not yet certified.
- Tests were written before the core implementation and regression fixes. Some supplemental browser scenarios were first observed passing after implementation. The prompt’s every-feature-red-first requirement therefore remains open. Initial package configuration also preceded its tests; this ordering error was corrected for subsequent work, not retroactively erased. Several Tier 3 features also had their tests written alongside the code; `ISA.md` records which, claim by claim.

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
- The **Move to…** menu moves a card to another column without dragging — the control to use at phone width. **Archive card** hides it. **Archive** on the board restores it. **Delete permanently…** requires confirmation; retained activity still records the deletion.
- Activity shows the actor, action, timestamp and before/after data. Reopen the detail view to refresh its history after editing. Position changes to neighbouring cards also have audit entries.

Card faces show labels, priority, due date, checklist progress, assignee initials and comment count. Dates are interpreted in local time through the end of the due day. Overdue dates are red; dates within 48 hours are amber. Completed cards are not marked overdue.

Markdown supports headings, bold, italics, code, fenced code, lists, blockquotes and HTTP(S) links. Raw HTML is escaped. Images become text placeholders and are never fetched. Opening an external link is a deliberate browser navigation.

### Card covers and colours

A card's detail view has a **Cover & colour** section, below Attachments. **Cover image** offers every image attachment already on that card (PNG/JPEG/GIF/WebP — the same types the Attachments section thumbnails; nothing else can be a cover); choosing one shows a short image strip at the top of the card's face. Removing that attachment clears the cover automatically, in the same edit. **Card colour** offers a small fixed palette of named colours as swatch buttons; the chosen colour shows as a thin accent stripe down the card's left edge, never behind any text. Both fields are optional and independent of each other.

### Effort estimation and planning

The planning extension follows the two copied reference notes, `FPGA-FW-Effort-Estimation-Model.md` and `FPGA-Project-Effort-Estimation-Top-Level.md`. They are development references, not runtime dependencies. The notes remain unchanged.

An Ideal Engineering Day (IED) is 6–7 uninterrupted engineering hours. It measures work volume, not elapsed time. Existing values in **Legacy estimate · unitless** remain untouched and never enter IED calculations.

1. Open **Effort & planning** above the board and choose **Enable project planning**. Select the whole-program type and spec maturity. Read the scoping questions and record assumptions. Whole-program bands include 25% contingency already; this setting does not apply contingency again to those bands. The coarse staffing scenario converts the band to weeks even before cards exist, separately from the completeness-gated detailed quote.
2. Open each card and choose **Start IED estimate**. Pick a **Category** (design work — register interfaces, FSMs, clock-domain crossing, DSP datapaths, serial/high-speed interfaces, vendor IP, top level, reference models — and lab/debug work — board bring-up, hardware testbench verification, interface characterization, on-chip debug, field update, qualification, production test) and a **Subcategory**, whose factor scales the category's base RTL/verification (or unsplit) IED. Choose **Custom task** instead to size the RTL, verification and unsplit-work fields directly; every field stays visible and editable either way, and editing any of them switches the category to Custom task. Record requested scope, assumptions and module-local factors, including **Lab access** (dedicated bench 1, shared lab 1.25, booked/remote lab 1.5). The verification factor multiplies only the verification share.
3. Categories and subcategories can be added, renamed and re-valued per workspace from the **IED catalog** section of the same dialog; ids are unique, names non-empty, factors 0.01–10 and ranges valid, and a category or subcategory still used by a card cannot be deleted. The built-in catalog is never edited in place — a workspace edit creates its own copy. See `FPGA-FW-Effort-Estimation-Model.md` Table 1 for the full default catalog and which factors are calibration starting values rather than source-derived.
4. Review the project's contingency and platform overheads. Defaults are 25% contingency, build/CI 2–4 IED, initial timing 3–8 IED, bring-up 4–10 IED and documentation at 10% of adjusted RTL effort. Concept scope normally needs 30–50% contingency. If an overhead is already a card — most often bring-up estimated as Board bring-up lab cards — remove its project-level budget and document why to avoid counting it twice.
5. Set focus, availability, allocated FTE, team efficiency and sprint length, or switch **Capacity mode** to **Direct** and type the IED per sprint directly. The nominal derived-mode dedicated-engineer scenario provides 5.525 IED per two-week sprint. Half an FTE with team efficiency 0.8 provides 2.21 IED. These are editable planning assumptions, not measurements of productivity. Direct mode also sets the per-working-day rate the milestone overview uses.
6. Assign a **Sprint number** on each estimated card, or use the board's **Sprints** view (below) to assign and review them together. The project table and the Sprints view both include each module's contingency and flag loads whose upper bound exceeds capacity. Overheads stay in the explicit unallocated reserve; they are not silently placed in the last sprint. Split oversized work into separately estimated cards. The app does not automatically slice tasks or assign dates.
7. After completing work, enter **Actual IED**, record the missed factor or learning, and choose **Log calibration**. Calibration freezes the current scope, category, subcategory and factors and estimated range alongside the actual effort. Later estimate edits cannot rewrite that observation. Multiple observations on one card are revisions, not additive time entries. The project table shows the latest per task; the card keeps all observations. Review baseline tables after about 10 tasks; the app never changes multipliers automatically.

The implemented equations are:

```text
module IED = (RTL + verification × verification factor + unsplit work)
             × spec × clock × utilization × reuse × lab access
project IED = sum(module IED) × (1 + contingency) + platform overheads
sprint IED = 5 × sprint weeks × focus × availability × FTE × team efficiency  (derived mode)
           = IED per sprint as entered                                        (direct mode)
weeks      = project IED / sprint IED × sprint weeks
```

In direct mode the quote shows weeks and sprints from the entered capacity and omits effort-equivalent working days, because a single IED-per-sprint figure does not separate focus from availability.

Unsplit work preserves the 2–10 IED legacy-debug, 2–8 IED beyond-initial-timing and every lab-category range, for which the catalog supplies no RTL/verification split. Documentation uses adjusted RTL before contingency. Ranges propagate through the calculations without replacing them by a midpoint; they are planning bounds, not statistical confidence intervals. The source formulas take precedence over rounded worked examples. Display values round to two decimals; calculations retain full precision. The legacy 19-entry baseline list (`baseline` on an estimate) stays accepted wherever it is already stored, including calibration inputs, but is no longer offered for new estimates — the catalog replaces it for everything new.

An effective module multiplier above 4 produces an **Architecture gap**, not a capped estimate. For independent ranges, the gate uses the highest possible effective multiplier; Lab access joins the common per-module factor the same way Spec, Clock, Timing and Reuse do. Unestimated cards, zero-sized defaults, an empty project, architecture gaps or undefined top-level specs withhold the calendar quote. The numeric subtotal remains diagnostic, not a complete quote. The detailed total is checked against the factor-of-two envelope around the top-level band; disagreement asks for a scope review. System integration is an additive band and is not compared as if it described the whole program.

Totals include all project cards, across boards and regardless of filters, including archived and completed cards. Deleting a card removes it from current scope; retained activity still records its estimate. Subtasks are not independently added. “Unfinished modules” is their full estimate, not a measured effort-to-complete. Sprint loads represent original allocated scope, including done cards. Working days are effort-equivalent days before staffing conversion. The calendar result is not a dependency-aware delivery schedule: parallelism, lab access, holidays and scope exclusions still need engineering review.

Planning text autosaves; numeric fields and selections commit when changed or left. Invalid values retain their raw drafts and show a save error. IED fields, calibration observations and project settings use the same journal, strict transactions, undo, snapshots and JSON backup path as the board. Old schema-2 workspaces need no conversion: planning fields are optional and missing fields mean unestimated work. A populated schema-1 migration also remains supported. Reopening an older application build is not a supported downgrade path for newly added planning data; keep the current HTML and an external backup.

### Sprints view

Open **Sprints** above the board for a time-boxed view over every card carrying a sprint number — not only estimated ones. Each numbered sprint lists its IED capacity (labelled Derived from staffing, Direct or Overridden), load including module contingency, headroom and a verdict (Within capacity, Over capacity, or Not quotable when the sprint holds an architecture gap, an unsized estimate, or a card with no IED effort at all), with the cards assigned to it; an **Unassigned** group lists *estimated* cards with no sprint number (a non-estimated card with no sprint simply carries no sprint, the same as before this release). A sprint's capacity can be overridden there — for a holiday or lab week — independently of the project's derived or direct capacity; clearing the override returns it to that project-level value. A card's sprint can be reassigned from the Sprints view, the card detail's **Sprint** field (for a card with no IED effort), or its own **Sprint number** field inside Effort estimation (for an estimated card) — all three write the same one field for that card.

Each sprint also has an optional **Name**, **Start date**, **End date** and **Scope**, editable in the same row. Dates default to a stable, sensible `sprintWeeks`-long window: sprint 1 defaults to the Monday on or before the earliest creation date among cards that have ever carried a sprint number in this project (so the default never drifts as days pass), and every later sprint number follows at that many `sprintWeeks` after it; a sprint's own explicit dates always win over that default. Editing any sprint's dates is not required, but is always available. Below the table, a **What was completed** note and **Close sprint** button close it out: every card in the sprint that is not yet in a done column moves to the next sprint (created automatically if nothing has touched it yet) as one undoable change, cards already done stay exactly where they are, and the sprint is marked closed with its completion note — a closed sprint's fields stop accepting edits. A burnup chart (scope vs. done) sits below each sprint, spanning the sprint's own start-to-end window — extended past the end date to today only while an open sprint has overrun it, never for a closed one — built from the same Activity-replay engine the milestone burnup chart uses, scoped to that sprint number within this project; history from before a sprint's own start date counts toward its opening value rather than being cut off.

Per-sprint capacity overrides apply only in this view, because the project's calendar/weeks quote and the milestone overview still use the project's derived or direct capacity without overrides — only the Sprints view itself knows about a specific sprint's shortened or extended capacity.

### Milestones

A milestone is a dated outcome a project's cards can belong to, not a schedule. The board stays pull-based: adding, renaming, re-dating or deleting a milestone never reorders a card or assigns it a date. Open **Milestones** above the board to add one (name and date; description optional), and assign it to a card from that card's **Milestone** field in its detail view. The card face shows a small milestone chip. A milestone filter joins the existing label/assignee/priority/due filters and round-trips through the URL fragment the same way.

Deleting a milestone unassigns its cards rather than deleting them; the unassignment goes through the normal card-edit path, so it appears in Activity and Undo restores it like any other edit.

The overview lists milestones by date, each with days remaining (or overdue), done/total cards (done means the card sits in a "done" column; archived cards count as scope, deleted cards don't — the same rule as the planning extension), a progress bar, and remaining effort as an IED range summed from unfinished cards that have an IED estimate, plus a count of unfinished cards that don't. When project planning is enabled, a fit verdict compares the *cumulative* remaining effort of every milestone on or before that date — capacity is shared across milestones, not reset at each one — against the working-day capacity between today and that date, using the same per-working-day rate `focus × availability × FTE × team efficiency` that the planning extension's weekly capacity is built from. Verdicts are **Fits**, **At risk** (the range straddles capacity) or **Does not fit**; the verdict is withheld and says so when planning isn't enabled or when any contributing milestone still has unestimated cards. This is a capacity check, not a dependency-aware delivery schedule.

### Flow control

**WIP limits.** A column's "⋯" menu has an optional WIP limit field (a positive whole number, or blank for no limit). The column header shows the limit as `count / limit`, where `count` is the column's non-archived card total — not the filtered/searched count the plain header otherwise shows. The badge turns amber when the count reaches the limit and red once it's above it. Going over the limit is always allowed; the app only ever makes it visible, never blocks the move.

**Blocked cards.** Any card's detail view has a "Blocked" checkbox. Checking it reveals a required reason field; the card cannot be marked blocked without one. A blocked card shows a small "Blocked" badge on its face, with the reason in its tooltip — the badge's icon and text carry the meaning, not colour alone. Unchecking clears it. The "Filter blocked" control narrows the board to blocked cards only, and round-trips through the URL fragment like the other filters. Blocking and unblocking go through the normal card-edit path, so they appear in Activity and Undo restores them.

**Dependencies.** A card can be blocked by other cards in the same project. Its detail view lists every other project card under "Blocked by" (check the ones it depends on) and, below that, "Blocks" — the cards that depend on it. A self-reference, a duplicate, a reference to a card outside the project, or a dependency cycle are all rejected when the change is saved. While any blocker has not reached a done column, the dependent card's face shows "Waiting on: <title>" (joining multiple blocker titles with a comma); the indicator disappears once every blocker is done. Deleting a card removes it from every dependent's blocker list automatically, through the same mutation path.

**Epics.** A card can be the child of exactly one other card in the same project, set from its detail view's "Epic / parent" field. A self-parent or a parent cycle is rejected when saved. A parent's face shows its children's aggregate progress as `done/total` with a small bar; a child's face shows a chip linking back to its parent's title. The detail view also lists an epic's children directly. The "Filter epic" control shows an epic together with its children and round-trips through the fragment. Deleting a parent card leaves its children in place with their `parentId` cleared, rather than deleting or re-parenting them.

### Boards

A project can hold several boards, each with its own columns and cards. The dropdown in the viewbar (next to the card count) switches between a project's boards; the choice round-trips through the URL fragment alongside the filters, so a bookmarked link reopens the same board. Open **Boards** to add one (blank, or started from a board template), rename one inline, or delete one. Deleting a board with cards requires choosing a destination board from the same project; its cards move into that board's first column through the normal move path, so the move is recorded in Activity and is undoable. The project's last board cannot be deleted.

A card can also jump to another board directly from its detail view's **Move to board…** control, landing in that board's first column. This is the one place a card crosses boards outside of board deletion — the column-to-column **Move to…** control still refuses to cross boards. Project-level totals (planning, milestones, sprints) already added up every board's cards, not only the one on screen; that did not change with this release.

### Views and swimlanes

The **Board** / **List** switcher in the viewbar picks how the current board's filtered cards are displayed; the choice round-trips through the URL fragment (`view=list`, omitted for the default board view) alongside every other filter. Only the active view renders.

The **Group board by** control (board view) turns a board's columns into horizontal lanes by assignee, priority, label or epic, plus a trailing **None** lane for cards without that attribute; the choice is saved on the board itself, so it is still in effect next time the board opens. A card with several assignees or labels appears once in every lane it matches — dragging it out of one of those lanes only removes that one membership, it does not touch the others. Dragging a card into a different lane changes column position and the lane's attribute together as one Activity entry and one undo step: an assignee or label lane makes the card gain the target and lose the source lane's value (the None lane just removes it); a priority lane sets that priority; an epic lane sets or clears the card's parent, subject to the same same-project and no-cycle rules the **Epic / parent** field already enforces — a move that would break one of those rules is rejected and the card is left exactly as it was. Column WIP counts in the header stay per column, not per lane. A card still moves between boards or to a specific column from its detail view's **Move to…** controls regardless of the active swimlane.

The **List** view shows the same filtered cards as a table — title, column, priority, due date, assignees, labels, milestone, epic and IED estimate — click a column header to sort by it (ascending, then descending on a second click; cards without a value for that column always sort last). **Group by** buckets the rows by column, priority, assignee, label, milestone or epic the same way swimlanes group the board (multi-valued fields appear in every matching group); within a chosen grouping, groups keep a fixed, sort-independent order (board column order, or priority rank), while the sort still governs the order of rows inside each group. Sort and group both round-trip through the URL fragment. Opening a row opens that card, the same as clicking its face on the board.

### My work

The sidebar's **My work** opens a cross-project list of every non-archived card assigned to the acting member (the same "Acting as" identity set in Workspace & members), grouped into Overdue, Today, This week, Later and No date. A completed assigned card is not excluded — it moves into a collapsed **Done** group instead, so finishing something does not make it disappear from the one place that shows what is assigned to you. Each row names its project and column; opening a row switches the board to wherever that card actually lives and opens its detail view.

### Templates

Save a card as a template from its detail view's **Template** section — it keeps the description, subtasks, label names and priority (if set). Create a card from a saved template using a column's **+ From template** control, which lists every card template and creates the card as one step. Save a board's current columns (names, done flags and WIP limits) as a board template from **Boards**, and start a new board from one the same place. Templates are workspace-level, included in JSON backups, and deletable from wherever they are listed.

### Bulk actions

Shift-click or Ctrl/Cmd-click (Cmd on macOS) a card face to add it to a multi-selection; a plain click still opens the card. A selection bar appears below the filters once at least one card is selected, showing the count and: move to column, add label, remove label, assign member, unassign member, and archive. Each action applies to every selected card as a single undo step, with its own Activity entry per affected card — the same mutation path every other card edit already uses. Escape clears the selection.

### Find work

Search matches title and description as you type. Label, assignee, priority, due, milestone, blocked and epic filters combine with AND. “Due this week” means the local Monday–Sunday calendar week. Completed cards do not match “overdue.”

The **Focus: my cards** checkbox hides every card not assigned to the acting member (the same "Acting as" identity set in Workspace & members) — in the Board, List, Calendar and Timeline views alike. Column card counts and WIP badges are unaffected by it, the same as every other filter here: they always count the column's non-archived cards, not the currently filtered set.

Filters and the selected project live in the URL fragment. Bookmark the file URL to keep that view. A fragment does not contain workspace data, so it cannot share the workspace with another person.

### Calendar and timeline views

The **Board**/**Calendar**/**Timeline** tabs above the board switch how the same filtered cards are presented; only the active view's markup renders, so switching away from the board costs nothing extra while it's hidden. The choice is stored as `view` in the URL fragment (omitted when it's Board, the default), alongside the other filters it already shares. Both views are lenses over the same cards: the board is still the only place a card is reordered, and neither view invents a date the user never set.

**Calendar.** A month grid by default, with a **Week** toggle; both are Monday-first and name weekdays in the viewer's locale. **Previous**/**Next**/**Today** navigate. A card with a due date appears on that day (title, a priority marker for high/urgent, and struck-through styling once done); a day holding more than three shows a “+N more” control that expands it in place. The active project's milestones appear as ◆ markers on their dates. A **No due date** side list holds every filtered card without one. Dragging a card onto a day sets its due date to that day; dragging a card from the grid onto the side list clears it. Either drop is the only way this view writes a date, and it goes through the normal card-edit mutation — one Activity entry, undoable like any other edit.

**Timeline.** A card can carry an optional **Start date** next to its **Due date** in the card detail view; the app rejects a start date set after the due date (and vice versa) the same way it rejects any other invalid edit. A card with both dates draws as a horizontal bar on a day scale that fills the available panel width (a minimum of 24 px per day, scrolling horizontally beyond that), with a date header above it — a full date at each week boundary, day numbers between them — plus week gridlines and a line marking today; a card with only one date, or neither, is listed under **Not scheduled** rather than guessing the missing one. Rows group by column or epic, switchable above the chart — grouping only reorders rows, it never resizes a bar. An arrow runs from a blocker's bar to a card it blocks, using the same “Blocked by” relationships as the board; an arrow drawn in the warning colour means the dependent is scheduled to start before its blocker is due, and its tooltip explains why. Clicking a bar, or a Not Scheduled row, opens that card.

### Keyboard

| Key | Action |
|---|---|
| Ctrl+Z / Cmd+Z outside text fields | Undo the latest workspace action, up to 50 actions in this session |
| Ctrl+Z / Cmd+Z inside text fields | Native text undo; the resulting input is autosaved |
| `/` outside dialogs and text fields | Focus search |
| `n` outside dialogs and text fields | Open a new-card input at the top of the focused card's column, or the first column if none is focused |
| `e` outside dialogs and text fields | Open the focused card |
| `j` / `k` outside dialogs and text fields | Move focus down/up through cards, in column-then-position (visual) order, across every column |
| `←` / `→` outside dialogs and text fields | Move the focused card to the previous/next column; persisted and undoable like a drag |
| `?` outside dialogs and text fields | Show the keyboard shortcut cheatsheet |
| Ctrl+K / Cmd+K | Open the command palette |
| Enter in a new-card or subtask input | Add the item |
| Escape | Close the dialog or inline input, or clear a bulk card selection |
| Tab / Shift+Tab | Move through native controls |
| Shift+click / Ctrl+click (Cmd on macOS) a card | Toggle it in the bulk selection; a plain click still opens it |

Every shortcut above except Ctrl+K and Ctrl+Z is ignored while typing in an input or textarea, or while a dialog is open; Escape always works. A focused card shows the browser's native focus outline, so the current position is always visible. Undo restores moves, edits and deletes without removing activity. A referenced member identity is retained when undoing its creation, so historical actors remain valid. Undo does not survive a reload, and restoring a workspace clears the undo stack.

### Command palette

Ctrl+K (or Cmd+K), or the "⌘K" button in the top bar, opens a fuzzy-search palette over every project, board, card title and a fixed list of actions (new project, new card, add column, milestones, sprints, effort & planning, archive, download backup, help, theme light/dark/system). Matching ranks an exact or prefix match above a match at the start of a word, which ranks above a plain subsequence match; ties break alphabetically. Arrow keys move the selection, Enter runs it (opening the matched card or project, or firing the action), and Escape closes the palette without doing anything.

### Quick-add

The "Card title" input used for every inline add (the `+ Add card`/`+ Add at top` buttons and the `n` shortcut) accepts a small inline syntax, with tokens allowed anywhere in the text and in any order:

| Token | Meaning |
|---|---|
| `#label` | A project label, matched case-insensitively against existing labels or created if none matches (several allowed) |
| `@name` | An assignee, matched case-insensitively by member name; a first-name prefix is accepted when it is unique |
| `!low` / `!medium` / `!high` / `!urgent`, or `!!` | Priority (`!!` is shorthand for urgent) |
| `^today`, `^tomorrow`, a weekday name, or `^YYYY-MM-DD` | Due date; a weekday name resolves to its next occurrence, never today itself |
| `~milestone` | A project milestone, matched case-insensitively by a unique name prefix |

A token that does not resolve — an unknown member, an unrecognised priority word, an invalid or ambiguous date or milestone — is left exactly as typed in the title rather than guessed at or silently dropped. A new label created this way, the parsed priority, due date, assignee and milestone are all applied in the same mutation that creates the card, so quick-add produces exactly one Activity entry and one undo step, the same as typing a plain title. The inline input's hint line repeats the syntax.

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

**Download backup** exports acknowledged workspace data as JSON: projects, boards, columns, cards, labels, members, settings, subtasks, comments, attachments, links and all activity, including deleted cards’ history. Session undo, raw text drafts and the snapshot archive are not workspace entities and are not included. The local concurrency revision is reassigned during restore; entity data is preserved.

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

Workspace owns members, settings (including an optional estimate unit, `"points"` or `"hours"`, defaulting to points, that labels the card estimate field and its column/swimlane sum badges), projects, an optional edited IED catalog (categories and subcategories; absent means the built-in catalog), optional card/board templates, and an optional list of notifications (`{id, memberId, kind: "mention"|"assignment"|"due"|"watch", cardId, read, createdAt, dedupeKey?}`, capped at 200 per member, oldest dropped first) — each belongs to one member and shows up only in that member's own inbox. Cards additionally carry an optional list of time entries (`{id, start, end, note?}`; a running entry has `end: null` and only its start is ever stored), with a per-card total shown next to the estimate and on the card face, an optional recurrence (`{frequency: "daily"|"weekly"|"monthly", columnId, next}`) that regenerates the card into a chosen column — on any board of the same project — whenever its `next` date has arrived, an optional list of watcher member IDs, a sprint number for a card with no IED effort (an estimated card keeps using its effort's own sprint number, unchanged), an optional cover (an attachment id, which must name an image attachment on the same card) and an optional colour (one of a fixed named palette). A project owns labels, boards, optional dated milestones and optional per-sprint records (`{number, name?, startDate?, endDate?, scope?, closedAt?, completedSummary?}`, keyed by the same sprint number a card already carries). Boards own ordered columns, each with an optional WIP limit, an optional aging threshold in whole days (shows a card's time in that column once it clears the threshold, never in a done column), and a `swimlane` setting (`none`, `assignee`, `priority`, `label` or `epic`; `none` by default) that groups the board into horizontal lanes without changing column WIP counts. A board also owns an optional list of automation rules (entering a chosen column: check all subtasks, or assign a chosen member; or a per-board overdue rule: add a chosen label to any non-done, non-archived card whose due date has passed), each independently enabled or disabled, and an optional "archive done cards after N days" setting. Columns own ordered cards. Cards contain subtasks, comments, label/member references, an optional milestone reference, optional IED effort (which may reference a catalog category/subcategory) and calibration records, an optional blocked reason, an optional list of same-project blocker card IDs, an optional same-project parent card ID, an optional start date (must not fall after the due date when both are set), an attachment array (files and images stored as data URLs, each capped at 2 MiB) and a link array (URL, git commit, GitHub issue or GitHub PR references), and an optional `restoredAt` timestamp set whenever a card is restored from Archive (completion history stays untouched; auto-archive's clock reads the later of `completedAt` and `restoredAt`). Projects may contain optional estimation and capacity settings. A card template holds a description, subtasks, label names and an optional priority; a board template holds a column list (name, WIP limit, aging threshold, done flag). Activity references card IDs and retains complete before/after records after deletion. The active board view (Board/List/Calendar/Timeline/Insights) is UI navigation state, not workspace data — it lives in the URL fragment's filters (which also carry a "focus: my cards" toggle) alongside search and the other filters, the same way the active project and board do. The cumulative flow diagram, lead/cycle time and throughput shown in the Insights view are all computed on demand from Activity history and live card fields; none of it is stored.

| Scope | Status |
|---|---|
| Tier 1 board/column operations, card details, ordering, archive/delete, filters, undo, local identities and activity | Implemented; domain and direct-file browser coverage |
| Automatic persistence, draft failure handling, JSON backup/restore | Implemented; transactional, reload, crash and browser failure tests |
| Mandatory snapshots, versioned schema, escaped Markdown, standalone build | Implemented; see acceptance limitations above |
| Requested project milestones, milestone filter and a capacity-check milestone overview | Implemented extension; domain, calculation-module and offline interaction tests |
| Per-milestone and per-sprint burnup charts (scope/done, derived from Activity history, sharing one engine) | Implemented extension; domain and offline interaction tests |
| Tier 2 WIP limits, blocked state, card dependencies and epics, plus their filters | Implemented; domain and offline interaction tests |
| Tier 2 keyboard shortcuts (new/open/move/navigate/cheatsheet), fuzzy command palette and quick-add syntax | Implemented; domain/unit and offline interaction tests |
| Tier 2 multiple boards per project, board switching/add/rename/delete, cross-project My work, card/board templates, bulk card actions | Implemented; domain and offline interaction tests |
| Tier 2 swimlanes, list, calendar and timeline views, with a Board/List/Calendar/Timeline view switcher | Implemented; domain and offline interaction tests |
| Requested IED estimates, top-level bands, capacity scenarios, numbered sprint allocation and calibration | Implemented extension; domain, persistence and offline interaction tests |
| Two-level IED catalog (workspace-editable), custom task entry, Lab access factor, direct/overridden sprint capacity and the Sprints view | Implemented extension; domain, migration and offline interaction tests |
| Light/dark theme (system-following with a System/Light/Dark override) and the phone-width board layout | Implemented extension; domain, token-contrast and offline interaction tests |
| Tier 3 accessibility: full keyboard operation (including moving a card between and within columns), visible focus, zero unnamed controls, WCAG AA contrast in both themes, automated `axe-core` falsifier | Implemented; domain, token-contrast and axe-core/keyboard-walk offline interaction tests |
| Tier 3 card aging (per-column aging threshold, card-face age badge, amber then red) | Implemented; domain and offline interaction tests |
| Tier 3 Insight: cumulative flow diagram (14/30/90/all-time range), lead/cycle time (median, 85th percentile, distribution, per-card detail view), throughput (cards completed per week, last 12 weeks) | Implemented; domain and offline interaction tests |
| Tier 3 estimate units and sums (workspace-wide points/hours, column and swimlane sum badges) | Implemented; domain and offline interaction tests |
| Tier 3 time tracking (start/stop timer, manual entries, per-card total, card-face badge) | Implemented; domain and offline interaction tests |
| Tier 3 recurring cards (daily/weekly/monthly, catch-up on launch, calendar-date month clamping) | Implemented; domain and offline interaction tests |
| Tier 3 automation (per-board rules: entering a column checks subtasks or assigns a member, overdue adds a label; per-board auto-archive after N days; both reconciled on the same launch/minute/visibility schedule recurring cards use) | Implemented; domain and offline interaction tests |
| Tier 3 attachments (drag-drop, paste, file picker; PNG/JPEG/GIF/WebP thumbnails, everything else a file-only chip; 2 MiB cap) and links (URL, git commit, GitHub issue/PR chips) | Implemented; domain and offline interaction tests |
| Tier 3 import (Trello board JSON, GitHub Issues JSON, CSV) and export (board CSV and Markdown) | Implemented; domain and offline interaction tests |
| Tier 3 local team organisation: @mentions (description and comments, rendered as chips), a notifications inbox (mention/assignment/due/watched-card, unread count, mark read/all read), and per-card watchers | Implemented; domain and offline interaction tests |
| Tier 3 time-boxed sprints (optional name/dates/scope per sprint, non-estimated cards can join one, close-out moves unfinished cards forward and records what was completed) | Implemented; domain, migration and offline interaction tests |
| Tier 3 card covers and custom card colours | Implemented; domain and offline interaction tests |
| Tier 3 focus mode ("Focus: my cards" in the filter bar, Board/List/Calendar/Timeline) | Implemented; domain and offline interaction tests |
| Authenticated collaboration, synchronization, hosted APIs, external CLI/webhooks, service-worker packaging | Outside this standalone architecture; not implemented |

See "Accessibility" below for full keyboard operation, focus visibility, accessible names and contrast. The phone-width layout (390 px) and theme switching are covered by the automated suite below.

### Accessibility

Every control in every view and every dialog (milestones, sprints, automation, import, notifications inbox, workspace & members, archive, snapshots, help, command palette, and card detail) is reachable and operable with the keyboard alone, with no trap: `Tab`/`Shift+Tab` reach every control, each open dialog keeps focus inside it and returns focus to whatever opened it on close, and `Escape` closes a dialog or the command palette. On the board, `←`/`→` move the focused card to the previous or next column, `Shift+↑`/`Shift+↓` reorder it within its own column, and `j`/`k` move focus between cards without moving one — see `?` for the full shortcut list. Every focusable element shows a visible focus outline in both themes.

Every interactive element has a non-empty accessible name; the cumulative-flow, lead/cycle-time and throughput charts in Insights each carry a text summary alongside the visual chart. Every text/background colour pairing the app defines clears WCAG AA (4.5:1 for normal text, 3:1 for large text and non-text indicators) in both themes, checked directly against the CSS token table by `tests/theme-contrast.test.ts`.

`tests/a11y-axe.test.ts` runs `axe-core` (development-only; see "Dependencies and licences") over every view and every dialog, in both themes, at 1024 px and 390 px, against a realistic fixture (labelled, assigned, blocked and time-tracked cards; a sprint; an automation rule; an unread notification), and asserts zero violations at `serious` or `critical` impact. `tests/a11y-keyboard.test.ts` independently walks the same surfaces by keyboard: it confirms every focusable control is reached by `Tab` alone, focus stays visible, and `Escape` returns focus correctly. A composite card-face button (board, list and timeline rows) carries a short name over a visually richer face and is a documented, narrowly-scoped exception to one `axe-core` rule (`label-content-name-mismatch`) — see DECISIONS.md § "Accessibility" for why.

### Themes

The board follows the operating system's light/dark preference by default, live: changing the OS setting updates the page immediately, no reload needed. The **Theme** control in the sidebar overrides this with **System**, **Light** or **Dark**. The choice is stored as part of the workspace, so it persists across reload, survives a schema-2 migration, and travels in JSON backups; a workspace saved before this field existed loads unchanged and defaults to System.

Before the workspace finishes loading, the page already renders in the operating system's theme using CSS alone. If an explicit override differs from the system theme, it applies as soon as the workspace loads — the one case where a brief flash to the override is expected. When the override matches the system theme, there is nothing to switch to, so there is no flash. All status colours (overdue, due soon, priority, done, WIP limit, blocked, error banner, planning warnings, label chips) keep their meaning in dark mode; every text-on-background pair the app defines clears WCAG AA (4.5:1), and non-text colour indicators clear 3:1, checked by `tests/theme-contrast.test.ts` directly against the CSS custom-property token table.

### Phone-width layout

On a phone, the sidebar actions (theme, workspace and members, daily snapshots, backup download, restore and help) sit behind the **Menu** button at the top right. Choosing an action or pressing Escape closes the menu.

At a 390 px viewport the page itself never scrolls horizontally; the board does, across its columns, and the sidebar collapses into a slim top strip instead of filling the screen. A card can be moved to another column from its detail view's **Move to…** control when dragging is impractical — the same control used at any width.

### Attachments and links

A card's detail view has an **Attachments** section: drag files onto it, paste an image or file while the card is open (Ctrl/Cmd+V), or use its **Add file** button. PNG, JPEG, GIF and WebP files show a thumbnail; every other type, including SVG, shows as a plain file chip and is never opened or rendered inline. Each file is capped at 2 MiB — a larger file is refused with a message and nothing is written. **Download** saves the original bytes; **Remove** deletes the attachment. Attachments are stored as data URLs inside the workspace, so they travel in JSON backups and daily snapshots like any other card data, and count toward their size.

The **Links** section holds references of four kinds: a plain URL, a git commit (repository and SHA), or a GitHub issue or pull request (repository and number) — pick the kind, fill in its fields, and press **Add link**. Pasting a `github.com` issue/PR/commit URL into the URL field fills in the right kind automatically. Each reference shows as a chip (for example "PR #42 · owner/repo" or "commit 1a2b3c4"); only `http://`/`https://` links are clickable, opening in a new tab. Nothing about a link ever makes a network request — chips are built entirely from what was typed or pasted.

### Import and export

The sidebar's **Import…** action creates a new project from a file already on your computer: a Trello board export (JSON), a GitHub Issues export (`gh issue list --json number,title,body,labels,state,assignees,url`), or a CSV with a header row (`title,description,column,labels,priority,due,estimate` — `title` is required, other columns are optional, unrecognized columns are ignored, and `labels` is semicolon-separated). A file that can't be read is refused with a message and nothing is imported.

A board's **Export CSV** and **Export Markdown** controls, in the toolbar above the board, download the current board. CSV uses the same columns the importer reads, so exporting and re-importing a board reproduces the same titles, columns, labels, priorities, due dates and estimates. Markdown is a readable summary — the board name, one heading per column, one bullet per card — meant for reading, not for round-tripping back in.

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
| axe-core | 4.14.0 | MPL-2.0 |
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
- `evidence/flow-red.txt`: flow control tests observed failing (missing exports) before implementation.
- `evidence/flow-board.png`, `flow-board-dark.png`: delivered-file captures of a WIP-limited column at and above its limit, a blocked card, a waiting-on-dependency card and an epic with children, in both themes.
- `evidence/calendar-view-browser-red.txt`, `timeline-view-browser-red.txt`: the calendar/timeline browser tests observed failing (no view switcher, no Start date field) against the pre-feature build.
- `evidence/calendar-view.png`: delivered-file capture of the month grid with a card placed on today's cell.
- `evidence/timeline-view.png`, `timeline-view-dark.png`: delivered-file captures of dependency bars and a conflict arrow, in both themes.

Evidence and development files are not deployment dependencies. Only the HTML is needed to launch the application.
