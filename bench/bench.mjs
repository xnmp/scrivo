#!/usr/bin/env node
// Startup benchmark for desktop markdown editors on Linux.
//
// Each run spawns the editor on a document and samples screenshots until the window
// settles. Metrics, all measured from spawn() and needing no cooperation from the app
// (Typora blocks DevTools flags in production, so closed-source editors are measured
// the same way as ours):
//   window   – first frame where the app's window is on screen
//   content  – first frame that is within 3% (by tile) of the final one: the document
//              is up, small late changes (a status bar, a caret) aside
//   complete – "visually complete": the first frame after which the screen stays
//              identical (± caret blink) to the final settled frame
//   pss      – summed PSS of the app's process tree, 1.5 s after visually complete
//
// Display backends:
//   cage (default) – a private, headless wlroots compositor (GPU-rendered, 1280×720).
//                    Nothing appears on your desktop and focus is never stolen.
//   hyprland       – your live Hyprland session (`--desktop`): the real-world number,
//                    but windows pop up and take focus. Animations are disabled for the
//                    duration and restored afterwards.
//
// Usage: node bench/bench.mjs <typora|scrivo> <file.md> [runs=8] [--desktop] [--dump=DIR]
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const [appName, fileArg, runsArg = '8'] = argv.filter((a) => !a.startsWith('--'));
const dumpDir = flags.find((f) => f.startsWith('--dump='))?.slice('--dump='.length);
const desktop = flags.includes('--desktop');
if (!appName || !fileArg) {
  console.error('usage: bench.mjs <typora|scrivo> <file.md> [runs] [--desktop] [--dump=DIR]');
  process.exit(2);
}
const file = path.resolve(fileArg);
const runs = Number(runsArg);

const APPS = {
  typora: { cmd: '/usr/bin/typora', classRe: /^typora$/i },
  scrivo: {
    cmd: process.env.SCRIVO_BIN ?? path.resolve(import.meta.dirname, '../src-tauri/target/release/scrivo'),
    classRe: /scrivo/i,
  },
};
const app = APPS[appName];
if (!app) throw new Error(`unknown app ${appName}`);

// ---------- screenshots ----------
const BLOCK = 16;

function capture(env, geometry) {
  return new Promise((resolve, reject) => {
    const args = ['-t', 'ppm', ...(geometry ? ['-g', geometry] : []), '-'];
    const p = spawn('grim', args, { env });
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`grim exit ${code}`));
      const raw = Buffer.concat(chunks);
      resolve({ t: performance.now(), sig: signature(raw), raw: dumpDir ? raw : undefined });
    });
  });
}

/** Mean luminance per BLOCK×BLOCK tile of a binary PPM. */
function signature(ppm) {
  let off = 0;
  const fields = [];
  while (fields.length < 4) {
    while (/\s/.test(String.fromCharCode(ppm[off]))) off++;
    const s = off;
    while (!/\s/.test(String.fromCharCode(ppm[off]))) off++;
    fields.push(ppm.toString('latin1', s, off));
  }
  off++;
  const [, w, h] = fields.map(Number);
  const bw = Math.ceil(w / BLOCK);
  const bh = Math.ceil(h / BLOCK);
  const sum = new Float64Array(bw * bh);
  const cnt = new Uint32Array(bw * bh);
  for (let py = 0; py < h; py++) {
    const row = off + py * w * 3;
    const by = ((py / BLOCK) | 0) * bw;
    for (let px = 0; px < w; px++) {
      const i = row + px * 3;
      const b = by + ((px / BLOCK) | 0);
      sum[b] += 0.299 * ppm[i] + 0.587 * ppm[i + 1] + 0.114 * ppm[i + 2];
      cnt[b]++;
    }
  }
  return sum.map((s, i) => s / cnt[i]);
}

/** Fraction of tiles whose mean luminance moved by more than `tol`. */
function diff(a, b, tol = 6) {
  if (a.length !== b.length) return 1;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > tol) n++;
  return n / a.length;
}
const SAME = 0.003; // ≤0.3% of tiles may differ (caret blink)
const CONTENT = 0.03;

/**
 * Sample until the screen has been stable for `stableMs` after the window appeared.
 * `isWindow(frame)` decides when the app is on screen.
 */
