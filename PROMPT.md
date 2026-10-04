# Build Prompt: Kanban Task & Project Manager

You are building a kanban-style task and project management application. This document describes what done looks like, not how to get there. Every requirement is written as a verifiable claim; pick the implementation that satisfies it best.

## Vision

A person opens one HTML file in a browser and within five seconds knows what is in flight, what is blocked, and what to pick up next. The workspace can track a small team's work locally, without implying networked collaboration. Moving work forward feels like moving a card on a physical board: instant, obvious, reversible. The board never lies about the state of work, and nothing typed into it is silently lost.

## Constraints

- **Single-file deployment, mandatory:** the final application is exactly one self-contained HTML file, `dist/fieldboard.html`. Copying that file to a supported computer and opening it directly in a standard browser using `file://` is sufficient to run the app. No installation, local server, browser extension, special browser flags, account or internet connection is required. A directory of assets, a ZIP archive or an HTML shell that calls a backend does not satisfy this requirement.

- **No external runtime dependencies:** all application JavaScript, CSS, icons, images, fonts and other required resources are embedded in the HTML. System fonts and native browser APIs are permitted. No CDN, remote module, API server, separate JavaScript/CSS/WASM file, worker sidecar, database service, telemetry or runtime package download is permitted. Application startup and all in-scope features must work with networking disabled. User-initiated navigation to a stored external link is not an application dependency; the app must not fetch that link to render its card.

- **Development stack:** use Bun for development, builds and tests, with strict TypeScript source. No npm/npx, no Python. Development dependencies are allowed, but any library needed by the final app must be bundled into the HTML with its required licence notices. Bun, TypeScript and package installation must not be required on the end user's machine.

- **Storage:** local-first, transactional browser storage, with IndexedDB as the default system of record. Persistence must be verified when the delivered HTML is opened through `file://` in each supported browser. `bun:sqlite`, a backend process and a separately deployed database file cannot be runtime requirements. Browser-managed workspace data and user-created backup files are data, not additional application deployment files. The HTML is not expected to rewrite itself when a card changes.

- **Development:** test-driven. Every feature starts as a failing test, then goes green. A feature without a test is not done.

- **Build and launch:** `bun run build` produces the single deployable HTML file. `bun run dev` may provide a development server and `bun run start` may provide an optional local preview, but neither is needed to use the final artifact. Serving the same HTML from a static host is optional and cannot replace direct-file acceptance testing.

- **Scope discipline:** ship the MVP tier completely before starting the next tier. A half-built nice-to-have is worse than none. The single-file and zero-external-runtime-dependency requirements apply to every shipped tier and override conflicting wishlist features. A feature that needs a backend, external service or extra deployment file remains explicitly deferred; it must not weaken these constraints.

## Core Domain Model

These entities exist and relate as described. Names may change; the relationships may not.

| Entity | Holds | Relationships |
|--------|-------|---------------|
| Workspace | name, members, settings | has many Projects |
| Project | name, description, color, status (active/archived) | has one or more Boards |
| Board | name, ordered Columns, swimlane config | belongs to a Project |
| Column | name, position, WIP limit, "done" flag | has ordered Cards |
| Card | title, description (Markdown), priority, due date, estimate, labels, assignees, created/updated timestamps | belongs to a Column; has Subtasks, Comments, Attachments, Links |
| Subtask | title, done flag, position | belongs to a Card |
| Label | name, color | many-to-many with Cards, scoped to Project |
| Comment | author, body (Markdown), timestamp | belongs to a Card |
| Activity | actor, action, before/after, timestamp | append-only, belongs to a Card |

## Tier 1: MVP (must have)

### Boards and columns

- A new project starts with a default board: **Backlog → To Do → In Progress → Review → Done**.

- Columns can be created, renamed, reordered by drag, and deleted. Deleting a non-empty column requires choosing where its cards go.

- One or more columns can be flagged as "done"; cards entering them get a `completedAt` timestamp, and leaving clears it.

