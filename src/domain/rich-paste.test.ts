import { describe, expect, it } from 'vitest';
import { convertRichHtml, safePasteUrl } from './rich-paste';

describe('rich clipboard conversion', () => {
  it('converts common browser formatting into portable Markdown', () => {
    expect(convertRichHtml('<h2>Notes</h2><p>Hello <strong>bold</strong>, <em>emphasis</em>, <del>old</del>, and <a href="https://example.com/a b">a link</a>.</p><blockquote><p>Quoted text</p></blockquote>'))
      .toBe('## Notes\n\nHello **bold**, *emphasis*, ~~old~~, and [a link](https://example.com/a%20b).\n\n> Quoted text');
  });

  it('converts lists, fenced code, inline code, and a browser table', () => {
    expect(convertRichHtml('<ol start="3"><li>first<ul><li>nested</li></ul></li><li>second</li></ol><p>Use <code>npm install</code>.</p><pre><code class="language-js">const n = 1;\n</code></pre><table><thead><tr><th>Name</th><th>Score</th></tr></thead><tbody><tr><td>A | B</td><td>10</td></tr></tbody></table>'))
      .toBe('3. first\n   - nested\n4. second\n\nUse `npm install`.\n\n```js\nconst n = 1;\n```\n\n| Name | Score |\n| --- | --- |\n| A \\| B | 10 |');
  });

  it('does not emit executable HTML or unsafe links', () => {
    expect(convertRichHtml('<p onclick="evil()"><a href="jav&#x61;script:evil()">click</a> <a href="data:text/html,x">data</a> <img src="https://example.com/tracker" alt="diagram"></p><script>evil()</script><iframe src="https://example.com"></iframe><style>body{display:none}</style>'))
      .toBe('click data diagram');
    expect(safePasteUrl('https://example.com/a(b)')).toBe('https://example.com/a%28b%29');
    expect(safePasteUrl('../assets/pic.png')).toBe('../assets/pic.png');
    expect(safePasteUrl('//example.com/evil')).toBeNull();
    expect(safePasteUrl('java\nscript:evil()')).toBeNull();
  });

  it('escapes Markdown-like prose and preserves code delimiters', () => {
    expect(convertRichHtml('<p>1. Not a list</p><p>- Nor this</p><p>Use <code>a`b</code> &amp; <code> x </code>.</p><pre><code>```\nraw\n</code></pre>'))
      .toBe('1\\. Not a list\n\n\\- Nor this\n\nUse ``a`b`` &amp; `  x  `.\n\n````\n```\nraw\n````');
  });

  it('round-trips entity-shaped text and link query text through Markdown', () => {
    expect(convertRichHtml('<p>&amp;copy; &amp;amp; &amp;#65; <a href="https://example.com/?q=&amp;copy;&amp;next=1">link</a></p>'))
      .toBe('&amp;copy; &amp;amp; &amp;\\#65; [link](https://example.com/?q=&amp;copy;&amp;next=1)');
  });

  it('keeps word boundaries between paragraphs inside table cells', () => {
    expect(convertRichHtml('<table><tr><td><p>first</p><p>second</p></td><td><div>third</div><div>fourth</div></td></tr></table>'))
      .toBe('| first second | third fourth |\n| --- | --- |');
  });

  it('keeps thematic, setext, and math-like prose literal', () => {
    expect(convertRichHtml('<p>---</p><p>one<br>--</p><p>two<br>=</p><p>Cost $x$ today</p>'))
      .toBe('\\---\n\none  \n\\--\n\ntwo  \n\\=\n\nCost \\$x\\$ today');
  });

  it('keeps visible text inside safe unsupported markup', () => {
    expect(convertRichHtml('<p>Equation <math><mi>x</mi><mo>+</mo><mn>1</mn></math> and <svg><text>42</text><script>evil()</script></svg> done.</p>'))
      .toBe('Equation x+1 and 42 done.');
  });

  it('preserves an ordered list that starts at zero', () => {
    expect(convertRichHtml('<ol start="0"><li>zero</li><li>one</li></ol>'))
      .toBe('0. zero\n1. one');
  });

  it('returns no rich result for empty, unsupported, or unreasonably large fragments', () => {
    expect(convertRichHtml('')).toBeNull();
    expect(convertRichHtml('<script>alert(1)</script>')).toBeNull();
    expect(convertRichHtml('x'.repeat(5_000_001))).toBeNull();
    expect(convertRichHtml('<span>x</span>'.repeat(10_001))).toBeNull();
  });
});
