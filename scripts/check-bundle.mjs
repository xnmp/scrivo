#!/usr/bin/env node
// Post-build checks on the web bundle: the startup contract that `vite build` can't enforce.
//
//   bun scripts/check-bundle.mjs [distDir=dist]
//
// 1. Startup size budget: JS/CSS linked by index.html and transitive static JS imports.
//    This does not account for conditional assets such as fonts or awaited lazy imports.
// 2. Shims run first: the entry's first static import is the shims chunk, so globals are
//    patched before any library chunk evaluates (see src/shims/, vite.config.ts).
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STARTUP_BUDGET_BYTES = 40 * 1024;
const importsOf = (code) => [...code.matchAll(/\b(?:import|export)\s*(?:[\w${},\s*]+from\s*)?["'](\.\/[^"']+)["']/g)].map((m) => m[1]);

export function checkBundle(directory) {
  const dist = path.resolve(directory);
  const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
  const failures = [];
  const startupFiles = new Set([...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]));
  const entry = html.match(/<script type="module"[^>]*src="\/(assets\/[^"]+\.js)"/)?.[1];
  if (!entry) failures.push('index.html has no module entry script');

  // Vite normally emits modulepreload links for static imports. Traverse imports too:
  // a build change that drops a preload link must not bypass the startup budget.
  const pending = entry ? [entry] : [];
  const visited = new Set();
  let entryImports = [];
  while (pending.length) {
    const asset = pending.pop();
    if (visited.has(asset)) continue;
    visited.add(asset);
    const file = path.join(dist, asset);
    if (!existsSync(file)) continue;
    const imports = importsOf(readFileSync(file, 'utf8'));
    if (asset === entry) entryImports = imports;
    for (const imported of imports) {
      const next = path.posix.normalize(path.posix.join(path.posix.dirname(asset), imported));
      startupFiles.add(next);
      pending.push(next);
    }
  }

  const missing = new Set([...startupFiles].filter((asset) => !existsSync(path.join(dist, asset))));
  for (const asset of missing) failures.push(`startup asset is missing: ${asset}`);
  const sizes = [...startupFiles].filter((asset) => !missing.has(asset)).map((asset) => [asset, statSync(path.join(dist, asset)).size]);
  const total = sizes.reduce((sum, [, size]) => sum + size, 0);
  if (total > STARTUP_BUDGET_BYTES) {
    failures.push(
      `startup bundle is ${(total / 1024).toFixed(0)} KiB, budget ${STARTUP_BUDGET_BYTES / 1024} KiB:\n` +
        sizes.map(([asset, size]) => `    ${(size / 1024).toFixed(1).padStart(7)} KiB  ${asset}`).join('\n'),
    );
  }

  if (entry && !missing.has(entry) && !/^\.\/shims-[\w-]+\.js$/.test(entryImports[0] ?? '')) {
    failures.push(`entry must import the shims chunk first; its static imports are: ${entryImports.join(', ') || '(none)'}`);
  }
  return { failures, total };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(process.argv[2] ?? 'dist');
  const { failures, total } = checkBundle(dist);
  if (failures.length > 0) {
    console.error(`check-bundle: ${failures.length} problem(s) in ${dist}\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`check-bundle: ok (startup ${(total / 1024).toFixed(0)} KiB of ${STARTUP_BUDGET_BYTES / 1024} KiB budget)`);
  }
}
