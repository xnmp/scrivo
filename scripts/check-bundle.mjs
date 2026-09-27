#!/usr/bin/env node
// Post-build checks on the web bundle: the startup contract that `vite build` can't enforce.
//
//   bun scripts/check-bundle.mjs [distDir=dist]
//
// 1. Startup size budget: linked JS/CSS, transitive static JS imports, and CSS @imports.
//    CSS URL assets are reported separately because fonts load only when used. Awaited
//    dynamic imports still need a runtime first-paint check.
// 2. Shims run first: the entry's first static import is the shims chunk, so globals are
//    patched before any library chunk evaluates (see src/shims/, vite.config.ts).
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STARTUP_BUDGET_BYTES = 40 * 1024;
const importsOf = (code) => [...code.matchAll(/\b(?:import|export)\s*(?:[\w${},\s*]+from\s*)?["'](\.\/[^"']+)["']/g)].map((m) => m[1]);
const cssImportsOf = (css) => [...css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"'\s)]+)["']?\s*\)?/g)].map((m) => m[1]);
const cssUrlsOf = (css) => [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);
const resolveAsset = (from, raw) => {
  const url = raw.split(/[?#]/, 1)[0];
  if (/^(?:data:|https?:|\/\/)/.test(url)) return null;
  return url.startsWith('/') ? url.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(from), url));
};

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

  const cssPending = [...startupFiles].filter((asset) => asset.endsWith('.css'));
  const cssVisited = new Set();
  const cssReferences = new Set();
  while (cssPending.length) {
    const asset = cssPending.pop();
    if (cssVisited.has(asset)) continue;
    cssVisited.add(asset);
    const file = path.join(dist, asset);
    if (!existsSync(file)) continue;
    const css = readFileSync(file, 'utf8');
    for (const imported of cssImportsOf(css)) {
      const next = resolveAsset(asset, imported);
      if (!next) {
        failures.push(`CSS import is outside the bundle: ${imported}`);
        continue;
      }
      startupFiles.add(next);
      cssPending.push(next);
    }
    for (const url of cssUrlsOf(css)) {
      const next = resolveAsset(asset, url);
      if (next && !startupFiles.has(next)) cssReferences.add(next);
    }
  }

  const missing = new Set([...startupFiles].filter((asset) => !existsSync(path.join(dist, asset))));
  for (const asset of missing) failures.push(`startup asset is missing: ${asset}`);
  const sizes = [...startupFiles].filter((asset) => !missing.has(asset)).map((asset) => [asset, statSync(path.join(dist, asset)).size]);
  const total = sizes.reduce((sum, [, size]) => sum + size, 0);
  const conditionalReferences = [...cssReferences].filter((asset) => !startupFiles.has(asset));
  const missingReferences = conditionalReferences.filter((asset) => !existsSync(path.join(dist, asset)));
  for (const asset of missingReferences) failures.push(`CSS-referenced asset is missing: ${asset}`);
  const conditional = conditionalReferences.filter((asset) => !missingReferences.includes(asset))
    .map((asset) => [asset, statSync(path.join(dist, asset)).size]);
  const conditionalBytes = conditional.reduce((sum, [, size]) => sum + size, 0);
  if (total > STARTUP_BUDGET_BYTES) {
    failures.push(
      `startup bundle is ${(total / 1024).toFixed(0)} KiB, budget ${STARTUP_BUDGET_BYTES / 1024} KiB:\n` +
        sizes.map(([asset, size]) => `    ${(size / 1024).toFixed(1).padStart(7)} KiB  ${asset}`).join('\n'),
    );
  }

  if (entry && !missing.has(entry) && !/^\.\/shims-[\w-]+\.js$/.test(entryImports[0] ?? '')) {
    failures.push(`entry must import the shims chunk first; its static imports are: ${entryImports.join(', ') || '(none)'}`);
  }
  return { failures, total, conditional, conditionalBytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(process.argv[2] ?? 'dist');
  const { failures, total, conditional, conditionalBytes } = checkBundle(dist);
  if (failures.length > 0) {
    console.error(`check-bundle: ${failures.length} problem(s) in ${dist}\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`check-bundle: ok (startup JS/CSS ${(total / 1024).toFixed(0)} KiB of ${STARTUP_BUDGET_BYTES / 1024} KiB budget)`);
    if (conditional.length) console.log(`  CSS-referenced assets: ${(conditionalBytes / 1024).toFixed(0)} KiB conditional (${conditional.map(([asset]) => asset).join(', ')})`);
  }
}
