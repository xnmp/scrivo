#!/usr/bin/env node
// Post-build checks on the web bundle: the startup contract that `vite build` can't enforce.
//
//   bun scripts/check-bundle.mjs [distDir=dist]
//
// 1. Startup size budgets: linked JS/CSS and the manifest's static import graph,
//    plus the window API requested during boot before first paint. CSS @imports count
//    with their owner. Manifest and CSS URL assets are validated and reported.
// 2. Shims run first: the entry's first static import is the shims chunk, so globals are
//    patched before any library chunk evaluates (see src/shims/, vite.config.ts).
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The deferred startup-tail contract adds ~1 KiB to the reader's first-paint code.
const STARTUP_BUDGET_BYTES = 41 * 1024;
const PREPAINT_BUDGET_BYTES = 56 * 1024;
// Boot registers Tauri window handlers before the first-frame mark. Keep this list
// aligned with src/boot.ts and src/platform/tauri.ts when startup imports change.
const PREPAINT_DYNAMIC_ROOTS = ['node_modules/@tauri-apps/api/window.js'];
const importsOf = (code) => [...code.matchAll(/\b(?:import|export)\s*(?:[\w${},\s*]+from\s*)?["'](\.\/[^"']+)["']/g)].map((m) => m[1]);
const cssImportsOf = (css) => [...css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"'\s)]+)["']?\s*\)?/g)].map((m) => m[1]);
const cssUrlsOf = (css) => [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);
const resolveAsset = (from, raw) => {
  const url = raw.split(/[?#]/, 1)[0];
  if (/^(?:data:|https?:|\/\/)/.test(url)) return null;
  return url.startsWith('/') ? url.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(from), url));
};

export function checkBundle(directory, { prepaintDynamicRoots = PREPAINT_DYNAMIC_ROOTS } = {}) {
  const dist = path.resolve(directory);
  const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
  const failures = [];
  const startupFiles = new Set([...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]));
  const entry = html.match(/<script type="module"[^>]*src="\/(assets\/[^"]+\.js)"/)?.[1];
  if (!entry) failures.push('index.html has no module entry script');
  const manifestFile = path.join(dist, '.vite', 'manifest.json');
  if (!existsSync(manifestFile)) failures.push('Vite build manifest is missing');
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
  const manifestEntry = Object.entries(manifest).find(([, chunk]) => chunk.isEntry && chunk.file === entry)?.[0];
  if (!manifestEntry) failures.push(`manifest has no entry for ${entry ?? 'index.html'}`);
  const dynamicRoots = new Set();
  const walkChunks = (roots, followDynamic, label) => {
    const files = new Set();
    const assets = new Set();
    const pending = [...roots];
    const visited = new Set();
    while (pending.length) {
      const key = pending.pop();
      if (visited.has(key)) continue;
      visited.add(key);
      const chunk = manifest[key];
      if (!chunk) {
        failures.push(`manifest ${label} import is missing: ${key}`);
        continue;
      }
      files.add(chunk.file);
      for (const css of chunk.css ?? []) files.add(css);
      for (const asset of chunk.assets ?? []) assets.add(asset);
      pending.push(...(chunk.imports ?? []));
      if (followDynamic) pending.push(...(chunk.dynamicImports ?? []));
      else for (const imported of chunk.dynamicImports ?? []) dynamicRoots.add(imported);
    }
    return { files, assets };
  };
  const staticGraph = walkChunks(manifestEntry ? [manifestEntry] : [], false, 'static');
  for (const file of staticGraph.files) startupFiles.add(file);
  const deferredGraph = walkChunks(dynamicRoots, true, 'dynamic');
  // Vite emits import('...css') as a standalone CSS manifest entry without a
  // dynamicImports edge. Include these outputs so their imports and fonts are checked.
  const standaloneCssRoots = Object.entries(manifest)
    .filter(([, chunk]) => chunk.file?.endsWith('.css') &&
      !startupFiles.has(chunk.file) && !deferredGraph.files.has(chunk.file))
    .map(([key]) => key);
  const standaloneCss = walkChunks(standaloneCssRoots, true, 'standalone CSS');
  for (const file of standaloneCss.files) deferredGraph.files.add(file);
  for (const asset of standaloneCss.assets) deferredGraph.assets.add(asset);
  const prepaintRoots = prepaintDynamicRoots.filter((key) => dynamicRoots.has(key));
  const prepaintGraph = walkChunks(prepaintRoots, false, 'prepaint');
  if (manifestEntry && prepaintRoots.length !== prepaintDynamicRoots.length) {
    failures.push(`known prepaint dynamic import is missing: ${prepaintDynamicRoots.filter((key) => !dynamicRoots.has(key)).join(', ')}`);
  }
  const entryImports = entry && existsSync(path.join(dist, entry))
    ? importsOf(readFileSync(path.join(dist, entry), 'utf8')) : [];

  const walkCss = (files, assets) => {
    const pending = [...files].filter((asset) => asset.endsWith('.css'));
    const visited = new Set();
    while (pending.length) {
      const asset = pending.pop();
      if (visited.has(asset)) continue;
      visited.add(asset);
      const file = path.join(dist, asset);
      if (!existsSync(file)) continue;
      const css = readFileSync(file, 'utf8');
      for (const imported of cssImportsOf(css)) {
        const next = resolveAsset(asset, imported);
        if (!next) {
          failures.push(`CSS import is outside the bundle: ${imported}`);
          continue;
        }
        files.add(next);
        pending.push(next);
      }
      for (const url of cssUrlsOf(css)) {
        const next = resolveAsset(asset, url);
        if (next && !files.has(next)) assets.add(next);
      }
    }
  };
  walkCss(startupFiles, staticGraph.assets);
  walkCss(deferredGraph.files, deferredGraph.assets);
  walkCss(prepaintGraph.files, prepaintGraph.assets);

  const missing = new Set([...startupFiles].filter((asset) => !existsSync(path.join(dist, asset))));
  for (const asset of missing) failures.push(`startup asset is missing: ${asset}`);
  const sizes = [...startupFiles].filter((asset) => !missing.has(asset)).map((asset) => [asset, statSync(path.join(dist, asset)).size]);
  const total = sizes.reduce((sum, [, size]) => sum + size, 0);
  const deferred = [...new Set([...deferredGraph.files, ...deferredGraph.assets])]
    .filter((asset) => !startupFiles.has(asset) && !staticGraph.assets.has(asset));
  const missingDeferred = deferred.filter((asset) => !existsSync(path.join(dist, asset)));
  for (const asset of missingDeferred) failures.push(`deferred asset is missing: ${asset}`);
  const deferredBytes = deferred.filter((asset) => !missingDeferred.includes(asset))
    .reduce((sum, asset) => sum + statSync(path.join(dist, asset)).size, 0);
  const conditionalReferences = [...staticGraph.assets].filter((asset) => !startupFiles.has(asset));
  const missingReferences = conditionalReferences.filter((asset) => !existsSync(path.join(dist, asset)));
  for (const asset of missingReferences) failures.push(`startup-referenced asset is missing: ${asset}`);
  const conditional = conditionalReferences.filter((asset) => !missingReferences.includes(asset))
    .map((asset) => [asset, statSync(path.join(dist, asset)).size]);
  const conditionalBytes = conditional.reduce((sum, [, size]) => sum + size, 0);
  const prepaint = [...prepaintGraph.files].filter((asset) => !startupFiles.has(asset));
  const missingPrepaint = prepaint.filter((asset) => !existsSync(path.join(dist, asset)));
  for (const asset of missingPrepaint) failures.push(`prepaint asset is missing: ${asset}`);
  const prepaintBytes = prepaint.filter((asset) => !missingPrepaint.includes(asset))
    .reduce((sum, asset) => sum + statSync(path.join(dist, asset)).size, 0);
  if (total > STARTUP_BUDGET_BYTES) {
    failures.push(
      `startup bundle is ${(total / 1024).toFixed(0)} KiB, budget ${STARTUP_BUDGET_BYTES / 1024} KiB:\n` +
        sizes.map(([asset, size]) => `    ${(size / 1024).toFixed(1).padStart(7)} KiB  ${asset}`).join('\n'),
    );
  }
  if (total + prepaintBytes > PREPAINT_BUDGET_BYTES) {
    failures.push(`prepaint JS/CSS is ${((total + prepaintBytes) / 1024).toFixed(0)} KiB, budget ${PREPAINT_BUDGET_BYTES / 1024} KiB`);
  }

  if (entry && !missing.has(entry) && !/^\.\/shims-[\w-]+\.js$/.test(entryImports[0] ?? '')) {
    failures.push(`entry must import the shims chunk first; its static imports are: ${entryImports.join(', ') || '(none)'}`);
  }
  return { failures, total, conditional, conditionalBytes, deferred, deferredBytes,
    prepaint, prepaintBytes, dynamicRoots: [...dynamicRoots], standaloneCssRoots };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(process.argv[2] ?? 'dist');
  const { failures, total, conditional, conditionalBytes, deferred, deferredBytes,
    prepaint, prepaintBytes, dynamicRoots, standaloneCssRoots } = checkBundle(dist);
  if (failures.length > 0) {
    console.error(`check-bundle: ${failures.length} problem(s) in ${dist}\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`check-bundle: ok (startup JS/CSS ${(total / 1024).toFixed(0)} KiB of ${STARTUP_BUDGET_BYTES / 1024} KiB budget)`);
    console.log(`  known prepaint JS/CSS: ${((total + prepaintBytes) / 1024).toFixed(0)} KiB of ${PREPAINT_BUDGET_BYTES / 1024} KiB budget (${prepaint.length} additional files)`);
    if (conditional.length) console.log(`  startup-referenced assets: ${(conditionalBytes / 1024).toFixed(0)} KiB conditional (${conditional.map(([asset]) => asset).join(', ')})`);
    if (deferred.length) console.log(`  declared deferred graph: ${(deferredBytes / 1024).toFixed(0)} KiB across ${dynamicRoots.length} JS roots and ${standaloneCssRoots.length} standalone CSS root(s) (includes known prepaint files and referenced assets)`);
  }
}
