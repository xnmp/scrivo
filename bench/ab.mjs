#!/usr/bin/env node
// Interleaved A/B startup comparison of app builds, with paired statistics.
//
// Machine load drifts during a run, so comparing two separate benchmark runs mostly
// measures the drift. This runs one launch of each build per round, rotates which
// build launches first, and compares builds within each round.
//
// Usage: node bench/ab.mjs <file.md> <rounds> <build> <build>...
//   build: a path to a Scrivo binary, or `typora`. The first build is the baseline.
//
// Each launch is `bench.mjs <app> <file> 1` in its own headless compositor.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const [file, roundsArg, ...builds] = process.argv.slice(2);
if (!file || !roundsArg || builds.length < 2) {
  console.error('usage: ab.mjs <file.md> <rounds> <baseline-build> <build>...');
  process.exit(2);
}
const rounds = Number(roundsArg);
if (!Number.isSafeInteger(rounds) || rounds < 1) {
  console.error('rounds must be a positive integer');
  process.exit(2);
}
const bench = path.join(import.meta.dirname, 'bench.mjs');
const METRICS = ['window', 'content', 'complete'];

function launch(build) {
  const app = build === 'typora' ? 'typora' : 'scrivo';
  const env = build === 'typora' ? process.env : { ...process.env, SCRIVO_BIN: path.resolve(build) };
  let out;
  try {
    out = execFileSync('node', [bench, app, file, '1'], { env, encoding: 'utf8' });
  } catch (error) {
    return { error: String(error.message).split('\n')[0] };
  }
  const line = out.split('\n').find((l) => l.startsWith('run 1:'));
  if (!line) return { error: 'benchmark returned no run result' };
  if (line.includes('FAILED')) return { error: line.slice('run 1: FAILED'.length).trim() || 'launch failed' };
  const metrics = Object.fromEntries(METRICS.map((m) => [m, Number(line.match(new RegExp(`${m}=(\\d+)`))?.[1])]));
  if (Object.values(metrics).some((value) => !Number.isFinite(value))) return { error: `invalid metrics: ${line}` };
  return { metrics };
}

const results = builds.map(() => []);
for (let r = 0; r < rounds; r++) {
  // Rotating the starting index balances first-launch effects for every build.
  for (let offset = 0; offset < builds.length; offset++) {
    const i = (r + offset) % builds.length;
    const run = launch(builds[i]);
    results[i][r] = run.metrics ?? null;
    console.log(`round ${r + 1} ${path.basename(builds[i])}: ${run.metrics
      ? METRICS.map((k) => `${k}=${run.metrics[k]}`).join(' ')
      : `FAILED ${run.error}`}`);
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

console.log(`\n${path.basename(file)}, ${rounds} rounds`);
builds.forEach((build, i) => {
  const ok = results[i].filter(Boolean);
  const summary = ok.length
    ? METRICS.map((k) => `${k} med=${median(ok.map((m) => m[k])).toFixed(0)}`).join('  ')
    : 'no successful launches';
  console.log(`  ${path.basename(build).padEnd(16)} n=${ok.length}  ${summary}`);
});
for (let i = 1; i < builds.length; i++) {
  const pairs = results[0].map((base, r) => [base, results[i][r]]).filter(([a, b]) => a && b);
  const diffs = pairs.map(([a, b]) => b.content - a.content);
  if (!diffs.length) {
    console.log(`  ${path.basename(builds[i])} vs ${path.basename(builds[0])}: no valid pairs`);
    continue;
  }
  const faster = diffs.filter((d) => d < 0).length;
  console.log(
    `  ${path.basename(builds[i])} vs ${path.basename(builds[0])}: content ${median(diffs) >= 0 ? '+' : ''}${median(diffs).toFixed(0)} ms ` +
      `(paired median), faster in ${faster}/${diffs.length} rounds`,
  );
}
