import { describe, expect, it } from 'vitest';
import { defaultEditorPreferences, indentationColumns, readEditorPreferences } from './editor-preferences';

describe('editor preferences', () => {
  it.each([null, 'invalid', 'null', '[]', '4', 'x'.repeat(4097)])('uses defaults for malformed stored settings: %s', (value) => {
    expect(readEditorPreferences(value)).toEqual(defaultEditorPreferences);
  });
  it('accepts known settings while preserving defaults for invalid and missing fields', () => {
    expect(readEditorPreferences(JSON.stringify({ lineNumbers: true, indentationGuides: 'yes', spellcheck: false, lineWrapping: false, tabSize: 8, unknown: 42 }))).toEqual({
      lineNumbers: true, indentationGuides: false, spellcheck: false, lineWrapping: false, tabSize: 8,
    });
    expect(readEditorPreferences('{"tabSize":0}').tabSize).toBe(4);
    expect(readEditorPreferences('{"tabSize":2}').tabSize).toBe(2);
  });
  it('counts visual indentation using tab stops and bounds extremely large indentation', () => {
    expect(indentationColumns(' \t  text', 4)).toBe(6);
    expect(indentationColumns('\t\t- child', 2)).toBe(4);
    expect(indentationColumns('content', 4)).toBe(0);
    expect(indentationColumns('', 4)).toBe(0);
    expect(indentationColumns(' '.repeat(1000000), 4)).toBe(80);
  });
});
