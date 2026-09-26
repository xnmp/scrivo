import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT, decode, encode } from './text-format';

// Text built from characters that stress EOL/BOM handling.
const tricky = fc.string({ unit: fc.constantFrom('a', ' ', '#', '\n', '\r', '﻿', 'é', '😀'), maxLength: 200 });

const uniformEol = (eol: string) =>
  fc.array(fc.string({ unit: fc.constantFrom('a', ' ', '*', '﻿', '中'), maxLength: 20 }), { maxLength: 20 })
    .map((lines) => lines.join(eol));

describe('decode/encode', () => {
  it('round-trips files with a single line-ending style byte-for-byte', () => {
    fc.assert(
      fc.property(fc.constantFrom('\n', '\r\n', '\r'), fc.boolean(), (eol, bom) =>
        fc.assert(
          fc.property(uniformEol(eol), (body) => {
            const raw = (bom ? '﻿' : '') + body;
            const { text, format } = decode(raw);
            expect(format.mixedEol).toBe(false);
            expect(encode(text, format)).toBe(raw);
          }),
          { numRuns: 30 },
        ),
      ),
      { numRuns: 12 },
    );
  });

  it('always yields editor text without carriage returns or a leading BOM', () => {
    fc.assert(
      fc.property(tricky, (raw) => {
        const { text } = decode(raw);
        expect(text).not.toMatch(/\r/);
        // Only a second BOM (i.e. content) may survive at the start.
        if (text.startsWith('﻿')) expect(raw.startsWith('﻿﻿')).toBe(true);
      }),
    );
  });

  it('is idempotent: re-decoding an encoded document changes nothing', () => {
    fc.assert(
      fc.property(tricky, (raw) => {
        const first = decode(raw);
        const second = decode(encode(first.text, first.format));
        expect(second.text).toBe(first.text);
        expect(second.format.eol).toBe(first.format.eol);
        expect(second.format.bom).toBe(first.format.bom);
        expect(second.format.mixedEol).toBe(false);
      }),
    );
  });

  it('keeps a BOM that appears after the first character as content', () => {
    expect(decode('a﻿b').text).toBe('a﻿b');
    expect(decode('﻿﻿x')).toEqual({ text: '﻿x', format: { eol: '\n', bom: true, mixedEol: false } });
  });

  it('picks the dominant line ending and flags mixed files', () => {
    const { text, format } = decode('a\r\nb\r\nc\nd');
    expect(text).toBe('a\nb\nc\nd');
    expect(format).toEqual({ eol: '\r\n', bom: false, mixedEol: true });
    expect(encode(text, format)).toBe('a\r\nb\r\nc\r\nd');
  });

  it('treats a lone CR as a line ending (classic Mac files)', () => {
    expect(decode('a\rb\r')).toEqual({ text: 'a\nb\n', format: { eol: '\r', bom: false, mixedEol: false } });
  });

  it('resolves ties and empty input to LF', () => {
    expect(decode('a\nb\r\n').format.eol).toBe('\n');
    expect(decode('')).toEqual({ text: '', format: DEFAULT_FORMAT });
    expect(decode('﻿')).toEqual({ text: '', format: { ...DEFAULT_FORMAT, bom: true } });
  });

  it('preserves the presence or absence of a trailing newline', () => {
    expect(encode(decode('x\r\n').text, decode('x\r\n').format)).toBe('x\r\n');
    expect(encode(decode('x').text, decode('x').format)).toBe('x');
  });

  it('handles multi-megabyte input', () => {
    const raw = 'line of text\r\n'.repeat(400_000);
    const { text, format } = decode(raw);
    expect(format.eol).toBe('\r\n');
    expect(encode(text, format)).toBe(raw);
  });
});
