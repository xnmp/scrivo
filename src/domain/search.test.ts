import { expect, it } from 'vitest';
import { searchScore } from './search';
it('ranks complete words before abbreviation matches and requires character order', () => {
  expect(searchScore('h2', 'Heading 2')).not.toBeNull();
  expect(searchScore('new tab', 'New tab File')).toBeLessThan(searchScore('nt', 'New tab File')!);
  expect(searchScore('2h', 'Heading 2')).toBeNull();
  expect(searchScore('', 'Anything')).toBe(0);
  expect(searchScore('  HEADING  2 ', 'Heading 2 Format')).not.toBeNull();
});
