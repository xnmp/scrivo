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
`bench/ab.mjs` rotates which app launches first on each paired round. “Content”
is the first screenshot within 3% of the final document image; “complete” is the first
frame after which the image stays stable. Times start at process launch. These numbers
are machine-specific and include the window system and webview startup.
These results are provisional: the sampler uses a stable final screenshot as its
reference, but does not yet verify that the document rendered in every run or reject
runs that reach its time cap. See [handover](docs/HANDOVER.md) for the validation work.

Measured on Linux on 2026-09-27, using the release binary and 12 attempted rounds
per fixture (milliseconds; lower is better). Two Typora launches failed to show a
window on the medium fixture, leaving 10 valid pairs there:

| Document | App | Valid launches | Window median | Content median | Complete median |
|---|---|---:|---:|---:|---:|
| Medium (8.8 KB) | Typora | 10 | 822 | 1,857 | 1,857 |
| Medium (8.8 KB) | Scrivo | 12 | 498 | 749 | 771 |
| Large (443 KB) | Typora | 12 | 922 | 1,294 | 1,558 |
| Large (443 KB) | Scrivo | 12 | 559 | 933 | 953 |

Scrivo reached content sooner in all 10 valid medium pairs and all 12 large pairs.
The paired median advantage was 1,162 ms for medium and 379 ms for large.
Individual launches varied with system load; the
[medium](bench/results/final-medium.txt) and
[large](bench/results/final-large.txt) round logs are included for inspection.

Run the comparison locally with:

```sh
node bench/ab.mjs bench/fixtures/medium.md 12 typora src-tauri/target/release/scrivo
node bench/ab.mjs bench/fixtures/large.md 12 typora src-tauri/target/release/scrivo
```

Scrivo is dual-licensed under MIT or Apache-2.0.
