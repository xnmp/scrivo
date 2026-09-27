#!/usr/bin/env node
// Run only after inspecting the PPM or a PNG converted from it. A reviewed reference
// lets the benchmark reject stable splash, error, and blank screens.
import { readFileSync, writeFileSync } from 'node:fs';
import { makeReference } from './visual.mjs';

const [screen, fixture, output] = process.argv.slice(2);
if (!screen || !fixture || !output) {
  console.error('usage: make-reference.mjs <reviewed-final.ppm> <fixture.md> <output.json>');
  process.exit(2);
}
writeFileSync(output, JSON.stringify(makeReference(readFileSync(screen), readFileSync(fixture))) + '\n');
