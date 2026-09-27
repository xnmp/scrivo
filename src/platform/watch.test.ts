import { expect, it } from 'vitest';
import { createMemoryPlatform } from './memory';

it('keeps document watches independent when another tab changes or closes', async () => {
  const platform = createMemoryPlatform();
  const changed: string[] = [];

  await platform.fs.watch('/notes/a.md', () => changed.push('a'), 'tab-a');
  await platform.fs.watch('/notes/b.md', () => changed.push('b'), 'tab-b');
  platform.disk.notify('/notes/a.md');
  platform.disk.notify('/notes/b.md');
  expect(changed).toEqual(['a', 'b']);

  await platform.fs.watch('/notes/c.md', () => changed.push('c'), 'tab-a');
  platform.disk.notify('/notes/a.md');
  platform.disk.notify('/notes/b.md');
  platform.disk.notify('/notes/c.md');
  expect(changed).toEqual(['a', 'b', 'b', 'c']);

  await platform.fs.watch(null, () => {}, 'tab-a');
  platform.disk.notify('/notes/c.md');
  platform.disk.notify('/notes/b.md');
  expect(changed).toEqual(['a', 'b', 'b', 'c', 'b']);
  expect([...platform.watchedPaths()]).toEqual([['tab-b', '/notes/b.md']]);
});

it('preserves the default single-document watch API', async () => {
  const platform = createMemoryPlatform();
  let calls = 0;
  await platform.fs.watch('/notes/a.md', () => { calls++; });
  expect(platform.watchedPath()).toBe('/notes/a.md');
  platform.disk.notify('/notes/a.md');
  await platform.fs.watch(null, () => { calls++; });
  platform.disk.notify('/notes/a.md');
  expect(calls).toBe(1);
  expect(platform.watchedPath()).toBeNull();
});
