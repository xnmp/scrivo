# Handover — 2026-10-03

## 2026-10-03: unified settings, substitutions, minimal chrome and text selection

This pass follows `d5e24cf` (desktop appearance catalog) and preserves that work
and the concurrent `923827d` external-link theme fix.
The user's active requests are Escape dismissal, minimal header, table hover +
strips, Ctrl+D multiple selections, customizable bindings, full Ctrl+, Settings,
Substitutions, text-only selection paint, and Ctrl+W closing the final native tab.
This section supersedes the older toolbar/dialog instructions below.

### User-visible behavior

- Header: menu, tabs, new-tab and native window controls. Removed permanent palette,
  appearance, settings, Contents, Properties and mode buttons plus the second row.
  Commands remain discoverable in the menu and Ctrl/⌘+P palette; Ctrl/⌘+E toggles
  reading/editing. Reader status still hints how to edit.
- Ctrl/⌘+, opens one Settings modal with Appearance, Editor, Hotkeys and
  Substitutions. Sidebar search filters sections; each section retains its own
  controls/search. Hotkeys accepts up to four chords, removal/conflict detection,
  reset and persistence. Escape cancels active shortcut recording first, then
  dismisses Settings; menu, palette, Properties and Contents also dismiss.
- Ctrl/⌘+D selects a word, then adds its next occurrence. Typing replaces every
  selection and Undo restores them together. Binding is customizable.
- Table hover or keyboard focus reveals narrow + strips below/right with vertical
  and horizontal resize cursors. Clicking extends rows/columns and focuses the new
  editable cell. Cell typing is grouped in Undo; structure is a separate event.
- Substitutions: global enable, ordered literal/regex rules, per-rule switches,
  source/replacement search, add/remove/swap/restore, validation and persistence.
  Defaults include arrows, inequalities, ± and ½. Typing triggers rules; paste,
  existing documents and IME composition do not. Immediate Backspace restores the
  source when all cursors participated; mixed cursors use ordinary Backspace.
  Table inputs share rules but keep control-character outputs literal.
- Native reader selection paint covers text runs, not full block rectangles.
  Original browser Selection and clipboard semantics remain authoritative. Native
  nested-list text needs inline spans to work around another WebKit paint bug.
- Final-tab Ctrl/⌘+W requests native window close, including dirty/recovery guards;
  Cancel leaves the app/tab open. Browser memory mode keeps a replacement tab.

### Architecture / contracts

- `ui/settings.ts` owns the dialog and embedded Appearance/Editor/Hotkeys/
  Substitutions forms. Avoid reintroducing multiple modals or per-editor settings.
  Close restores connected prior focus; command-opened panels focus real content.
  `ui/dialog-escape.ts` handles native search-field Escape explicitly. Do not use
  stopPropagation to cover duplicate dispatch.
- `tab-window.ts` remains owner of commands, active documents and guarded native
  close. The global key dispatcher yields to hotkey recording; form fields keep
  native text editing. Record Ctrl+Shift+, as a conflict rather than resetting the
  user's appearance while recording.
- `domain/substitutions.ts` is pure matching/validation. RE2JS uses linear-time
  matching; `/pattern$/` accepts `i` and `s`, supports captures in replacement and
  rejects empty-match patterns. Context is bounded to 2,048 characters across
  lines; at most 100 rules, source 128 / replacement 2,048, expanded output 8,192.
  Replacement escapes are \n, \t, \b and \\; RE2 excludes lookaround/backrefs.
- `platform/substitutions.ts` owns `scrivo.substitutions.v1`, a 2MiB JSON envelope,
  defensive reads, subscriptions/storage synchronization and session-only failure
  reporting. Keep the envelope large enough for escaped 100-rule valid configs.
- `editor/substitutions.ts` uses CodeMirror's default input transaction to preserve
  multiple selections. It dispatches typing then replacement with isolated undo.
  Restoration state clears on document/selection changes. Table inputs use the
  matcher facet, exact caret/value guards, and avoid multiline/control output.
- `editor/setup.ts` loads selectNextOccurrence synchronously inside the deferred
  editor. A lazy selection import lost rapid consecutive Ctrl+D presses; don't
  restore that race. Search panel UI itself is still deferred.
- `viewer/text-selection.ts` installs only natively after boot. CSS Custom Highlights
  use clipped per-text-node ranges; native block paint is transparent only while
  custom ranges exist. Every large flow container seeks visible children by binary
  search (including nested lists/tables), rather than scanning a huge selected
  document on every scroll. Offscreen selection/copy remains unchanged. New reader
  DOM prepares bare text in parent list items before selection. Engines without
  Custom Highlight support retain native selection. Dynamic load failure falls
  back to native selection.
- Tables reuse existing commands/Markdown serialization. `focusCell` focuses
  synchronously if mounted; schedule one frame only when the target is absent.
  Unconditional delayed select erased the beginning of rapid typed cell text.

### In-app Save As (latest user steering)

Ctrl/⌘+S on untitled documents and Save As now open `ui/save-dialog.ts`, an app
modal with File name and absolute Folder fields. No system Save dialog launches.
Existing named files save directly. Escape/Cancel writes nothing; Enter submits.
Native path validation checks document identity and regular-file stat before
closing, preserving fields and showing an inline error for missing folders.
Controller conflict/write guards still own actual saves and overwrite confirmation.
`domain/save-location.ts` validates POSIX vs Windows absolute paths, preserves
Windows drive roots, rejects incomplete UNC/relative paths and invalid filenames,
and never expands shell expressions or silently changes extensions. Initial folder
comes from existing path or native homeDir. There is no folder browser or folder
creation in this modal. `platform/dev.ts` uses the same UI; memory unit tests and
queued picker answers retain deterministic behavior. Open file remains a system
picker, as the request concerned saving.

### Startup follow-up (latest user request)

The final pass separates Settings forms from tab chrome. `ui/window-chrome.ts`
imports/constructs them on first Settings/Appearance/Hotkeys/Substitutions/reset
command through one cached promise. All callers await the command; failed imports
report through the existing command error path and can retry. An AbortController
tracks each pending open intent: Escape or a newer command prevents a late modal,
while the module/instance cache remains reusable. The synchronous recording facade
still protects hotkey recording. Packaged palette registration stays independent
and reconciles active built-in CSS during chrome initialization, even if Settings
never opens; the saved theme snapshot still applies in boot before document layout.
The settings forms, full import library and roughly 150 KiB regex module no longer
load for an ordinary reading startup. Editor typing still loads its matching rules.

Behavior gates: 25 affected browser tests passed, then 22 tests after cancellation
and reconciliation fixes; final 12 settings contracts passed. Native four affected
specs passed after the lazy change (settings/substitutions/final close, Commands,
Appearance, Save modal). Final timing comparison below records actual results;
do not infer an almost-instant native launch from reduced frontend work alone.
Baseline `/tmp/scrivo-before-lazy-settings`, SHA-256
`68dd9172c776732b4841a21a3290e5830b538ffa02c7ef184da72a9630976d0e`.
Three baseline medium traces: content median 439 ms, JS-to-shell-ready work visible
in `/tmp/scrivo-startup-before-lazy-settings.log`. Final candidate comparisons use
private headless cage, identical fixtures/references and isolated XDG configuration.

A final native selector investigation narrowed transparent native selection to
`.markdown-body *::selection`. Suppressing all HTML descendants could blank the
reader for a programmatic Range spanning body boundaries. Reader-only suppression
preserves narrow list/real Ctrl+A paint and avoids that engine bug. Native chrome
text selection remains native. Real Ctrl+A/body-range evidence:
`/tmp/scrivo-selector-article-descendants-{list,ctrl-a,body}.png` and
`/tmp/scrivo-selection-selector-compare-valid.log`.

### Verification and reproducible commands

- Unit suite: 474 passed (34 files). A concurrent earlier run of the existing
  incomplete-parse fold timing test failed once; unchanged retry and later complete
  runs passed. Source/path/domain contracts have dedicated behavior tests.
- Final full Chromium regression:148 passed (including 11 settings/save contracts).
  Focused 11 passed also covers
  settings, substitutions, table extension, mixed Backspace, literal paste, long
  Swap, recorder/reset conflict, dotall across lines, custom Save and overwrite
  cancellation. Log: `/tmp/scrivo-settings-all-final.log`.
