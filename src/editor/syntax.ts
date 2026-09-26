// Markdown grammar: GFM (via lang-markdown's `markdownLanguage`) + math + YAML front
// matter, with fenced code blocks parsed by lazily loaded language grammars.
//
// We deliberately don't call lang-markdown's `markdown()`: it statically pulls in the
// HTML/CSS/JS grammars for inline HTML, which would sit on the startup path.
import { Language, LanguageDescription, LanguageSupport, ParseContext } from '@codemirror/language';
import { codeLanguages } from './code-languages';
import { markdownLanguage, pasteURLAsLink } from '@codemirror/lang-markdown';
import { tags as t } from '@lezer/highlight';
import { parseCode, type BlockContext, type InlineContext, type Line, type MarkdownConfig, type MarkdownParser } from '@lezer/markdown';

// lezer-markdown tracks how many containers (quotes, list items) a line continues in
// `Line.depth`; it's public at runtime but missing from the typings.
const lineDepth = (line: Line) => (line as Line & { depth: number }).depth;

const DOLLAR = 36;
const BACKSLASH = 92;
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13;
const isDigit = (c: number) => c >= 48 && c <= 57;

/**
 * `$inline$` and `$$ display $$` math with pandoc's rules: the opening `$` must not be
 * followed by whitespace, the closing `$` must not be preceded by whitespace nor
 * followed by a digit (so "$5 and $10" stays text).
 */
export const mathSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath', style: t.special(t.string) },
    { name: 'InlineMathMark', style: t.processingInstruction },
    { name: 'BlockMath', block: true },
    { name: 'BlockMathMark', style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== DOLLAR || cx.char(pos + 1) === DOLLAR) return -1;
        const first = cx.char(pos + 1);
        if (first === -1 || isSpace(first)) return -1;
        for (let i = pos + 1; i < cx.end; i++) {
          const c = cx.char(i);
          if (c === BACKSLASH) {
            i++;
            continue;
          }
          if (c !== DOLLAR) continue;
          if (isSpace(cx.char(i - 1)) || isDigit(cx.char(i + 1))) continue;
          return cx.addElement(
            cx.elt('InlineMath', pos, i + 1, [cx.elt('InlineMathMark', pos, pos + 1), cx.elt('InlineMathMark', i, i + 1)]),
          );
        }
        return -1;
      },
    },
  ],
  parseBlock: [
    {
      name: 'BlockMath',
      before: 'FencedCode',
      parse(cx: BlockContext, line: Line) {
        if (line.next !== DOLLAR || line.text.charCodeAt(line.pos + 1) !== DOLLAR) return false;
        const from = cx.lineStart + line.pos;
        const marks = [cx.elt('BlockMathMark', from, from + 2)];

        // Single line: $$ x $$
        const close = line.text.indexOf('$$', line.pos + 2);
        if (close >= 0) {
          if (line.text.slice(close + 2).trim() !== '') return false;
          marks.push(cx.elt('BlockMathMark', cx.lineStart + close, cx.lineStart + close + 2));
          const end = cx.lineStart + close + 2;
          cx.nextLine();
          cx.addElement(cx.elt('BlockMath', from, end, marks));
          return true;
        }

        let end = cx.lineStart + line.text.length;
        while (cx.nextLine()) {
          if (lineDepth(line) < cx.depth) break; // the enclosing quote/list ended
          const at = line.text.lastIndexOf('$$');
          if (at >= line.pos && line.text.slice(at + 2).trim() === '') {
            marks.push(cx.elt('BlockMathMark', cx.lineStart + at, cx.lineStart + at + 2));
            end = cx.lineStart + at + 2;
            cx.nextLine();
            break;
          }
          end = cx.lineStart + line.text.length;
        }
        cx.addElement(cx.elt('BlockMath', from, end, marks));
        return true;
      },
    },
  ],
};

const FENCE = /^(---|\.\.\.)\s*$/;
const MAX_FRONT_MATTER_LINES = 1000;

/**
 * YAML front matter: `---` on the very first line, closed by `---` or `...`. Without
 * this, the closing `---` turns the YAML into a setext heading.
 */
export const frontMatterSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'FrontMatter', block: true },
    { name: 'FrontMatterMark', style: t.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'FrontMatter',
      before: 'HorizontalRule',
      parse(cx: BlockContext, line: Line) {
        if (cx.lineStart !== 0 || !/^---\s*$/.test(line.text)) return false;
        // Only commit if a closing fence exists: the block parser can't backtrack.
        if (!hasClosingFence(cx)) return false;
        const marks = [cx.elt('FrontMatterMark', 0, 3)];
        while (cx.nextLine()) {
          if (FENCE.test(line.text)) {
            marks.push(cx.elt('FrontMatterMark', cx.lineStart, cx.lineStart + 3));
            const end = cx.lineStart + line.text.length;
            cx.nextLine();
            cx.addElement(cx.elt('FrontMatter', 0, end, marks));
            return true;
          }
        }
        return false;
      },
    },
  ],
};

/**
 * Scan ahead for the closing fence. Uses the parser's `input`, which is public at
 * runtime but untyped; a unit test guards against it disappearing.
 */
function hasClosingFence(cx: BlockContext): boolean {
  const input = (cx as unknown as { input?: { length: number; read(from: number, to: number): string } }).input;
  if (!input) return false;
  const head = input.read(0, Math.min(input.length, 64 * 1024));
  const lines = head.split('\n');
  for (let i = 1; i < lines.length && i < MAX_FRONT_MATTER_LINES; i++) {
    if (FENCE.test(lines[i]!)) return true;
  }
  return false;
}

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

export function markdownSupport(): LanguageSupport {
  return new LanguageSupport(scrivoMarkdown, [pasteURLAsLink]);
}
