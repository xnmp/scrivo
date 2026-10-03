import { displayName, documentDir } from './document';

export const suggestedLocation = (path: string, home: string) => {
  const folder = documentDir(path) ?? home;
  return { folder: /^[A-Za-z]:$/.test(folder) ? folder + path[2] : folder, name: displayName(path) };
};

/** Paths remain literal; no shell expansion or implicit extension changes. */
export function saveLocation(folder: string, name: string, windows = false): { path: string } | { error: string } {
  const absolute = windows ? /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/.test(folder) : folder.startsWith('/');
  if (!absolute) return { error: 'Enter an absolute folder path.' };
  if (/[\u0000-\u001f]/.test(folder)) return { error: 'Folder paths cannot contain control characters.' };
  if (!name || name === '.' || name === '..' || /[\\/\u0000-\u001f]/.test(name)) return { error: 'Enter a filename without slashes or control characters.' };
  const separator = /^[A-Za-z]:\\|^\\\\/.test(folder) ? '\\' : '/';
  return { path: `${folder.replace(/[\\/]+$/, '')}${separator}${name}` };
}
