// Fixture builders for the native (tauri-driver) E2E suite. Each fixture creates
// its own fresh temp directory under $HOME (not tmpfs /tmp — Scrivo's atomic write
// renames within the document's directory, and some environments mount /tmp as a
// separate, size-limited filesystem) and returns the document path to launch the
// app with. Fixtures must finish writing before the app is launched (the app reads
// the file at startup), so this runs inside wdio's `beforeSession` hook, not inside
// a spec's `before()`.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Fixture {
  dir: string;
  docPath: string;
  /** Extra CLI args passed before the doc path (e.g. `--edit`). */
  launchArgs?: readonly string[];
  /** Launch without a path to exercise untitled crash recovery. */
  launchWithoutFile?: boolean;
}

export interface SaveBytesFixture extends Fixture {
  original: Buffer;
}

const runsRoot = path.join(os.homedir(), '.scrivo-e2e-native');

function freshDir(): string {
  mkdirSync(runsRoot, { recursive: true });
  return mkdtempSync(path.join(runsRoot, 'run-'));
}

// Smallest possible valid PNG: a 1x1 transparent pixel.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

// A file that exists is opened in the reading view by default (view-first); these
// fixtures exercise the editor (live preview, typing, saving), so they launch with
// `--edit` to land there directly instead of routing every spec through a manual
// Ctrl+E toggle first.
const EDIT = ['--edit'] as const;

export function headingFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'doc.md');
  writeFileSync(docPath, '# Hello World\n\nSome body text.\n');
  return { dir, docPath, launchArgs: EDIT };
}

export function saveBytesFixture(): SaveBytesFixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'doc.md');
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const body = Buffer.from('Line one\r\nLine two\r\n', 'utf8');
  const original = Buffer.concat([bom, body]);
  writeFileSync(docPath, original);
  return { dir, docPath, original, launchArgs: EDIT };
}

export function missingFileFixture(): Fixture {
  const dir = freshDir();
  // Deliberately not created: the app should start with an empty document and
  // create this file on first save. (A missing path already starts in the editor;
  // `--edit` is added anyway so this spec doesn't depend on that incidental behaviour.)
  const docPath = path.join(dir, 'new.md');
  return { dir, docPath, launchArgs: EDIT };
}

// 0xFF/0xFE are never valid anywhere in UTF-8.
export const INVALID_UTF8_BYTES = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0xff, 0xfe, 0x00]);

export function invalidUtf8Fixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'bad.md');
  writeFileSync(docPath, INVALID_UTF8_BYTES);
  // An unreadable file already starts in the editor (see startup.rs); `--edit` is
  // added anyway so this spec doesn't depend on that incidental behaviour.
  return { dir, docPath, launchArgs: EDIT };
}

export function imageFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'doc.md');
  writeFileSync(docPath, '# Pic\n\n![alt](pic.png)\n');
  writeFileSync(path.join(dir, 'pic.png'), ONE_PIXEL_PNG);
  return { dir, docPath, launchArgs: EDIT };
}

export function checkboxFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'doc.md');
  writeFileSync(docPath, '# Tasks\n\n- [ ] Buy milk\n');
  return { dir, docPath, launchArgs: EDIT };
}

export function tableFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'doc.md');
  writeFileSync(docPath, '| Name | Score |\n| --- | ---: |\n| Ann | 10 |\n\nAfter the table.\n');
  return { dir, docPath, launchArgs: EDIT };
}

export function listEditingFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'doc.md');
  writeFileSync(docPath, '- first\n- ');
  return { dir, docPath, launchArgs: EDIT };
}

export function foldEditingFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'doc.md');
  writeFileSync(docPath, '# First\nbody\n## Child\ninside\n# Next\nend\n');
  return { dir, docPath, launchArgs: EDIT };
}

export function recoveryFixture(): Fixture {
  const dir = freshDir();
  return { dir, docPath: path.join(dir, 'unused.md'), launchWithoutFile: true };
}

export function autosaveConflictFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'doc.md');
  writeFileSync(docPath, 'Start\n');
  return { dir, docPath, launchArgs: EDIT };
}

