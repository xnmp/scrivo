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
// A comparison needs at least 80% valid paired rounds for each candidate.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { median, minimumPairs } from './stats.mjs';

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
  const args = [bench, app, file, '1'];
  if (process.env.BENCH_FAILURE_DIR) args.push(`--failure-dir=${process.env.BENCH_FAILURE_DIR}`);
  const run = spawnSync('node', args, { env, encoding: 'utf8' });
  const out = run.stdout ?? '';
  const line = out.split('\n').find((l) => l.startsWith('run 1:'));
  if (!line) {
    const detail = run.stderr?.split('\n').find((part) => /(?:Error:|ENOENT|ERR_)/.test(part));
    return { error: run.error?.message ?? detail?.trim() ?? 'benchmark returned no run result' };
  }
  if (line.includes('FAILED')) return { error: line.slice('run 1: FAILED'.length).trim() || 'launch failed' };
  if (run.status !== 0) return { error: `benchmark exited ${run.status}: ${line}` };
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

console.log(`\n${path.basename(file)}, ${rounds} rounds`);
const requiredPairs = minimumPairs(rounds);
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
  if (pairs.length < requiredPairs) {
    console.error(`  ${path.basename(builds[i])} vs ${path.basename(builds[0])}: insufficient valid pairs (${pairs.length}/${rounds}; need ${requiredPairs})`);
    process.exitCode = 1;
    continue;
  }
  const faster = diffs.filter((d) => d < 0).length;
  console.log(
    `  ${path.basename(builds[i])} vs ${path.basename(builds[0])}: content ${median(diffs) >= 0 ? '+' : ''}${median(diffs).toFixed(0)} ms ` +
      `(paired median), faster in ${faster}/${diffs.length} rounds`,
  );
}