async function sampleRun(env, geometry, isWindow, { stableMs = 1500, capMs = 20000 } = {}) {
  const frames = [];
  const start = performance.now();
  let windowAt = null;
  let lastChange = start;
  while (performance.now() - start < capMs) {
    const f = await capture(env, typeof geometry === 'function' ? geometry() : geometry);
    if (windowAt === null && isWindow(f)) windowAt = f.t;
    if (frames.length && diff(frames.at(-1).sig, f.sig) > SAME) lastChange = f.t;
    frames.push(f);
    if (windowAt !== null && f.t - lastChange > stableMs) break;
  }
  if (windowAt === null) throw new Error('window never appeared');
  const final = frames.at(-1).sig;
  let lastDifferent = -1;
  frames.forEach((f, i) => {
    if (diff(f.sig, final) > SAME) lastDifferent = i;
  });
  const complete = frames[lastDifferent + 1].t;
  const content = frames.find((f) => f.t >= windowAt && diff(f.sig, final) <= CONTENT).t;
  if (dumpDir) dumpFrames(frames, final);
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

/** Live Hyprland session: the real-world number, but windows appear and take focus. */
async function hyprlandBackend() {
  const hyprctl = (...args) => execFileSync('hyprctl', args, { encoding: 'utf8' });
  // Legacy configs accept `keyword`; Lua configs (Hyprland ≥0.55) only accept `eval`.
  const setAnimations = (on) => {
    const out = hyprctl('keyword', 'animations:enabled', on ? '1' : '0');
    if (/can't work/.test(out)) hyprctl('eval', `hl.config({ animations = { enabled = ${on} } })`);
  };
  const animationsOn = () => {
    const o = JSON.parse(hyprctl('getoption', 'animations:enabled', '-j'));
    return Boolean(o.bool ?? o.int);
  };
  const previous = animationsOn();
  process.on('SIGINT', () => {
    setAnimations(previous);
    process.exit(130);
  });
  setAnimations(false);
  if (animationsOn()) throw new Error('could not disable Hyprland animations');

  const sock = path.join(process.env.XDG_RUNTIME_DIR, 'hypr', process.env.HYPRLAND_INSTANCE_SIGNATURE, '.socket2.sock');
  const conn = net.createConnection(sock);
  let opened = null;
  let buf = '';
  conn.on('data', (d) => {
    const now = performance.now();
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('openwindow>>')) continue;
      const [address, , cls] = line.slice('openwindow>>'.length).split(',');
      if (app.classRe.test(cls) && !opened) opened = { t: now, address };
    }
  });
  const geometry = () => {
    if (!opened) return '0,0 1x1';
    const c = JSON.parse(hyprctl('clients', '-j')).find((w) => w.address === `0x${opened.address}`);
    return c ? `${c.at[0]},${c.at[1]} ${c.size[0]}x${c.size[1]}` : '0,0 1x1';
  };
  return {
    name: 'hyprland desktop',
    env: process.env,
    async sample() {
      opened = null;
      const r = await sampleRun(process.env, geometry, () => opened !== null);
      return { ...r, windowAt: opened.t };
    },
    settle: () => sleep(800),
    async stop() {
      conn.destroy();
      setAnimations(previous);
    },
  };
}

// ---------- main ----------
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: s[0], median: q(0.5), p90: q(0.9), max: s.at(-1) };
};
const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${v.toFixed(0)}`).join(' ');

const display = desktop ? await hyprlandBackend() : await cageBackend();
const results = { window: [], content: [], complete: [], pss: [] };
try {
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const child = spawn(app.cmd, [file], { env: display.env, stdio: 'ignore', detached: true });
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
      console.log(`run ${i + 1}: FAILED ${e.message}`);
    } finally {
      await killTree(child.pid);
      await display.settle();
    }
  }
} finally {
  await display.stop();
}

console.log(`\n${appName} ${path.basename(file)} runs=${runs} on ${display.name}`);
for (const [k, unit] of [['window', 'ms'], ['content', 'ms'], ['complete', 'ms'], ['pss', 'MiB']]) {
  if (results[k].length) console.log(`  ${k.padEnd(8)} ${unit.padEnd(3)} : ${fmt(stats(results[k]))}`);
}
