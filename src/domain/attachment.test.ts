import { describe, expect, it } from 'vitest';
import { attachmentLink, checkClipboardFileSize, isMarkdownFile, MAX_CLIPBOARD_FILE_BYTES } from './attachment';

describe('attachment link policy', () => {
  it('inserts image syntax and encodes filenames as one relative path segment', () => {
    expect(attachmentLink('über photo (1).png')).toBe('![über photo (1)](assets/%C3%BCber%20photo%20%281%29.png)');
    expect(attachmentLink('paste', 'image/png')).toBe('![paste](assets/paste)');
  });

  it('inserts a portable file link and escapes a visible label', () => {
    expect(attachmentLink('report [final] #1.pdf')).toBe('[report \\[final\\] #1.pdf](assets/report%20%5Bfinal%5D%20%231.pdf)');
    expect(attachmentLink('a?b&c.txt')).toBe('[a?b&c.txt](assets/a%3Fb%26c.txt)');
  });

  it('rejects names that could escape assets and identifies Markdown drops', () => {
    for (const invalid of ['', '.', '..', '../file.png', 'a\\b.png', 'line\nbreak.txt']) {
      expect(() => attachmentLink(invalid)).toThrow();
    }
    expect(isMarkdownFile('notes.MD')).toBe(true);
    expect(isMarkdownFile('notes.mdwn')).toBe(true);
    expect(isMarkdownFile('notes.txt')).toBe(true);
    expect(isMarkdownFile('report.pdf')).toBe(false);
  });

  it('rejects oversized and malformed clipboard files before reading their bytes', () => {
    expect(() => checkClipboardFileSize(MAX_CLIPBOARD_FILE_BYTES)).not.toThrow();
    for (const size of [MAX_CLIPBOARD_FILE_BYTES + 1, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => checkClipboardFileSize(size)).toThrow('64 MiB');
    }
  });
});
