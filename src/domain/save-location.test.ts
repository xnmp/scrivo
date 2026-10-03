import { expect, it } from 'vitest';
import { saveLocation, suggestedLocation } from './save-location';

it('preserves literal names, extension, spaces and platform path style', () => {
  expect(suggestedLocation('Untitled.md', '/home/me')).toEqual({ folder: '/home/me', name: 'Untitled.md' });
  expect(suggestedLocation('/notes/hello.markdown', '/home/me')).toEqual({ folder: '/notes', name: 'hello.markdown' });
  expect(saveLocation('/', 'a.md')).toEqual({ path: '/a.md' });
  expect(saveLocation('/notes/', 'a $(name).md')).toEqual({ path: '/notes/a $(name).md' });
  expect(suggestedLocation('C:\\note.md', 'C:\\Users\\me')).toEqual({ folder: 'C:\\', name: 'note.md' });
  expect(saveLocation('C:\\Notes\\', 'a.md', true)).toEqual({ path: 'C:\\Notes\\a.md' });
  expect(saveLocation('\\\\server\\share', 'a.md', true)).toEqual({ path: '\\\\server\\share\\a.md' });
});
it('rejects relative folders, empty or path-like names and controls', () => {
  for (const folder of ['', 'notes', '~/notes', '/notes\n']) expect(saveLocation(folder, 'a.md')).toHaveProperty('error');
  for (const name of ['', '.', '..', '../a.md', 'a/b.md', 'a\\b.md', 'a\0.md']) expect(saveLocation('/notes', name)).toHaveProperty('error');
  expect(saveLocation('C:\\Notes', 'a.md')).toHaveProperty('error');
  for (const folder of ['/notes', 'C:Notes', '\\\\server']) expect(saveLocation(folder, 'a.md', true)).toHaveProperty('error');
});
