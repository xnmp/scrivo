import type { Theme } from '../domain/appearance';
/** Original palettes using Obsidian's public variables. Loaded with settings only. */
const palette = (mode: string, bg: string, surface: string, fg: string, muted: string, border: string, accent: string) =>
  `.theme-${mode} { --background-primary:${bg}; --background-secondary:${surface}; --background-secondary-alt:${surface}; --text-normal:${fg}; --text-title:${fg}; --text-muted:${muted}; --text-faint:${muted}; --background-modifier-border:${border}; --interactive-accent:${accent}; --text-on-accent:${mode === 'dark' ? '#181818' : '#ffffff'}; --text-accent:${accent}; --code-background:${surface}; --table-row-alt-background:${surface}; --caret-color:${fg}; --blockquote-border-color:${border}; }`;
export const builtinThemes: readonly Theme[] = [
  { id: 'builtin:charcoal', name: 'Charcoal', css: palette('dark', '#1e1e1e', '#292929', '#dedede', '#a3a3a3', '#3f3f3f', '#b4a0e5') + palette('light', '#ffffff', '#f3f3f3', '#292929', '#656565', '#dedede', '#7656a6') },
  { id: 'builtin:arctic', name: 'Arctic', css: palette('dark', '#252c38', '#303a49', '#e0e8f2', '#a7b5c8', '#47566b', '#88c0d0') + palette('light', '#f5f8fc', '#e8eef5', '#29364a', '#596a82', '#cad5e2', '#267587') },
  { id: 'builtin:ember', name: 'Ember', css: palette('dark', '#262524', '#363330', '#e6dcc5', '#b9a88e', '#514a42', '#ff921c') + palette('light', '#fffaf0', '#f0e8d8', '#40372b', '#75664f', '#d8cbb8', '#ad5200') + '.theme-dark { --h1-color:#ff921c; --h2-color:#f1bb34; } .theme-light { --h1-color:#ad5200; --h2-color:#926b00; }' },
  { id: 'builtin:paper', name: 'Paper', css: palette('light', '#fcf8ef', '#eee8da', '#383c32', '#686c5c', '#d2ccbc', '#48745d') + palette('dark', '#222821', '#2d352c', '#dfdfc9', '#a8b2a0', '#495344', '#a2c6a1') },
];
