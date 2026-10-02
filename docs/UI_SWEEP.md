# UI sweep — 2026-10-03

Full review of the desktop file editor using the supplied Scrivo and Obsidian screenshots.
Vanilla TypeScript DOM components, CodeMirror, Tauri/WebKitGTK, and the existing CSS
variable system. No new UI framework or motion dependency was introduced.

## Coverage

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Reader/live preview, source, Settings, Properties, Appearance, palette, hotkeys, recents and menus; light/dark and 320px captures | Shared body metrics; 13px chrome and smaller secondary labels; bounded path wrapping |
| Surfaces | Native integrated header, tabs, document toolbar, sidebar, panels, modal prompts, search and table menu | Shared tokens, structural borders, restrained elevation, bounded dialogs |
| Animations | Tab switching, search, palette and settings states | Immediate frequent interactions; no new entry or press animation |
| Icons | Header, tabs, document toolbar, window controls and menu groups | One currentColor SVG set at 1.5px; accessible names, focus/hover/expanded states |
| Performance | Production bundle gate, deferred imports, native startup capture | Bundled palettes and controls deferred; startup figures recorded in HANDOVER |

## Findings resolved

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `src-tauri/src/lib.rs`, `src/ui/window-chrome.ts` | Native title bar above a separate tab strip | Integrated tab/title row on Linux/Windows with minimize, maximize/restore, close and drag region | Matches reference hierarchy and reduces duplicated chrome |
| MEDIUM | `src/styles/base.css`, `src/ui/tabs.ts`, `src/styles/chrome.css` | Tab strip scrolled all chrome; narrow tab close target could clip | Only tab list scrolls; active item revealed; narrower labels and 40px close target at narrow widths | Window controls stay reachable at native minimum width |
| HIGH | `src/ui/window-chrome.ts`, `src/styles/chrome.css` | Empty drag region had no height; pointer-down detail was zero | Full-height drag region, mouse-down handler | Custom chrome must provide a working drag target |
| MEDIUM | `src/ui/icons.ts`, `src/ui/outline.ts`, `src/ui/properties.ts`, `src/ui/editor-settings.ts`, `src/ui/appearance-settings.ts` | Mixed text toggles, Unicode symbols and floating buttons | Shared outlined SVG controls aligned in two compact rows | Consistent optical weight and predictable control positions |
| MEDIUM | `src/styles/outline.css` | Floating Contents card | Flush full-height sidebar, with overlay behavior on small windows | Matches document/navigation hierarchy in the reference |
| LOW | `src/styles/viewer.css`, `src/editor/theme.ts`, `src/styles/chrome.css` | Excess top padding, disparate panel radii and search/table-menu surfaces | Matched 32px content padding; shared surface/spacing/focus rules | Consistent reader/editor density and secondary surfaces |
| MEDIUM | `src/ui/builtin-themes.ts`, `src/platform/appearance.ts` | Only Default was selectable without importing CSS | Charcoal, Arctic, Ember and Paper, each light/dark, plus imports | Provides immediately useful choices; selected CSS persists before document layout |
| LOW | `src/ui/appearance-settings.ts`, `src/styles/chrome.css` | Long import caveats occupied the main form; accent preview always blue | Collapsible import help and current theme accent preview | Reduces visual noise and makes the color control accurate for built-in palettes |
| MEDIUM | `src/ui/app-menu.ts` | No coherent application menu | File/Edit/Format/View/Settings groups, keyboard navigation and current shortcut hints | Familiar hierarchy without a screen-height list of unrelated commands |
| HIGH | `src/ui/command-picker.ts` | Closing palette restored focus after the chosen command, preventing subsequent typing | Restore focus first, then execute the chosen action from the dialog close event | Formatting and Find remain immediately usable |
| MEDIUM | `src/ui/hotkey-settings.ts`, `src/domain/commands.ts`, `src/editor/setup.ts`, `src/ui/properties.ts` | Scattered fixed shortcuts and stale CodeMirror/panel fallbacks | Shared command definitions, configurable bindings, conflict feedback and disabled legacy fallbacks | Removing a shortcut cannot silently trigger a different editor action |
| LOW | `src/styles/base.css`, `src/ui/builtin-themes.ts` | White primary-button text on every accent | Theme-provided text-on-accent variable | Bundled bright dark-theme accents retain readable primary actions |

## Considered but rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Header | Add vault/file-tree controls copied from Obsidian | Scrivo edits individual files; nonfunctional navigation would misrepresent its capabilities |
| Palette, tabs and hotkeys | Add staged entry/press animations | Frequent keyboard-driven actions need immediate feedback and predictable focus |
| Themes | Fetch community themes at startup | Network/library work would increase launch cost; original bundled palettes and local imports satisfy selection without it |
| Main menu | Show every command in one menu | The first visual capture required excessive vertical scrolling; grouped menus expose a clearer hierarchy |

## Verification

- Production headless Chromium captures: dark reader/editor/Appearance/palette,
  Settings/Properties/Contents; light hotkeys/menu/recents; Appearance at 320×700.
- Private native WebKitGTK screenshot confirms the integrated controls; no host
  desktop automation. Physical dragging, native close veto, maximize/restore, minimize, real save,
  theme and shortcut persistence are exercised by `e2e-native/specs/commands.spec.ts`.
- Full browser regression and focused post-review checks are recorded in HANDOVER.
  Feature tests assert Markdown/file bytes, undo, selected recents, and focus,
  rather than only presence of controls.
- No new animations: slowed animation inspection is not applicable.
- Platform boundary: Windows and macOS were not run. macOS retains native decorations.
  Imported CSS can intentionally override styling; arbitrary community layouts are
  outside the compatibility contract.

Final native drag result and release measurements are recorded in HANDOVER.

## Verdict

Approved for the verified Linux release. All findings above are resolved, and
the release is installed. Reviewed native reader/editor startup references pass
all nine smoke launches. Windows and macOS remain unverified platform boundaries.
