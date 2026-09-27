// Screenshot comparison shared by the sampler and reviewed fixture references.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BLOCK = 16;
export const SAME = 0.003;
// Eleven 16×16 tiles at 1280×720. Missing visible document text, the fixture
// label, or a different fixture moves more tiles; caret blink moves fewer.
export const READY = 0.003;

/** Mean luminance per 16×16 tile of a binary PPM (grim's P6 output). */
export function signature(ppm) {
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.toString('latin1', 0, 64));
  if (!header) throw new Error('invalid P6 screenshot');
  const [width, height] = header.slice(1).map(Number);
  const offset = Buffer.byteLength(header[0], 'latin1');
  if (ppm.length !== offset + width * height * 3) throw new Error('invalid P6 screenshot size');
  const columns = Math.ceil(width / BLOCK);
  const rows = Math.ceil(height / BLOCK);
  const sum = new Float64Array(columns * rows);
  const count = new Uint32Array(columns * rows);
  for (let y = 0; y < height; y++) {
    const row = offset + y * width * 3;
    const tileRow = Math.floor(y / BLOCK) * columns;
    for (let x = 0; x < width; x++) {
      const pixel = row + x * 3;
      const tile = tileRow + Math.floor(x / BLOCK);
      sum[tile] += 0.299 * ppm[pixel] + 0.587 * ppm[pixel + 1] + 0.114 * ppm[pixel + 2];
      count[tile]++;
    }
  }
  return sum.map((value, tile) => value / count[tile]);
}

/** Fraction of tiles whose mean luminance moved by more than `tolerance`. */
export function diff(a, b, tolerance = 6) {
  if (a.length !== b.length) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > tolerance) changed++;
  return changed / a.length;
}

/** First frame that actually matches the reviewed document, after the window appears. */
export function firstContentTime(frames, windowAt, reference) {
  const frame = frames.find((candidate) => candidate.t >= windowAt && diff(candidate.sig, reference) <= READY);
  if (!frame) throw new Error('no frame matched the reviewed document');
  return frame.t;
}

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function makeReference(ppm, fixtureBytes) {
  return {
    version: 1,
    fixtureSha256: digest(fixtureBytes),
    tiles: Buffer.from(Uint8Array.from(signature(ppm), Math.round)).toString('base64'),
  };
}

export function loadReference(referenceFile, fixtureBytes) {
  const reference = JSON.parse(readFileSync(referenceFile, 'utf8'));
  if (reference.version !== 1 || reference.fixtureSha256 !== digest(fixtureBytes)) {
    throw new Error(`readiness reference does not match fixture: ${referenceFile}`);
  }
  if (typeof reference.tiles !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(reference.tiles)) {
    throw new Error(`invalid readiness reference: ${referenceFile}`);
  }
  const tiles = Buffer.from(reference.tiles, 'base64');
  if (tiles.length !== 80 * 45) throw new Error(`readiness reference must be 1280×720: ${referenceFile}`);
  return tiles;
}
