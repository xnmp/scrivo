#!/usr/bin/env node
// Startup benchmark for desktop markdown editors on Linux.
//
// Each run spawns the editor on a document and samples screenshots until the window
// settles. Metrics, all measured from spawn() and needing no cooperation from the app
// (Typora blocks DevTools flags in production, so closed-source editors are measured
// the same way as ours):
//   window   – first frame where the app's window is on screen
//   content  – first frame matching the manually reviewed fixture screen to within
//              0.3% of image tiles
//   complete – first frame after which that viewport stays identical (± caret blink)
//   pss      – summed PSS of the app's process tree, 1.5 s after viewport completion
//
// Every run uses a private, headless 1280×720 cage compositor.
//
// Usage: node bench/bench.mjs <typora|scrivo> <file.md> [runs=8] [--dump=DIR] [--trace] [--edit]
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { READY, SAME, diff, firstContentTime, loadReference, signature } from './visual.mjs';
import { median } from './stats.mjs';

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const [appName, fileArg, runsArg = '8'] = argv.filter((a) => !a.startsWith('--'));
const dumpDir = flags.find((f) => f.startsWith('--dump='))?.slice('--dump='.length);
const failureDir = flags.find((f) => f.startsWith('--failure-dir='))?.slice('--failure-dir='.length);
const trace = flags.includes('--trace');
const unverified = flags.includes('--unverified');
const edit = flags.includes('--edit');
if (flags.includes('--desktop')) throw new Error('live-desktop benchmarking is unsupported; use the private cage compositor');
if (!appName || !fileArg) {
  console.error('usage: bench.mjs <typora|scrivo> <file.md> [runs] [--dump=DIR] [--failure-dir=DIR] [--trace] [--edit (scrivo only)] [--reference=FILE] [--unverified]');
  process.exit(2);
}
if (edit && appName !== 'scrivo') throw new Error('--edit is only supported for scrivo');
const file = path.resolve(fileArg);
const runs = Number(runsArg);
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('runs must be a positive integer');
const referenceFile = flags.find((f) => f.startsWith('--reference='))?.slice('--reference='.length)
  ?? path.join(import.meta.dirname, 'references', `${appName}-${path.basename(file, path.extname(file))}${edit ? '-edit' : ''}.json`);
const reference = unverified ? null : loadReference(referenceFile, readFileSync(file));

const APPS = {
  typora: { cmd: '/usr/bin/typora' },
  scrivo: {
    cmd: process.env.SCRIVO_BIN ?? path.resolve(import.meta.dirname, '../src-tauri/target/release/scrivo'),
  },
};
const app = APPS[appName];
if (!app) throw new Error(`unknown app ${appName}`);

// ---------- screenshots ----------
function capture(env, geometry, includeRaw = Boolean(dumpDir)) {
  return new Promise((resolve, reject) => {
    const args = ['-t', 'ppm', ...(geometry ? ['-g', geometry] : []), '-'];
    const p = spawn('grim', args, { env });
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`grim exit ${code}`));
      const raw = Buffer.concat(chunks);
      resolve({ t: performance.now(), sig: signature(raw), raw: includeRaw ? raw : undefined });
    });
  });
}

/**
 * Sample until the screen has been stable for `stableMs` after the window appeared.
 * `isWindow(frame)` decides when the app is on screen.
 */
async function sampleRun(env, geometry, isWindow, { stableMs = 1500, capMs = 20000 } = {}) {
  const frames = [];
  const start = performance.now();
  let windowAt = null;
  let lastChange = start;
  let settled = false;
  while (performance.now() - start < capMs) {
    const f = await capture(env, typeof geometry === 'function' ? geometry() : geometry);
    if (windowAt === null && isWindow(f)) windowAt = f.t;
    if (frames.length && diff(frames.at(-1).sig, f.sig) > SAME) lastChange = f.t;
    frames.push(f);
    if (f.t - start >= capMs) break;
    if (windowAt !== null && f.t - lastChange > stableMs && (reference === null || diff(f.sig, reference) <= READY)) {
      settled = true;
      break;
    }
  }
  if (dumpDir && frames.length) dumpFrames(frames, frames.at(-1).sig);
  if (windowAt === null) throw new Error('window never appeared');
  const final = frames.at(-1).sig;
  const readinessDifference = reference === null ? null : diff(final, reference);
  if (readinessDifference !== null && readinessDifference > READY) throw new Error(`document never matched reviewed screen within ${capMs} ms (${(readinessDifference * 100).toFixed(1)}% of tiles differ)`);
  if (!settled) throw new Error(`document screen did not settle within ${capMs} ms`);
  let lastDifferent = -1;
  frames.forEach((f, i) => {
    if (diff(f.sig, final) > SAME) lastDifferent = i;
  });
  const complete = frames[lastDifferent + 1].t;
  const content = firstContentTime(frames, windowAt, reference ?? final);
  const intervals = frames.slice(1).map((f, i) => f.t - frames[i].t);
  return { windowAt, content, complete, frames: frames.length, interval: intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length) };
}

function dumpFrames(frames, final) {
  mkdirSync(dumpDir, { recursive: true });
  const timeline = frames.map((f, i) => `${String(i).padStart(3, '0')} t=${(f.t - frames[0].t).toFixed(0)} diff=${diff(f.sig, final).toFixed(3)}`);
  writeFileSync(path.join(dumpDir, 'timeline.txt'), timeline.join('\n') + '\n');
  frames.forEach((f, i) => writeFileSync(path.join(dumpDir, `${String(i).padStart(3, '0')}.ppm`), f.raw));
  writeFileSync(path.join(dumpDir, 'final.ppm'), frames.at(-1).raw);
}

