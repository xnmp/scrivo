import { describe, expect, it } from 'vitest';
import { extractHeadings } from './headings';

describe('editing heading index', () => {
  it('indexes ATX, setext, and nested headings with their source lines', () => {
    const text = '# First\n\nTitle\n---\n\n> ## Quoted\n\n- ### Nested\n';
    expect(extractHeadings(text)).toEqual([
      { id: 'line-1', line: 1, level: 1, text: 'First' },
      { id: 'line-3', line: 3, level: 2, text: 'Title' },
      { id: 'line-6', line: 6, level: 2, text: 'Quoted' },
      { id: 'line-8', line: 8, level: 3, text: 'Nested' },
    ]);
  });

  it('omits apparent headings inside YAML, fenced code, HTML, and display math', () => {
    const text = '\ufeff---\ntitle: x\n# yaml comment\n---\n```markdown\n# Code\n```\n\n<div>\n# HTML\n</div>\n\n$$\n# Math\n$$\n\n# Actual\n';
    expect(extractHeadings(text)).toEqual([{ id: 'line-17', line: 17, level: 1, text: 'Actual' }]);
  });

  it('uses readable inline labels and preserves Unicode', () => {
    expect(extractHeadings('# **Bold** and [Link](destination) `code` ![alt](x) &amp; 😀 ###\n')).toEqual([
      { id: 'line-1', line: 1, level: 1, text: 'Bold and Link code alt & 😀' },
    ]);
    expect(extractHeadings('# [Label][ref] and \\*literal\\*\n\n[ref]: target\n')[0]?.text).toBe('Label and *literal*');
  });

  it('excludes YAML comments from large front matter accepted by Properties', () => {
    expect(extractHeadings('---\nx: ' + 'a'.repeat(70000) + '\n# yaml comment\n---\n# Real\n')).toEqual([
      { id: 'line-5', line: 5, level: 1, text: 'Real' },
    ]);
  });

  it('reaches the tail of large documents without using a viewport parser prefix', () => {
    const text = '# Start\n\n' + 'paragraph 😀\n\n'.repeat(30000) + '# Tail\n';
    expect(extractHeadings(text).map(({ text, line }) => ({ text, line }))).toEqual([
      { text: 'Start', line: 1 }, { text: 'Tail', line: 60003 },
    ]);
  });
});
