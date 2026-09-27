# Handover — 2026-09-28

## 2026-09-28: editing interactions and natural tables

The active goal remains `docs/FILE_EDITOR_PARITY.md`: reach Obsidian-class
editing for local Markdown files and test it extensively. Milestone 1 P1–P4 is
committed as `33c626d` (details below). This checkpoint completes E1 list,
pairing, and folding interactions, and E2 rendered-table interactions. It also
delivers the table sort, move, and alignment part of E3. The parity goal is
**still active**: I1 rich paste, I2 local attachments, W1 document tabs, D1
editing outline/properties, and E3 editor preferences remain.

### Implementation map

- `src/editor/editing.ts` uses CodeMirror Markdown commands for list Enter and
  Backspace, and composes mixed-cursor edits into one undoable transaction when
  one cursor is inside a list and another is not. Tab/Shift+Tab adjust list
  indentation. `src/editor/setup.ts` installs bracket/quote/backtick pairing and
  the editing bindings. Native and browser tests exercise actual saved Markdown
  in live preview and source mode.
- `src/editor/syntax.ts` supplies heading section folds. CodeMirror's syntax
  tree can cover only the visible prefix of a large document. The fallback
  locates source lines that could be peer headings, then asks CodeMirror's
  Markdown parser whether each is really a top-level heading. This avoids
  mistaking code, HTML, rules, or list children for section boundaries. Nested
  headings use their parsed container boundary. The scan stops after 2,500
  lines or a 20 ms budget and offers no fold if the boundary is unknown,
  avoiding a truncated fold or long main-thread pause. A 1.1 MB pure-state
  probe takes about 1.3 ms here and safely offers no fold. `src/editor/folding.ts` renders
  named, keyboard-focusable gutter buttons and preserves focus after toggling.
- `src/editor/live-preview/widgets.ts` keeps rendered tables visible while
  editing a cell. A click places the caret near the clicked text for plain
  cells; formatted cells place it at the end of the Markdown source so a click
  cannot land inside hidden link/emphasis syntax. Grapheme-aware hit testing
  avoids splitting emoji or combining characters. Long-cell hit testing uses
  bounded measurement. Tab/Shift+Tab and Enter navigate/add rows; arrows move
  among focused cells, typing replaces a focused value, and Escape leaves the
  cell selected. The context menu has insert/delete/move row and column,
  numeric-aware sort, and alignment actions. It returns focus immediately.
- `src/domain/table.ts` holds pure cell, sort, move, and alignment transforms.
  `src/editor/live-preview/index.ts` applies them as Markdown transactions;
  structural actions isolate history so each has its own undo step. No-op
  sorts and moves do not mark a document edited. `README.md` documents use.

### Acceptance evidence

- Unit tests cover lists, multiple cursors, code fences, folding partial trees,
  HTML blocks, nested lists, escaped pipes, malformed/extra table cells, sort
  order, alignment, and no data loss in column moves.
- Browser `e2e/editing-interactions.spec.ts` and `e2e/tables.spec.ts` assert
  source bytes, undo/redo, save/reopen, keyboard focus, malformed delimiters,
  and a 20,000-character table cell. Native `list-editing`, `fold-editing`, and
  `table` specs assert actual file bytes and visible actions in WebKitGTK.
- Final gates passed: 372/372 Vitest tests, TypeScript checks for the app and
  native E2E, 51/51 Rust tests, 89/89 Chromium E2E tests, 19/19 native E2E
  specs, and `tauri build --no-bundle`. The startup bundle gate passed at
  40/41 KiB and the prepaint gate at 54/56 KiB. The release binary and installed
  `/home/chong/.local/bin/scrivo` both have SHA-256
  `300ecc4ddd31869b739c93a53380ff0ecd5bc08bfb0f6b4e4829cb737b108def`.
  The running window was left open to preserve possible unsaved work; the new
  binary runs on its next launch. Earlier checkpoint numbers below are
  historical and do not supersede this section.

### Resume order

1. Start with `docs/FILE_EDITOR_PARITY.md` and `docs/FILE_EDITOR_AUDIT.md`.
   Do not restart an already-running Scrivo window if it may contain unsaved
   work; the installed executable takes effect on next launch.
2. Implement I1 HTML-to-Markdown paste as a pure conversion plus a small
   clipboard adapter. Test unsafe HTML/URLs, plain-text fallback, formatting,
   tables, save/reopen, and native clipboard behavior.
3. Implement I2 local attachments and drop handling, then W1 independent
   document tabs, D1 editor outline/properties, and remaining E3 preferences.
   Keep the startup bundle gate and native behavior tests on each milestone.

Do not mark the active parity goal complete until the remaining IDs and release
criteria in `FILE_EDITOR_PARITY.md` pass.

## 2026-09-28: file editor parity, durable editing checkpoint

The active goal is `docs/FILE_EDITOR_PARITY.md`: make Scrivo an Obsidian-class
local Markdown file editor and test the work extensively. The table-editing
checkpoint below is committed as `3298091`. This checkpoint implements milestone
1, P1–P4: autosave, visible save state, crash recovery, and deliberate handling
of external edits. `docs/FILE_EDITOR_AUDIT.md` records the milestone 0 native
behavior matrix. This is a checkpoint, **not completion of the parity goal**.

### What changed and where

- `src/app/controller.ts` owns the durable-editing state. Existing named files
  autosave after 2 seconds idle through the existing serial queue and conditional
  `fs.write`. Save status is `saved`, `edited`, `saving`, or `action-needed`; the
  last state pauses autosave after failure/conflict. Manual Save retries and can
  reload, Save As, or confirm overwrite. The saved snapshot is captured before
  each write; edits made while it is in flight stay dirty and save later.
- `src/app/ports.ts` defines `RecoveryStore` and recovery prompt contracts;
  `src/platform/memory.ts` backs tests and `src/platform/tauri.ts` invokes the
  native commands. `src-tauri/src/recovery.rs` stores JSON recovery copies under
  the Tauri app-data `recovery/` directory using a synced same-directory temp
  file and atomic replacement. Unix directory/file modes are 0700/0600. The
  first dirty change starts a write immediately; later changes are throttled
  to 500 ms. Each document's latest copy is kept until saved or explicitly
  discarded; seven-day/100 MiB limits apply to redundant history only.
- `src/ui/save-status.ts`, `status-bar.ts`, `dialog.ts`, and `recovery-prompt.ts`
  provide the visible state, retry control, and Restore/Discard UI. Dialog code
  stays in lazy editor imports, preserving the startup budget. Escape cancels
  a recovery prompt without deleting the copy.
- `src/app/workspace.ts` checks for recovery after the reading view paints.
  Recovery copies for missing named files can be offered even if launch has no
  file path. Accepting a copy for another path surfaces it in the editor; an
  existing editor in reading mode re-renders after a successful reopen even
  when the path stays the same. These two hidden-buffer bugs were found in
  independent review and have unit and native coverage.
- Native E2E fixtures now set `XDG_DATA_HOME` per test directory so crash and
  recovery tests cannot touch the user's real Scrivo data. New native specs
  cover real autosave bytes, a competing external writer, SIGKILL/relaunch of
  untitled text, deleted named recovery, and recovery while viewing another file.

### Safety details and known limit

The controller never changes its known file stamp merely because the user chose
“Keep Mine.” A later save still requires a conditional write or explicit
resolution. Overwrite confirmation uses the disk stamp observed before the
dialog, so a third writer during the dialog yields another conflict. Reload
rechecks the editor version after awaiting the file read; it cannot replace an
edit typed during that read. Close/open/new refuse to drop edits typed while a
chosen Save is in flight. A deleted file triggers an immediate recovery write.
Undoing back to the saved text removes an obsolete copy after pending writes.
If another edit arrives while a clean save removes its recovery copy, removal
immediately queues a new first checkpoint; queued writes for a clean or replaced
document are skipped. The regression is covered in the controller tests.

Recovery IPC is asynchronous. A SIGKILL before the latest copy has finished
writing can lose those last keystrokes; the native crash test waits until a
copy exists and then verifies exact restored Markdown. There is no true
instantaneous guarantee at the keypress boundary. The latest copy for each
identity may exceed the soft 100 MiB cap; that deliberate choice satisfies the
requirement to keep one copy per dirty document. There is no multi-document
session yet, so multiple in-memory tabs and independent watchers are future W1.

### Verification and release

Final source verification: 336/336 Vitest tests across 17 files; 51/51 Rust
tests; 78/78 full Chromium E2E at two workers; 17/17 native WebKitGTK specs,
22/22 tests; application and native-test TypeScript typechecks; and the web
startup gate at 40/41 KiB startup JS/CSS and 54/56 KiB known prepaint JS/CSS.
One first Chromium run with four workers hit exactly 250 ms on a strict
`<250 ms` frame-gap assertion in an unrelated giant-code performance test;
both two-worker full reruns passed. The release build and installed binary
match: SHA-256
`136bcb797c604e5cc362a164d0288fcf465e760cc08e206daf1fb296d71d27de`
for both `src-tauri/target/release/scrivo` and
`/home/chong/.local/bin/scrivo`. The existing live process was left alone;
restart it when its unsaved work is safe.

Useful commands:

```sh
bun run typecheck
bunx tsc --noEmit -p e2e-native/tsconfig.json
bun run test
cargo test -q --manifest-path src-tauri/Cargo.toml
bun run build:web
bunx playwright test --project=chromium --workers=2
bun run test:e2e:native
bunx tauri build --no-bundle
```

### Resume work

1. Confirm this checkpoint commit and the installed binary hash above. Do not
   restart a live Scrivo window without preserving its unsaved content.
2. Continue milestone 2 E1: list continuation/termination, indentation,
   paired syntax, and folding, with pure Markdown transforms and CodeMirror
   bindings. Expand E2 acceptance on malformed/escaped/large tables; direct
   cell editing and row/column actions already exist.
3. Then implement I1 rich HTML paste and I2 local attachments, W1 independent
   document tabs, and D1 edit outline/properties. E3 table sort/move/alignment
   and preferences remain later scope. Keep `docs/FILE_EDITOR_PARITY.md` status
   current and check the native behavior matrix before each milestone.

Do not mark the active parity goal complete until the remaining feature IDs and
release criteria in `FILE_EDITOR_PARITY.md` are satisfied.

## 2026-09-28: live table editing

The current work adds Obsidian-style cell editing to Scrivo's CodeMirror live
preview. Previously, clicking a rendered cell revealed the entire raw Markdown
table. Now a focused input edits that cell while the table stays rendered. Each
input change updates the Markdown document through a normal undoable CodeMirror
transaction. `Tab`/`Shift+Tab` move across cells, `Enter` moves down, and moving
beyond the last row adds an empty row. Right-click or `Shift+F10` opens row and
column insert/delete actions; the menu returns focus to the table. Document
shortcuts remain available from focused cells. Source mode (`Ctrl+/`) still
provides direct Markdown editing.