// ---------- process tree ----------
function descendants(rootPid) {
  const children = new Map();
  for (const ent of readdirSync('/proc')) {
    if (!/^\d+$/.test(ent)) continue;
    try {
      const stat = readFileSync(`/proc/${ent}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(Number(ent));
    } catch { /* raced with exit */ }
  }
  const out = [];
  const stack = [rootPid];
  while (stack.length) {
    const p = stack.pop();
    out.push(p);
    stack.push(...(children.get(p) ?? []));
  }
  return out;
}

function treePssMiB(rootPid) {
  let kb = 0;
  for (const pid of descendants(rootPid)) {
    try {
      const m = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8').match(/^Pss:\s+(\d+)/m);
      if (m) kb += Number(m[1]);
    } catch { /* exited */ }
  }
  return kb / 1024;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function killTree(pid) {
  const pids = descendants(pid);
  for (const p of pids) try { process.kill(p, 'SIGTERM'); } catch { /* gone */ }
  const t0 = performance.now();
  while (pids.some(alive) && performance.now() - t0 < 3000) await sleep(50);
  for (const p of pids.filter(alive)) try { process.kill(p, 'SIGKILL'); } catch { /* gone */ }
  while (pids.some(alive)) await sleep(20);
}

// ---------- display backends ----------

/** Private headless compositor. The app is spawned directly (not as cage's child). */
async function cageBackend() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'scrivo-bench-'));
  const envFile = path.join(dir, 'env');
  const cage = spawn('cage', ['-s', '--', 'sh', '-c', `echo "$WAYLAND_DISPLAY $DISPLAY" > ${envFile}; exec sleep infinity`], {
    env: { ...process.env, WLR_BACKENDS: 'headless', WLR_LIBINPUT_NO_DEVICES: '1' },
    stdio: 'ignore',
    detached: true,
  });
  const t0 = performance.now();
  while (!existsSync(envFile) || readFileSync(envFile, 'utf8').trim() === '') {
    if (performance.now() - t0 > 10000) throw new Error('cage did not start');
    await sleep(20);
  }
  const [wayland, x11] = readFileSync(envFile, 'utf8').trim().split(/\s+/);
  const env = { ...process.env, WAYLAND_DISPLAY: wayland, DISPLAY: x11 ?? '' };
  delete env.HYPRLAND_INSTANCE_SIGNATURE;
  // Xwayland starts lazily on the first X client; warm it so X11 apps don't pay for it.
  if (x11) execFileSync('xprop', ['-root', '_NET_SUPPORTED'], { env, stdio: 'ignore', timeout: 10000 });
  const empty = (await capture(env)).sig;
  return {
    name: 'cage (headless, 1280x720)',
    env,
    sample: () => sampleRun(env, undefined, (f) => diff(f.sig, empty) > 0.05),
    /** Wait until the output is empty again. */
    async settle() {
      const t = performance.now();
      while (diff((await capture(env)).sig, empty) > SAME && performance.now() - t < 5000) await sleep(50);
    },
    async stop() {
      await killTree(cage.pid);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ---------- main ----------
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: s[0], median: median(s), p90: q(0.9), max: s.at(-1) };
};
const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${v.toFixed(0)}`).join(' ');

const display = await cageBackend();
const results = { window: [], content: [], complete: [], pss: [] };
let failures = 0;
if (unverified) {
  console.error('UNVERIFIED capture: no document-readiness reference was checked');
  process.exitCode = 1;
}
try {
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const child = spawn(app.cmd, edit ? ['--edit', file] : [file], {
      env: trace ? { ...display.env, SCRIVO_TRACE: '1' } : display.env,
      stdio: trace ? ['ignore', 'pipe', 'ignore'] : 'ignore',
      detached: true,
    });
    const traceChunks = [];
    child.stdout?.on('data', (chunk) => traceChunks.push(chunk));
    try {
      const r = await display.sample();
      await sleep(1500);
      const pss = treePssMiB(child.pid);
      results.window.push(r.windowAt - t0);
      results.content.push(r.content - t0);
      results.complete.push(r.complete - t0);
      results.pss.push(pss);
      console.log(
        `run ${i + 1}: window=${(r.windowAt - t0).toFixed(0)} content=${(r.content - t0).toFixed(0)} complete=${(r.complete - t0).toFixed(0)} ms  ` +
          `pss=${pss.toFixed(0)} MiB  (${r.frames} frames @ ${r.interval.toFixed(0)} ms)`,
      );
    } catch (e) {
      failures++;
      console.log(`run ${i + 1}: FAILED ${e.message}`);
      if (failureDir) {
        mkdirSync(failureDir, { recursive: true });
        const screenshot = path.join(failureDir, `${appName}-${path.basename(file, path.extname(file))}-${Date.now()}.ppm`);
        try {
          writeFileSync(screenshot, (await capture(display.env, undefined, true)).raw);
          console.log(`  failed screen: ${screenshot}`);
        } catch (captureError) {
          console.log(`  failed screen unavailable: ${captureError.message}`);
        }
      }
    } finally {
      await killTree(child.pid);
      await display.settle();
      if (trace) {
        const marks = Buffer.concat(traceChunks).toString('utf8').split('\n').filter((line) => line.startsWith('SCRIVO_TRACE'));
        for (const mark of marks) console.log(mark);
      }
    }
  }
} finally {
  await display.stop();
}

console.log(`\n${appName} ${path.basename(file)}${edit ? ' --edit' : ''} runs=${runs} on ${display.name}`);
for (const [k, unit] of [['window', 'ms'], ['content', 'ms'], ['complete', 'ms'], ['pss', 'MiB']]) {
  if (results[k].length) console.log(`  ${k.padEnd(8)} ${unit.padEnd(3)} : ${fmt(stats(results[k]))}`);
}
if (failures) process.exitCode = 1;
