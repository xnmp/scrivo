// Test doubles shared by the app-layer tests. Not imported by production code.
import { Text } from '@codemirror/state';
import type { ConflictChoice, EditorPort, Prompter, UnsavedChoice } from './ports';

/** Headless editor over CodeMirror's immutable Text. */
export function fakeEditor() {
  let doc = Text.empty;
  let path: string | null = null;
  const toDoc = (s: string) => Text.of(s.split('\n'));
  const port: EditorPort<Text> & { type(s: string): void; value(): string; path(): string | null } = {
    snapshot: () => doc,
    toText: (t) => t.toString(),
    reset: (text, p) => ((path = p), (doc = toDoc(text))),
    replace: (text) => (doc = toDoc(text)),
    setDocumentPath: (p) => void (path = p),
    type: (s) => void (doc = toDoc(doc.toString() + s)),
    value: () => doc.toString(),
    path: () => path,
  };
  return port;
}

export function scriptedPrompter() {
  const answers = { unsaved: [] as UnsavedChoice[], conflict: [] as ConflictChoice[], disk: [] as Array<'reload' | 'keep'> };
  const asked: string[] = [];
  const notices: string[] = [];
  const prompter: Prompter = {
    async unsavedChanges(name) {
      asked.push(`unsaved:${name}`);
      return answers.unsaved.shift() ?? 'cancel';
    },
    async saveConflict(name) {
      asked.push(`conflict:${name}`);
      return answers.conflict.shift() ?? 'cancel';
    },
    async changedOnDisk(name) {
      asked.push(`disk:${name}`);
      return answers.disk.shift() ?? 'keep';
    },
    notify: (m) => void notices.push(m),
  };
  return { prompter, answers, asked, notices };
}

