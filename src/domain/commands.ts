import { validChord } from './hotkeys';
export { eventChord, validChord } from './hotkeys';
export interface CommandDefinition { readonly id: string; readonly label: string; readonly group: string; readonly keys: readonly string[] }
const command = (id: string, label: string, group: string, ...keys: string[]): CommandDefinition => ({ id, label, group, keys });
export const commands: readonly CommandDefinition[] = [
  command('new', 'New tab', 'File', 'Mod+KeyT', 'Mod+KeyN'),
  command('open', 'Open file…', 'File', 'Mod+KeyO'), command('recent', 'Open recent…', 'File', 'Mod+KeyR'),
  command('save', 'Save', 'File', 'Mod+KeyS'), command('saveAs', 'Save as…', 'File', 'Mod+Shift+KeyS'),
  command('close', 'Close tab', 'File', 'Mod+KeyW'), command('clearRecents', 'Clear recent files', 'File'),
  command('undo', 'Undo', 'Edit', 'Mod+KeyZ'), command('redo', 'Redo', 'Edit', 'Mod+Shift+KeyZ', 'Mod+KeyY'),
  command('find', 'Find…', 'Edit', 'Mod+KeyF'), command('replace', 'Find and replace…', 'Edit', 'Mod+KeyH'),
  command('findNext', 'Find next', 'Edit', 'Mod+KeyG', 'F3'), command('findPrevious', 'Find previous', 'Edit', 'Mod+Shift+KeyG', 'Shift+F3'),
  command('reading', 'Toggle reading / editing', 'View', 'Mod+KeyE'), command('source', 'Toggle source / live preview', 'View', 'Mod+Slash'),
  command('nextTab', 'Next tab', 'View', 'Mod+Tab'), command('previousTab', 'Previous tab', 'View', 'Mod+Shift+Tab'),
  command('palette', 'Command palette…', 'View', 'Mod+KeyP', 'Mod+Shift+KeyP'),
  command('appearance', 'Appearance…', 'Settings', 'Mod+Comma'), command('resetAppearance', 'Reset appearance', 'Settings', 'Mod+Shift+Comma'),
  command('hotkeys', 'Customize hotkeys…', 'Settings'), command('editorSettings', 'Editor settings', 'Settings'),
  command('properties', 'Document properties', 'View'), command('contents', 'Toggle contents', 'View'),
  ...[
    ['bold', 'Bold', 'Mod+KeyB'], ['italic', 'Italic', 'Mod+KeyI'], ['underline', 'Underline', 'Mod+KeyU'],
    ['inlineCode', 'Inline code', 'Mod+Shift+Backquote'], ['strike', 'Strikethrough', 'Alt+Shift+Digit5'],
    ['link', 'Insert link', 'Mod+KeyK'], ['paragraph', 'Paragraph', 'Mod+Digit0'],
    ...Array.from({ length: 6 }, (_, i) => [`heading${i + 1}`, `Heading ${i + 1}`, `Mod+Digit${i + 1}`]),
    ['increaseHeading', 'Increase heading level', 'Mod+Equal'], ['decreaseHeading', 'Decrease heading level', 'Mod+Minus'],
    ['quote', 'Blockquote', 'Mod+Shift+KeyQ'], ['orderedList', 'Numbered list', 'Mod+Shift+BracketLeft'],
    ['bulletList', 'Bullet list', 'Mod+Shift+BracketRight'], ['codeBlock', 'Insert code block', 'Mod+Shift+KeyK'],
    ['mathBlock', 'Insert math block', 'Mod+Shift+KeyM'], ['table', 'Insert table', 'Mod+Shift+KeyT'],
    ['fold', 'Fold section', 'Mod+Alt+BracketLeft'], ['unfold', 'Unfold section', 'Mod+Alt+BracketRight'],
  ].map(([id, label, key]) => command(id!, label!, 'Format', key!)),
];
export type Hotkeys = Readonly<Record<string, readonly string[]>>;
export function readHotkeys(raw: string | null): Hotkeys {
  if (!raw || raw.length > 32768) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(commands.flatMap(({ id }) => Array.isArray(value[id]) && value[id].length <= 4 && value[id].every(validChord)
      ? [[id, [...new Set<string>(value[id])]]] : []));
  } catch { return {}; }
}
export const bindings = (definition: CommandDefinition, overrides: Hotkeys) => overrides[definition.id] ?? definition.keys;
const resolved = (chord: string, mac: boolean) => chord.replace('Mod', mac ? 'Meta' : 'Ctrl');
export function conflict(id: string, chord: string, overrides: Hotkeys, mac: boolean): CommandDefinition | undefined {
  return commands.find(def => def.id !== id && bindings(def, overrides).some(key => resolved(key, mac) === resolved(chord, mac)));
}
export function matchCommand(chord: string, overrides: Hotkeys, mac: boolean): CommandDefinition | undefined {
  return commands.find(def => bindings(def, overrides).some(key => resolved(key, mac) === resolved(chord, mac)));
}
export const displayChord = (chord: string, mac = false) => chord.replace('Mod', mac ? '⌘' : 'Ctrl').replace(/Key|Digit/g, '').replace('Backquote', '`').replace('BracketLeft', '[').replace('BracketRight', ']').replace('Comma', ',').replace('Slash', '/').replace('Equal', '=').replace('Minus', '−');
