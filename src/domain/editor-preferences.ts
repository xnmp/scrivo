export interface EditorPreferences {
  readonly lineNumbers: boolean;
  readonly indentationGuides: boolean;
  readonly spellcheck: boolean;
  readonly lineWrapping: boolean;
  readonly tabSize: 2 | 4 | 8;
}

export const defaultEditorPreferences: EditorPreferences = Object.freeze({
  lineNumbers: false, indentationGuides: false, spellcheck: true, lineWrapping: true, tabSize: 4,
});

/** Persisted settings are untrusted and may come from an older app version. */
export function readEditorPreferences(serialized: string | null): EditorPreferences {
  if (!serialized || serialized.length > 4096) return defaultEditorPreferences;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultEditorPreferences;
    const record = value as Record<string, unknown>;
    const boolean = (key: keyof EditorPreferences): boolean => typeof record[key] === 'boolean'
      ? record[key] as boolean : defaultEditorPreferences[key] as boolean;
    return Object.freeze({
      lineNumbers: boolean('lineNumbers'), indentationGuides: boolean('indentationGuides'),
      spellcheck: boolean('spellcheck'), lineWrapping: boolean('lineWrapping'),
      tabSize: record.tabSize === 2 || record.tabSize === 8 ? record.tabSize : 4,
    });
  } catch { return defaultEditorPreferences; }
}

/** Visual indentation is bounded, even for pathological leading whitespace. */
export function indentationColumns(text: string, tabSize: number): number {
  let columns = 0;
  for (const character of text) {
    if (character === ' ') columns++;
    else if (character === '\t') columns += tabSize - columns % tabSize;
    else break;
    if (columns >= 80) return 80;
  }
  return columns;
}