### Cards

- Cards can be created inline at the top or bottom of any column with only a title; everything else is optional.

- Cards move between and within columns by drag and drop, and the new order persists across reloads.

- Opening a card shows a detail view with: title, Markdown description (with rendered preview), priority (none/low/medium/high/urgent), due date, labels, assignees, subtask checklist with progress, and comments.

- A card's face on the board shows at a glance: title, labels, priority, due date (red when overdue, amber within 48 h), subtask progress (e.g. `3/5`), assignee avatars, and comment count.

- Cards can be archived (hidden, restorable) and deleted (with confirmation). Archive is the default; delete is the deliberate path.

### Finding work

- A search box filters the visible board by title and description text as you type.

- Filters by label, assignee, priority, and due state (overdue / due this week / no date) combine with AND, and are reflected in the URL fragment so a filtered direct-file view can be bookmarked without a server or router.

### Persistence and safety

- Every change is persisted automatically; there is no save button. The UI reports a change as saved only after its browser-storage transaction commits. Terminating the browser during a write must not lose any previously acknowledged change in the supported browser's tested durability mode. An interrupted transaction must leave either the complete old state or the complete new state, never a partial mutation.

- Text entered before a transaction commits is retained in a local draft journal. Storage denial, quota exhaustion or a failed write is visibly reported; the app must never claim success or silently fall back to volatile memory. Document browser storage eviction, private browsing and device failure as limits rather than promising protection against them.

- Every card mutation is written to the Activity log, and the card detail view shows that history.

- Undo (`Ctrl+Z`) reverses the last move, edit, or delete within the session.

- Full-workspace JSON backup download and restore from a user-selected JSON file are mandatory MVP features. Restore validates the file before changing data and requires confirmation before replacing an existing workspace. Moving or renaming the HTML, changing browsers or changing profiles must have a documented backup/restore path; browser storage must not be assumed to travel with the HTML file.

### Acceptance tests for Tier 1

- Creating, moving, editing, archiving, and deleting a card each have an automated test that asserts the persisted state after a fresh reload.

- A drag-and-drop reorder test proves order survives browser restart.

- A crash test terminates the browser process during a storage transaction, reopens the delivered HTML using the same profile and file path, and proves stored state is consistent. It also verifies that previously acknowledged changes survive.

- A backup/restore test exports a populated workspace, imports it into a fresh browser profile, and asserts lossless recovery of all workspace entities and activity history.

- Storage-denied and quota-exhaustion tests prove a failed write is never displayed as saved.

### Single-file acceptance tests, mandatory for every release

- `bun run build` produces `dist/fieldboard.html` as the only required deployment artifact. An automated artifact check rejects external resource references, unresolved imports and references to build-machine paths or adjacent application files. Stored user links are data, not application resource references.

- A real-browser test copies only that HTML into an otherwise empty directory, then opens it through `file://` in a fresh browser profile with networking disabled and no local server running. It exercises project creation, card creation, editing, Markdown preview, moving, filtering, archive/restore, deletion, undo and backup/restore without any external resource request or application error. Later-tier features, when shipped, are exercised under the same isolated conditions.

- After browser shutdown and restart, reopening the copied HTML at the same path and in the same profile restores the acknowledged workspace and card order.

- The README lists the browser names and versions in which direct-file launch and persistence were tested. At least one standard browser on Linux must pass all mandatory direct-file checks without special flags. Unsupported or unavailable persistent storage produces a visible error, not a false claim that the app is fully usable.

- Screenshots and browser-test evidence come from the delivered HTML, not only from a development-server version. Passing source-level or server-based tests alone does not satisfy this deployment requirement.

## Tier 2: Should have

### Flow control

- **WIP limits** per column: the column header shows `n / limit`, turns amber at the limit and red above it. Exceeding is allowed but always visible.

- **Blocked state:** any card can be marked blocked with a reason; blocked cards render with a distinct visual treatment and can be filtered.

