import { describe, expect, it } from 'vitest';
import { resolveTarget } from './links';
import { reachesPrefix, touches } from './reveal';

describe('resolveTarget', () => {
  it.each([
    ['img.png', '/docs', { kind: 'file', path: '/docs/img.png' }],
    ['./assets/a b.png', '/docs', { kind: 'file', path: '/docs/assets/a b.png' }],
    ['assets/a%20b.png', '/docs', { kind: 'file', path: '/docs/assets/a b.png' }],
    ['../up.png', '/docs/sub', { kind: 'file', path: '/docs/up.png' }],
    ['../../../x.png', '/a', { kind: 'file', path: '/x.png' }],
    ['/abs/x.png', null, { kind: 'file', path: '/abs/x.png' }],
    ['<my image.png>', '/d', { kind: 'file', path: '/d/my image.png' }],
    ['img.png?raw=1#frag', '/d', { kind: 'file', path: '/d/img.png' }],
    ['https://e.com/x.png?a=1', '/d', { kind: 'url', url: 'https://e.com/x.png?a=1' }],
    ['data:image/png;base64,AAAA', null, { kind: 'url', url: 'data:image/png;base64,AAAA' }],
    ['//cdn.e.com/x.png', null, { kind: 'url', url: 'https://cdn.e.com/x.png' }],
    ['file:///home/u/x%20y.png', null, { kind: 'file', path: '/home/u/x y.png' }],
    ['file:///C:/pics/x.png', null, { kind: 'file', path: 'C:/pics/x.png' }],
    ['C:\\pics\\x.png', null, { kind: 'file', path: 'C:\\pics\\x.png' }],
    ['img.png', 'C:\\docs', { kind: 'file', path: 'C:\\docs\\img.png' }],
    ['img.png', '/', { kind: 'file', path: '/img.png' }],
    ['../img.png', '/', { kind: 'file', path: '/img.png' }],
    ['img.png', 'C:', { kind: 'file', path: 'C:/img.png' }],
    ['img.png', '/docs/', { kind: 'file', path: '/docs/img.png' }],
    ['img.png', '\\\\server\\share', { kind: 'file', path: '\\\\server\\share\\img.png' }],
    ['bad%E0%A4%A.png', '/d', { kind: 'file', path: '/d/bad%E0%A4%A.png' }],
  ])('%s relative to %s', (raw, dir, expected) => {
    expect(resolveTarget(raw, dir)).toEqual(expected);
  });

  it('cannot resolve relative paths without a document directory', () => {
    expect(resolveTarget('img.png', null)).toBeNull();
  });

  it('rejects empty destinations', () => {
    expect(resolveTarget('', '/d')).toBeNull();
    expect(resolveTarget('  <>  ', '/d')).toBeNull();
  });
});

describe('reveal policy', () => {
  const caret = (p: number) => [{ from: p, to: p }];

  it('reveals an inline element when the caret is inside or at either edge', () => {
    // **bold** spans 10..18
    expect(touches(caret(9), 10, 18)).toBe(false);
    expect(touches(caret(10), 10, 18)).toBe(true);
    expect(touches(caret(14), 10, 18)).toBe(true);
    expect(touches(caret(18), 10, 18)).toBe(true);
    expect(touches(caret(19), 10, 18)).toBe(false);
  });

  it('reveals for a selection overlapping the element', () => {
    expect(touches([{ from: 0, to: 12 }], 10, 18)).toBe(true);
    expect(touches([{ from: 0, to: 5 }, { from: 30, to: 40 }], 10, 18)).toBe(false);
  });

  it('keeps a line prefix hidden while typing right after it', () => {
    // "# " hidden at 0..2
    expect(reachesPrefix(caret(2), 0, 2)).toBe(false);
    expect(reachesPrefix(caret(1), 0, 2)).toBe(true);
    expect(reachesPrefix(caret(0), 0, 2)).toBe(true);
    expect(reachesPrefix([{ from: 1, to: 5 }], 0, 2)).toBe(true);
  });
});