- Native: Editor Settings1, Properties/Outline2, Table2, Commands1, Appearance1,
  Settings/Substitutions/final-close1, Save modal1 passed in isolated displays.
  Save modal additionally verifies missing-folder error retains fields and actual
  writes succeed after correction. Logs `/tmp/scrivo-save-validation-native.log`,
  `/tmp/scrivo-settings-native-final.log`, earlier settings-native/retry logs.
- `browser.keys(['Control','Left'])` emits letters L,E,F,T, including Ctrl+T;
  corrected native spec uses ArrowLeft. Never reuse Left for arrow navigation.
  After WebKit reload, X11 active-window metadata can be absent; the close test
  locates Scrivo in its own tauri-driver process group and sends signal0 only to
  confirm clean Ctrl+W exit. No user process is killed or automated.
- Independent native visual check passes: nested-list text-width highlight, actual
  copy/paste equality, clear, scroll. A 1,200-item selected list highlights visible
  591–608 and 1091–1108 after scrolling while full selection remains 330,214 characters.
  Evidence `/tmp/scrivo-selection-final-native.log`, final-list.png,
  final-single-list-late.png. All native actions are private xvfb/dbus/openbox.
- App and native-spec TypeScript pass. Bundle gate final37/41KiB startup,
  51/56KiB known prepaint; settings, RE2 and Save remain deferred. Native release
  compile/install details are recorded below when complete.
- Reader medium/large and medium editor 1280×720 references were captured on private
  cage, converted with ffmpeg, visually reviewed then regenerated with
  `bench/make-reference.mjs`. Verified one-run smoke checks use those references;
  these are correctness checks and do not establish new speed comparisons.
- Visual agent-browser evidence includes light/dark desktop, 320px Settings,
  switch/error/focus states, Save modal and table hover under `/tmp/scrivo-*`.
  No browser runtime errors. `docs/UI_SWEEP.md` records scope and untested OS limits.

Commands:

```sh
bun run typecheck
bunx tsc -p e2e-native/tsconfig.json --noEmit
bun run test
bunx playwright test --project=chromium --workers=2
bun run build:native-test
# Use private xvfb/dbus/with-wm.sh; see package script and native config.
bunx tauri build --no-bundle
XDG_CONFIG_HOME=/tmp/scrivo-settings-bench-config \
XDG_DATA_HOME=/tmp/scrivo-settings-bench-data \
node bench/bench.mjs scrivo bench/fixtures/medium.md 1
```

### Release, installation and measured startup result

Release build succeeded with startup 37/41 KiB, known prepaint 51/56 KiB and 3,281 KiB
in the declared deferred graph. Installed atomically at `/home/chong/.local/bin/scrivo`
for the next launch. Current user windows were not automated, closed or restarted.
Release and installed SHA-256:
`70dffd99b6ac906435dde08d9624dd6803e48cb4ef4f3ca54177146dcf62a8f1`.
Both `text/markdown` and `text/x-markdown` remain `dev.scrivo.editor.desktop`.

Eight verified, alternating paired medium launches compare the preserved baseline
and final release. All 8 pairs valid and candidate faster in 8/8; **paired median
content improvement 15 ms**. Aggregate medians: before 369 ms, after 343 ms. Do not confuse
aggregate median difference 26 ms with paired effect 15 ms. The private 1280×720
compositor and exact reviewed references are used for both binaries; this result
is machine/fixture-specific and does not promise instantaneous GTK/WebKit startup.
Raw reproducible evidence: `bench/results/paired-lazy-settings-medium.txt`.

```sh
XDG_CONFIG_HOME=/tmp/scrivo-settings-bench-config \
XDG_DATA_HOME=/tmp/scrivo-settings-bench-data \
node bench/ab.mjs bench/fixtures/medium.md 8 \
  /tmp/scrivo-before-lazy-settings /tmp/scrivo-after-lazy-settings
```

Final behavior gates: full Chromium 148 passed before the late startup optimization;
affected suites 25 passed, then 22 passed after cancellation and palette fixes, then
12 Settings contracts passed including stale packaged CSS. Native four affected
specs passed after the optimization; earlier editor settings, tables and properties
specs also passed. Unit 474 and app/native TypeScript pass. The added resource
assertion verifies both Settings and substitution/regex modules stay unrequested
in normal reading startup; an in-flight module test verifies Escape cancellation.
Independent reviews covered command state, persistence bounds, input/history,
native selection paint/copy, large-selection traversal and lazy theme reconciliation.

Final release viewport smoke checks also pass for the large reader and medium
editor using the reviewed references. Logs: `/tmp/scrivo-lazy-large-smoke.log`,
`/tmp/scrivo-lazy-editor-smoke.log`. These one-run checks are correctness gates,
not additional performance claims. Final reading resource/theme checks: 2 passed
in `/tmp/scrivo-lazy-resource-proof.log`.

The installed release preserves the concurrent appearance catalog and external-link
color commits. This checkpoint contains the complete requested work; no required
implementation remains. Future native Windows/macOS checks are optional platform
coverage, not a blocked Linux task. Local browser/preview owned by this pass were
closed; benchmark artifacts/baseline binaries remain in `/tmp` and the repo results.

### Resume boundaries

- Never automate the user's live desktop or restart/close their windows. Install
  atomically for the next launch. Default Markdown associations were set previously.
- Native fixtures isolate XDG_DATA_HOME **and** XDG_CONFIG_HOME, preventing the user's
  desktop theme catalog from overriding appearance fixtures. Benchmarks need this
  isolation too. Bundle assets must not be rebuilt during browser suites.
- Existing desktop-theme work is preserved. Concurrent external-link theme work
  was separately committed as `923827d`; this checkpoint follows it. The only
  remaining live-preview index change in this pass is table typing history.
- Follow historical sections only for unchanged infrastructure and earlier findings.
  This top section records the current installation, contracts and verification.


## 2026-10-03: commands, bundled themes and comprehensive UI sweep

This work follows `ce3389a`. The active requests were built-in selectable themes,
configurable hotkeys, Ctrl+T new tab, Ctrl+R recents, a command palette, integrated
Obsidian-style chrome, and a comprehensive aesthetic sweep. Implementation,
review, release build, installation and verification are complete. Older sections
below are historical; start with this section when resuming.

### User-visible behavior

- Ctrl/⌘+T and Ctrl/⌘+N create a tab; Ctrl/⌘+R searches recent files. Selecting an
  existing open file activates its tab instead of duplicating it. Recent history
  is identity-deduplicated, bounded to 50 entries, and can be cleared in the picker,
  menu or palette. Missing files report errors; untitled paths are not recorded.
- Ctrl/⌘+P or Ctrl/⌘+Shift+P opens a command palette. Word and abbreviation search,
  arrow navigation, Enter, Escape, shortcut hints and document commands work in
  both reading and editing. A picked command runs after close/focus restoration.
- Main menu groups File, Edit, Format, View and Settings. Arrow keys navigate;
  Right opens a group and Left returns. Current bindings appear beside commands.
- Customize hotkeys accepts up to four chords per command, supports removal,
  detects conflicts (including Ctrl/Meta aliases of Mod), persists across launches,
  and can restore defaults. Standard select/copy/cut/paste chords are protected;
  form text fields retain native undo/redo even when application bindings change.
- Table insertion moved from Ctrl/⌘+T to Ctrl/⌘+Shift+T. Structural table/list
  editing remains unchanged. Application shortcuts work inside rendered cells.
- Appearance includes Charcoal, Arctic, Ember and Paper, each with light/dark
  palettes. These are original bundled palettes using Obsidian variables, not
  claims of exact third-party themes. Local CSS imports and prior controls remain.
  Builtins cannot be removed. Packaged palette updates reconcile selected CSS.
- Linux/Windows have an integrated tab/title row with outlined native controls and
  a blank drag region. Double-click maximizes/restores. macOS keeps decorations.
  Only tabs scroll, leaving the native controls visible at minimum width.
- Document toolbar aligns Contents, title and reading/editing control. Editor
  Properties/Settings use shared icons. Contents is a flush sidebar on desktop and
  an overlay on narrow windows. Reader/editor top padding, panels, dialogs, table
  menus and search surfaces use consistent tokens. No new motion dependency.
- Appearance import details are collapsible, the color preview uses bundled theme
  accent, and primary actions use the theme's text-on-accent variable.

### Ownership and important seams

- Pure logic: `domain/commands.ts`, `domain/hotkeys.ts`, `domain/recents.ts`,
  `domain/search.ts`. Physical key codes preserve shifted native key behavior.
