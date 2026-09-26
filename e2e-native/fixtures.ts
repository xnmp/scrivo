// Fixture builders for the native (tauri-driver) E2E suite. Each fixture creates
// its own fresh temp directory under $HOME (not tmpfs /tmp — Scrivo's atomic write
// renames within the document's directory, and some environments mount /tmp as a
// separate, size-limited filesystem) and returns the document path to launch the
// app with. Fixtures must finish writing before the app is launched (the app reads
// the file at startup), so this runs inside wdio's `beforeSession` hook, not inside
// a spec's `before()`.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Fixture {
  dir: string;
  docPath: string;
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

export function headingFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'doc.md');
  writeFileSync(docPath, '# Hello World\n\nSome body text.\n');
  return { dir, docPath };
}

export function saveBytesFixture(): SaveBytesFixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'doc.md');
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const body = Buffer.from('Line one\r\nLine two\r\n', 'utf8');
  const original = Buffer.concat([bom, body]);
  writeFileSync(docPath, original);
  return { dir, docPath, original };
}

export function missingFileFixture(): Fixture {
  const dir = freshDir();
  // Deliberately not created: the app should start with an empty document and
  // create this file on first save.
  const docPath = path.join(dir, 'new.md');
  return { dir, docPath };
}

// 0xFF/0xFE are never valid anywhere in UTF-8.
export const INVALID_UTF8_BYTES = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0xff, 0xfe, 0x00]);

export function invalidUtf8Fixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'bad.md');
  writeFileSync(docPath, INVALID_UTF8_BYTES);
  return { dir, docPath };
}

export function imageFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'doc.md');
  writeFileSync(docPath, '# Pic\n\n![alt](pic.png)\n');
  writeFileSync(path.join(dir, 'pic.png'), ONE_PIXEL_PNG);
  return { dir, docPath };
}

export function checkboxFixture(): Fixture {
  const dir = freshDir();
  const docPath = path.join(dir, 'doc.md');
  writeFileSync(docPath, '# Tasks\n\n- [ ] Buy milk\n');
  return { dir, docPath };
}

export const fixtureBySpec: Record<string, () => Fixture> = {
  'heading.spec.ts': headingFixture,
  'save-bytes.spec.ts': saveBytesFixture,
  'missing-file.spec.ts': missingFileFixture,
  'invalid-utf8.spec.ts': invalidUtf8Fixture,
  'image.spec.ts': imageFixture,
  'checkbox.spec.ts': checkboxFixture,
};
