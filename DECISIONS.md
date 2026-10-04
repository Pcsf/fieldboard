# Technical decisions

## Single HTML, no runtime packages

Bun bundles strict TypeScript into one browser IIFE. The build inserts the bundle and CSS into an HTML shell, calculates the script’s SHA-256 CSP hash and writes `dist/fieldboard.html`. No modules, workers, fonts, images or sidecar files are loaded at runtime. There are no bundled third-party runtime licences because the application uses only its own code and browser APIs.

A framework was not needed for this board. DOM nodes are reused by column/card identity so that moving one card does not replace a thousand-card board. Styling is embedded; symbols and system fonts replace icon/font downloads.

## One atomic workspace record

IndexedDB is the system of record. Each mutation writes the whole validated workspace in a strict-durability transaction. This makes the atomicity boundary include card order, completion state and activity together. A saved acknowledgment comes from `transaction.oncomplete`, never a successful request or an optimistic render.

The tradeoff is write amplification and a practical workspace-size limit. Append-only history and full-state localStorage drafts can exceed the smaller journal quota before IndexedDB fills. Quota failures stay visible. This MVP does not prune history or quietly stop journalling to hide that limit.

Schema version 2 adds completion timestamps to version-1 data. Migration runs in the IndexedDB upgrade transaction, preserving storage identity. Unknown future schemas are rejected instead of guessed at.

## Drafts and concurrent tabs

The localStorage journal is written before submitting a new workspace state. A later queued draft includes its in-flight predecessor so startup can distinguish a committed predecessor from an unrelated conflicting revision after a crash. Draft clearing is conditional on the previously observed journal value.

Web Locks provides an exclusive editor lock. A second tab cannot edit until the first closes. IndexedDB revision comparisons are an additional stale-writer check, not a claim of multi-user collaboration. localStorage comparisons alone are not cross-process compare-and-swap, which is why they are not the concurrency authority.

Raw text has a separate journal. Text is also retained in memory if that journal fails, and an independent error prevents unrelated successful writes from making the UI claim the rejected text was saved. The error offers a draft download. Storage denial cannot be made durable by software; closing the tab while both stores reject writes can lose unexported text.

## Activity and undo

Each card mutation records actor, action, timestamp and complete before/after values. Reordering also logs cards whose numeric positions change. Deleted cards retain history. Undo restores a previous session state but appends audit entries rather than rewinding history. Member records referenced by history remain available.

Restore is an explicit whole-workspace replacement with confirmation and a cleared undo stack. JSON preserves domain entities and history; the local revision advances independently to maintain concurrency safety.

## Local snapshots are not backups

A snapshot stores the committed workspace once per active local day. The last seven snapshot dates are retained. Launch and a one-minute timer provide catch-up while the app runs; there is no background claim while the file is closed. User-downloaded JSON is the recovery path for another profile, changed file identity or device loss.

## Markdown and browser security

Markdown is a deliberately small allowlist renderer, not a general HTML interpreter. Text is escaped before formatting. Only HTTP(S) Markdown links become anchors, with `noopener noreferrer`; images stay textual. A CSP permits only the build-hashed script, blocks resource images, connections, frames, objects and form submission, and permits embedded styles. Stored user links are navigation data, not runtime dependencies.

## Verification boundaries

Bun unit tests cover the domain, draft/revision logic, schema migration and snapshot retention. Playwright exercises the isolated built HTML with networking disabled, using separate persistent profiles for recovery tests. Crash testing kills the actual test-owned browser process while a strict transaction is held open.

The container runs as root, so these Chromium tests require the test harness’s sandbox exception. That is not normal desktop acceptance. The same suite also passes as an unprivileged desktop user with the sandbox enabled; a normal headed launch is still unrecorded. No sandbox-disabling instruction is given to end users. The unflagged Linux browser gate, physical 60 fps test and full visual review remain open. Supplemental tests first observed passing after implementation are documented as such rather than being described as red-first proof.

## Tier boundary

Tier 1 and the mandatory deployment/safety requirements retain their original acceptance limits. The explicit request to integrate the copied FPGA estimation methodology authorizes a bounded planning extension before those limits close; it does not authorize the rest of Tier 2/3. The MVP uses one board per newly created project; the data model retains the project-to-many-boards relationship without exposing later-tier board management.

## IED planning extension

IED is separate from the original unitless card estimate. Optional schema-2 fields preserve old workspaces byte-for-byte on load and avoid assigning units to old data. Planning fields are structurally validated in live cards, calibration snapshots and historical before/after records. Unknown future schema versions remain rejected. Downgrading to an older app is not supported for newly added data; no compatibility guarantee is inferred from sharing a schema number.

The calculation module implements the reference formulas rather than copying the notes' rounded examples. Verification scales only verification. Debug and timing tasks use an unsplit range because the reference does not supply a split. Documentation is 10% of adjusted RTL by default; platform costs are added after module contingency. Independent ranges use conservative bounds. The architecture gate uses the maximum effective multiplier over those ranges, with 4 as the limit, and does not clamp the result.

All project cards count, including archived/done work. Unestimated cards are counted and withhold calendar quotes instead of becoming zero effort. Old unitless estimates are ignored. Whole-program bands are a separate sanity check, not another multiplier on the detailed sum. The integration band is additive and excluded from whole-program comparison.

Calendar output is a capacity scenario. Numbered sprint loads include module contingency; platform overheads remain visible as unallocated reserve. No scheduling, dependency or full sprint-lifecycle claim is made. Calibration observations copy their estimate inputs at recording time, so later edits cannot rewrite the measurement. The project summary uses the latest observation per task and never sums revisions or silently tunes factors.

The UI uses the existing journal, staging, undo and storage paths. Dynamic scope and learning text is escaped before rendering. The extension adds no runtime dependency or network access. Its Playwright assertions cover delivered-file interactions and persisted data; screenshots do not close faithful visual or motion acceptance.