- Infrastructure: `platform/command-preferences.ts`; keys `scrivo.hotkeys.v1` and
  `scrivo.recents.v1`. Denied storage keeps session state and reports unsuccessful
  writes; malformed/oversized JSON falls back safely. Storage events synchronize
  other windows. Successful identity/stat reconciliation updates recent history.
- `tab-window.ts` owns active-tab command execution and file ownership; existing
  serial Workspace/controller operations remain authoritative. Chrome composition
  is `ui/window-chrome.ts`; menus, picker and hotkey settings are separate components.
- One capture dispatcher owns application shortcuts. `editor/setup.ts` opt-in
  externalShortcuts removes fixed application/format/history/fold keys, search
  bindings and conflicting CodeMirror defaults. Standalone editor tests/callers
  retain default behavior. `formattingCommands` exposes named editor actions.
- Properties open is idempotent while visible, preserving unfinished new-property
  input. Saves call commit() first; invalid pending values prevent save. The actual
  editor opts out of the legacy Properties Ctrl+S listener, so removed bindings
  cannot still save from a form. Successful commit restores document focus so the
  next Undo changes Markdown rather than a text field's private history.
- WindowPort close registration returns Promise<void> and is awaited before the
  custom controls appear. The guard awaits initialIdentityReady, then checks all
  workspaces; readiness releases in finally. UI close calls native close(), never
  destroy(), preserving cancellation/recovery policy. New permissions allow
  close/minimize/toggle-maximize/start-dragging.
- Lightweight stored-chord matching runs during boot so custom shortcuts pressed
  before controls load can replay. Shims must remain the first static import.
  Palette/library/chrome code remain deferred; selected CSS applies synchronously.
- Builtin catalog is `ui/builtin-themes.ts`; registration reconciles active builtin
  CSS and persistence without adding the catalog to the startup import graph.

### Review findings and completed verification

- Independent adversarial reviews found and verified fixes for CodeMirror fallback
  collisions after unbinding, draft loss when reopening Properties, builtin CSS
  updates, native edit shortcuts, close guard registration, and palette focus.
- Pointer instrumentation reproduced pointer-down detail=0 versus mouse-down=1;
  the blank drag region also needed explicit stretch under centered flex alignment.
  Mouse-down/full-height fixes are implemented and verified with physical XTest
  input on private Xvfb. WebDriver's DOM pointer simulation does not move the X
  pointer used by GTK native window moves. Openbox adjusts the first drag from
  the top edge: requested (+60,+40) yielded (+60,+29); a second drag yielded exactly
  (+60,+40). The test asserts substantial native displacement in both requested
  directions rather than exact frame coordinates. No product workaround was added.
- 465 unit tests pass; app/native test TypeScript and git diff check pass.
- Full Chromium regression: 134 passed before final polish/review follow-ups.
  Follow-ups: 16 appearance/commands/properties, 27 command/table outcomes,
  15 command/menu/editing-outline/search/appearance checks, 13 command/properties
  checks after the final focus fix, and the final seven command tests passed.
- Native commands: one comprehensive scenario passed physical dragging, maximize/
  restore, minimize, new tab, dirty window-close cancellation, recents, palette
  formatting with real file bytes, and hotkey/theme persistence across relaunch.
  Native Properties/Outline: both tests passed, including BOM/CRLF/comments and
  unknown-value preservation, Undo after save, and heading navigation/unfolding.
  Native Appearance: imported variables and persistence passed without changing
  the file. All use private Xvfb/DBus/Openbox; no host desktop automation was used.
- Visual coverage and real rejected alternatives: `docs/UI_SWEEP.md`. Captures
  inspected dark reader/editor/Appearance/palette/Contents/Properties/Settings,
  light hotkeys/menu/recents, Appearance at 320×700 and native header.
- Production gate currently 36/41 KiB static startup, 50/56 KiB known prepaint,
  about 3,114 KiB deferred. No new cold-start speedup claim: earlier investigations
  found native GTK/WebKit dominates. New shell geometry has reviewed benchmark
  references and verified release smoke measurements below.

### Release, installation and startup evidence

`bunx tauri build --no-bundle` succeeded. Both the release binary at
`src-tauri/target/release/scrivo` and the installed `/home/chong/.local/bin/scrivo`
have SHA256:

```text
8344edf6a881b9281d0538b215f97d9dc596fcb5d2be7665714ac8ab4d365017
```

Installation used a temporary sibling and atomic rename; existing user windows
were not closed. The next launch uses this release. The prior binary is preserved
at `/tmp/scrivo-before-chrome-release` for this session (not a durable artifact).
Both `text/markdown` and `text/x-markdown` defaults remain
`dev.scrivo.editor.desktop`, whose launcher uses `/home/chong/.local/bin/scrivo %F`.

Reviewed fresh native 1280×720 reader-medium, reader-large and editor-medium final
captures before replacing their JSON and PNG references in `bench/references/`.
Exploratory `--unverified` captures deliberately exit 1 and are not verification
results. Then ran three verified launches per path, sequentially without builds
or other native tests running, using `SCRIVO_TRACE` via `--trace` and isolated
`XDG_DATA_HOME=/tmp/scrivo-chrome-bench-data`:

| Path | Passed | Window median | Complete visible interface median | PSS median |
| --- | ---: | ---: | ---: | ---: |
| Medium reader | 3/3 | 232 ms | 411 ms | 256 MiB |
| Large reader | 3/3 | 237 ms | 422 ms | 419 MiB |
| Medium editor | 3/3 | 235 ms | 496 ms | 290 MiB |

Content and stable-viewport metrics coincide in these runs. References include the
settled chrome; these figures describe the complete visible interface, and not
just the earlier prefetched document paint. Sampling intervals were 18–26 ms.
Three launches establish a smoke check, not a paired performance comparison or
an almost-instant startup claim. Do not compare these absolute medians against
historical runs with different geometry, host load or binary references.

Committed raw logs: `bench/results/chrome-shipping-medium.txt`,
`chrome-shipping-large.txt`, and `chrome-shipping-medium-edit.txt` include trace
marks. Reproduce with the release built from this checkpoint and the reviewed
references:

```sh
XDG_DATA_HOME=/tmp/scrivo-chrome-bench-data node bench/bench.mjs scrivo bench/fixtures/medium.md 3 --trace
XDG_DATA_HOME=/tmp/scrivo-chrome-bench-data node bench/bench.mjs scrivo bench/fixtures/large.md 3 --trace
XDG_DATA_HOME=/tmp/scrivo-chrome-bench-data node bench/bench.mjs scrivo bench/fixtures/medium.md 3 --edit --trace
```

Session-only logs under `/tmp`: `scrivo-unit.log`, `scrivo-full-e2e.log`,
`scrivo-final-e2e.log`, `scrivo-final-command-properties.log`,
`scrivo-command-focus-final.log`, `scrivo-native-commands-final.log`,
`scrivo-native-final-recheck.log` (Properties/Outline passed; earlier overstrict
drag assertion failed), `scrivo-native-final.log` (Appearance passed; earlier
issues subsequently fixed), and `scrivo-release-build.log`. Final inspected
screens include `scrivo-final-{reader,menu,outline,narrow}.png`,
`scrivo-native-chrome.png`, and `scrivo-chrome-{medium,large,medium-edit}.png`.
Temporary logs/captures are not durable; committed references and results are.

### Reproduce

```sh
bun run typecheck
bunx tsc -p e2e-native/tsconfig.json --noEmit
bun run test
bunx playwright test --project=chromium --workers=1
bun run build:native-test
env -u WAYLAND_DISPLAY -u HYPRLAND_INSTANCE_SIGNATURE GDK_BACKEND=x11 \
  xvfb-run -a dbus-run-session -- e2e-native/with-wm.sh bunx wdio run \
  e2e-native/wdio.conf.ts --spec e2e-native/specs/commands.spec.ts
bunx tauri build --no-bundle
```

Native fixtures create files under ~/.scrivo-e2e-native and use private Xvfb/DBus/openbox.
The drag helper requires Python 3/libXtst and refuses non-Xvfb displays.
Never automate/close the user desktop. Install affects subsequent launches only.

### Scope boundaries

No Obsidian vault/plugin/marketplace layer, remote-theme downloading or exact
community DOM emulation. Windows/macOS were not executed; macOS keeps native chrome.
Imported CSS is user trusted and can override layout. Absolute recent paths are
persisted locally and have an explicit clear action. Native drag result, installed
checksum and updated benchmark references are recorded above.

