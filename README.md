# Scrivo

Scrivo is a fast markdown reader and editor for desktop. Existing files open in a
reading view rendered by Rust; press `Ctrl+E` (`⌘E` on macOS) to edit in a single-pane
live preview. The file on disk stays markdown, with its original UTF-8 BOM and dominant
line ending style preserved when saved.

## Use

```sh
scrivo notes.md          # open in the reading view
scrivo --edit notes.md   # open directly in the editor
scrivo                  # start a new document
```

In the reading view, `Ctrl+F` finds text, `Enter` and `Shift+Enter` move between
matches, and `Esc` closes find. Documents with headings have a Contents sidebar;
fenced code is highlighted after the document appears. `Ctrl+O` opens a file;
`Ctrl+T` (or `Ctrl+N`) starts a new tab. `Ctrl+R` opens recent files; the picker can clear its history. Each file opens in its own tab. `Ctrl+Tab` and
`Ctrl+Shift+Tab` switch tabs, and `Ctrl+W` closes the active tab; closing a dirty
tab asks what to do with that document. Closing the final tab closes the app. Opening the same file through a symlink
selects its existing tab. Changes made by another program are detected while
the window stays open; a dirty editor asks before replacing its text.
The editor supports fenced code, tables, task lists, math, images, and YAML front
matter. In a rendered table, click a cell to place the text caret; `Tab`/`Shift+Tab`
move between cells, `Enter` moves down, and arrow keys cross cells at the text edges.
Moving past the last row adds one. Pasting spreadsheet cells fills the table and
adds rows or columns as needed. Right-click a cell (or press `Shift+F10`) to
add, delete, or move rows and columns, sort a column, or change its alignment.
Hover a table to reveal + strips below and to its right for new rows and columns.
Table edits remain Markdown and can be undone. Local image paths resolve relative
to the document.
Enter continues a list, or ends an empty item; Tab and Shift+Tab adjust its
indentation. Brackets, quotes, and backticks pair as you type and a typed closer
skips an automatically inserted one. Headings and nested lists have fold buttons
in the editor gutter; `Ctrl+Alt+[` and `Ctrl+Alt+]` (or `⌘+Option` on macOS)
fold and unfold at the caret. Folding never changes the Markdown file.
Contents also works while editing, follows heading changes, and opens folded
sections when navigating. Properties edits simple YAML text, numbers, and
checkboxes directly in Markdown; comments, key order, and other values remain
intact. Complex or malformed YAML stays available through Edit YAML in source.
Valid property edits participate in autosave, recovery, and undo.
Ctrl/⌘+, opens Settings with Appearance, Editor, Hotkeys and Substitutions.
Editor settings offer line numbers, indentation guides, spellcheck, line wrapping,
and tab display width. These preferences apply to all tabs and persist across
launches without changing Markdown or undo history.
Pasting formatted text from a browser converts headings, lists, links, emphasis,
code, and tables into Markdown. Plain-text paste keeps its original text.
Pasting an image or file, or dropping a file onto the editor, copies it into an
`assets/` folder beside the Markdown file and inserts a relative link. A dropped
Markdown file opens as a document. If the document has no saved path, Scrivo asks
where to save it before importing. Existing asset names are never overwritten;
the copy receives a numbered name instead. Clipboard files are limited to 64 MiB,
and native clipboard images to 10 megapixels.

Named files save automatically after 2 seconds without typing; `Ctrl+S` saves
immediately. Untitled documents and Save As use an in-app modal with filename and
absolute folder fields; Escape cancels and invalid folders retain your input.
Existing files save directly. The editor shows Edited, Saving, Saved, or Action needed. A failed
save can be retried from the status bar. If another program changes the file,
autosave pauses and the editor offers reload, Save As, or a confirmed overwrite
when saving manually. Unsaved and untitled text receives a private recovery copy
in app data; on the next launch, choose Restore or Discard. Recovery writes are
asynchronous, so the very latest keystrokes may not survive a process kill before
their copy has finished writing.

## Build and test

