// Markdown grammar: GFM (via lang-markdown's `markdownLanguage`) + math + YAML front
// matter, with fenced code blocks parsed by lazily loaded language grammars.
//
// We deliberately don't call lang-markdown's `markdown()`: it statically pulls in the
// HTML/CSS/JS grammars for inline HTML, which would sit on the startup path.
import { ensureSyntaxTree, foldService, Language, LanguageDescription, LanguageSupport, ParseContext, syntaxTree } from '@codemirror/language';
import { codeLanguages } from './code-languages';
import { markdownLanguage, pasteURLAsLink } from '@codemirror/lang-markdown';
import { frontMatterSyntax, mathSyntax } from './markdown-blocks';
export { frontMatterSyntax, mathSyntax } from './markdown-blocks';
import { parseCode, type MarkdownParser } from '@lezer/markdown';
import type { SyntaxNode } from '@lezer/common';
import type { EditorState, Text } from '@codemirror/state';

// Nested ```markdown blocks reuse this grammar (defined below; resolved lazily).
const languages = codeLanguages(() => markdownSupport());

/**
 * Grammar for a fenced code block's info string. Unloaded grammars start loading and
 * the block is re-parsed when they arrive (the same mechanism lang-markdown uses).
 */
function codeParser(info: string) {
  const found = LanguageDescription.matchLanguageName(languages, info, true);
  if (!found) return null;
  if (found.support) return found.support.language.parser;
  return ParseContext.getSkippingParser(found.load());
}

const markdownParser = (markdownLanguage.parser as MarkdownParser).configure([
  mathSyntax,
  frontMatterSyntax,
  parseCode({ codeParser }),
]);

/** Shares `markdownLanguage.data`, so lang-markdown's commands recognise it. */
export const scrivoMarkdown = new Language(markdownLanguage.data, markdownParser, [], 'markdown');

const headingLevel = (node: SyntaxNode): number | null => {
  const match = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
  return match ? Number(match[1]) : null;
};

const headingScanCache = new WeakMap<Text, Map<string, { parsed: number; to: number | null }>>();
const MAX_SECTION_SCAN_LINES = 2500;

/**
 * Candidate lines are cheap to find, but only the Markdown parser can decide
 * whether they are headings rather than code, HTML, rules, or list children.
 * Stop if parsing or scanning would exceed a short UI budget.
 */
function sectionEnd(state: EditorState, headingEnd: number, level: number): number | null {
  const doc = state.doc;
  const parsed = syntaxTree(state).length;
  let cached = headingScanCache.get(doc);
  if (!cached) headingScanCache.set(doc, cached = new Map());
  const key = `${headingEnd}:${level}`;
  const hit = cached.get(key);
  if (hit?.parsed === parsed) return hit.to;
  const remember = (to: number | null): number | null => {
    cached.set(key, { parsed, to });
    return to;
  };

  const deadline = performance.now() + 20;
  const firstLine = doc.lineAt(headingEnd).number + 1;
  let number = firstLine;
  for (const source of doc.iterLines(firstLine)) {
    const lineNumber = number++;
    if (lineNumber - firstLine >= MAX_SECTION_SCAN_LINES ||
        (lineNumber & 127) === 0 && performance.now() >= deadline) return remember(null);
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+|$)/.exec(source);
    const setext = atx ? null : /^ {0,3}(=+|-+)[ \t]*$/.exec(source);
    const candidateLevel = atx ? atx[1]!.length
      : setext ? (setext[1]![0] === '=' ? 1 : 2) : null;
    if (candidateLevel === null || candidateLevel > level) continue;
    const line = doc.line(lineNumber);
    const remaining = deadline - performance.now();
    if (remaining <= 0) return remember(null);
    const candidateTree = ensureSyntaxTree(state, line.to, remaining);
    if (!candidateTree) return remember(null);
    for (let node: SyntaxNode | null = candidateTree.resolveInner(line.to, -1); node; node = node.parent) {
      const actualLevel = headingLevel(node);
      if (actualLevel !== null && actualLevel <= level && node.parent?.name === 'Document') {
        return remember(doc.line(doc.lineAt(node.from).number - 1).to);
      }
    }
  }
  return remember(doc.length);
}

/** Fold a heading through its following section, stopping at a peer or parent. */
export const headingFolds = foldService.of((state, start, end) => {
  const tree = syntaxTree(state);
  for (let node: SyntaxNode | null = tree.resolveInner(end, -1); node; node = node.parent) {
    if (node.from < start) break;
    const level = headingLevel(node);
    if (level === null) continue;
    let last = node;
    let peer = false;
    for (let next = last.nextSibling; next; next = last.nextSibling) {
      const nextLevel = headingLevel(next);
      if (nextLevel !== null && nextLevel <= level) { peer = true; break; }
      last = next;
    }
    const to = !peer && tree.length < state.doc.length && node.parent?.name === 'Document'
      ? sectionEnd(state, node.to, level) : last.to;
    return to !== null && to > end ? { from: end, to } : null;
  }
  return null;
});

export function markdownSupport(): LanguageSupport {
  return new LanguageSupport(scrivoMarkdown, [
    headingFolds,
    scrivoMarkdown.data.of({ closeBrackets: { brackets: ['(', '[', '{', "'", '"', '`'] } }),
    pasteURLAsLink,
  ]);
}