### Resume guidance

No required task remains open for this checkpoint. The most useful follow-up is
native Windows/macOS verification of chrome, keyboard layouts and modal focus.
If startup optimization resumes, preserve this release and its references as the
baseline, use paired runs with each binary's reviewed reference, and separate
document paint from complete chrome readiness. Keep editor, theme catalog and
command UI off the static startup graph; rerun the bundle gate after import changes.
Do not automate the host desktop or discard any existing user's Markdown changes.

---


## 2026-10-02: appearance system, gutter fix, startup follow-up

This checkpoint follows `5ffab9e`. The user's additional requests were to remove
the bright left editor line, reduce startup time, and add Obsidian-style theming.

### Appearance behavior and ownership

- The tab strip's Appearance button is available in reading and editing. It opens
  a native modal dialog with system/light/dark mode, imported theme selection,
  accent color, text/monospace fonts, font size (12–24), and reset. Escape closes
  it and restores focus. Ctrl/⌘+, opens it; Ctrl/⌘+Shift+, resets before opening,
  providing a recovery path if imported CSS hides controls. Document shortcuts
  do not operate on background tabs while a native dialog is open.
- Imports local self-contained CSS files, up to 1 MiB each; the library is bounded
  to 20 themes and 4 MiB serialized. Imported CSS is user-authored/trusted styling,
  not Markdown. Existing native CSP remains in effect. Relative companion assets,
  Obsidian plugins/Style Settings, a theme marketplace, and Obsidian-specific
  layout selectors are not implemented. This is CSS-variable compatibility, not
  a promise that arbitrary community themes reproduce all Obsidian chrome.
- `domain/appearance.ts` validates bounded immutable values and imported themes.
  `platform/appearance.ts` owns WebView-local persistence, cross-window storage
  events, and application of CSS. Small preferences use `scrivo.appearance.v1`;
  the deferred theme library uses `scrivo.themes.v1`. An authoritative atomic
  `scrivo.active-theme.v1` snapshot contains selected ID, name, and CSS together.
  That snapshot is reconciled into the library after partial storage mutations,
  keeping the Theme selector consistent with the CSS actually being used.
- Ordinary preference changes only write small settings. CSS and library data
  are rewritten when selection or library content changes. Denied/quota storage
  leaves session controls usable and reports that saving failed. Invalid storage
  falls back safely. CSS JSON expansion is bounded separately from decoded CSS.
- Appearance applies synchronously before first document layout; the library
  and UI remain deferred. System mode listens for OS changes. `theme-light` and
  `theme-dark` classes are placed on HTML and body. `base.css` bridges Obsidian
  surface, text, accent, border, code, selection, caret, font, line-height, and
  readable-width variables into existing app tokens. Per-level `--h1-color`
  through `--h6-color` apply to both reading and live preview headings. Theme
  changes never touch Markdown or undo history.
- `ui/appearance-settings.ts` owns controls and imports. An import generation
  invalidates an obsolete asynchronous file read after a newer selection/reset.
  The existing per-editor Settings panel still owns editor projections only.

### Border and startup work

- Reproduced the white line as CodeMirror's default light-base gutter separator,
  which remained under Scrivo's dark tokens. `editor/theme.ts` explicitly sets
  `.cm-gutters` border to none; browser and native checks verify width 0px while
  fold controls remain available. A border-only release was installed early.
- Preserved the prior installed release as `/tmp/scrivo-startup-baseline`, SHA-256
  `d58d5be3fbf26809182157883f6b6193120c5b56c9cf134a8f2e0dbe7dd519ca`.
  Independent sequential native profiling found window build around 190 ms,
  JavaScript start around 317 ms, and first layout around 364 ms. Large Markdown
  prefetch completed around 16 ms. Native window/WebKit startup dominates.
- Added tab-shell import/ready trace marks. The deferred shell took roughly
  30 ms to load and 25–30 ms to initialize. Two earlier-loading experiments were
  measured and rejected (results below). Shipping keeps the prior deferred shell
  scheduling. Pending keyboard/link handling includes Appearance shortcuts pressed
  during boot. A failed controls import/init now reports recovery, retains readable
  content, and releases buffered shortcuts instead of leaving them captured.
- Shipping bundle gate: about 33/41 KiB static startup and 47/56 KiB known
  prepaint. The experiment counted the earlier tab shell explicitly at 79/84 KiB;
  that increase was reverted with the scheduling experiment. CodeMirror, code
  highlighting, appearance UI, and the theme library remain deferred. Conditional
  math font remains about 1,060 KiB; declared deferred graph is about 3,085 KiB.
- The first eager-import experiment initialized sessions after two animation
  frames. Twelve verified medium pairs found +1 ms paired median (faster 6/12),
  so that scheduling alone did not help. Retained raw trial:
  `bench/results/paired-appearance-double-frame-medium.txt`, candidate SHA-256
  `14c722cf725d38dd2c269575640f221061634fb5934d05a6207a33513271afc6`.
  The second experiment mounted in the first idle slot after initial layout,
  using the existing WebKit shim and a 100 ms starvation deadline. Twelve pairs
  per fixture found medium baseline/candidate medians 397/393 ms, paired delta
  −8 ms (faster 8/12), but large 396/405 ms, paired delta +12 ms (faster 4/12).
  All 24 pairs passed viewport references. This was rejected because it did not
  improve both workloads. Logs: `paired-appearance-startup-{medium,large}.txt`;
  measured candidate SHA-256
  `c2e63b9d0122231039e41c3da08eb5e3f88b76e88ea96ff1de1a00ae87748e03`.
  The idle deadline also does not guarantee a paint before mount under frame
  starvation. No new first-viewport speed improvement is claimed for shipping.

### Verification and release status

- Unit suite: 455 passing, including malformed preferences, bounded CSS, escaped
  boundary-sized persistence, partial writes, library reconciliation, denied
  storage, cross-window updates, and disposing subscriptions.
- Production Chromium regression suite: 129 passing with one worker. An earlier
  run used stale assets for the new heading-color assertion and had a separate
  Chromium page crash on settings reload; rebuilt final assets passed. A final
  focused appearance run also checks modal shortcut routing, reset via keyboard,
  font overrides, and actual failed controls-module recovery. The latter retains
  readable content without an unhandled error and releases the shortcut listener.
- Native appearance spec passes: File API import, actual WebKit theme/heading
  colors, reader→editor gutter width, native relaunch persistence, reset, and
  unchanged real file bytes. It uses an isolated Xvfb/DBus session and the browser
  File API instead of interacting with the host file chooser. The first attempt
  failed solely because of an invalid test selector; corrected XPath passed.
- App and native test typechecks, release/debug builds, bundle gate, and
  `git diff --check` pass. Independent adversarial review found and verified the
  persistence/import ordering/library-write/heading-color fixes above; no concrete
  appearance selection consistency issue remained in the final focused review.
- Final installed checksum and release smoke measurements are recorded below.
  Temporary detailed logs are under `/tmp/scrivo-appearance-*`; reproduce tests
  rather than depending on those files.
- Further cold-start investigation should target native GTK/WebKit initialization,
  not Markdown rendering or deferred editor logic. A separate warm-launch design
  could reuse an existing window/process; this is not implemented and would change
  launch semantics, requiring reliable request queueing and real multi-process
  native tests. Do not present warm-open timings as cold-start measurements.

### Shipping artifact

Release `src-tauri/target/release/scrivo` is installed as
`/home/chong/.local/bin/scrivo`, SHA-256
`73eec8f20ec2efc4fb1ca79ccdbfae8cc43e40351339917641edec93bb0942bf`.
Three isolated, reviewed-reference native launches per fixture gave content medians
389 ms (medium) and 396 ms (large), with all six viewports verified. These are smoke
measurements, not evidence of an improvement over the previous release. Raw phase
logs: `bench/results/appearance-shipping-{medium,large}.txt`.
The existing `dev.scrivo.editor.desktop` remains the default for both
`text/markdown` and `text/x-markdown`; its launcher executes the installed binary.

### Reproduction

```sh
bun run typecheck
bunx tsc -p e2e-native/tsconfig.json --noEmit
bun run test
bunx playwright test --project=chromium --workers=1
bun run build:native-test
env -u WAYLAND_DISPLAY -u HYPRLAND_INSTANCE_SIGNATURE GDK_BACKEND=x11 \
  xvfb-run -a dbus-run-session -- e2e-native/with-wm.sh bunx wdio run \
  e2e-native/wdio.conf.ts --spec e2e-native/specs/appearance.spec.ts
bunx tauri build --no-bundle
```

