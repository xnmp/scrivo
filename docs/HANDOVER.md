# Handover (2026-09-26, evening)

State: view-first Scrivo is committed. tsc clean; vitest 270 passing; Playwright (chromium) 49 passing; cargo tests passing.

## Done this session
- View-first reading view (Rust renderer), with the editor lazy-loaded.
- Startup work (all measured with `bench/ab.mjs`, recorded in ARCHITECTURE.md "Performance decisions"):
  - `prewarm.rs`: −48 ms.
  - Uncompressed math font: −26 ms.
  - Prerendering into `index.html` was rejected (+58 ms). The experiment patch is in the session scratchpad.
- Find in the reading view (Ctrl/⌘+F, Enter/Shift+Enter, F3, Esc) uses the CSS Custom Highlight API. The code is in `src/domain/find.ts`, `src/viewer/find.ts` and `src/ui/find-bar.ts`, with tests in `e2e/viewer-find.spec.ts`.

## In flight when the session ended (check first)
1. **Native E2E update** (`e2e-native/`: view-first specs, free ports, safe xvfb script). A subagent was working on it and the work is uncommitted in the tree.
   - Review the diff.
   - Run it only via the package.json script, which must unset `WAYLAND_DISPLAY`/`HYPRLAND_INSTANCE_SIGNATURE` and force `GDK_BACKEND=x11` under xvfb-run.
2. **Adversarial review** (renderer XSS, link policy, workspace data safety, prewarm FFI) was running in a subagent. Its report may be lost; re-run it unbiased if so.

## Next
- Final benchmark vs Typora on a quiet machine: `node bench/ab.mjs bench/fixtures/medium.md 12 typora src-tauri/target/release/scrivo`, then the same for large.md. Then write a README with the results.
- Viewer features: code highlighting in the reading view (lezer, idle time), an outline sidebar (headings are already returned), a file watcher.
- The editor uses KaTeX while the viewer uses MathML (math-core). Consider unifying them.
