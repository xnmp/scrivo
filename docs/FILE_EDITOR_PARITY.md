# Obsidian-class file editing: spec and delivery plan

Status: active delivery plan, 2026-09-28. Scope is Scrivo as a desktop editor for local Markdown
files. This document defines a useful parity target, not a claim that Scrivo will
reproduce every Obsidian feature or keyboard shortcut.

## Goal and scope

A user should be able to open several `.md` files, edit them comfortably in live
preview or source mode, paste rich content and images, and trust that work survives
a crash or a competing edit from another program. The Markdown files remain the
source of truth and should stay usable in other editors.

Included: document lifecycle, editing interactions, local attachments, search
within a document, and document-local navigation and metadata. Excluded:
vault-wide search, backlinks, graph view, sync, plugins, Canvas, Bases, publishing,
and daily-note workflows. Wiki links are only in scope if they can be represented
as portable Markdown links; a vault-wide link resolver is outside this plan.

Obsidian references for the target behavior: [editing modes](https://obsidian.md/help/edit-and-read),
[editor settings](https://obsidian.md/help/settings), [table interactions](https://obsidian.md/help/advanced-syntax),
[paste and drop](https://obsidian.md/help/drag-and-drop), [properties](https://obsidian.md/help/properties),
and [file recovery](https://obsidian.md/help/plugins/file-recovery).

## Baseline in this repository

Scrivo already opens and saves local UTF-8 Markdown, preserves a leading BOM and
the dominant line ending, renders a reading view, and offers CodeMirror live
preview and source mode. The editor has undo/redo, document find/replace,
formatting shortcuts, spellcheck, and manual Save/Save As. File stamps and a
watcher detect external changes; conditional atomic writes and prompts protect
dirty buffers. The renderer and editor cover GFM tables, tasks, alerts,
footnotes, math, images, and YAML front matter. See `README.md`,
`docs/ARCHITECTURE.md`, and `src/editor/setup.ts`.

Natural rendered-table cell editing and row/column insertion and deletion were
integrated in commit `3298091`. The current checkpoint adds click caret placement,
keyboard cell movement, row/column moves, numeric-aware sorting, and alignment
controls. Table changes remain ordinary undoable Markdown edits.

Milestone 0's native behavior audit is in `docs/FILE_EDITOR_AUDIT.md`. Milestone 1
(P1–P4) is implemented and verified in the 2026-09-28 checkpoint. E1 and E2
editing interactions are implemented and verified in the current checkpoint.
I1 rich clipboard conversion is implemented and verified in the latest checkpoint;
I2, W1, D1, and editor preferences in E3 remain open.

At the start of each later milestone, verify the precise existing behavior in
the native app before adding code.

## Product requirements

| ID | Priority | User-visible contract | Acceptance criterion |
|---|---|---|---|
| P1 | Must | Existing named files save automatically after a short editing pause. `Ctrl/⌘+S` still saves immediately. | After an edit and 2 seconds idle, the file contains the new Markdown; an edit typed while a save is in flight remains pending and is saved later. |
| P2 | Must | Save state is visible: edited, saving, saved, or action needed. Failed saves remain visible and retryable. | The UI never reports “Saved” before the relevant write succeeds; a failed write leaves the buffer and a visible error. |
| P3 | Must | Local recovery preserves unsaved or untitled text across an app crash. Recovery is offered on reopening; accepting or dismissing it is explicit. | Kill the app after editing an untitled document, relaunch, and recover its exact Markdown. A recovery copy never silently overwrites a newer disk version. |
| P4 | Must | External edits and autosave conflicts are resolved deliberately. | If another program changes a file during an edit, autosave stops for that file, keeps the user's buffer and recovery copy, and offers reload, save elsewhere, or confirmed overwrite. |
| E1 | Must | Markdown typing feels natural: lists continue and terminate correctly; indentation works on lists and selections; pairs can be inserted or skipped; headings and nested lists can be folded. | Common Enter, Backspace, Tab, and bracket actions produce expected Markdown and remain undoable in both modes. Folding changes the view, never the saved text. |
| E2 | Must | Rendered tables support cell navigation and structural editing without forcing the whole table into source text. | Keyboard and context-menu actions update valid Markdown; save/reopen, undo/redo, empty cells, escaped pipes, and malformed tables behave predictably. |
| I1 | Must | Pasting rich text produces readable Markdown; pasting plain text preserves its text. | Paste headings, lists, links, emphasis, code, and a table from a browser; save/reopen and compare the Markdown and rendered result. Unsupported markup becomes text, not executable HTML. |
| I2 | Must | Pasting or dropping an image/file creates a local attachment and inserts a relative Markdown link. | The attachment survives save/reopen and moving the containing folder; same-name drops never overwrite an existing file. An untitled document is prompted to save before attachment import. |
| W1 | Should | Several documents can be open in tabs, with independent selection, scroll, undo history, dirty state, and disk watcher. | Switching tabs preserves each document's state; closing a dirty tab asks only about that tab; no two tabs independently edit the same canonical path. |
| D1 | Should | Document-local navigation and metadata are convenient. | A heading outline works while editing; YAML properties can be changed without losing comments, key order, or unknown values. Source mode remains available. |
| E3 | Later | Table sort/move/alignment and optional line numbers, indentation guides, and editor preferences are available. | Each command has a clear undo result; preferences persist across launches without changing Markdown bytes. |

### Persistence rules

- Keep Markdown text as the single source of truth. All editing commands, including
  table and property actions, apply text changes through CodeMirror transactions.
- Autosave uses the existing serial document lifecycle and conditional write API.
  It must not bypass file-stamp checks, conflict prompts, or the saved-snapshot
  rule for edits made during a write.
- Do not autosave an untitled document to an arbitrary user-visible path. Store a
  recovery copy in app data until the user chooses a file path.
- Write recovery copies atomically outside the document folder. Include document
  identity, source path if any, time, and the disk stamp last observed. Keep at
  least one recent copy for every dirty document; cap retention by age and total
  size. A first implementation should retain seven days and expose deletion after
  successful recovery. Recovery data should be private to the current OS user.
- Manual save, autosave, and watcher events must have deterministic ordering.
  A failed or conflicting autosave must not repeatedly prompt or overwrite; it
  should pause and leave one persistent action-needed state until resolved.
- Existing BOM/EOL and invalid-UTF-8 behavior remain intact. Any imported asset
  and its Markdown insertion must succeed together from the user's perspective:
  on failure, report it and leave no broken reference or silently replaced file.

### Editing and import rules

- Match the surrounding Markdown style where possible: ordered-list numbering,
  list marker, indentation, and line ending. Do not reformat unrelated text.
- Editing commands must work with selections, multiple cursors where supported,
  empty documents, Unicode, malformed Markdown, and large documents. Each user
  action should be one sensible undo step.
- Paste conversion is a pure HTML-to-Markdown transform behind a small clipboard
  adapter. Ignore scripts, event attributes, and unsafe URLs. Use text/plain when
  rich conversion fails; report a file-import error without losing clipboard text.
- Store new attachments by default under a sibling `assets/` directory, use
  collision-safe names, and insert path-encoded relative links. Keep the choice
  of image syntax (`![](...)`) versus file-link syntax (`[](...)`) based on type.
  Do not import an external URL as a local file without an explicit user action.
- Folder or file drops onto the window should have an explicit result: open a
  Markdown file, import an attachment at an editor position, or report unsupported
  input. Never read arbitrary dropped directories recursively.

## Delivery plan

### 0. Contract audit and checkpoints

Record a native-app behavior matrix for opening, saving, conflict resolution,
find/replace, source mode, table editing, paste, drop, and close. Integrate the
in-progress table work first or keep it isolated; do not build later milestones
on an unverified working tree. Capture a baseline release build and startup
budget before altering `boot.ts` or other prepaint imports.

### 1. Durable editing (P1–P4)

Add an autosave scheduler in the app layer, driven by content changes and using
the existing controller queue. Model save status and recovery state independently
of UI rendering. Add a recovery storage port with a native app-data adapter and
an in-memory test adapter. Implement restore/dismiss UI after the state machine
is tested. Make close and restart behavior explicit for named and untitled files.

**Gate:** unit tests cover in-flight edits, repeated edits, failed writes,
external modification/deletion, and recovery precedence. Native E2E verifies
file bytes, restart recovery, and a real external-write conflict. No startup
regression outside the existing measured budget.

### 2. Editing interactions (E1–E2)

Finish and verify the table work. Add pure Markdown commands for list continuation,
termination, indentation, and paired syntax, then CodeMirror bindings. Add fold
state as an editor projection. Keep defaults small and document shortcuts.

**Gate:** command tests assert resulting Markdown and undo behavior; browser and
native E2E cover keyboard-driven table and list editing, save/reopen, and source
mode. Include malformed input, escaped pipes, multiple selections, and long rows.

### 3. Clipboard and attachments (I1–I2)

Define a conversion contract for supported HTML, with golden input/output
examples. Add native clipboard/drop plumbing through platform ports. Add a
collision-safe attachment writer and a path/link policy in the domain layer.
Keep file copying separate from Markdown insertion until both can be committed
or a failed copy can be cleaned up safely.

**Gate:** paste/drop E2E checks the actual saved Markdown and attachment bytes;
tests include duplicate names, relative paths, Unicode names, unsafe HTML/URLs,
permission errors, and an untitled document.

### 4. Multiple documents (W1)

Replace the single active `DocumentState` with a document-session collection in
the app layer. Each session owns its own editor buffer, saved snapshot, watcher,
save/recovery status, selection, and scroll position. The workspace chooses the
active session; tabs render that state. Deduplicate canonical paths and serialize
operations per session while coordinating global open/close actions. Load tab UI
and session machinery without moving CodeMirror into the first-paint bundle.

**Gate:** native E2E opens several files, edits two, switches repeatedly, changes
one externally, closes one, relaunches, and verifies every file and recovery
state. Measure startup and tab-switch latency on existing large fixtures.

### 5. Document-local refinement (D1, E3)

Reuse heading metadata to show an outline during editing. Add a conservative
YAML properties UI that edits only the chosen source spans; leave unsupported
YAML constructs editable in source mode. Then add table sort/move/alignment and
optional editor preferences if observed usage justifies them.

**Gate:** round-trip tests preserve comments, key order, unrecognized values,
and malformed YAML. E2E verifies outline navigation, table commands, and persisted
preferences where implemented.

## Release criteria

1. No silent loss or overwrite in crash, save failure, external edit, tab close,
   or attachment-name collision scenarios.
2. The named acceptance checks above pass against real files in native E2E;
   unit tests cover pure text transforms and lifecycle decisions.
3. Markdown remains portable and byte-preserving outside intentionally edited
   spans, subject to Scrivo's documented mixed-EOL normalization.
4. Browser and native accessibility checks cover keyboard access, focus return,
   visible status/error messages, and screen-reader names for new controls.
5. Release build, typecheck, Rust tests, browser E2E, native E2E, and the existing
   startup bundle/performance gates pass for each affected milestone.

## Decisions to revisit after milestone 1

The 2-second autosave pause, seven-day recovery retention, sibling `assets/`
folder, and tab model are proposed defaults. Validate them in a native prototype
and with real editing workflows. Changing these defaults should not weaken the
data-safety contracts above.