The pure helpers in `src/domain/table.ts` find cells, escape typed pipes, and
perform structural edits. `src/editor/live-preview/build.ts` builds a lazy table
model; `widgets.ts` renders it and preserves the active input during source
updates. Its `updateDOM` compares cell source and redraws only changed cells,
while checking table shape and alignment. An external edit to the active cell
closes the stale input. `src/editor/live-preview/index.ts` applies changes to
the CodeMirror document. `src/editor/setup.ts` bridges document shortcuts while
focus is inside the widget. CSS and user instructions are in `editor.css` and
`README.md`.

Adversarial review found and prompted fixes for surplus cells being discarded
by column edits, compact cells ending in a backslash swallowing the next pipe,
quadratic redraw work, stale focused inputs, table-shape reuse, and focus after
menu actions. Unit tests cover the pure edge cases; browser tests assert actual
Markdown output, save, undo, row/column actions, focus, and external updates.

Verification: app/native TypeScript typechecks and **314/314** Vitest tests passed.
The targeted Chromium table suite passed **9/9**, and the full Chromium suite
passed **72/72** with four workers. The full native WebKitGTK suite passed
**13/13 specs, 17/17 tests**, including a new rendered-cell edit and disk-save
check. Its first draft failed because the initial caret kept the table in raw
source mode; after moving the caret out, WebKit WebDriver's `setValue()` lost a
replaced input element. The final test uses actual key input and passes. The
release build and bundle gate passed at 41/41 KiB startup JS/CSS and 55/56 KiB
known prepaint JS/CSS. Headless screenshots of a focused cell and the table
menu were visually reviewed. The release binary was installed atomically at
`/home/chong/.local/bin/scrivo`; installed and release SHA-256 both equal
`bad687564f8198b677d2845011bbc4f235382819e7a139a7dc494abf08f83543`.
An already-running Scrivo process retains the older executable until restarted;
it was left open to avoid disturbing unsaved work.

Known scope: direct cell editing and row/column insertion/deletion are present;
sorting, moving rows/columns, and alignment menu actions from Obsidian remain
future work. The context menu is portaled outside CodeMirror, so document
shortcuts do not run while that transient menu has focus. The previous Linux
save-race checkpoint begins below; its remaining risks and Windows deferral
still apply.

## Previous Linux checkpoint: existing-file save race

The active request was to commit the two-phase startup preview, fix the known
existing-target save race, run the Linux verification suites, and leave a
complete handover. Startup preview is committed as `ff434f3` (`WIP: Load large
startup documents in two phases`). This checkpoint changes only document saving,
its tests/dependency, and documentation. No further performance experiment was
run. Windows runtime verification is explicitly deferred to a separate goal.

### Save behavior and evidence

`src-tauri/src/document_io.rs` previously checked the target's `FileStamp`
after writing the temp file, then used `fs::rename(temp, target)`. Another process
could edit or replace the target between those steps; the save then reported
success while discarding that change. Two deterministic tests injected a late
edit after the last check for both `Unchanged` and confirmed `Overwrite`. Both
failed against the old implementation, establishing the regression before the
fix.

On Linux, an existing-target save now snapshots the initial target's inode,
metadata, and streamed SHA-256 content; verifies the prepared temp file belongs
to this save and contains the requested bytes; and exchanges the temp with the
target using `renameat2(RENAME_EXCHANGE)`. It checks the displaced inode against
the initial snapshot (ignoring ctime changed by the exchange). If it differs,
Scrivo exchanges the files back and reports a conflict. It also checks the
installed inode/content before reporting success. If namespace contention
prevents safe recovery, the competing version is retained at the temp path and
the I/O error names that path. A temp pathname replaced before failure cleanup's
identity check is retained. The original file's permissions are copied through
the open temp handle. `sha2` is now a Linux dependency; it was
already a Windows dependency.

The tests cover late in-place edits for both conditions, replacement, same-size
content with restored mtime, permission change, symlink retargeting, another
replacement/edit after exchange, prepared-file tampering, and temp pathname
replacement. Review found and corrected several false-success paths during this
work. The focused Linux document I/O suite passes **35/35** tests.