export function recoveryNamedFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'deleted.md');
  const recoveryDir = path.join(dir, 'data', 'dev.scrivo.editor', 'recovery');
  mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(recoveryDir, 'named-copy.json'), JSON.stringify({
    id: 'named-copy', path: docPath, stamp: 'deleted-stamp',
    format: { eol: '\n', bom: false, mixedEol: false }, text: '# Recovered missing file\n', updatedAt: Date.now(),
  }), { mode: 0o600 });
  return { dir, docPath, launchWithoutFile: true };
}

export function recoveryOtherFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'viewed.md');
  writeFileSync(docPath, '# Original reading view\n');
  const recoveryDir = path.join(dir, 'data', 'dev.scrivo.editor', 'recovery');
  mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(recoveryDir, 'other-copy.json'), JSON.stringify({
    id: 'other-copy', path: path.join(dir, 'deleted.md'), stamp: 'deleted-stamp',
    format: { eol: '\n', bom: false, mixedEol: false }, text: '# Recovered other file\n', updatedAt: Date.now(),
  }), { mode: 0o600 });
  return { dir, docPath };
}

// --- Reading-view fixtures (view-first: launched with no extra args). ---

export function readingHeadingFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'doc.md');
  writeFileSync(docPath, '# Hello World\n\nSome body text.\n');
  return { dir, docPath };
}

export function readingImageFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'doc.md');
  // `pic.png` is a real sibling file (loads through the asset protocol). The empty
  // `![missing]()` reference can never resolve to a URL (see render/src/url.rs
  // `ImageSource::Unavailable`), so the renderer emits `.image-missing` for it
  // regardless of whether anything on disk is actually missing.
  writeFileSync(docPath, '# Pics\n\n![alt](pic.png)\n\n![missing]()\n');
  writeFileSync(path.join(dir, 'pic.png'), ONE_PIXEL_PNG);
  return { dir, docPath };
}

export function readingToggleFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'doc.md');
  writeFileSync(docPath, '# Hello World\n\nSome body text.\n');
  return { dir, docPath };
}

export function readingWatchFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'doc.md');
  writeFileSync(docPath, '# Before\n\nOriginal text.\n');
  return { dir, docPath };
}

export function readingLargeFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'large.md');
  writeFileSync(docPath, readFileSync(new URL('../bench/fixtures/large.md', import.meta.url)));
  return { dir, docPath };
}

export function readingGiantCodeFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'giant.md');
  const line = `${'0123456789'.repeat(10)}\n`;
  const code = line.repeat(25_000) + 'unique-middle-code-marker\n'
    + `\t${'W'.repeat(1000)}far-right-marker\n`
    + `\t${'漢'.repeat(350)}\t${'漢'.repeat(350)}unicode-right-marker\n` + line.repeat(25_000);
  const boundaryCode = `${'漢'.repeat(19)}\tZ\n` + '0123456789abcdefghij\n'.repeat(50_000);
  // An astral character before the first renderer chunk exercises UTF-16
  // offsets through the Rust response and native WebKit insertion path.
  writeFileSync(docPath, Array.from({ length: 40 }, (_, i) => `Paragraph ${i}${i === 0 ? ' 😀' : ''}\n\n`).join('')
    + `\n\`\`\`\n${code}\`\`\`\n\n\`\`\`\n${boundaryCode}\`\`\`\n\n# Tail\n`);
  return { dir, docPath };
}

export const fixtureBySpec: Record<string, () => Fixture> = {
  'heading.spec.ts': headingFixture,
  'save-bytes.spec.ts': saveBytesFixture,
  'missing-file.spec.ts': missingFileFixture,
  'invalid-utf8.spec.ts': invalidUtf8Fixture,
  'image.spec.ts': imageFixture,
  'checkbox.spec.ts': checkboxFixture,
  'table.spec.ts': tableFixture,
  'list-editing.spec.ts': listEditingFixture,
  'fold-editing.spec.ts': foldEditingFixture,
  'recovery.spec.ts': recoveryFixture,
  'autosave-conflict.spec.ts': autosaveConflictFixture,
  'recovery-named.spec.ts': recoveryNamedFixture,
  'recovery-other.spec.ts': recoveryOtherFixture,
  'reading-heading.spec.ts': readingHeadingFixture,
  'reading-image.spec.ts': readingImageFixture,
  'reading-toggle.spec.ts': readingToggleFixture,
  'reading-watch.spec.ts': readingWatchFixture,
  'reading-large.spec.ts': readingLargeFixture,
  'reading-giant-code.spec.ts': readingGiantCodeFixture,
};