- **Card dependencies:** a card can block, or be blocked by, another card. A card whose blocker is not done shows that relationship on its face.

### Organisation

- **Swimlanes:** a board can group rows by assignee, priority, label, or epic, and cards move between lanes by drag.

- **Epics / parent cards:** a card can be a parent of other cards, showing aggregate progress of its children.

- **Multiple boards per project** and a cross-project "My Work" view listing every card assigned to me, grouped by due date.

- **Templates:** card templates (pre-filled description and subtasks) and board templates (column set + WIP limits) can be saved and reused.

### Speed

- **Keyboard-first:** every common action has a shortcut: `n` new card, `/` search, `e` edit, `←/→` move card between columns, `j/k` navigate, `?` shows the shortcut cheatsheet.

- **Command palette** (`Ctrl+K`) reaches any project, board, card, or action by fuzzy search.

- **Bulk actions:** multi-select cards (shift/ctrl-click) to move, label, assign, or archive them together.

- **Quick-add syntax:** typing `Fix login #bug @paulo !high ^friday` creates a card with label, assignee, priority, and due date parsed out.

### Views

- **List view:** the same cards as a sortable, groupable table.

- **Calendar view:** cards with due dates placed on a month/week calendar; dragging a card to a new day changes its due date.

- **Timeline view:** cards with start and due dates shown as bars (Gantt-style), with dependencies drawn as arrows.

## Tier 3: Nice to have

### Insight

- **Cumulative flow diagram** per board over a selectable time range.

- **Cycle time and lead time** per card and as board-level distributions (median, 85th percentile).

- **Throughput chart:** cards completed per week.

- **Aging indicator:** cards that have sat in one column longer than a configurable threshold show their age on the card face.

- **Burndown / burnup** for a sprint or milestone.

### Planning

- **Sprints / iterations:** time-boxed containers with a start and end date, a scope, and a close-out that moves unfinished cards forward.

- **Recurring cards:** a card can recur daily/weekly/monthly and regenerates in a chosen column. Recurrences missed while the app was closed are reconciled on launch without a background service.

- **Time tracking:** start/stop timer on a card, manual entries, and a per-card total alongside the estimate.

- **Estimates:** story points or hours, summed per column and per swimlane.

### Automation

- **Rules engine:** "when a card enters Done, check all subtasks"; "when a card is overdue, add label `late`"; "when a card moves to Review, assign the reviewer". Rules are listed, toggleable, and every rule firing appears in the Activity log. Time-based rules run while the app is open and are reconciled on launch.

- **Auto-archive:** cards in done columns older than N days are archived automatically while the app is open or when it is next launched.

### Local team organisation

- **Members and @mentions:** local member identities can be assigned to cards or mentioned in comments and descriptions. They are workspace records, not authenticated accounts.

- **Notifications inbox:** local notifications for mentions, assignments, and due-date reminders are generated while the app is running; overdue reminders are reconciled when it is reopened. No push service or background daemon is required.

- **Watchers:** local member records can subscribe to card changes shown in the local notifications inbox.

- **Deferred, outside the standalone release:** authenticated multi-user roles and real-time synchronisation between separate browsers or devices. These require a separately approved architecture and an explicit revision of the deployment constraints. They are not acceptance requirements for the single-file app.

### Integration and data

- **Attachments:** files and images can be added to a card by drag-drop or paste, with image thumbnails. Their contents are stored locally in browser storage and included in workspace backups, with no upload service or application sidecar files.

- **Links:** a card can reference a URL, a git commit, or a GitHub issue/PR, rendered as a chip from locally supplied metadata. Remote previews and GitHub API calls are not required or performed automatically.

- **Import:** from user-selected Trello JSON, exported GitHub Issues JSON, and CSV files. Import is processed entirely within the browser; live service integrations are deferred.

- **Export:** board export to CSV and Markdown. Lossless full-workspace JSON export and restore are already mandatory in Tier 1; later-tier data must also round-trip through that format.