This is a fail-closed recovery protocol, not a filesystem transaction. Linux's
[documented rename flags](https://man7.org/linux/man-pages/man2/rename.2.html)
provide exchange and no-replace, but no compare-and-replace for an existing
pathname. A competing writer with
an already-open descriptor can still edit the displaced inode after its final
scan and before cleanup. A namespace change between recovery's identity check
and exchange can also leave a competing file at the temp path for manual
recovery. Review also identified a temp-path check→unlink race in both normal
success and error cleanup: another process replacing that hidden path in the
window can have its replacement unlinked. A stat-before-unlink guard narrows but
does not close this race. Filesystems that do not support `RENAME_EXCHANGE` return an unsupported
I/O error for existing-target saves. Non-Linux platforms still use their prior
final-check then rename path; Windows runtime behavior remains unverified here.
Do not describe this as an absolute guarantee against uncooperative concurrent
writers. The Linux path hashes the existing file and installed copy with a
fixed 64 KiB buffer, so saving now adds I/O proportional to document size; save
latency was not benchmarked under this goal. See `docs/ARCHITECTURE.md` for the
safety contract.

### Verification and current work

- Rust focused document I/O: **35/35 passed** after the final temp cleanup test.
- Chromium: the first 12-worker full run missed a 250 ms frame-gap threshold in
  the giant Unicode block test (observed 266.6 ms); the isolated test passed at
  83.3 ms. A full four-worker rerun passed **65/65** in 18.2 seconds.
- Native WebKitGTK suite: **12/12 specs, 16/16 tests passed**, including byte
  preservation and external-change save behavior.
- Rust app suite: **48/48 passed**. Rust renderer suite: **35/35 passed**.
- TypeScript app and native typechecks: passed. Vitest: **309/309 passed**.
- Release build: passed (`bunx tauri build --no-bundle`). The bundle gate passed
  at 41/41 KiB startup JS/CSS and 55/56 KiB known prepaint JS/CSS.
- The final native rerun after the open-handle permission change also passed
  **12/12 specs, 16/16 tests**.

The next agent should inspect the final commit and `git status`, review any
remaining native failures if present, and keep Windows runtime verification as
a separate goal. For future Linux save work, address the residual held-descriptor
window only with a design that can give a stronger contract; avoid treating an
extra stamp check as atomic compare-and-swap. Do not restart startup performance
experiments under this goal.

## Previous startup checkpoint (`ff434f3`)

The user wants Scrivo, a Typora-like markdown reader/editor, working, thoroughly
verified, and exceptionally fast at startup. The broader goal remains open; there
is no release or deployment. The current product checkpoint implements a complete
two-phase startup response for large rendered documents. Earlier checkpoints
include atomic conditional saves, native Unicode boundary coverage, progressive
reading and edit-to-reading transitions, early Find, giant code-block containment,
code highlighting after paint, and reviewed startup benchmarks.

**Current resume point:** `startup_preview` sends the first complete renderer
chunk when the rest of the HTML is at least 64 KiB. The original cached
`startup_view` response supplies the full document after the preview reaches the
screen. The reader preserves its visible prefix and appends later chunks; Find
waits for completion, anchors requested early are queued, and stale tails are
ignored after navigation or edit handoff. A first chunk too short to fill 1.5
screens waits for the tail before claiming the first screen is ready. A failed
tail rejects completion, displays a persistent warning with Retry, and leaves
the prefix readable. Successful Retry restores focus, Find, and highlighting.
The failure view loads only on demand. The startup bundle gate is now 41 KiB
static JS/CSS and remains 56 KiB including the known prepaint window import.

Key code: `src-tauri/src/commands.rs` selects a UTF-16-safe preview boundary
without an extra full-document clone; `src/platform/tauri.ts` supplies the full
cached tail; `src/viewer/viewer.ts` owns the tail lifecycle; `src/viewer/tail-failure.ts`
and `src/styles/tail-failure.css` provide the deferred warning; `src/boot.ts`
connects completion to Find/highlighting. `src/app/workspace.ts` passes the
optional tail loader through the existing startup flow.

**Release A/B results against the preserved baseline:** every launch passed its
reviewed first-viewport reference. In 12 paired rounds each, candidate minus
baseline first-viewport medians were large.md **−9 ms** (8/12 faster) and the
synthetic 5 MB fixture **−38 ms** (11/12 faster). Medium.md was **+7 ms** (4/12
faster), and a second 12-pair medium run was **+6 ms** (5/12 faster). Paired
content-after-window medians for these four runs were −8, −35, +1, and +1.5 ms,
respectively. The medium first-viewport deltas largely tracked window timing;
these runs do not prove a medium startup improvement. They also do not establish
a statistically robust gain for large.md. The 5 MB gain is the clearest result.
Raw logs: `bench/results/paired-complete-preview-{large,5mb,medium,medium-repeat}.txt`.
Baseline binary `/tmp/scrivo-before-preview-probe` has SHA-256
`60d13b8e46171297babc0397397f5ba456132582e4d94ae8d81f486958e7570f`;
measured candidate binary had SHA-256
`9caf3baad909070addea99606f837dcc5559a979c0405d2db26a391114950029`.
After the anchor-only navigation fix, the final release binary at
`src-tauri/target/release/scrivo` has SHA-256
`17e42a87a77e91cd7406c8d77251d04a42eebff58795293a41fcb6a03eb5043d`.
That final fix was not part of the A/B runs; it does not touch the first viewport.
The 5 MB fixture is `/tmp/scrivo-startup-5mb.md`, SHA-256
`311f3ca19187aa4342ec4766bfa58daf5f03b7f3ca804fc08bc42c1ea03228ea`;
its recipe and reference are below.

**Verification for this checkpoint:** TypeScript typecheck, 309/309 Vitest tests,
38/38 Rust app tests, 35/35 renderer tests, 64/64 existing Chromium E2E tests,
and the final 12/12 native WebKitGTK specs (16/16 tests) passed. The additional
browser regression `e2e/reading-tail-retry.spec.ts` passed:
failed tail → persistent warning → Retry → full-document Find and code highlighting,
with reader focus restored. An adversarial review found and fixed a stale queued
anchor replay after a newer successful jump; a dedicated unit test covers it.
The release build and bundle gate passed: 41/41 KiB
startup, 55/56 KiB known prepaint.

**At that checkpoint:** the existing-target final save check→rename race and
Windows runtime verification remained. The save work is described above; the
old raw binary IPC and first-layout experiments below were reverted and remain
history, not active code.

Read `README.md` for usage and the latest performance table,
`docs/ARCHITECTURE.md` for layers and safety/performance decisions, and
`docs/CONVENTIONS.md` for coding and testing rules. Key code entry points are
`src/boot.ts` (composition root), `src/app/workspace.ts` (document state and disk
transitions), `src/app/controller.ts` (actions), `src/platform/tauri.ts` (native
adapter), `src/viewer/viewer.ts` (progressive reading view), and
`src-tauri/src/document_io.rs` (atomic conditional writes).

## Latest startup investigation (after `eec536a`)

- **First-chunk preview upper bound, reverted.** A temporary `startup_view`
  response truncated rendered HTML at the first complete renderer chunk and
  omitted the rest. Its first viewport matched the reviewed screenshot in one
  smoke run for each fixture and in **12/12 paired rounds** each. Because the
  tail never arrived, this build was intentionally incomplete and is **not** a
  candidate for release or a proven production speedup. Candidate minus baseline
  first-viewport paired medians were **−1 ms** medium (6/12 faster), **−60 ms**
  large (8/12 faster), and **−32 ms** synthetic 5 MB (10/12 faster). Paired
  content-after-window medians were −12, −31.5, and −34 ms, respectively. Host
  load varied substantially, so these are an upper bound to investigate, not a
  promised gain. The probe also removed background tail insertion and highlighting
  work, so its effect cannot be attributed solely to IPC. Raw rounds are
  `bench/results/paired-preview-upper-{medium,large,5mb}.txt`. Baseline binary
  SHA-256 was `60d13b8e46171297babc0397397f5ba456132582e4d94ae8d81f486958e7570f`;
  incomplete probe binary was
  `7d167408e6acfdc7592944254c77595bccd93059d996b91842794ef68b63bba3`.
  Both source and release binary were restored to the baseline after the probe.
  A production attempt is justified only if its complete tail path retains a
  material paired first-viewport gain while all tail, Find, anchor, cancellation,
  Unicode, and failure outcomes pass.
- **First-screen layout experiment, reverted.** A three-run diagnostic instrumented
  `viewer.show()` without changing its insertion order. For medium, large, and
  synthetic 5 MB documents it appended exactly **24 initial blocks** in about
  **1–2 ms**; the two `scrollHeight` checks together took **25–46 ms**. Raw
  verified traces are `bench/results/diagnostic-first-pass-{medium,large,5mb}.txt`.
  Removing the initial height check on the empty article kept the same 1.5-screen
  target and passed typecheck, 302 unit tests, the release/bundle gate, and
  visually verified startup runs. In 12/12 valid paired release rounds per
  fixture, first viewport changed **−3 ms** for medium (7/12 faster) and
  **+17 ms** for large (3/12 faster). The host was slower and noisier than in
  prior runs, so absolute times across sessions are not comparable; the rotated
  pairs do not support keeping the change. It was reverted. Raw pairs are
  `bench/results/paired-skip-empty-layout-{medium,large}.txt`. No 5 MB pair was
  run for this candidate after the large regression. The baseline binary for
  these pairs was `/tmp/scrivo-before-first-layout-check`, SHA-256
  `95f311350948c633476149f70f0922c3a1b6138fc0d54186acbf254a844192e8`.
  The restored release build and bundle gate passed, and one fresh verified
  medium and large startup launch each matched its reviewed reference.
  A better first-layout candidate needs to reduce actual layout work while
  preserving the first viewport and early scroll behavior.
- **Prefetch/clone phase split.** Temporary Rust marks, retained because they
  are inert unless `SCRIVO_TRACE=1`, show that the worker completes reading and
  rendering before the web page asks for the view. Three verified release runs
  per fixture measured process start→prefetch ready at **0.6–0.8 ms** for medium,
  **12–15 ms** for large, and **15–19 ms** for the synthetic 5 MB document. The
  cached view clone at command entry took **≤0.1 ms**, **0.5–1.0 ms**, and
  **1.5–1.9 ms**, respectively. Window-built→JavaScript-start was roughly
  **110–147 ms** across these runs; the prefetched result was already ready well
  before it. There is no current evidence that optimizing file read, Markdown
  rendering, or clone will improve the reviewed first viewport on these fixtures.
  Raw captures: `bench/results/diagnostic-prefetch-{medium,large,5mb}.txt`.
  They are trace diagnostics under changing host load, not paired speed claims.
  The release build, web bundle gate, and three visual-reference matches for
  each fixture passed; Rust app tests passed 36/36. The next candidate should
  address measured post-window startup work or a verified first-viewport cost.
- **Raw binary IPC experiment, reverted.** Tauri [documents raw `Response`
  bytes](https://v2.tauri.app/develop/calling-rust/) as a way to avoid slow JSON
  serialization of large command responses. An experimental `startup_view`
  response used a little-endian header length, JSON metadata, and raw UTF-8 HTML;
  a TypeScript decoder reconstructed the existing view contract. The code handled
  both `ArrayBuffer` and Tauri's number-array postMessage fallback. Rust and
  TypeScript contract tests, typechecks, release build, bundle gate, and the full
  rebuilt native WebKitGTK suite passed (12 specs, 16 tests). The candidate's
  Unicode fixture change was reverted with the codec; an independent permanent
  native boundary regression test was added later, as described above.
- **Paired release outcomes:** 12/12 valid visual-reference pairs per fixture.
  Candidate minus baseline first-viewport median was **−11 ms** for medium
  (8/12 faster), **+5 ms** for the 1.12 MB large fixture (4/12 faster), and
  **−13 ms** for a synthetic 5.17 MB rendered payload (9/12 faster). Raw rounds:
  `bench/results/paired-binary-ipc-{medium,large,5mb}.txt`. A separate verified
  three-run 5 MB trace in `bench/results/diagnostic-binary-ipc-5mb.txt` showed
  Rust delivery→raw JavaScript receipt of 16–22 ms and another 4–13 ms to decode;
  the earlier JSON delivery→JavaScript interval was 32–39 ms. Those separate
  trace sessions ran under varying host load, so use the paired outcomes for
  first-viewport claims. The custom protocol added maintenance and could be
  costly in Tauri's number-array fallback, which the startup pairs did not cover.
  An independent review recommended reverting it; no reliable user-visible
  startup gain was established.
- **5 MB fixture/reference for follow-up:** `bench/references/scrivo-scrivo-startup-5mb.json`
  is a visually inspected baseline reference bound to fixture SHA-256
  `311f3ca19187aa4342ec4766bfa58daf5f03b7f3ca804fc08bc42c1ea03228ea`.
  Recreate `/tmp/scrivo-startup-5mb.md` with the exact recipe below, then run
  `node bench/bench.mjs scrivo /tmp/scrivo-startup-5mb.md 3` or the paired A/B
  tool. The fixture is intentionally generated outside the repo to avoid checking
  in 5 MB of repeated text. The paired baseline binary was
  `/tmp/scrivo-before-binary-ipc`, SHA-256
  `58a918392ba6e77418e76690e7c2c1969c8b5d5cd0908c6c0279ff686c7d74ba`.

  ```sh
  node <<'NODE'
  const fs = require('fs');
  const medium = fs.readFileSync('bench/fixtures/medium.md', 'utf8');
  const tail = '\n# Large tail\n\n```text\n' + ('0123456789abcdef'.repeat(20) + '\n').repeat(16000) + '```\n';
  fs.writeFileSync('/tmp/scrivo-startup-5mb.md', medium + tail);
  NODE
  ```

- **Earlier preview plan, now implemented:** first compare a fresh release build against the
  `fb7ed11` baseline under a stable host using visual references and paired
  launches. The remaining measured cost is mainly window/web-process startup;
  reducing the full-document prepaint IPC cost more substantially would require
  a correct first-chunk/tail-loading contract for early Find, anchors, scroll,
  cancellation, and editor handoff. Keep the existing native and Chromium outcome
  gates when trying that design. Windows runtime checks and the existing-target
  final save check→rename race also remain open from the I/O work below.

  A concrete transport design needs to keep `viewer.settled()` pending until the
  tail has arrived and entered the DOM: Find waits on that contract, while code
  highlighting and startup tracing also use it. `scrollToAnchor()` currently searches
  pending chunks synchronously and returns a boolean, so an anchor requested
  before tail receipt needs an explicit queued or asynchronous outcome. The
  viewer must ignore late tails after a new document, edit handoff, or suspension,
  and expose a tail-load error without claiming the document is complete. Keep
  UTF-16 HTML offsets through Unicode and ensure the first response ends at a
  complete renderer block. [Tauri Channels](https://v2.tauri.app/develop/calling-frontend/)
  provide ordered streaming if more than a two-command preview/tail exchange is
  needed; a simple two-command design may have less maintenance cost. Neither
  design was implemented at that point. The existing medium, large, and synthetic 5 MB
  visual references and early Find/anchor/native tests became its gates.
  A low-complexity first attempt would retain `startup_view` as the full result,
  add `startup_preview` for large documents only, and fetch the full cached view
  after first paint. The preview should end at the renderer's first complete
  chunk. If that chunk cannot fill the first 1.5 screens, the viewer must fetch
  the tail before claiming the first screen is ready. The full result can then
  extend pending HTML without replacing the visible prefix or resetting scroll.

- A later trace split the time between Rust's `startup_view` return and the
  viewer's first HTML parse. Temporary marks at JavaScript receipt and viewer
  entry showed that the browser parses the first ~6.4 KB HTML chunk in under
  1 ms; most of the earlier 30 ms gap was transfer/deserialization of the full
  rendered document. The native IPC payloads and three observed delivery→JS
  intervals were: medium 22 KB, **0.9–1.1 ms**; large 1.12 MB,
  **7.9–12.0 ms**; synthetic 5.17 MB, **31.6–38.7 ms**. Raw traces are
  `bench/results/diagnostic-ipc-medium.txt`,
  `bench/results/diagnostic-ipc-large.txt`, and
  `bench/results/diagnostic-ipc-5mb-unverified.txt`. These are diagnostic
  runs under variable host load, not paired speed comparisons. The temporary
  trace calls were removed and the baseline release binary restored.
  Sending only the first chunk before paint could reduce large-file transfer
  time, but it would require a robust tail-loading contract for early Find,
  anchors, scroll, cancellation, and editor handoff. Preserve those outcomes
  before pursuing that larger design change.
- A synthetic 5.14 MB document was made by appending 16,000 320-character
  code lines to `bench/fixtures/medium.md` in `/tmp`. Three release launches in
  the private compositor reported a stable viewport at 411–441 ms and a
  `document settled` trace at 441–472 ms. The captured final PNG was inspected
  and showed the correct medium-document first screen. This used `--unverified`,
  so it intentionally exited 1 and **did not** pass a reviewed screenshot
  reference; these timings are diagnostic, not a regression gate or A/B claim.
- Startup traces showed HTML parsing followed by a roughly 9–11 ms math-font
  wait. An experiment started the font load before first-chunk parsing to
  overlap them. After typecheck, 302 unit tests, and a release build passed,
  12 valid paired launches per fixture showed **+5 ms** medium first viewport
  (candidate faster in 4/12) and **−1 ms** large (7/12). This is no reliable
  startup gain, so the code was reverted and the baseline release binary was
  restored. Raw rounds are in `bench/results/paired-font-overlap-medium.txt`
  and `bench/results/paired-font-overlap-large.txt`. Baseline binary SHA-256:
  `58a918392ba6e77418e76690e7c2c1969c8b5d5cd0908c6c0279ff686c7d74ba`;
  candidate: `bf07f9acae0139da47347169133eca9b49c148928b6360a35967235741372b4a`.
  Both runs used `node bench/ab.mjs <fixture> 12 /tmp/scrivo-before-font-overlap
  src-tauri/target/release/scrivo` in the private compositor.
- Startup code remains as in `eec536a`. The next performance change should be
  supported by a measured bottleneck; window/web-process startup still takes
  most of the time in the reviewed fixture traces.

## Current checkpoint: atomic installation of new documents

- `WriteCondition::Absent` and `WriteCondition::Overwrite` when the target was
  initially absent previously checked the path, then used replacing `fs::rename`.
  A deterministic test hook between the final check and rename reproduced silent
  overwrite of a file created by another writer in that gap.
- New-target installation now uses Linux `renameat2(RENAME_NOREPLACE)`, macOS
  `renamex_np(RENAME_EXCL)`, or Windows `MoveFileExW` without its replacement flag.
  A late file or symlink returns `Conflict` and remains intact; temp files are
  removed. Existing-target saves retain the earlier check and replace behavior.
  Rust tests cover late files for both absent and explicit-overwrite conditions,
  a late symlink, and the no-replace primitive with an existing destination.
  The Windows API call now adds an extended-length prefix for long drive/UNC
  paths, matching Rust's own long-path handling; a Windows-only test saves beyond
  260 UTF-16 units. That test cross-compiles but has not run on Windows.
- An independent review caught an unsafe checked-rename fallback and a hard-link
  cleanup problem. Both fallbacks were removed. If a filesystem lacks atomic
  no-replace rename, a new-document save returns an I/O error with the message
  `filesystem cannot atomically create a new document`; it does not overwrite a
  competing path. This may limit new saves on older or virtual filesystems and
  needs runtime checks on such volumes. This change does **not** close the
  existing-target final check → rename race.

### Validation for this checkpoint

| Check | Result |
|---|---|
| Reproduction | New late-file regression failed against the old replacing rename |
| Rust app tests | 36/36 passed on Linux |
| Rust renderer tests | 35/35 passed; unchanged renderer |
| Isolated Windows-target module/tests check | Passed `cargo check --offline --tests --target x86_64-pc-windows-gnu`; runtime not tested |
| Native WebKitGTK suite | 12/12 specs, 16 tests passed on rebuilt debug app, including new-file creation and save conflict outcomes; private DBus/Xvfb needed unsandboxed execution |
| Web build and bundle gate | Passed as part of native build; 39/40 KiB static and 52/56 KiB known prepaint JS/CSS |
| Release build | Passed `bunx tauri build --no-bundle`; no startup benchmark was repeated for this save-path-only change |
| Independent adversarial review | Found and drove removal of unsafe/partial-success fallbacks and long-path handling; final review found no further concrete defect |

## Previous checkpoint: progressive edit-to-reader transition (`28ee47a`)

- A real 443 KB Chromium diagnostic showed that returning from edit mode inserted
  all 800 code blocks before the reader appeared; the isolated transition took
  about 561 ms. `viewNow()` rendered the reader while `body[data-mode='edit']`
  applied `display: none` to it. Its zero layout height made the first-screen
  insertion loop run to the end. [CSS Display](https://www.w3.org/TR/css-display-3/)
  specifies that `display: none` generates no box; [CSS visibility](https://www.w3.org/TR/CSS22/visufx.html)
  keeps an invisible box in layout.
- The workspace now calls `prepareView()` only after rendering the editor buffer.
  The boot adapter applies a temporary CSS state that gives the reader its real
  viewport dimensions while keeping the editor visible and the reader invisible.
  It removes the state after switching to the reader. An isolated diagnostic then
  returned with 2 of 800 code blocks inserted in about 145 ms; the rest appended
  progressively. These are single diagnostic runs, not a paired benchmark.
- The newly progressive path exposed a source-line scroll clamp: the viewer had
  loaded beyond the target line without loading enough content below it to place
  that line at the top. `scrollToLine()` now fills below the target as anchor
  navigation already does. The existing Ctrl+E position test initially caught
  the three-line drift and now passes.
- The editor stays usable while asynchronous rendering runs. A text snapshot can
  become stale if the user types during rendering or insertion. The workspace
  now retries until the rendered snapshot matches the current editor text, and
  suspends insertion of an abandoned reader document. Unit tests delay each
  phase independently and verify that the final reader contains both edits.
  `e2e/reading-large-toggle.spec.ts` checks a populated first viewport, partial
  insertion at handoff, the final 800 blocks, and a reachable tail. The native
  large-file test checks the same handoff from the document top. A first native
  attempt asserted partial insertion while the reader was at the tail after a
  previous test; loading the whole document was correct for that target. A
  temporary WebKitGTK probe confirmed the prepared reader had a real 451 px
  viewport and stopped the first-screen pass after 12 blocks. The probe was
  removed, and the test now scrolls to the top before switching.

### Validation for this checkpoint

| Check | Result |
|---|---|
| TypeScript and Vitest | Pass; 302/302 unit tests |
| Chromium suite | 64/64 passed on the second 12-worker run; the first run had one 250 ms frame-gap miss in a giant Unicode block; that spec passed at 150 ms alone and 200 ms in the full rerun |
| Native WebKitGTK suite | 12/12 specs, 16 tests passed on the rebuilt debug app; the new large-document return test captures the handoff state in a `MutationObserver` |
| Release build and bundle gate | Pass; 39/40 KiB static, 52/56 KiB known prepaint JS/CSS |
| Paired release startup checks | 12/12 valid pairs per fixture; +7 ms medium (candidate faster in 5/12), −7 ms large (9/12); no consistent effect |
| Independent adversarial review | Found unnecessary old-DOM layout and stale async snapshot/background retry paths; all addressed; final review found no concrete defect |

Raw paired rounds are in `bench/results/paired-progressive-toggle-medium.txt`
and `bench/results/paired-progressive-toggle-large.txt`. Baseline release binary
SHA-256: `a14ac7d8e303cc959be8e598269d1971f9fb577ad1ec90dd2e6a2b27f4997adb`;
candidate: `7db12b67b56e5960039284c58cceda2e1636e949efd37bab3e917acc6c7469f1`.
Each run used `node bench/ab.mjs` with the fixture, 12 rounds, the copied baseline
binary, and the candidate release binary. The medium and large paired differences
split direction and are small; they do not establish a startup speed change.

The broader objective remains active. Windows runtime tests on NTFS and a
weak/virtual filesystem and the existing-target final save check → rename race
remain priorities.

## Previous checkpoint: bounded insertion and cancellable early Find (`dc73f06`)

- A real Chromium probe of the 443 KB fixture reproduced idle starvation: with
  a continuous animation using roughly 16 ms of each frame, three seconds after
  opening Find only 2 of 800 code blocks had entered the page and the bar still
  said `Searching…`. The browser can delay `requestIdleCallback` indefinitely when
  there is no idle time; the [MDN API guidance](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback)
  recommends a timeout for required work.
- `src/viewer/viewer.ts` now schedules background slices with a 250 ms timeout.
  An early Find request uses a 25 ms timeout until the document is complete or
  its `AbortSignal` is cancelled. A timed-out callback gets a bounded 12 ms work
  budget; its reported zero idle time no longer causes immediate one-block
  yielding. At most two renderer chunks are parsed per slice. The first viewport
  is still inserted synchronously before any background callback is scheduled.
- `src/viewer/find.ts` aborts the previous wait on a new query or when Find closes,
  so insertion returns to background pacing when the search is no longer needed.
  An independent reviewer found this cancellation requirement during review.
  The second review found that a hidden reader would otherwise keep doing forced
  timeout work while the user edited. `boot.ts` now suspends the reader on the
  switch to edit mode; returning to the reader renders a fresh document as the
  workspace already requires. Unit tests cover promotion, timeout completion,
  demotion, suspension, and stale search cancellation.
  `e2e/reading-busy-find.spec.ts` keeps the animation running until
  the actual Find bar shows `1 of 1` and all 800 blocks are present; it passed
  in the full Chromium suite. An exploratory run with the timeout slice showed
  740/800 code blocks after three seconds of the same load, up from 2/800 on the
  baseline. These are diagnostic observations, not comparative benchmark samples.

### Validation for this checkpoint

| Check | Result |
|---|---|
| TypeScript and Vitest | Pass; 300/300 unit tests |
| Full Chromium suite | 63/63 passed after reader suspension, including the existing 250 ms insertion frame-gap gate |
| Full native WebKitGTK suite | 12/12 specs, 15 tests passed on the final rebuilt debug binary |
| Release build and web bundle gate | Pass; 38/40 KiB static, 52/56 KiB known prepaint JS/CSS |
| Paired release startup checks | 12/12 valid pairs per fixture; −4 ms medium, +3 ms large paired median; faster in 6/12 each |
| Independent adversarial review | Found missing cancellation and hidden-reader work; both addressed; final review found no concrete defect |

Paired raw rounds are in `bench/results/paired-idle-timeout-medium.txt` and
`bench/results/paired-idle-timeout-large.txt`. The baseline release binary
SHA-256 is `d9e3745d94f6f556d9b29f127f048af35f8a73bab2d8bc942d9280b304baadd3`;
the final release binary SHA-256 is
`a14ac7d8e303cc959be8e598269d1971f9fb577ad1ec90dd2e6a2b27f4997adb`.
For each fixture, run `node bench/ab.mjs bench/fixtures/medium.md 12
/tmp/scrivo-before-idle-timeouts src-tauri/target/release/scrivo`, substituting
`large.md` for the other run. The small, split paired differences do not establish a startup
speed change. The baseline diagnostic's 2/800 and candidate's 740/800 counts
were observed under synthetic continuous animation in Chromium, not native
release startup runs.

The broader objective is still active. Windows runtime checks on NTFS and a
weak/virtual filesystem remain the highest-value follow-up. Also revisit the
final save check → rename race before claiming fully race-free conditional writes.

## Previous checkpoint: stronger Windows file revisions (`0d8539a`)

- The previous Windows `FileStamp` contained only size and modified time. A
  same-size external edit with restored modified time could be missed, allowing
  a conditional save to overwrite it. `src-tauri/src/document_io.rs` now queries
  `GetFileInformationByHandleEx` for exact last-write/change times and 128-bit
  file identity plus volume serial when supported. Rust's corresponding metadata
  methods remain unstable; the Windows API is called through `windows-sys`.
  [Microsoft's FILE_BASIC_INFO documentation](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_basic_info)
  explains change time; [FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)
  defines the strong identity.
- An independent review found that `FileIdInfo` can fail on FAT/exFAT and virtual
  drives. Unsupported queries fall back to the older volume + 64-bit file ID, or
  to stable metadata if neither ID query is supported. Fallback stamps include
  SHA-256 of the file's content, as do stamps with no usable change time. Stat and
  save checks hash through a fixed 64 KiB buffer; `read_document` hashes the bytes
  it already read. Windows stat/save uses an attributes-only handle until the
  content hash is actually needed, retaining access to files that disallow data
  reads on strong-identity filesystems. Other API failures still surface as I/O
  errors. [Microsoft's legacy file information documentation](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/ns-fileapi-by_handle_file_information)
  describes the 64-bit ID and FAT timestamp limitations.
- The same stamp is used for read consistency, watcher/focus stat checks, both
  checks around an unchanged or confirmed-overwrite save, and the post-save
  result. Rust tests now cover same-size edits with restored mtime and atomic
  replacement with copied mtime on both Unix and Windows. The Windows test code
  cross-compiles but has **not run on Windows** here. An isolated Windows-target
  Cargo harness compiled `document_io.rs` and its tests successfully; a full
  Tauri Windows check stopped in `tauri-winres` because this host lacks
  `x86_64-w64-mingw32-windres`, before checking app code. Runtime verification on
  NTFS and a weak/virtual filesystem remains required.
- The reviewer found no further introduced defect after the fallback and bounded
  hashing fixes. Limitations remain: a concurrent writer can race the hash scan
  on a coarse-timestamp filesystem, and any writer can race the final check →
  rename gap. Some WinFsp-FUSE volumes also fail the pre-existing
  `fs::canonicalize` call during save, even though opening them may work. The next
  agent should test these paths on Windows rather than infer runtime behavior
  from cross-compilation, and change symlink resolution only with safety tests.

### Validation for this checkpoint

| Check | Result |
|---|---|
| Rust workspace | 32 app + 35 renderer tests passed on Linux |
| Windows cross-target module and tests | `cargo check --offline --tests --target x86_64-pc-windows-gnu` passed in isolated `/tmp/scrivo-windows-check` harness |
| Full Tauri Windows cross-check | Build script blocked by missing `x86_64-w64-mingw32-windres`; no Windows runtime result |
| Full native WebKitGTK suite | 12/12 specs, 15 tests passed on rebuilt debug binary |
| Release build and web bundle gate | Pass; 37/40 KiB static, 51/56 KiB known prepaint JS/CSS |
| Paired release startup checks | 12/12 valid pairs per fixture; −13 ms medium, +8 ms large paired median; no consistent effect |
| Independent adversarial review | Found and drove fixes for unsupported IDs, read-access regression, and unbounded hashing; final review found no introduced defect |

Paired raw rounds are in `bench/results/paired-windows-stamp-medium.txt` and
`bench/results/paired-windows-stamp-large.txt`. Previous release binary SHA-256:
`90871a3d4c398722b9fdb7b1cfc91ca4180682b70ba0261642bc1170317f5388`;
candidate: `d9e3745d94f6f556d9b29f127f048af35f8a73bab2d8bc942d9280b304baadd3`.
The candidate was faster in 8/12 medium and 6/12 large pairs. These results do
not establish a startup speed gain or regression; they only check that the
Linux refactor did not produce an obvious startup change on these fixtures.

The full objective remains active. The highest-value follow-up is Windows runtime
testing on NTFS and FAT/exFAT (or a virtual drive), including the new same-size
conflict tests, native Save As and symlink behavior, and startup. Also retain the
final check → rename caveat below. The idle-starvation issue is addressed above.

## Previous checkpoint: responsive early Find (`0d638ba`)

- Before this change, typing into Find immediately after the 443 KB fixture's first
  screen appeared paused the webview for about 444 ms. A split Chromium diagnostic
  corrected the initial attribution: `viewer.loadAll()` itself took 33–37 ms;
  synchronous Find indexing/geometry immediately after bulk insertion took
  another 413–441 ms. When background insertion had settled first, the same
  one-match Find took about 7 ms. These are exploratory host timings, not a
  statistical benchmark. The old handover wording attributed the entire pause to
  `loadAll()` and was inaccurate.
- `src/viewer/find.ts` now awaits `viewer.settled()` before indexing and revealing
  a match, letting the existing bounded idle insertion complete without a sudden
  layout flush on the input event. Find still covers the whole document. A request
  counter prevents a superseded query or a closed bar from publishing stale
  matches. `src/ui/find-bar.ts` shows `Searching…` immediately, disables previous
  and next while waiting, preserves input focus, and handles a failed search.
  Empty queries clear synchronously.
- `e2e/reading-early-find.spec.ts` exercises the actual Ctrl+F input path in one
  browser task immediately after the first screen of the real fixture. It requires
  opening and entering the query in under 150 ms, while fewer than 800 code blocks
  are inserted; then it requires the final `1 of 1`, the visible `fib_400` match,
  and all 800 code blocks. A second test closes Find during insertion and checks
  that completion cannot restore highlights. Finder unit tests cover cancellation
  by a newer query and by clear. The full-suite run initially hit Playwright's
  default 5-second assertion timeout under 12-way contention; increasing only
  the final-result wait to 15 seconds made the full run pass. The immediate
  responsiveness threshold did not change.
- Independent review found no concrete Find race. The idle-starvation risk left
  at that checkpoint was later reproduced and addressed in the current checkpoint.

### Validation for this checkpoint

| Check | Result |
|---|---|
| TypeScript and Vitest | Pass; 296/296 unit tests |
| Full Chromium suite | 62/62 passed, including early Find and close during insertion |
| Full native WebKitGTK suite | 12/12 specs, 15 tests passed on final debug build |
| Debug and release builds, web bundle gate | Pass; 37/40 KiB static, 51/56 KiB known prepaint JS/CSS, 1,060 KiB conditional font, 2,517 KiB deferred graph |
| Independent review | No concrete Find race found; idle starvation remains a theoretical limit |
| Verified release startup smoke | 5/5 medium and 5/5 large reviewed-screen matches; first-viewport medians 365 ms and 361 ms |

The release binary SHA-256 is
`90871a3d4c398722b9fdb7b1cfc91ca4180682b70ba0261642bc1170317f5388`.
The smoke commands were `node bench/bench.mjs scrivo bench/fixtures/medium.md 5`
and the same command with `large.md`. Their logs are in
`/tmp/scrivo-async-find-startup-medium.log` and
`/tmp/scrivo-async-find-startup-large.log` on this host. These validate the
reviewed viewport, but without paired baseline rounds they do not establish
a startup time change.

The complete-document result, 150 ms input-path check, 250 ms insertion
frame-gap gate, and startup reference checks remain regression gates. The final
cross-process check → rename race remains a data-safety follow-up below.

## Previous checkpoint: faster background insertion (`65d29fc`)

- The 443 KB large fixture contains 151 safe HTML chunks. Instrumentation on the
  committed one-chunk scheduler observed about 150 idle callbacks after initial
  screen insertion; roughly 0.8 s of callback work included about 0.7 s of layout, and
  callback scheduling added roughly 0.55 s. The viewer now allows two chunks per
  idle callback with a 12 ms slice budget (previously one chunk and 8 ms). It still
  parses only the first safe chunk before paint, yields when the deadline is low,
  and forces layout inside each callback so cost is accounted for before the next.
- A 12-round rotated release comparison on the large fixture, with each launch
  checked against the reviewed first-viewport screenshot, measured **−419 ms
  paired median** to `document settled` (all blocks inserted). The candidate was
  faster in **12/12** pairs; unpaired medians were 1,634 ms baseline and 1,232 ms
  candidate. In those same runs, first-viewport paired median was −2 ms. Separate
  ordinary startup A/B runs measured −3 ms medium (6/12 faster) and +5 ms large
  (4/12 faster). These small, inconsistent first-viewport differences do not
  establish a startup speed change.
- Five diagnostic native release traces of the two-chunk policy measured 75–77
  background callbacks, with 12–18 ms maximum callback work. Temporary RAF
  instrumentation during those traces measured 21–29 ms maximum frame gaps and
  15–19 ms p95; it was removed from the final build. A new Chromium E2E test
  verifies that the real large document completes with 800 code blocks, 400
  tables, 800 MathML elements, 800 tasks, a reachable tail, and no frame gap
  reaching 250 ms during insertion. The existing native large-file tests still
  check tail visibility, full highlighting, and Find while highlighting.
- An attempted 16-block first-screen batch was reverted. Both startup fixtures
  crossed the 1.5-viewport target after 16 blocks, but a 12-pair medium release
  comparison showed +1 ms paired median and no reliable improvement. A reviewer
  found no scheduler race in the final change. One unit assertion that assumed a
  single callback could not parse a second chunk was changed to assert that the
  document still loads progressively.

### Validation for this checkpoint

| Check | Result |
|---|---|
| TypeScript and Vitest | Pass; 295/295 unit tests |
| Full Chromium suite | 60/60 passed, including the large-document background outcome and frame check |
| Full native WebKitGTK suite | 12/12 specs, 15 tests passed on final debug build |
| Debug and release builds | Pass; bundle gate 37/40 KiB static, 51/56 KiB known prepaint JS/CSS, 1,060 KiB conditional font, 2,517 KiB deferred graph |
| Large settled-time paired comparison | 12/12 valid pairs; −419 ms paired median, candidate faster 12/12 |
| First-viewport paired comparisons | 12/12 valid pairs each; −3 ms medium, +5 ms large in ordinary A/B runs |
| Independent review | No substantive scheduler race or settled-time benchmark validity issue found |

Raw rounds are in `bench/results/paired-two-chunk-settled-large.txt`,
`bench/results/paired-two-chunk-startup-medium.txt`, and
`bench/results/paired-two-chunk-startup-large.txt`. The RAF diagnostic is in
`bench/results/diagnostic-two-chunk-frames-large.txt`; its binary included
temporary measurement code, while the final release binary does not. Baseline
`8fea444` SHA-256:
`885783490a3a22ae453e98f6e8058d22c1d5b1711226a59f2dfe16354406676d`;
final candidate SHA-256:
`39a756ea84231b04a6b2cf7127d5fad2aa60a5ac0b0a55964aef3e640548ec84`.
The paired settled-time command used an ephemeral script around
`bench/bench.mjs scrivo bench/fixtures/large.md 1 --trace`, rotated baseline
and candidate launch order, required a valid screenshot and the `document
settled` trace mark on every run, and exited successfully with 12/12 valid pairs.
Only the first-viewport A/B commands are stable repository tooling; reproduce
settled-time numbers with the trace command and a rebuilt `8fea444` baseline if
needed. Do not compare absolute medians between benchmark sessions.

The early-Find pause identified here was addressed by the responsive early Find
checkpoint above; the current checkpoint also bounds its completion under load.

## Previous checkpoint: Unicode width for giant code blocks (`8fea444`)

- `src/viewer/viewer.ts` now segments a giant block with Unicode lines when it can
  preserve horizontal width. Its scanner finds the widest ASCII line in `ch`
  columns and collects distinct Unicode lines. Canvas measures the latter with the
  computed code font. Tab stops follow the CSS Text rule that skips a stop when
  the advance would be less than `0.5ch`, plus a 1px rounding allowance
  ([CSS Text Level 3](https://www.w3.org/TR/css-text-3/)). The
  resulting minimum code width has a further 4px allowance for Canvas/DOM shaping
  differences. The full source text remains in DOM order and `code.textContent`
  stays exact. No change was made to the 250-line segmentation or Find geometry.
- Measurement is bounded to 512 distinct Unicode lines, 200,000 distinct Unicode
  UTF-16 code units total, and 10,000 per line. Controls/line separators, invalid
  style assumptions, or a measurement limit cause the entire giant block to keep
  the browser's native unsegmented layout. The per-line limit protects correctness:
  an adversarial 200,000-character CJK line had about 806px of Canvas/DOM width
  divergence in Chromium and clipped after segmentation. At the 10,000-character
  limit, an independent review swept 7,516 plain and tabbed Unicode patterns;
  its largest underestimate was 0.141px, within the 4px allowance. This is an
  empirical guard for the tested engines, not a proof for every font/platform.
- The reviewer also reproduced a tab-stop boundary bug in the first implementation:
  19 CJK characters then a tab advanced one full tab stop farther in Chromium
  than a naive next-multiple calculation. The CSS Text threshold fix and a narrow
  scrollbar regression test pass in Chromium and native WebKitGTK. The 5 MB fixture
  has a wide line with tabs before and within CJK text; tests assert exact text,
  segmentation, far-right Find visibility, tail access, and frame gaps. A separate
  1 MB fixture verifies that an over-limit Unicode line uses native width and its
  final marker remains horizontally reachable.

### Validation for this checkpoint

| Check | Result |
|---|---|
| TypeScript and Vitest | Pass; 295/295 unit tests |
| Full Chromium suite | 59/59 passed after the 10,000-character cap; isolated six-test giant-code spec passed |
| Native WebKitGTK | 12/12 specs passed after final cap, including adversarial tab-stop reachability |
| Debug and release builds | Pass; bundle gate 37/40 KiB static, 51/56 KiB known prepaint JS/CSS, 1,060 KiB conditional font, 2,517 KiB deferred graph |
| Independent review | No further concrete clipping issue within the cap; 7,516 Chromium line patterns checked |
| Paired release startup comparison | 12/12 valid pairs per fixture; median change −3 ms medium, +4 ms large |

The raw rotated A/B rounds are in
`bench/results/paired-unicode-segments-medium.txt` and
`bench/results/paired-unicode-segments-large.txt`. The previous checkpoint binary
(`6f1c539`) had SHA-256
`2e1965dcf79a70b07eb2ba461cb5b89f4c4c9d6c0d89dce09fa6254e384b78a7`;
the final candidate had SHA-256
`885783490a3a22ae453e98f6e8058d22c1d5b1711226a59f2dfe16354406676d`.
Medium first-viewport content medians were 375 ms baseline and 374 ms candidate;
large medians were 380 ms and 385 ms. Candidate was faster in 6/12 medium and
4/12 large rounds. The paired differences are small and do not establish a
startup speed gain. The medium and large fixtures do not contain a 5 MB Unicode
code block; the giant-block E2E checks cover its interaction and frame behavior.
Absolute medians should not be compared across benchmark sessions.

The next agent should retain the fallback limits unless a browser-measured width
strategy can guarantee reachability with acceptable cost. Startup is the broader
priority: keep using the reviewed first-viewport benchmark and inspect any
regression under controlled paired runs. Windows conflict behavior and the final
cross-process check → rename race remain data-safety follow-ups described below.

## Previous checkpoint: tall code blocks and Find (`6f1c539`)

- A 5 MB fenced code block with 50,000 lines previously produced about a 333–350 ms
  maximum Chromium frame gap. Profiling attributed roughly 221–242 ms to layout;
  the earlier whole-block `content-visibility: auto` trial merely moved a 350 ms
  stall to scrolling. `src/viewer/viewer.ts` now splits plain ASCII code blocks of
  at least 1 MB into 250-line DOM spans. Each has `content-visibility: auto` and an
  estimated intrinsic height based on the computed line height. All source text
  remains in DOM order and `code.textContent` remains exact. The code block is
  segmented after insertion but before a forced layout read. WebKit's HTML parser
  splits a large code string into multiple Text nodes; the implementation joins
  these before segmenting.
- Paint containment initially clipped long lines. The viewer now calculates the
  widest ASCII line in monospace columns, accounting for tab stops, and gives the
  code element that minimum width. An independent review reproduced the bug with
  a 1,000-character line; browser and native tests now scroll to its final
  characters on a tabbed line. At this checkpoint, non-ASCII giant code stayed on
  the original layout path; the following Unicode checkpoint extended bounded support.
- WebKit returns a zero `Range` rectangle when a Find match lies in an offscreen
  segment. `src/viewer/find.ts` temporarily lays out only the matching segment(s)
  for geometry queries. Find also scrolls a code block horizontally when the match
  lies beyond its right edge. Native and Chromium tests locate a middle marker and
  a marker at the far right of the 1,000-character line, checking the actual match
  rectangle is visible. Tests also compare the entire 5 MB code text with the
  source, navigate to the tail, and check background and scroll frame gaps.
- The targeted three-test Chromium spec measured a **33–100 ms** maximum frame gap
  for the 5 MB case across runs on this host, below its 200 ms bound. A native
  five-stop scroll diagnostic measured **17 ms** and is now checked against the
  same 200 ms bound. These are host-specific behavioral gates, not a controlled
  startup speed comparison.

### Validation for this checkpoint

| Check | Result |
|---|---|
| TypeScript and Vitest | Pass; 295/295 unit tests |
| Targeted Chromium giant-code and Find specs | 11/11 tests passed after horizontal Find change |
| Targeted native WebKitGTK giant-code spec | Pass after horizontal Find change |
| Full Chromium suite | 56/56 passed, including an ordinary wide-code Find test |
| Full native WebKitGTK suite | 12/12 specs, 15 tests passed with final tabbed fixture and Find behavior |
| Debug and release builds | Pass; bundle gate 36/40 KiB static, 50/56 KiB known prepaint JS/CSS, 1,060 KiB conditional font, 2,517 KiB deferred graph |
| Paired release startup comparison | 12/12 valid old/new pairs for each fixture; median candidate change +4 ms medium, +2 ms large |

The final startup runs are retained in
`bench/results/paired-code-segments-medium.txt` and
`bench/results/paired-code-segments-large.txt`. The baseline release binary was
copied from `30b91d9` (SHA-256
`3ce67f46c57f4584f6a17e487b20220bb33646d1c3af231095896bdcf0618780`);
the candidate binary SHA-256 was
`2e1965dcf79a70b07eb2ba461cb5b89f4c4c9d6c0d89dce09fa6254e384b78a7`.
Medium first-viewport medians were 363 ms baseline and 366 ms candidate; large
were 377 ms and 382 ms. Candidate was faster in 6/12 medium and 4/12 large
rounds. These results do not establish a startup speed gain. The small positive
differences should be weighed against the bounded 5 MB code-block layout and
native scroll improvements; do not compare absolute medians to other sessions.

The data-safety priorities from this checkpoint remain: validate conflict behavior
on Windows and consider a stronger Windows revision identity than size and modified
time. The final filesystem check → rename race is still present across processes.

## Previous checkpoint: exact file revisions and active Find (`30b91d9`)

- Native runs intermittently displayed a save conflict when an untouched file was
  edited and saved. The key event reached the editor, but the disk bytes stayed
  unchanged. A targeted Rust trace in a failing native run captured a `FileStamp`
  timestamp whose bits changed by one `f64` ULP after Rust → JSON → JavaScript →
  Rust (`...9116` became `...9117`). Filesystem nanosecond precision is not
  reliably preserved by a JSON number.
  The false conflict appeared in different native specs, so it was not a fixture
  or key-dispatch issue. Temporary diagnostic listeners and traces were removed.
- `FileStamp` is now an opaque JSON string. Rust encodes exact filesystem integers:
  device, inode, size, mtime seconds/nanoseconds, and ctime seconds/nanoseconds on
  Unix. Other platforms encode size and exact modified time with an epoch sign;
  failure to obtain modified time fails closed. The domain compares token strings;
  the in-memory platform issues monotonic string tokens. A Rust test round-trips a
  token through JSON and uses it for a conditional save. Domain tests now use the
  public opaque-string contract.
- The Rust write path checks for changes both before and after writing the temp
  file, including user-confirmed overwrites. It re-resolves symlinks before rename
  and refuses a retargeted or dangling link. Deterministic tests change the target
  between temp-file completion and rename, including a newly introduced dangling
  link and an external edit after overwrite confirmation. Existing link targets and
  external content remain intact on conflict. A final check → rename race across
  processes remains because the filesystem has no atomic compare-and-rename here.
- `e2e-native/specs/reading-large.spec.ts` atomically samples partial highlighting
  of the real 800-code-block fixture, dispatches Ctrl+F in that same browser task,
  and checks that Find opens and focuses before all blocks are highlighted. It
  then finds `fib_400` as `1 of 1`. A separate existing test uses a real Control+F
  keypress and checks every block's final highlighted text.
- `e2e-native/specs/save-bytes.spec.ts` now tests a dirty editor plus an external
  write: Ctrl+S prompts instead of replacing the external bytes, and `Load Theirs`
  updates the editor. Failure diagnostics include the editor and disk state.

### Validation for this checkpoint

| Check | Result |
|---|---|
| `bun run typecheck`; native E2E TypeScript check | Pass |
| `bun run test` | 295/295 Vitest tests passed |
| `cargo test -q` in `src-tauri` | 31/31 app Rust tests passed |
| `cargo test -q -p scrivo-render` | 35/35 renderer Rust tests passed |
| `bun run test:e2e` | 54/54 Chromium tests passed on the opaque-token change before the final Rust-only overwrite guard |
| `bun run build:native-test` | Pass; bundle gate 34/40 KiB static, 48/56 KiB known prepaint JS/CSS, 1,060 KiB conditional font, 2,517 KiB deferred graph |
| Native WebKitGTK | 11/11 specs, 14 tests passed against final rebuilt debug binary; an earlier full run also passed before the final Rust-only overwrite guard |
| `bunx tauri build --no-bundle` | Pass; final release binary built |
| Verified release startup smoke | 5/5 medium and 5/5 large first-viewport reference matches; medians 358 ms and 371 ms respectively |
| `git diff --check` | Pass |

An independent adversarial review found the symlink and confirmed-overwrite races;
the resulting checks and focused Rust tests are included. Native tests run under
isolated Xvfb/DBus. The startup smoke uses the current release binary and reviewed
fixture references, but is a single-app check under this host's current load, not
a controlled paired comparison with Typora. Raw current-run logs are in
`/tmp/scrivo-smoke-medium-final.log` and `/tmp/scrivo-smoke-large-final.log` (not
committed); retain the paired measurements below as the comparison baseline.

## Earlier product checkpoint (`8eeead5`)

Commit `8eeead5` made native E2E match view-first startup; hardened Rust file
reads, stamps, and atomic writes; added parent-directory watching with clean reload
and dirty-buffer prompts; added postpaint code highlighting and a Contents sidebar;
and updated Save As conflict handling. It passed 279 unit tests, 26 Rust tests,
52 Chromium E2E cases, and 10 native WebKitGTK specs. It also introduced rotated
A/B rounds and a linked JS/CSS bundle budget. Its startup claims were provisional
because a stable splash screen could be timed as content, failed runs could exit 0,
and the budget omitted a conditional 1 MB math font.

## Previous continuation (`1565334`)

- `bench/bench.mjs` now waits through intermediate stable screens until the first
  viewport matches a manually reviewed fixture-specific reference, then stays
  stable for 1.5 seconds. A timed `content` frame itself must match the reference
  within 0.3% of 16×16 luminance tiles. Missing windows, incomplete or capped runs
  fail; the process exits nonzero when a run fails. `--failure-dir=DIR` saves a final
  PPM for diagnosis. `--unverified --dump=DIR` supports reference capture, exits
  nonzero, and labels the numbers unverified. The live-desktop mode was removed;
  every run uses a private 1280×720 `cage` compositor.
- `bench/references/` contains compact fixture-hashed signatures and the four PNGs
  from which they were made. Both apps' medium and large PNGs were visually
  inspected: the expected heading, fixture label, and body text are visible.
  `bench/fixtures/gen.py` now puts distinct Medium/Large labels at the top and
  distinct end headings at the tail. The benchmark compares first-viewport startup,
  not the time to finish rendering the whole file.
- `bench/ab.mjs` retains each launch failure and requires at least 80% valid paired
  rounds for every candidate, exiting nonzero otherwise. Both benchmark scripts
  use the conventional median for even sample counts. Unit tests cover blank and
  incomplete screens, wrong fixtures, fixture hash mismatch, the timed-frame
  contract, median calculation, and the minimum-pair rule. An independent reviewer
  rechecked the final implementation and found no substantive validity issue within
  this first-viewport metric.
- `scripts/check-bundle.mjs` began reporting the conditional 1,060 KiB math font.
- `e2e-native/specs/reading-large.spec.ts` opens the real 443 KB fixture in the
  native WebKitGTK app, waits for its distinct end heading, scrolls it into view,
  and verifies it is visible. This separately validates the large file outcome.
  The first attempt used a stale WebDriver element handle while progressive blocks
  were appending; the final test polls the live DOM and passed with the full suite.

## Bundle gate checkpoint (`425cd77`)

- `vite.config.ts` now emits Vite's build manifest. `scripts/check-bundle.mjs`
  traverses manifest `imports`, `dynamicImports`, `css`, and `assets`, plus CSS
  `@import` and `url()` references. It fails on missing files anywhere in the
  reachable static or dynamic graph. The static JS/CSS budget is **34/40 KiB**.
- Review found that `src/app/workspace.ts` calls `window.setTitle` during initial
  display and `src/boot.ts` registers window handlers before the first-frame mark.
  Both can request `@tauri-apps/api/window` before paint. The checker now includes
  that known dynamic root and its static dependencies in a **48/56 KiB prepaint
  JS/CSS** budget. The root list in `scripts/check-bundle.mjs` needs review when
  boot-time imports change. This budget measures uncompressed files; it does not
  measure network latency or parse/evaluation cost.
- The gate validates and reports **1,060 KiB** of startup-referenced assets (the
  reading-view math font) separately from JS/CSS, and **2,517 KiB** in the declared
  deferred graph across eight JS roots and one standalone CSS root. Vite emits the
  dynamically imported KaTeX stylesheet as a manifest entry without an import edge,
  so the checker traverses standalone CSS entries as well. The deferred figure
  includes the prepaint window files and referenced KaTeX fonts. Synthetic tests
  cover each graph and missing references. An independent reviewer rechecked the
  three initial findings against the final checker and found them resolved, with
  no remaining substantive gate or documentation issue.

## Postpaint code highlighting checkpoint (`1dec5d8`)

- The 443 KB large fixture has 800 fenced code blocks. Before this change, a
  temporary native diagnostic saw all 800 highlighted only around 10.9 seconds
  after launch: the highlighter yielded once per block. The initial batched-idle
  diagnostic reached all 800 around 3.9 seconds on the same host. These are
  exploratory observations, not controlled paired benchmarks or a CI speed gate.
- `src/viewer/code-highlight.ts` now uses `IdleDeadline.timeRemaining()` to fit
  several small blocks in an idle period. It caches resolved language supports
  within the document, preserves original code on grammar/parser failure, and
  flushes text-node invalidation before a new grammar load, before yielding to
  another idle callback, and at completion. It checks document version after an
  asynchronous load or idle callback to avoid changing a superseded document.
- `src/boot.ts` refreshes an open Find at most every 250 ms during highlighting
  and once at completion. Previously, re-indexing the entire document after each
  code block made a native Find-open diagnostic take about 19.4 seconds; after
  throttling, the large native test took 3.2–3.3 seconds. That test duration is
  not a formal performance metric and does not guarantee Find opened before
  highlighting finished. The behavior tests cover Find's final count and the
  content outcome.
- `src/viewer/code-highlight.test.ts` checks that a changed block is reported
  before a slow second grammar load, then checks text preservation and cancellation.
  The new native test independently waits for all 800 code blocks, opens Find for
  `fib_400`, verifies `1 of 1`, waits for every block to have token spans, and
  compares all rendered code text with the source fixture. An independent reviewer
  found no remaining substantive correctness issue in this revised change.
- The new release binary passed five first-viewport runs against the reviewed
  large fixture reference: content times **338–485 ms**, median **388 ms**. This
  is a single-app smoke measurement under current host load, not a replacement
  for the retained 12-pair Scrivo/Typora comparison below.

## Validation at the highlighting checkpoint

| Check | Latest result |
|---|---|
| `bun run typecheck` | Pass |
| `bunx tsc --noEmit -p e2e-native/tsconfig.json` | Pass |
| `bun run test` | 294 tests across 17 files passed |
| `bun run test:e2e` | 52/52 Chromium tests passed |
| `bun run test:e2e:native` | 11/11 native WebKitGTK specs, 12 tests passed, including both large-file tests |
| `cargo test -q` | 26/26 Rust tests passed at the prior checkpoint; Rust unchanged here |
| `bun run build:web` | Pass; 34/40 KiB static, 48/56 KiB known prepaint JS/CSS, 1,060 KiB referenced assets, 2,517 KiB deferred graph |
| `bunx tauri build --no-bundle` | Pass; release binary rebuilt with current web assets |
| `node bench/bench.mjs scrivo bench/fixtures/large.md 5` | 5/5 verified reference matches; first viewport median 388 ms |
| `git diff --check` | Pass before commit |

Rust source did not change in the prior highlighting checkpoint. The previous native
suite initially had 10 pass and one new test fail from its stale handle, then passed
11/11 after the test correction; the current suite passes both large-file tests.
Playwright WebKit cannot start on this host because `libicu74`, `libxml2`, and
`libflite1` are missing; native WebKitGTK was exercised. Repository-wide
`cargo fmt --check` still reports broad preexisting formatting drift.

## Viewer phase trace checkpoint (`722c68b`)

`src/viewer/viewer.ts` now accepts an optional trace callback, supplied by the
composition root. It marks inert HTML parsing, math-font readiness, and first-block
layout during `show()`. The callback checks `__SCRIVO_TRACE__`; normal launches do
not invoke the backend. The rounded bundle gate still reports 34/40 KiB static and
48/56 KiB known prepaint JS/CSS.

Fresh three-run release traces are retained in
`bench/results/diagnostic-viewer-medium.txt` and
`bench/results/diagnostic-viewer-large.txt`. All six launches matched their
reviewed first-viewport references. Approximate phase durations from trace marks:

| Phase | Medium | Large |
|---|---:|---:|
| Process start → window built | 140–184 ms | 137–167 ms |
| Window built → JS start | 84–92 ms | 82–88 ms |
| Startup view delivered → HTML parsed | 1.7–2.0 ms | 30.5–33.9 ms |
| HTML parsed → math font ready | 10.7–11.9 ms | 8.8–9.5 ms |
| Math font ready → first blocks laid out | 22.7–24.1 ms | 24.3–27.5 ms |
| First viewport screenshot | 334–389 ms | 356–419 ms |

These are diagnostic runs on this host, not a paired comparison. JavaScript marks
pass through a Tauri IPC call, so small per-phase differences include IPC scheduling.
The native window and webview account for most elapsed time before JavaScript.
The large document's complete HTML parsing added roughly 30 ms before its first
viewport. The math-font wait was around 9–12 ms in these runs, smaller than the
first-block layout cost. The large document finished progressive insertion at
1,062–1,544 ms in these traces; first viewport was already visible.

This continuation passed `bun run typecheck`, all 294 Vitest tests, all 52 Chromium
E2E tests, the release build and bundle gate, and all six reviewed startup
reference checks. The first Chromium attempt could not bind the local dev server
inside the restricted sandbox (`listen EPERM`); the same command passed with local
networking permitted. No native feature behavior or Rust source changed.

## Earlier checkpoint: chunked HTML parsing before first paint (`129cd13`)

- The Rust renderer (`src-tauri/render/src/lib.rs`) now records UTF-16 offsets only
  after complete top-level Markdown blocks. It starts another chunk after 32 blocks
  or about 16 KiB of generated HTML, whichever comes first. This avoids a separate
  HTML tag scanner and lets each chunk be parsed independently with the browser's
  inert `<template>` parser. A single oversized block can exceed 16 KiB.
- `ViewDocument.chunkEnds` carries those offsets through native IPC and the browser
  dev renderer. `src/viewer/viewer.ts` parses the first chunk before the first
  viewport, then parses later chunks while appending blocks during idle callbacks.
  A callback parses at most one new chunk and checks elapsed time and the idle
  deadline between appended nodes. Synchronous anchor and line navigation can still
  load any required chunks immediately. Renderers without offsets use the previous
  whole-document path. A superseded document stops its old idle work.
- Rust tests cover nested lists, supplementary Unicode offsets, and large blocks;
  viewer tests cover complete content, deferred chunks, navigation, and settlement.
  A Chromium E2E test renders 32 roughly 30 KiB code blocks through the real Rust
  renderer, checks every code block's exact text, navigates to the tail, and finds
  it. It records animation frame gaps through two frames after settlement and fails
  above 200 ms. The observed maximum was 16.7 ms alone and 66.7 ms under the full
  parallel suite on this host. The full native WebKitGTK suite again verified the
  443 KB fixture's tail and all 800 highlighted code blocks. Its large-file spec
  also passed after checking all 400 tables, 800 MathML expressions, and 800 task
  checkboxes across the parsed chunks. An independent review
  found no remaining substantive boundary or scheduling defect after tightening
  the idle callback and tests.
- In 12 rotated old/new release pairs for the large fixture, the original binary
  had median first viewport **362 ms** and the final chunked binary **345 ms**;
  paired median change **−20 ms**, faster in 10/12 pairs. Raw data are in
  `bench/results/paired-chunked-html-large.txt`. The baseline binary was copied
  from commit `722c68b` (SHA-256
  `5e27a63afd1739a5d02452a93b60d1a038f459b58537049634addd39ef89c17a`).
  A prior byte-capped candidate
  showed −29 ms in 12/12 pairs; that candidate lacked the final one-chunk-per-idle
  scheduler and is not the result claimed here. Three post-change release traces
  in `bench/results/diagnostic-chunked-viewer-large.txt` saw the first chunk parsed
  7.8–9.1 ms after startup-view delivery, versus 30.5–33.9 ms for the entire HTML
  in the earlier traces. These trace marks include small IPC scheduling delays.
  The final idle scheduler finished progressive insertion at 1,460–1,473 ms after
  launch in those traces; it trades some tail completion time for bounded background
  work. First viewport content appeared at 340–355 ms.
- The first post-change trace showed higher PSS than earlier runs. Five alternating
  old/new launches (`bench/results/diagnostic-chunked-memory.txt`) measured roughly
  428–437 MiB for **both** binaries, so the observed shift was host-wide rather
  than a memory regression from chunking. PSS is sampled 1.5 seconds after first
  viewport stability; this is not a peak-memory measurement.
- The final binary also passed 12 direct-to-editor launches against its separately
  reviewed editor reference: median first viewport **388 ms**, window **212 ms**.
  Raw data are in `bench/results/verified-medium-edit-chunked.txt`. This is a
  standalone Scrivo measurement, not a paired Typora comparison.

### Validation on the final candidate

| Check | Result |
|---|---|
| `bun run typecheck`; native E2E TypeScript check | Pass |
| `bun run test` | 295 tests across 17 files passed |
| `cargo test -q -p scrivo-render`; `cargo test -q` | 35 renderer and 26 app Rust tests passed |
| `bun run test:e2e` | 54/54 Chromium tests passed, including the 1 MB single-block case |
| `bun run test:e2e:native` | 11/11 WebKitGTK specs, 12 tests passed |
| `bunx tauri build --no-bundle` | Pass; 34/40 KiB static and 48/56 KiB known prepaint JS/CSS |
| Paired startup checks | 12/12 valid old/new large, 12/12 valid current Scrivo/Typora medium and large |
| Editor startup | 12/12 reviewed reference matches; median first viewport 388 ms |

## Earlier editor startup and full-document timing (`2101010`)

- `bench/bench.mjs --edit` launches `scrivo --edit FILE` and loads a separate
  fixture-hashed screenshot reference. The new `scrivo-medium-edit.png` was visually
  inspected: it shows the CodeMirror editor, the Medium fixture heading and body,
  and 1,373 words in the status bar. The reviewer measured a 20.25% tile difference
  from the reader reference, well beyond the 0.3% readiness threshold. Five trial
  runs and a retained 12-run series all passed. The raw series is
  `bench/results/verified-medium-edit.txt`: median window **213 ms**, visible
  editor **389 ms**, stable first viewport **389 ms**, PSS **286 MiB**. This is a
  standalone Scrivo measurement; `bench/ab.mjs` does not pass `--edit` to Typora.
- The retained three-run trace in `bench/results/diagnostic-large-settled.txt`
  showed verified first-viewport content at **377–492 ms** and `document settled`
  (all progressive blocks inserted) at **1,016–1,417 ms** after process start. An
  earlier diagnostic three-run session had a 1,935 ms settle outlier under load.
  These traces are not a paired comparison, and full-document completion is not
  the screenshot benchmark's `complete` metric. The native tail E2E passed again.
- An unverified missing-file launch was captured separately to inspect the empty
  editor path; the screenshot showed the expected empty editor. Its 3-run median
  content time was 335 ms, but the run intentionally exited nonzero and is not a
  reviewed benchmark result.

## Earlier paired measurements versus Typora

Raw logs for that earlier release build and 0.3% content criterion are
`bench/results/verified-medium-chunked.txt` and
`bench/results/verified-large-chunked.txt`. Previous release logs are retained
as `bench/results/verified-medium.txt` and `verified-large.txt`; earlier logs with
weaker readiness checks are `bench/results/pre-readiness-*.txt`. Do not mix
absolute medians across these sessions.
Each run attempted 12 rotated-order pairs in the same private compositor;
all 12 pairs were valid for both fixtures. Times are milliseconds after process
launch and are specific to this Linux host, Typora 1.14.9-1, and their load:

| Fixture | App | Window median | Content median | Stable viewport median |
|---|---|---:|---:|---:|
| Medium, 8.8 KB | Typora | 411 | 965 | 965 |
| Medium, 8.8 KB | Scrivo | 211 | 340 | 340 |
| Large, 443 KB | Typora | 433 | 2,016 | 2,016 |
| Large, 443 KB | Scrivo | 211 | 356 | 356 |

Scrivo reached the reviewed first viewport sooner in all 12 pairs for both
fixtures. Paired median advantages were 626 ms and 1,682 ms respectively. Host
load differed from the previous release comparison; use the paired differences
and raw rounds, not cross-run absolute medians, to evaluate relative startup.
"Complete" in raw logs means only that the first viewport was
stable. The native large-file test proves its tail eventually renders; it does not
measure how long that takes. A prior single startup trace is in
`docs/ARCHITECTURE.md` and should not be treated as an A/B result.

## Remaining limits and useful next work

- The prepaint list is maintained from source review rather than inferred from
  JavaScript execution. Re-audit it whenever boot, workspace display, or platform
  adapters change. The math font remains a 1,060 KiB conditional first-paint
  dependency for documents with math. Measure a proposed font change in paired
  release runs and check math-heavy rendering before adopting.
- Reviewed screenshot references are sensitive to compositor geometry, fonts, app
  theme, and deliberate UI changes. Regenerate them only after inspecting the new
  PNGs. The 0.3% tile threshold is strict by design; a new machine may need its
  own reviewed references. This is a first-viewport benchmark, not a Typora
  full-document completion test.
- The Rust write path still has the cross-process race between final conflict
  check and rename when replacing an existing target. New-target installation
  uses atomic no-replace rename where supported and fails safely otherwise.
  Windows stamps now include change time and file identity where
  available, plus a bounded-memory content hash on weaker filesystems; runtime
  Windows verification remains outstanding. A writable file in a directory
  that forbids temporary-file creation now fails safely and keeps the buffer dirty.
  See `docs/ARCHITECTURE.md` for the safety model.
- The editor uses KaTeX for interactive preview while the Rust reader supplies
  MathML. Keep the two render paths separate until output and startup costs have
  been measured. A prior concurrent browser/native run had one failure in each
  suite under load; later full concurrent and sequential reruns passed, but its
  exact cause was not established.
- `document settled` times insertion only. Code highlighting completes later.
  Native tests verify Find opening during partial highlighting and the final
  800-block outcome, while their runtimes are not stable performance gates. If
  changing the idle policy further, measure interaction latency and full
  highlighting time with a controlled trace.
- Chunk boundaries require complete top-level blocks. A very large table or
  paragraph can still exceed the 8 ms idle budget. Giant code blocks beyond the
  bounded Unicode measurement limits keep the original layout path. The 200 ms
  performance gates cover their specified fixtures on this host, not arbitrary
  block size or slower hardware.
- Before the current segmentation checkpoint, an additional Chromium test with
  one 1 MB code block observed a 50 ms maximum frame gap in isolation and 100 ms
  in the full parallel suite, with exact text and tail navigation. A 5 MB code
  diagnostic observed a 333 ms gap; isolated profiling attributed 22–25 ms to
  parsing and about 221 ms to forced layout. Applying `content-visibility: auto`
  only to the whole code block moved a 350 ms stall to visible scrolling. A trial
  that appended code text in 512,000-character idle slices reached 150 ms maximum
  in isolation but 383 ms under the full parallel suite; cumulative layout grew
  from about 221 ms to 458–981 ms. Both trials were reverted. The current 250-line
  containment strategy addresses this ASCII case and tests visible scrolling.
  [MDN's `content-visibility` reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility)
  describes the browser behavior used here.

## Commands

```sh
bun run typecheck
bunx tsc --noEmit -p e2e-native/tsconfig.json
bun run test
(cd src-tauri && cargo test -q)
bun run build:web
bun run test:e2e
bun run test:e2e:native
bunx tauri build --no-bundle
node bench/ab.mjs bench/fixtures/medium.md 12 typora src-tauri/target/release/scrivo
node bench/ab.mjs bench/fixtures/large.md 12 typora src-tauri/target/release/scrivo
node bench/bench.mjs scrivo bench/fixtures/medium.md 1 --trace
node bench/bench.mjs scrivo bench/fixtures/large.md 3 --trace
node bench/bench.mjs scrivo bench/fixtures/medium.md 12 --edit
```

To refresh a reference after a visual or platform change, run one app and fixture
headlessly with `--unverified --dump=/tmp/NAME`, convert `final.ppm` to PNG with
`ffmpeg`, **inspect the image**, then use `node bench/make-reference.mjs
/tmp/NAME/final.ppm bench/fixtures/FILE.md bench/references/APP-FILE.json` and copy
the inspected PNG beside it. The unverified capture exits 1 intentionally. Use
`BENCH_FAILURE_DIR=/tmp/scrivo-bench-failures` with `bench/ab.mjs` to retain final
screens of failed launches. Keep GUI automation off the developer's live desktop.
The private compositor may need local display socket access outside the default
sandbox. Use Bun, not npm/yarn/pnpm.