Use private compositor benchmarks; never automate or close the user's desktop
windows. Installing a binary changes subsequent launches, not existing processes.

## 2026-10-02: D1 and E3 delivered; scoped file-editor parity complete

This checkpoint closed the scoped file-editor parity work. Sections below describe earlier
states and must not be read as current outstanding work. The objective was
local Markdown file editing parity defined by `docs/FILE_EDITOR_PARITY.md`, with
extensive outcome verification. P1–P4, E1–E3, I1–I2, W1 and D1 are implemented.
There are no remaining required coding tasks in that scoped plan. This checkpoint
finishes the D1 groundwork from `bcc8e23` and adds persistent editor preferences.

### User-visible behavior

- Contents now works in editing and source modes, indexes the complete document,
  updates after edits, and navigates to the current heading line. Navigation
  unfolds containing sections and focuses the editor. Each tab retains its own
  heading index; the shared outline shows only the active document.
- Properties edits simple YAML string, finite exact number, and boolean scalars.
  Valid input updates Markdown immediately, so autosave, recovery, dirty status,
  and tab/window close all use the actual text. Each field's typing is undoable
  as a group. The row Save button validates and returns focus to the editor;
  Ctrl/⌘+S inside the panel validates pending values and saves the document.
  Adding a property inserts a single source line; Ctrl/⌘+S also commits a valid
  pending new property. Empty string values are allowed.
- Properties preserves comments, key order, fences, unrelated values, and body
  bytes. Nested values, lists, aliases, custom tags, multiline strings, nulls,
  and integers outside JavaScript's safe range remain editable in source.
  Invalid/oversized YAML shows an explanation and source action; the form never
  rewrites it. Stale controls cannot overwrite a changed source scalar.
- Settings offers line numbers, indentation guides, spellcheck, wrapping, and
  tab display width (2/4/8 spaces). Preferences apply to every mounted editor
  and persist across native launches. They change editor projections and never
  Markdown bytes or undo history. Guides draw in source/code/front matter and
  rendered nested list rows. Settings and Properties are mutually exclusive;
  Escape returns focus to the relevant toggle.
- Ctrl/⌘+Shift+Z now resolves redo from modifier state even when the WebView
  reports lowercase `z`. Ctrl/⌘+Shift+S receives the same treatment for Save As.

### Ownership and implementation

- `src/domain/properties.ts` is the pure YAML source-span boundary. It validates
  a leading BOM-aware LF/CRLF fenced mapping with `yaml.parseDocument`, bounded
  to 256 KiB/1,000 lines and 64 KiB values. `readProperties`, `changeProperty`,
  and `addProperty` never serialize the whole mapping. Changes re-read current
  source and compare an expected scalar before replacing only its token.
  Root flow/tagged maps reject property additions. `src/ui/properties.ts` owns
  forms and validation; `src/editor-app.ts` dispatches normal CodeMirror changes.
  A 257 KiB editor prefix suffices, avoiding full-document conversion for a
  property keystroke. Field boundaries use history isolation, while typing
  uses `input.type.properties` for ordinary grouping.
- `src/editor/headings.ts` is a pure complete Markdown heading extractor. Its
  worker parser imports GFM, the shared block grammar, and inert entity decoding.
  It skips apparent headings in code, HTML, YAML, and display math, and produces
  readable Unicode inline labels. `markdown-blocks.ts` contains the previously
  inline math/front-matter grammar, re-exported from `syntax.ts` for existing
  callers. The front-matter fence scan now reaches 257 KiB, including YAML
  accepted by Properties.
- `headings.worker.ts` + `heading-worker-client.ts` provide one lazily created
  module worker per window, request IDs, and error/recreation handling.
  `heading-observer.ts` owns a 250 ms debounce, one in-flight request per editor,
  coalescing, stale rejection, and disposal. Worker results never mutate source.
  `editor-app.ts` stores the immutable indexed document and composed change
  descriptions; positions are remapped only when navigating, avoiding an
  all-headings pass on each keystroke. `setup.revealLine` unfolds ranges before
  scrolling. `tab-window.ts` keeps reading and editing heading sets per session.
  `ui/outline.ts` defers row DOM while hidden and reuses rows while open.
- `domain/editor-preferences.ts` validates immutable settings/defaults and
  bounds visual indentation. `platform/editor-preferences.ts` loads deferred
  WebView local storage under `scrivo.editor-preferences.v1`, shares subscribers
  within the window, and receives storage events from other windows. Corrupt
  data falls back safely; denied/quota storage leaves session settings usable
  and shows persistence feedback. `setup.ts` reconfigures one preferences
  compartment. `indentation-guides.ts` decorates only visible source lines,
  reads at most 80 characters per line, and deduplicates split visible ranges.
- Keep W1's ownership boundaries: each session retains its own Workspace,
  controller, EditorApp, CodeMirror state, and watcher. Preference values are
  shared, while metadata/forms/index observers belong to their editor session.

### Review findings and resolved failures

- Independent adversarial review found per-keystroke O(headings) remapping/DOM
  rebuilds, ephemeral Properties drafts bypassing save/close, large YAML comment
  leakage into Contents, unsafe-integer rounding, and guide allocation/alignment
  issues. These were addressed with lazy navigation mapping/reused outline rows,
  live scalar edits, aligned scan bounds, conservative scalar filtering, bounded
  visible-line reads, and font-appropriate guide styles. Final E3 review reported
  no further concrete persistence, tab-sharing, history, or accessibility defect.
- An isolated undo/redo investigation reproduced CodeMirror trying Ctrl+Z before
  Ctrl+Shift+Z for a lowercase shifted character. When an earlier undo event
  remained, redo unexpectedly undid it. A high-priority DOM handler now resolves
  the two distinct shifted document commands from modifier state and consumes
  the command even when no redo exists. Browser and native undo/redo outcomes
  verify the fix with multiple history events.
- Native probes distinguished test interactions from product defects: Properties
  remains open when switching reading→editing, so blindly toggling it hid the
  target control; Contents covers the gutter on narrow windows; typing must
  focus the editor. WebKitWebDriver also coalesces repeated identical key pairs
  (`Added`→`Aded`, `Root`→`Rot`). Native specs use actual keyboard interaction and
  strings without consecutive duplicate letters. No product timing workaround
  was added.
- Development-server browser runs intermittently failed to load modules with
  Chromium `net::ERR_INSUFFICIENT_RESOURCES`; a trace showed failed requests for
  `inline-ast.ts`/`widgets.ts` and a rejected editor dynamic import, leaving the
  initial static Untitled shell. The specific host limit is unproven. Production
  bundle verification passed the entire suite. Playwright now builds web assets
  and serves Vite preview, with the same Rust renderer/asset middleware registered
  for both dev and preview. This tests shipped workers/code splitting and avoids
  hundreds of development-module requests per navigation. Development remains
  available through `bun run dev`.

### Verification and release evidence

- Vitest: **444/444**, including scalar round trips, malformed/oversized YAML,
  BOM/CRLF/comments/order, unsupported constructs, precision, stale values,
  full heading extraction, async stale/disposal/retry, preferences validation,
  failed persistence, and subscriber disposal.
- Rust: **60/60**. App and native E2E TypeScript checks passed; `git diff --check`
  passed. `build:web`, debug native build, and release `tauri build --no-bundle`
  passed.
- Chromium: **126/126** against production assets, 2 workers, 36.7 seconds.
  New specs cover property save/undo/redo/reopen and unknown YAML preservation;
  adding, invalid/stale inputs, Ctrl+S, tab isolation and 320px focus/overflow;
  editing outline updates/navigation and the 443 KiB fixture's tail; preference
  reload/tab sharing/source guides/undo preservation; and saved find/replace
  outcomes. Earlier dev-module runs had resource failures described above.
- Native WebKitGTK: the full suite passed **24/24 spec files**, then the new
  `editor-find` spec passed independently, giving coverage for **all 25 current
  spec files**. `properties-outline` verifies real BOM/CRLF/comment/unknown YAML
  bytes, undo/redo/save, native worker navigation/unfolding, and edited headings.
  `editor-settings` relaunches the app and verifies persisted preferences and
  unchanged source/history. `editor-find` checks replace-all, undo/redo, exact
  BOM/CRLF disk bytes, and native reopen. Existing conflict/recovery/attachment/
  tab/table/large-reading tests remain passing.
