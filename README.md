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
`Ctrl+N` starts a new document. Changes made by another program are detected while
the window stays open; a dirty editor asks before replacing its text.
The editor supports fenced code, tables, task lists, math, images, and YAML front
matter. Local image paths resolve relative to the document.

## Build and test

Install [Bun](https://bun.sh/), Rust, and the [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your platform. On Linux, the native test suite also needs `tauri-driver`, `WebKitWebDriver`, `xvfb-run`, `dbus-run-session`, and `openbox`.

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

## Startup performance

The comparison uses the same 1280×720 private headless compositor for both apps.
`bench/ab.mjs` rotates which app launches first on each paired round. “Content” is
the first screenshot matching a [visually reviewed, fixture-specific screen](bench/references/)
within 0.3% of image tiles; stable loading or error screens, a missing window, and a 20-second
time-cap result fail the run. “Complete” means the first frame after which that
viewport stays stable, not that the whole file has rendered. At least 80% of paired
rounds must be valid. Times start at process launch and include the window system
and webview; results are machine-specific. A native E2E test separately checks that
the large document's tail renders and can be scrolled into view.

Measured on Linux on 2026-09-27 using the release binary and 12 valid paired
rounds per fixture (milliseconds; lower is better):

| Document | App | Valid launches | Window median | Content median | Viewport stable median |
|---|---|---:|---:|---:|---:|
| Medium (8.8 KB) | Typora | 12 | 449 | 1,010 | 1,010 |
| Medium (8.8 KB) | Scrivo | 12 | 218 | 363 | 363 |
| Large (443 KB) | Typora | 12 | 819 | 4,107 | 4,107 |
| Large (443 KB) | Scrivo | 12 | 495 | 858 | 858 |

Scrivo reached the verified first viewport sooner in 11/12 medium pairs and all
12 large pairs. The paired median advantage was 651 ms for medium and 3,239 ms
for large. One medium Scrivo launch took 1.7 s to show a window. Host load changed
sharply during the large run, so its absolute medians are especially sensitive to
that run's conditions; the comparison is based on within-round pairs. The
[medium](bench/results/verified-medium.txt) and
[large](bench/results/verified-large.txt) round logs are included for inspection.
Earlier runs with different fixture labels and less stringent readiness checks are
retained as [medium](bench/results/pre-readiness-medium.txt) and
[large](bench/results/pre-readiness-large.txt) historical logs; they are not directly
comparable with these results.

The web build gate counts 34 KiB of linked startup JS/CSS and static imports against
a 40 KiB budget. It separately reports a 1,060 KiB math font that loads when math is
used in the reading view.

Run the comparison locally with:

```sh
node bench/ab.mjs bench/fixtures/medium.md 12 typora src-tauri/target/release/scrivo
node bench/ab.mjs bench/fixtures/large.md 12 typora src-tauri/target/release/scrivo
```

Scrivo is dual-licensed under MIT or Apache-2.0.
