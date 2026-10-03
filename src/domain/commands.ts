import { eventChord, validChord, type ShortcutEvent } from './hotkeys';
export { eventChord, validChord } from './hotkeys';
export interface CommandDefinition { readonly id: string; readonly label: string; readonly group: string; readonly keys: readonly string[] }
const command = (id: string, label: string, group: string, ...keys: string[]): CommandDefinition => ({ id, label, group, keys });
export const commands: readonly CommandDefinition[] = [
  command('new', 'New tab', 'File', 'Mod+KeyT', 'Mod+KeyN'),
  command('open', 'Open file…', 'File', 'Mod+KeyO'), command('recent', 'Open recent…', 'File', 'Mod+KeyR'),
  command('save', 'Save', 'File', 'Mod+KeyS'), command('saveAs', 'Save as…', 'File', 'Mod+Shift+KeyS'),
  command('close', 'Close tab', 'File', 'Mod+KeyW'), command('clearRecents', 'Clear recent files', 'File'),
  command('undo', 'Undo', 'Edit', 'Mod+KeyZ'), command('redo', 'Redo', 'Edit', 'Mod+Shift+KeyZ', 'Mod+KeyY'),
  command('selectNext', 'Select next occurrence', 'Edit', 'Mod+KeyD'),
  command('find', 'Find…', 'Edit', 'Mod+KeyF'), command('replace', 'Find and replace…', 'Edit', 'Mod+KeyH'),
  command('findNext', 'Find next', 'Edit', 'Mod+KeyG', 'F3'), command('findPrevious', 'Find previous', 'Edit', 'Mod+Shift+KeyG', 'Shift+F3'),
  command('reading', 'Toggle reading / editing', 'View', 'Mod+KeyE'), command('source', 'Toggle source / live preview', 'View', 'Mod+Slash'),
  command('nextTab', 'Next tab', 'View', 'Mod+Tab'), command('previousTab', 'Previous tab', 'View', 'Mod+Shift+Tab'),
  command('palette', 'Command palette…', 'View', 'Mod+KeyP', 'Mod+Shift+KeyP'),
  command('zoomIn', 'Zoom in', 'View', 'Mod+Equal', 'Mod+Shift+Equal', 'Mod+NumpadAdd'),
  command('zoomOut', 'Zoom out', 'View', 'Mod+Minus', 'Mod+Shift+Minus', 'Mod+NumpadSubtract'),
  command('zoomReset', 'Reset zoom', 'View'),
  command('settings', 'Settings…', 'Settings', 'Mod+Comma'),
  command('appearance', 'Appearance…', 'Settings'), command('resetAppearance', 'Reset appearance', 'Settings', 'Mod+Shift+Comma'),
  command('hotkeys', 'Customize hotkeys…', 'Settings'), command('editorSettings', 'Editor settings', 'Settings'),
  command('substitutions', 'Substitutions…', 'Settings'),
  command('properties', 'Document properties', 'View'), command('contents', 'Toggle contents', 'View'),
  ...[
    ['bold', 'Bold', 'Mod+KeyB'], ['italic', 'Italic', 'Mod+KeyI'], ['underline', 'Underline', 'Mod+KeyU'],
    ['inlineCode', 'Inline code', 'Mod+Shift+Backquote'], ['strike', 'Strikethrough', 'Alt+Shift+Digit5'],
    ['link', 'Insert link', 'Mod+KeyK'], ['paragraph', 'Paragraph', 'Mod+Digit0'],
    ...Array.from({ length: 6 }, (_, i) => [`heading${i + 1}`, `Heading ${i + 1}`, `Mod+Digit${i + 1}`]),
    ['increaseHeading', 'Increase heading level', 'Mod+Alt+Equal'], ['decreaseHeading', 'Decrease heading level', 'Mod+Alt+Minus'],
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
const resolved = (chord: string, mac: boolean) => chord.replace('Mod', mac ? 'Meta' : 'Ctrl');
/** Saved choices take precedence over newly introduced default shortcuts. */
export const bindings = (definition: CommandDefinition, overrides: Hotkeys, mac = false): readonly string[] =>
  overrides[definition.id] ?? definition.keys.filter(key => !Object.entries(overrides).some(([id, keys]) =>
    id !== definition.id && keys.some(assigned => resolved(assigned, mac) === resolved(key, mac))));
export function conflict(id: string, chord: string, overrides: Hotkeys, mac: boolean): CommandDefinition | undefined {
  return commands.find(def => def.id !== id && bindings(def, overrides, mac).some(key => resolved(key, mac) === resolved(chord, mac)));
}
export function matchCommand(chord: string, overrides: Hotkeys, mac: boolean): CommandDefinition | undefined {
  return commands.find(def => bindings(def, overrides, mac).some(key => resolved(key, mac) === resolved(chord, mac)));
}
/** Default zoom follows the printed sign across layouts; saved physical keys win. */
export function matchKeyCommand(event: ShortcutEvent, overrides: Hotkeys, mac: boolean): CommandDefinition | undefined {
  const physical = matchCommand(eventChord(event, mac), overrides, mac);
  if (physical && overrides[physical.id] !== undefined) return physical;
  if ((event.key === '+' || event.key === '-') && !event.altKey) {
    const zoom = commands.find(command => command.id === (event.key === '+' ? 'zoomIn' : 'zoomOut'))!;
    const semantic = eventChord({ code: event.key === '+' ? 'Equal' : 'Minus', key: event.key,
      ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey }, mac);
    if (overrides[zoom.id] === undefined && bindings(zoom, overrides, mac).includes(semantic)) return zoom;
  }
  return physical;
}
export const displayChord = (chord: string, mac = false) => chord.replace('NumpadAdd', 'Num +').replace('NumpadSubtract', 'Num −').replace('Mod', mac ? '⌘' : 'Ctrl').replace(/Key|Digit/g, '').replace('Backquote', '`').replace('BracketLeft', '[').replace('BracketRight', ']').replace('Comma', ',').replace('Slash', '/').replace('Equal', '=').replace('Minus', '−');