- Visual inspection used agent-browser on dev and built preview, with named
  controls and no console errors; light/dark 320px and 1280px settings screens
  were inspected. Browser responsive properties/focus assertions passed.
- Bundle gate: **28/41 KiB** static startup; **42/56 KiB** known prepaint;
  **3,079 KiB** declared deferred graph, including assets. The independent
  heading worker is about **214 KiB** uncompressed. Extracting the block grammar
  kept CodeMirror/code-language loaders out of that worker (the first prototype
  accidentally bundled ~1.27 MiB).
- Twelve paired release startup rounds per fixture, baseline W1 binary SHA-256
  `d97035bccb02a37151aa2799558939020f596ae6157d29e908250c3ba7b5e882`:
  medium baseline/candidate content medians **406/409 ms**, paired delta **−2 ms**,
  candidate faster 7/12; large **386/396 ms**, paired delta **+8 ms**, faster 2/12.
  All 24 paired rounds passed reviewed viewport references. These are small
  host-dependent differences, not evidence of a meaningful startup speed change.
  Logs: `bench/results/paired-d1-e3-{medium,large}.txt`. Old README timings belong
  to their explicitly named builds/runs and should not be mixed with these.

### Installed artifact and reproducible commands

The verified release artifact is `src-tauri/target/release/scrivo`, installed to
`/home/chong/.local/bin/scrivo`. Both should have SHA-256
`d58d5be3fbf26809182157883f6b6193120c5b56c9cf134a8f2e0dbe7dd519ca`.
Existing desktop windows retain their previous process; the next launch loads
this release. Native automation and benchmarks used isolated displays.

```sh
bun run typecheck
bunx tsc -p e2e-native/tsconfig.json --noEmit
bun run test
cargo test --manifest-path src-tauri/Cargo.toml
bunx playwright test --project=chromium --workers=2
bun run test:e2e:native
bunx tauri build --no-bundle
```

For the exact successful browser run, a temporary Playwright config targeted
the verified preview at `http://127.0.0.1:5174`, with Chromium and two workers.
The checked-in Playwright config now starts an equivalent built preview on 1421.
`/tmp/scrivo-built-browser.log`, `/tmp/scrivo-final-native.log`, and
`/tmp/scrivo-find-native2.log` hold session-local detailed outcomes; they may be
removed by the host and are not needed to reproduce the commands above.

### Next agent / limits

No open implementation item remains in `FILE_EDITOR_PARITY.md`. Begin any future
work from the new checkpoint, not from the historical D1 WIP below. This plan
intentionally concerns local file editing; vault search/backlinks/graph/sync,
plugins and other Obsidian vault workflows remain outside its defined scope.
Verification here is Linux Chromium + native WebKitGTK; macOS/Windows launches
and a native OS drag gesture are not automated in this environment. Browser
transfer outcomes and native attachment file/clipboard integration are covered.
Properties is deliberately a scalar form; rename/delete/complex metadata editing
continues through source. Tabs remain mounted, so many large open documents grow
memory usage. Recovery is asynchronous and retains the previously documented
very-latest-keystroke kill window. No new timing assumption weakens file safety.

If a shell command fails sandbox setup with a bubblewrap `.codex` mount
`Quota exceeded`, use an approved escalated command: filesystem capacity/inode
checks showed ample space, and this was a sandbox setup failure. Git writes and
installation also require escalation under this workspace's permissions.

## 2026-09-28: D1 properties WIP handoff

The active goal is still `docs/FILE_EDITOR_PARITY.md`: local Markdown editing
parity with extensive verification. W1 tabs are complete in `2317b97` (details
below) and its release binary is installed. This WIP checkpoint begins D1;
**editing outline, properties UI, and E3 preferences are not implemented**.
Do not mark D1 or the overall goal complete from this commit.

### Exact WIP state

- `package.json` and `bun.lock` add `yaml` 2.9.1 as a direct runtime dependency.
  It is intended to load only with the deferred editor, preserving the reading
  startup bundle. `src/domain/properties.ts` is an unconnected pure helper with
  `readProperties`, `changeProperty`, and `addProperty`. It finds a leading
  `---` YAML block (up to 1,000 lines/256 KiB), asks `yaml.parseDocument` to
  validate its mapping, exposes only single-line string scalar values, and
  returns offsets for a CodeMirror text transaction. Other YAML types stay in
  source and are counted as unsupported. Editing replaces only the scalar
  token with a JSON-quoted YAML string; adding inserts one key line before the
  closing fence or creates a new fenced block. The helper has no side effects
  and is not imported by the app, so this commit adds no user-visible feature.
- `bun run typecheck` and `git diff --check` passed after the WIP files were
  added. A direct Bun probe read `title: Old # keep` alongside an untouched
  list, then produced `title: "New" # keep` at the expected source offsets.
  **No unit, browser, or native test covers this new helper yet.** W1's 408
  Vitest, 60 Rust, 7 focused browser tab, and 22 native spec results below
  predate these D1 files. The installed binary also predates them.

### Why this approach