Install [Bun](https://bun.sh/), Rust, and the [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your platform. On Linux, the native test suite also needs `tauri-driver`, `WebKitWebDriver`, `xvfb-run`, `dbus-run-session`, `openbox`, Python 3, and `libXtst` for physical pointer verification on the private test display.

```sh
bun install
bun run dev                 # browser development server, in-memory files
bun run build               # release desktop bundle
bun run typecheck
bun run test                # domain and app unit tests
bun run test:e2e            # Chromium browser E2E
cd src-tauri && cargo test  # Rust renderer and file I/O
```

`bun run test:e2e:native` builds the debug app and runs native E2E on an isolated X
display. `bun run test:e2e:all` also runs Playwright WebKit when its host dependencies
are installed. See [architecture](docs/ARCHITECTURE.md) and [conventions](docs/CONVENTIONS.md)
for the code layout, safety model, and performance decisions.

## Commands and hotkeys

Open the command palette with **Ctrl/⌘+P**. Search command names or abbreviations,
use arrow keys to select, and Enter to run. Right-click the tab strip to open it
with the mouse. **Customize hotkeys** in Settings or the
palette lets you remove bindings, record up to four shortcuts per command, and
restore defaults. Conflicting bindings show the existing command; remove that
binding before reassigning it. Preferences persist across launches.

**Ctrl/⌘+T** creates a tab; **Ctrl/⌘+R** opens recents; table insertion is now
**Ctrl/⌘+Shift+T**. Standard select/copy/cut/paste shortcuts stay available, and
form fields retain native text undo. **Ctrl/⌘+D** selects the current word, then
adds its next occurrence on each press; typing edits all selections together.
The palette shows the current bindings. Escape dismisses menus and panels.
Contents, Properties and reading/editing are available through the palette.

Linux and Windows use an integrated tab/title row with window controls and a
blank area for dragging; double-click the blank area to maximize or restore.
macOS retains its native title bar. Active tabs use a subtle rounded outline;
inactive close controls appear on hover or keyboard focus. Resizing keeps the
selected tab visible.

## Appearance

Open **Settings → Appearance** (Ctrl/⌘+,) to choose system/light/dark mode,
an accent, text and monospace fonts, and font size. Settings apply to reading and
editing and persist across launches. Import self-contained Obsidian `theme.css`
files to use their compatible CSS variables, including per-level heading colors.
Charcoal, Arctic, Ember and Paper are included, each with light and dark palettes.
You can also retain and switch between imported themes. Reset with Ctrl/⌘+Shift+, if a
custom theme hides the controls.

Obsidian-specific layouts, plugins, theme marketplaces, and local companion assets
are not included. Imports are limited to 1 MiB per CSS file.

## Substitutions

Settings → Substitutions replaces matching suffixes as you type. Enable or disable
rules, search, add, remove, swap source and replacement, or restore defaults.
Immediate Backspace restores a replacement. Existing text and pasted text remain
unchanged. Common arrow, inequality and fraction substitutions are included.

Regex rules use `/pattern$/` with optional `i` or `s`; replacements support `$1`,
`$2`, `$&`, and `\n`, `\t`, `\b`, `\\` escapes. Matching uses RE2 syntax,
without lookaround or backreferences. Multiline/control-character replacements
apply in the editor; rendered single-line table cells keep those triggers literal.

## Startup performance

Settings forms and substitution regex code load when first needed. An alternating
comparison of the current release against the same app before this change found
15 ms lower paired-median content time in all eight medium-document rounds on
this Linux machine. See [raw results](bench/results/paired-lazy-settings-medium.txt)
and [handover](docs/HANDOVER.md) for the measurement boundary and build hashes.


The comparison uses the same 1280×720 private headless compositor for both apps.
`bench/ab.mjs` rotates which app launches first on each paired round. “Content” is
the first screenshot matching a [visually reviewed, fixture-specific screen](bench/references/)
within 0.3% of image tiles; stable loading or error screens, a missing window, and a 20-second
time-cap result fail the run. “Complete” means the first frame after which that
viewport stays stable, not that the whole file has rendered. At least 80% of paired
rounds must be valid. Times start at process launch and include the window system
and webview; results are machine-specific. A native E2E test separately checks that
the large document's tail renders and can be scrolled into view.

Measured on Linux on 2026-09-27 using release commit `129cd13`, Typora 1.14.9-1, and
12 valid paired rounds per fixture (milliseconds; lower is better):

| Document | App | Valid launches | Window median | Content median | Viewport stable median |
|---|---|---:|---:|---:|---:|
| Medium (8.8 KB) | Typora | 12 | 411 | 965 | 965 |
| Medium (8.8 KB) | Scrivo | 12 | 211 | 340 | 340 |
| Large (443 KB) | Typora | 12 | 433 | 2,016 | 2,016 |
| Large (443 KB) | Scrivo | 12 | 211 | 356 | 356 |

Scrivo reached the verified first viewport sooner in all 12 pairs for both
fixtures. The paired median advantage was 626 ms for medium and 1,682 ms for large.
The comparison is based on within-round pairs because absolute times vary with host
load. The [medium](bench/results/verified-medium-chunked.txt) and
[large](bench/results/verified-large-chunked.txt) round logs are included for
inspection. [Previous release comparisons](bench/results/verified-large.txt) and
earlier runs with weaker readiness checks are retained as history; their absolute
medians should not be mixed with this run.

The renderer supplies safe top-level block boundaries so the reading view parses
only its first HTML chunk before paint, then parses and inserts the rest in idle
slices. In 12 paired old/new release runs on the large fixture, this cut first
viewport time by 20 ms (paired median), with the new build faster in 10/12 pairs.
The [raw build comparison](bench/results/paired-chunked-html-large.txt) is retained.

The editor startup path has its own reviewed first-viewport reference. In 12
headless launches of `scrivo --edit medium.md`, the median window time was 212 ms
and the median visible editor time was 388 ms; all 12 runs passed the reference
check. The [raw editor log](bench/results/verified-medium-edit-chunked.txt) is a standalone
Scrivo measurement, not a paired Typora comparison. Reproduce it with
`node bench/bench.mjs scrivo bench/fixtures/medium.md 12 --edit`.

The current web build gate counts 36 KiB of linked static startup JS/CSS against a 41 KiB
budget. Tauri's window API loads during boot; including it gives 50 KiB of known
prepaint JS/CSS against a 56 KiB budget. The tab shell remains deferred. The gate also validates and reports a
1,060 KiB math font referenced by the reading-view stylesheet and a 3,114 KiB
declared deferred graph, which includes the window API, KaTeX CSS/fonts, and
features loaded later.

The integrated chrome release was checked on 2026-10-03 against freshly reviewed
reader and editor screenshots. Three verified launches per reader fixture reached
the complete visible interface at medians of 411 ms (medium) and 422 ms (large).
These are small regression smoke samples, with isolated application data, rather
than a new paired speed comparison. [Release logs and conditions](docs/HANDOVER.md)
include the editing path and installed binary checksum.

Large startup documents receive the first complete renderer chunk before the
cached full document. The reading view inserts that preview for the first viewport,
then loads the rest while preserving Find and anchor behavior. A tail-load failure
leaves a persistent warning with Retry. In reviewed 12-pair release launches, the
complete path reached the first viewport 38 ms sooner on a synthetic 5 MB document
(11/12 faster) and 9 ms sooner on large.md (8/12). Medium.md took 6–7 ms longer
across two 12-pair runs, mostly alongside window timing; its post-window difference
was about 1–1.5 ms. [Raw rounds and verification](docs/HANDOVER.md) are retained.

The current release inserts up to two rendered HTML chunks per idle slice after
the initial screen is inserted. Against commit `8fea444`, a 12-pair large-file run
reached full document insertion 419 ms sooner by paired median (faster in all
12 rounds). Separate 12-pair startup runs found −3 ms on medium and +5 ms on
large; these small differences do not establish a first-viewport speed change.
[Raw rounds and conditions](docs/HANDOVER.md) are retained.

Returning from editing a large document now prepares a measurable reading viewport
while the editor remains visible. It shows the first screen before inserting the
rest of the document. Browser and native integration tests verify the complete
result; the latest paired startup checks found no consistent first-viewport change.

Run the comparison locally with:

```sh
node bench/ab.mjs bench/fixtures/medium.md 12 typora src-tauri/target/release/scrivo
node bench/ab.mjs bench/fixtures/large.md 12 typora src-tauri/target/release/scrivo
```

Scrivo is dual-licensed under MIT or Apache-2.0.


## Desktop themes

Native launches optionally read `desktop-theme.json` from Tauri's app config directory
(`$XDG_CONFIG_HOME/dev.scrivo.editor`, default `~/.config/dev.scrivo.editor` on Linux).
The catalog has `{ "theme": "builtin:desktop:nord", "mode": "dark", "themes": [...] }`;
each theme contains `id`, `name`, and self-contained `css` using Obsidian variables.
The desktop selection applies before first paint and clears the accent override while
preserving fonts, font size, and imported themes. Catalog themes appear in Appearance
alongside the bundled palettes. In-app changes work until the next native launch,
when the desktop selection applies again. Missing or invalid catalogs leave the app's
saved appearance intact. Web builds continue to use browser preferences.

The chezmoi `scripts/set-theme.sh` command refreshes stylesheets from matching Obsidian
themes (preserving their CSS variable cascade and document colors), and creates
missing stylesheets from desktop palettes when no equivalent exists. It writes files
to the config directory's `themes/` folder and atomically publishes the catalog. Relaunch Scrivo after switching themes.
