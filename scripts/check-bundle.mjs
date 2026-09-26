#!/usr/bin/env node
// Post-build checks on the web bundle: the startup contract that `vite build` can't enforce.
//
//   bun scripts/check-bundle.mjs [distDir=dist]
//
// 1. Startup size budget: everything index.html loads before first paint (entry, its
//    static imports, CSS). Lazy features must stay out of it.
// 2. Shims run first: the entry's first static import is the shims chunk, so globals are
//    patched before any library chunk evaluates (see src/shims/, vite.config.ts).
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const STARTUP_BUDGET_BYTES = 40 * 1024;

const dist = path.resolve(process.argv[2] ?? 'dist');
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
const failures = [];

const startupFiles = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
const entry = html.match(/<script type="module"[^>]*src="\/(assets\/[^"]+\.js)"/)?.[1];
if (!entry) failures.push('index.html has no module entry script');

const sizes = startupFiles.map((f) => [f, statSync(path.join(dist, f)).size]);
const total = sizes.reduce((sum, [, n]) => sum + n, 0);
if (total > STARTUP_BUDGET_BYTES) {
  failures.push(
    `startup bundle is ${(total / 1024).toFixed(0)} KiB, budget ${STARTUP_BUDGET_BYTES / 1024} KiB:\n` +
      sizes.map(([f, n]) => `    ${(n / 1024).toFixed(1).padStart(7)} KiB  ${f}`).join('\n'),
  );
}

if (entry) {
  const code = readFileSync(path.join(dist, entry), 'utf8');
  // Static imports only: `import{..}from"./x.js"` or `import"./x.js"` (not `import(`).
  const imports = [...code.matchAll(/\bimport\s*(?:[\w${},\s*]+from\s*)?["'](\.\/[^"']+)["']/g)].map((m) => m[1]);
  if (!/^\.\/shims-[\w-]+\.js$/.test(imports[0] ?? '')) {
    failures.push(`entry must import the shims chunk first; its static imports are: ${imports.join(', ') || '(none)'}`);
  }
}

if (failures.length > 0) {
  console.error(`check-bundle: ${failures.length} problem(s) in ${dist}\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`check-bundle: ok (startup ${(total / 1024).toFixed(0)} KiB of ${STARTUP_BUDGET_BYTES / 1024} KiB budget)`);