- **Deferred, outside the standalone release:** a hosted REST API, an external CLI runtime and outbound webhooks. These do not fit a browser-only deployment and are not acceptance requirements for this artifact.

### Polish

- **Themes:** light and dark mode following the system preference, with a manual override.

- **Responsive:** usable on a phone; columns scroll horizontally, cards move via a "Move to…" menu when drag is impractical.

- **Accessibility:** full keyboard operation, visible focus, screen-reader labels on every control, WCAG AA contrast.

- **Card cover images and custom card colours.**

- **Focus mode:** hide everything except cards assigned to me.

- **Offline operation:** already mandatory from Tier 1 on first direct-file launch, with no prior network visit or cache warm-up. Installable PWA packaging and reconnect synchronisation are deferred if they require separate manifest/service-worker files, an origin server or an external service; they cannot replace the required standalone HTML.

## Non-Functional Requirements

- A board with 1,000 cards renders and scrolls smoothly (60 fps on a mid-range laptop) and drag feedback begins within 50 ms.

- A card move persists in under 100 ms locally.

- All user-supplied Markdown is sanitised within the browser; no stored input can execute script when viewed. Markdown rendering must not load remote images or other external resources.

- The browser-storage schema is versioned with forward migrations, and a migration test runs against a populated fixture. Schema upgrades preserve existing workspace data at the same storage identity.

- A daily automatic local snapshot of the workspace is kept, with the last 7 retained. Snapshots are created while the app is running, with a catch-up snapshot on the next launch after an inactive day. No background execution is promised while the HTML is closed. Restoring a retained snapshot is one documented in-app action with confirmation. A downloadable backup and file-based restore are also required, because snapshots in the same browser storage do not protect against storage eviction or device loss.

- The README distinguishes the application artifact from workspace data. It documents where data is stored, the supported browser/file-path behaviour, storage limits, backup procedures and how to move a workspace to another computer.

- All performance, security, persistence and offline acceptance checks target the built single HTML file. A network-dependent implementation is noncompliant even if it appears offline after its assets have been cached.

## Definition of Done

A tier is done when every claim in it:

1. has an automated test that failed before the implementation and passes after it;

2. has been exercised in a real browser, with a screenshot as evidence for anything visual;

3. is documented in the README with the command or interaction that uses it;

4. passes the mandatory single-file acceptance tests from an isolated copy of `dist/fieldboard.html`.

A release is not done if it requires anything beyond the HTML file and a supported standard browser to run. Build tools and test dependencies belong to the development environment only. Server-dependent wishlist items explicitly marked deferred above are excluded from the standalone tier criteria; all other in-scope claims remain mandatory.

"Should work" is not a status. If a claim cannot be verified, say so explicitly and leave it open. Any server-backed implementation must not be described as satisfying this revised deployment requirement until it has been changed and the built artifact passes these checks.

## Deliverables

- **Final application:** `dist/fieldboard.html`, a single self-contained file that runs when opened directly in a supported browser. No adjacent application assets or installed runtime are needed.

- **Source and build:** strict TypeScript source in this folder, with `bun install && bun run build` producing that HTML. `bun run dev` may be used for development, but users of the final file do not run it.

- **Tests:** a green suite runnable with `bun test`, including artifact checks and the real-browser single-file acceptance tests. Missing browser verification leaves the release open; skipped tests are not a passing release verdict.

- **README:** separate developer build instructions from end-user instructions to open the HTML. Cover the feature list per tier with status, keyboard shortcuts, the data model, supported browser versions, direct-file persistence limits, backup/restore, and development/bundled dependencies with versions and licences. State explicitly that external runtime dependencies are zero.

- **Evidence:** screenshots and test results from the isolated final HTML, including first launch with networking disabled, browser-restart persistence and lossless backup/restore.

- A short `DECISIONS.md` recording each non-obvious technical choice and the reason for it, including browser storage and the single-file bundling strategy.
