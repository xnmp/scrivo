// Inline markdown → a small, serialisable tree, built from the editor's syntax tree.
// Used where we must render markdown ourselves instead of decorating the source
// (table cells). Converting to DOM is a separate step so the conversion is testable.
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

export type InlineNode =
  | { readonly t: 'text'; readonly text: string }
  | { readonly t: 'strong' | 'em' | 'strike' | 'sub' | 'sup'; readonly children: InlineNode[] }
  | { readonly t: 'code'; readonly text: string }
  | { readonly t: 'link'; readonly href: string; readonly children: InlineNode[] }
  | { readonly t: 'image'; readonly src: string; readonly alt: string }
  | { readonly t: 'math'; readonly tex: string };

const WRAPPERS: Record<string, 'strong' | 'em' | 'strike' | 'sub' | 'sup'> = {
  StrongEmphasis: 'strong',
  Emphasis: 'em',
  Strikethrough: 'strike',
  Subscript: 'sub',
  Superscript: 'sup',
};

const MARKS = new Set([
  'EmphasisMark', 'CodeMark', 'LinkMark', 'StrikethroughMark', 'SubscriptMark',
  'SuperscriptMark', 'InlineMathMark', 'TableDelimiter', 'HeaderMark', 'QuoteMark', 'ListMark',
]);

const childrenNamed = (node: SyntaxNode, name: string): SyntaxNode[] => {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) out.push(c);
  return out;
};

/** Inline content of `parent` restricted to [from, to). */
export function inlineAst(state: EditorState, parent: SyntaxNode, from: number, to: number): InlineNode[] {
  const slice = (a: number, b: number) => state.sliceDoc(a, b);
  const out: InlineNode[] = [];
  const text = (a: number, b: number) => {
    if (b <= a) return;
    const s = slice(a, b);
    const last = out[out.length - 1];
    if (last?.t === 'text') out[out.length - 1] = { t: 'text', text: last.text + s };
    else out.push({ t: 'text', text: s });
  };

  let pos = from;
  for (let c = parent.firstChild; c; c = c.nextSibling) {
    if (c.to <= from || c.from >= to) continue;
    text(pos, Math.max(pos, c.from));
    pos = Math.max(pos, c.to);
    if (MARKS.has(c.name)) continue;
    const wrapper = WRAPPERS[c.name];
    if (wrapper) {
      out.push({ t: wrapper, children: inlineAst(state, c, c.from, c.to) });
      continue;
    }
    switch (c.name) {
      case 'InlineCode': {
        const marks = childrenNamed(c, 'CodeMark');
        out.push({ t: 'code', text: slice(marks[0]?.to ?? c.from, marks[1]?.from ?? c.to).trim() });
        break;
      }
      case 'InlineMath': {
        const marks = childrenNamed(c, 'InlineMathMark');
        out.push({ t: 'math', tex: slice(marks[0]?.to ?? c.from, marks[1]?.from ?? c.to) });
        break;
      }
      case 'Link': {
        const marks = childrenNamed(c, 'LinkMark');
        const url = c.getChild('URL');
        if (marks.length < 2 || (!url && !c.getChild('LinkLabel'))) {
          text(c.from, c.to); // `[text]` without a destination is just text
          break;
        }
        out.push({
          t: 'link',
          href: url ? slice(url.from, url.to) : '',
          children: inlineAst(state, c, marks[0]!.to, marks[1]!.from),
        });
        break;
      }
      case 'Image': {
        const marks = childrenNamed(c, 'LinkMark');
        const url = c.getChild('URL');
        out.push({ t: 'image', src: url ? slice(url.from, url.to) : '', alt: marks.length >= 2 ? slice(marks[0]!.to, marks[1]!.from) : '' });
        break;
      }
      case 'Autolink': {
        const url = c.getChild('URL');
        const href = url ? slice(url.from, url.to) : slice(c.from, c.to);
        out.push({ t: 'link', href, children: [{ t: 'text', text: href }] });
        break;
      }
      case 'URL': {
        const href = slice(c.from, c.to);
        out.push({ t: 'link', href, children: [{ t: 'text', text: href }] });
        break;
      }
      case 'Escape':
        text(c.from + 1, c.to);
        break;
      default:
        // TableCell and other containers: descend; unknown leaves: keep their text.
        if (c.firstChild) out.push(...inlineAst(state, c, Math.max(from, c.from), Math.min(to, c.to)));
        else text(Math.max(from, c.from), Math.min(to, c.to));
    }
  }
  text(pos, to);
  return out;
}