- [Obsidian's properties guide](https://obsidian.md/help/properties) keeps YAML
  as the file format, offers raw Source mode, and leaves nested properties to
  source editing. Scrivo's D1 contract requires preserving comments, key order,
  and unknown values. The [`yaml` Document API](https://github.com/eemeli/yaml/blob/main/docs/04_documents.md)
  exposes scalar source ranges. Its [parsing guide](https://github.com/eemeli/yaml/blob/main/docs/07_parsing_yaml.md)
  describes CST use for exact source preservation. Replacing one known scalar
  span is safer here than serializing the whole front matter, which could alter
  formatting or comment placement.
- The reading outline is `src/ui/outline.ts`, fed by renderer headings in
  `src/tab-window.ts`; it is currently hidden in edit mode. `src/editor/setup.ts`
  has `onDocChanged`, `onSelectionChanged`, and `revealLine`, which are usable
  seams for editing outline navigation. Parsing the whole 443 KiB benchmark
  with `scrivoMarkdown.parser.parse()` took about 109–227 ms per call on this
  host. Do not run a full parse synchronously on every keystroke. Use an async
  worker, a bounded incremental strategy, or a dedicated native heading query;
  coalesce edits and reject stale results. [CodeMirror's reference](https://codemirror.net/docs/ref/)
  notes that its current syntax tree can be incomplete, so relying on the
  visible parser prefix would produce an incomplete outline on large files.

### Next agent: finish D1

1. Add behavior tests for `properties.ts` before wiring it: no front matter,
   empty and malformed blocks, duplicate keys, comments and key order, quoted
   strings, Unicode, CRLF/BOM, mixed and very large YAML, block scalars, aliases,
   nested maps, numeric/bool values, and stale offsets. Check the first-line
   `---` with no newline: `frontMatter()` currently treats it as absent rather
   than unclosed, so `addProperty()` could prepend a second block. Confirm and
   fix that edge case. Also decide whether a closing fence with trailing text
   or a very large block should be reported as invalid or simply left in source.
2. Add an accessible, document-local Properties UI in the editor. Re-read the
   current CodeMirror document at commit time, call the pure helper, and dispatch
   its `{from,to,insert}` as one undoable transaction through the editor. Show
   unsupported YAML as source-only, keep malformed input untouched, and preserve
   the current mode and cursor. Test saved bytes, undo/redo, reopen, tab isolation,
   comments/order/unknown values, and source mode in Chromium and WebKitGTK.
3. Extend the existing outline UI to editing: derive headings from current
   Markdown without blocking typing, navigate with `revealLine`, update after
   edits and tab switches, and keep focus/selection predictable. Test headings
   inside code/front matter, stale async results, large documents, and native
   keyboard access. Then complete E3 persistent preferences and the remaining
   release criteria in `docs/FILE_EDITOR_PARITY.md`.

Keep `src/app/tab-registry.ts` and each session's `Workspace`/`EditorApp` as the
ownership boundaries. Property edits belong in CodeMirror transactions, and
preferences should change editor projections rather than Markdown bytes.

## 2026-09-28: W1 independent document tabs

The active objective remains `docs/FILE_EDITOR_PARITY.md`. W1 is implemented:
multiple local Markdown documents can stay open with independent reader/editor
surfaces, CodeMirror states, undo histories, selection, scroll, save/recovery
state, and watcher subscriptions. Opening the same canonical file, including a
symlink alias, activates its existing tab. `Ctrl+Tab` and `Ctrl+Shift+Tab`
switch tabs; `Ctrl+W` closes the active tab and prompts only for that dirty
document. Local Markdown links and dropped Markdown files open tabs. D1 editing
outline/properties and E3 editor preferences remain to finish the broader goal.

### Implementation and safety decisions

- Foundation commit `4200a97` added the immutable tab registry
  (`src/app/tab-registry.ts`), keyed watcher subscriptions (`src-tauri/src/watch.rs`,
  `src/platform/{tauri,memory}.ts`), and native canonical document identity
  (`src-tauri/src/commands.rs`). The subsequent W1 integration adds
  `src/tab-window.ts`, `src/ui/tabs.ts`, and per-session DOM panels. Each session
  reuses the existing `Workspace` and `DocumentController`; editing remains lazy
  so CodeMirror is absent from the first-paint bundle.
- `src/boot.ts` paints the prefetched reading document before importing the tab
  manager. It queues early links and shortcuts until the manager is ready.
  `src/app/workspace.ts` hydrates that first view, opens document links through
  the manager, and keeps the reader's file path current after Save As.
- Save As reserves its target identity while the dialog/write is in progress;
  writes reject an identity owned by another tab. Recovery matching uses
  canonical aliases in `src/app/recovery-match.ts` and is scoped to the owning
  session. Failed opens remove their tab. A cancelled whole-window close
  re-protects dirty documents without autosaving text the user had chosen to
  discard before cancelling another tab's prompt.
- Tab state remains in `src/tab-window.ts`; `src/app/tab-registry.ts` is the pure
  identity/order/activation model. `docs/W1_DESIGN.md` explains ownership. The
  tab manager currently keeps every opened editor mounted; this preserves
  CodeMirror history and scroll but memory grows with the number of large tabs.

### Verification and performance

- Browser E2E covers independent edits/undo/saves, canonical path deduplication,
  dirty close, retained selection/scroll, inactive external edits, cancelled
  window close and recovery, reader Save As, and two 443 KiB editing tabs. The
  large-tab test measured a 33.0 ms median and 35.4 ms maximum from activation
  through two animation frames over 10 switches on this host; it also asserts
  that the intended document is visible after each switch.
- Native WebKitGTK E2E passed all 22 spec files. The W1 native spec opens a
  second file through a link, verifies a symlink alias selects that tab, saves
  edits to two separate files, detects an atomic external replacement on
  activation, discards only the dirty second tab, relaunches, and checks both
  files' exact outcomes. The focused tab suite passed 7/7, including keyboard
  tab navigation and focus return. The full browser run passed 110/113; three existing
  heavy reading tests timed out while 12 workers competed for CPU, and all four
  tests in those spec files passed on a serial rerun. Run those serially when
  interpreting future full-suite failures.
- Vitest passed 408/408; Rust passed 60/60. App and native E2E TypeScript checks,
  `build:web`, release `tauri build --no-bundle`, and the bundle gate passed:
  28/41 KiB static startup and 42/56 KiB known prepaint. The reviewed medium
  and large startup references in `bench/references/` were refreshed for the
  tab bar. Three verified release runs: medium content median 549 ms, large
  556 ms. On the same host, the previous installed I2 release measured 509 ms
  medium and 485 ms large against its own reviewed references. Those small,
  unpaired samples suggest W1 adds roughly 40–71 ms to complete chrome; the
  document first appears before the deferred tab controls. Older README
  startup medians were recorded in a different run and should not be compared
  directly. PSS on large launches varied widely for both versions; avoid
  claiming a reliable memory delta from three runs.
- The release binary is installed at `/home/chong/.local/bin/scrivo`. Both it and
  the release artifact have SHA-256
  `d97035bccb02a37151aa2799558939020f596ae6157d29e908250c3ba7b5e882`.
  An existing window was left running; its next launch uses this build.

### Resume

1. Implement D1: show the heading outline while editing and allow conservative
   YAML property changes through source-span transactions, preserving comments,
   key order, unknown values, and malformed input. Keep source mode available.
2. Implement E3 persistent editor preferences (line numbers, indentation guides,
   and options justified by the parity contract), then run the release criteria
   in `docs/FILE_EDITOR_PARITY.md`. Table sort/move/alignment already shipped.

The W1 adversarial read-only review found recovery ownership, identity races,
Save As conflict, early-link, watcher cleanup, reader path, and cancelled-close
risks. They were addressed before the verification above; the final review found
no remaining high-impact issue in those paths.

## 2026-09-28: I2 local attachments checkpoint

The active objective is still `docs/FILE_EDITOR_PARITY.md`. I2 is implemented:
image/file paste and file drop copy into a sibling `assets/` directory and insert
relative, path-encoded Markdown links. An untitled document goes through Save As
first. A same-name file receives a numbered name; an import failure rolls back
created files and preserves clipboard text. Pasted text accompanying an image is
kept. Native Markdown drops open the document; directories and mixed Markdown
drops report an error. The editor now handles file paste and browser file drop,
while Tauri accepts native paths and reads image-only X11 clipboards through the
official clipboard-manager plugin (pinned at 2.3.3 to match Tauri 2.11).

### Implementation map

- `src/editor/attachments.ts`, `src/editor/setup.ts`, and `src/editor-app.ts`
  capture a CodeMirror insertion location before asynchronous reads or dialogs.
  The location maps through edits and is invalidated on document reset/reload.
  Imports are bound to the controller document generation, so an open/recovery
  operation queued ahead cannot redirect a paste into another file. Clipboard
  files over 64 MiB and native clipboard images over 10 megapixels fail visibly.
- `src/app/file-drops.ts` decides whether a native drop opens one Markdown file
  or imports attachment paths. It checks the active document before and after
  switching from Reading to Editing, since accepting an unmatched recovery copy
  can change the active path. `src/app/register-file-drops.ts` attaches the
  deferred listener. `src-tauri/src/file_drops.rs` queues native drops from
  window creation until the frontend listener is ready, so startup does not
  load the webview drop API before first paint.
- `src/platform/tauri-clipboard.ts` reads and PNG-encodes native clipboard
  images when WebKitGTK's paste event exposes no `File` or MIME types. The
  browser's own paste handler still handles normal file payloads. Errors other
  than an empty/non-image clipboard are reported.
- `src-tauri/src/attachment_io.rs` and `src/domain/attachment.ts` implement
  byte-limited Unicode names, collision handling, relative link syntax,
  streaming path copies, and cleanup on read/sync/stamp failures. Native path
  imports reject FIFOs and other non-regular files before opening. Relative
  link resolution now decodes encoded reserved characters, so image preview
  and file reveal find names containing `&` or `#`.
- `src/boot.ts` reports document paths changed by attachment Save As to the
  existing file watcher. README documents paste/drop behavior and limits.

### Verification

- `bun run typecheck` and the native E2E TypeScript check passed. Unit suites
  passed 401/401. Rust suites passed 59/59, including real copied
  bytes, duplicate Unicode names, partial-copy cleanup, FIFO rejection, and the
  early-drop queue.
- Full Chromium E2E passed 107/107 before the final 64 MiB case; the focused
  attachment suite passed 8/8 afterward. It checks duplicate bytes and links,
  save/reopen, untitled Save As, file drop position, text preservation, watcher
  registration, oversized rejection, and stale insertion cancellation.
- Full native WebKitGTK E2E passed 21/21 spec files. The attachment spec uses
  real X11 text and PNG clipboard data, checks exact saved link and copied PNG
  signature/size, confirms the image displays, then copies the Markdown file
  and `assets/` to a new directory and confirms the image still loads there.
- `tauri build --debug --no-bundle` and the final release
  `tauri build --no-bundle` passed. The startup bundle gate remained at
  41/41 KiB; known prepaint was 55/56 KiB. The release binary was installed
  atomically at `/home/chong/.local/bin/scrivo`; release and installed SHA-256
  are `2fc5ad36afeb0060f9641d606a66add93bfb768e885fdf8edd7c1f7136c7f71a`.
  An already-running window was not restarted, so its next launch picks up
  the new executable.
- A three-run private-compositor startup smoke on the final release matched the
  reviewed screenshots: medium content median 355 ms, large 357 ms. These are
  unpaired runs, so compare them cautiously with the historical 12-run medians
  of 340 ms and 356 ms in README; they show no large launch regression.

### Remaining work and limits

1. Start W1 multi-document sessions and tabs. The present controller and
   workspace own one active document; this is the main architectural change.
   Then implement D1 editing outline/properties and E3 preferences. The
   broader parity goal remains active until those and release criteria pass.
2. Native OS file-drop routing has unit and queue tests, and browser file-drop
   E2E exercises insertion; the native E2E currently exercises native image
   paste rather than driving an OS drag gesture. Same-user hostile replacement
   of `assets/` or a just-copied file between pathname checks is a residual
   filesystem race in `attachment_io.rs`; do not claim atomic protection against
   a concurrent adversarial process. The writer never overwrites an existing
   name during ordinary imports.

## 2026-09-28: natural table editing follow-up and I2 groundwork

The user asked for table editing closer to Obsidian after the I1 checkpoint.
This checkpoint completes that request while the broader
`docs/FILE_EDITOR_PARITY.md` objective remains active. Existing tables already
had direct cell editing, row/column actions, sorting, and alignment. This work
adds spreadsheet-style paste, more continuous keyboard movement, and a safe
failure path for grid paste. The editor opens in Reading view for named files;
press `Ctrl+E` to switch to editing, then click a rendered table cell.

### Table behavior and implementation

- `src/domain/table.ts` parses tab/newline-separated clipboard cells, including
  quoted TSV values and doubled quotes. A quoted field with an embedded tab or
  newline is rejected because a GFM table cell cannot store it faithfully.
  Pasted pipes are escaped. The operation grows columns and body rows, preserves
  other source cells, and returns a complete Markdown table for one undoable
  transaction. It bounds the clipboard at 1 MB/20,000 cells and the resulting
  table at 100,000 cells. Column expansion is one pass over existing rows.
- `src/editor/live-preview/widgets.ts` handles paste from an open cell input or
  a selected rendered cell. Grid paste focuses its last cell. Plain text paste
  into a selected cell writes to Markdown. `Tab` on a selected cell begins
  editing the next cell; arrow keys at input text edges cross cells, and
  `Shift+Enter` moves up except in the header. Invalid grid paste is consumed
  without changing source and shows a toast through the existing prompter.
- `src/editor/live-preview/index.ts` owns the Markdown transaction. The
  `tablePasteNotice` facet carries only the notification callback; pure table
  transforms remain in the domain module. README describes the controls.

### Verification and installed app

- TypeScript app and native E2E checks passed; 389/389 Vitest tests passed when
  files ran sequentially. A parallel run had one timing-sensitive folding test
  miss its pre-existing 20 ms budget; its focused rerun passed. Rust tests
  passed 55/55, including the uncommitted I2 groundwork tests.
- Chromium: 99/99 full E2E tests passed before the final quoted-TSV parser;
  20/20 table E2E tests passed after it. Tests assert visible pasted cells,
  escaped pipes, row/column growth, focus, undo/redo, saved bytes, reopen, and
  rejection without source damage. The native WebKitGTK table spec passed
  2/2 after the table interaction changes using a real X11 TSV clipboard and
  checking saved Markdown. Playwright WebKit could not launch because host
  `libicu74`, `libxml2`, and `libflite1` dependencies are absent; this is an
  environment limitation, not a table test failure.
- `tauri build --no-bundle` and the startup bundle gate passed (41/41 KiB
  startup, 55/56 KiB known prepaint). The release binary was installed
  atomically at `/home/chong/.local/bin/scrivo`. Release and installed SHA-256:
  `26e879a76e5c39034e638b370b96dcf063478efc9d9f873d637365936719940b`.
  An existing window was not restarted; the next launch uses this binary.

### I2 attachment work present in this checkpoint

The tree also contains **unfinished** attachment groundwork begun before the
table request. `src-tauri/src/attachment_io.rs` copies bytes or a real source
file into sibling `assets/` with collision-safe names, symlinked-directory
rejection, sync, and stamp-checked rollback. `src-tauri/src/commands.rs` exposes
byte/path import and rollback commands; `src/platform/{tauri,memory}.ts` and
`src/app/ports.ts` provide the attachment port. `src/domain/attachment.ts`
builds encoded relative Markdown links. `src/app/controller.ts` has a queued
import operation that saves untitled documents first, imports each source,
inserts links, and rolls back on failure. `src/editor/setup.ts` has a mapped
insertion anchor. These compile and the Rust attachment tests pass, but there
is no clipboard/drop UI wiring or I2 browser/native E2E yet. Do not describe
I2 as complete or as installed user-facing functionality.

### Resume

1. Finish I2 by wiring clipboard file paste and browser/native file drops into
   `controller.importAttachments`; keep a single mapped insertion point until
   asynchronous copying completes. Handle Save As cancellation, import error,
   and stale insertion anchors without leaving broken Markdown links. Make
   native path drops explicit for folders and Markdown documents.
2. Strengthen the native writer for byte-length-limited Unicode filenames,
   cleanup on sync failure, and permission/error tests. Add controller unit
   tests and browser/native E2E for actual attachment bytes, collisions,
   encoded links, save/reopen, moved folders, and untitled Save As.
3. Then complete W1 document tabs, D1 editor outline/properties, and remaining
   E3 preferences. Keep the broader parity goal active until all release
   criteria in `docs/FILE_EDITOR_PARITY.md` pass.

## 2026-09-28: rich clipboard paste (I1)

The active objective is still `docs/FILE_EDITOR_PARITY.md`. This checkpoint
completes I1: browser HTML paste becomes portable Markdown in live preview and
source mode, while a plain-text paste stays literal. I2 local attachments, W1
document tabs, D1 editing outline/properties, and the E3 editor preferences
remain. The prior editing/table checkpoint is `ba1fd43`.

### Implementation and behavior

- `src/domain/rich-paste.ts` is a pure HTML-fragment-to-Markdown transform built
  on parse5's inert parser. It supports headings, paragraphs, lists (including
  zero-based numbering), links, emphasis, strikeout, inline/fenced code,
  blockquotes, and GFM tables. Safe unsupported elements contribute visible
  text; active elements such as scripts and iframes are omitted. Links accept
  `http`, `https`, `mailto`, and portable relative targets; unsafe schemes are
  omitted while link labels survive. Entity-like text, math delimiters, and
  thematic/setext-looking lines are escaped so rendering retains their visible
  meaning. HTML input over 5 MB, over 10,000 tag starts, or beyond the nesting
  guard falls back to `text/plain` when available.
- `src/editor/clipboard.ts` handles rich paste within CodeMirror content as one
  `input.paste` transaction. An unconvertible HTML fragment uses normal plain
  paste, and paste into Find/Replace remains in its input. It ignores table
  widget inputs. `src/editor/setup.ts` installs the adapter ahead of the
  Markdown URL-paste extension.
- `parse5` is a direct runtime dependency in `package.json`/`bun.lock`; the
  frozen-lockfile dry run resolves it at 7.3.0. README and the parity/audit
  docs describe the new behavior. This checkpoint does not import images or
  files from the clipboard; I2 owns attachment creation and drop handling.

### Verification

- `bun run test`: 382/382. Converter tests cover malformed/unsafe markup,
  entity and URL round trips, nested table-cell paragraphs, Markdown-like
  prose, MathML/SVG visible text, zero-based lists, and large input fallback.
- `bun run typecheck` and native E2E TypeScript check passed; Rust tests 51/51.
- Chromium 96/96 passed. `e2e/rich-paste.spec.ts` checks saved Markdown,
  reopen/render, plain fallback, one-step undo/redo, and Find/Replace focus.
- Native 20/20 specs passed. `rich-paste.spec.ts` uses a real X11 HTML clipboard
  and checks the bytes saved by WebKitGTK. Both native and release bundle gates
  passed at 40/41 KiB startup JS/CSS and 54/56 KiB known prepaint.
- `tauri build --no-bundle` passed. The release and installed binary at
  `/home/chong/.local/bin/scrivo` both have SHA-256
  `f64101d5088901316f78e2368323870b02476e51c4b0f8e8f52b17a36eeb6d8c`.
  An already-running window was not restarted because it may hold unsaved work;
  the new binary starts on the next launch.

### Resume

Start I2 with `docs/FILE_EDITOR_PARITY.md` and the app/platform ports. Keep
attachment copying separate from Markdown insertion until both can succeed
or a failed copy can be cleaned up. Test duplicate filenames, Unicode names,
relative links after moving the containing folder, untitled Save As, rejected
directory drops, errors, and actual native attachment bytes. Then tackle W1,
D1, and E3. Do not mark the parity objective complete before every listed
release criterion is verified.

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
