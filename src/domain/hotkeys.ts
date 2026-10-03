const modifiers = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'];
export function validChord(chord: unknown): chord is string {
  if (typeof chord !== 'string' || chord.length > 80) return false;
  const parts = chord.split('+'), key = parts.pop()!;
  return /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Tab|Enter|Space|Comma|Period|Slash|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|NumpadAdd|NumpadSubtract|Arrow(Left|Right|Up|Down))$/.test(key)
    && parts.every((part, i) => modifiers.includes(part) && (i === 0 || modifiers.indexOf(part) > modifiers.indexOf(parts[i - 1]!)))
    && !/^(Mod|Ctrl|Meta)\+Key[ACVX]$/.test(chord)
    && (parts.some(part => ['Mod', 'Ctrl', 'Meta', 'Alt'].includes(part)) || /^F\d+$/.test(key));
}
export type ShortcutEvent = Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;
export function eventChord(event: ShortcutEvent, mac: boolean): string {
  const key = event.code || (/^[a-z]$/i.test(event.key) ? `Key${event.key.toUpperCase()}` : /^\d$/.test(event.key) ? `Digit${event.key}` : ({ ',': 'Comma', '/': 'Slash', '-': 'Minus', '=': 'Equal', '+': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '`': 'Backquote' } as Record<string, string>)[event.key] ?? event.key);
  return [...((mac ? event.metaKey : event.ctrlKey) ? ['Mod'] : []), ...((mac ? event.ctrlKey : event.metaKey) ? [mac ? 'Ctrl' : 'Meta'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), key].join('+');
}

/** Bootstrap only: capture candidate stored bindings until the command registry loads. */
export function storedChordMatches(chord: string, raw: string | null, mac: boolean): boolean {
  if (!raw || raw.length > 32768) return false;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const resolve = (key: string) => key.replace('Mod', mac ? 'Meta' : 'Ctrl');
    return Object.values(value).some(keys => Array.isArray(keys) && keys.length <= 4 && keys.every(validChord)
      && keys.some(key => resolve(key) === resolve(chord)));
  } catch { return false; }
}
