use super::*;
use proptest::prelude::*;
use std::path::Path;

fn asset(path: &Path) -> String {
    format!("asset://localhost/{}", url::encode_uri_component(&path.to_string_lossy()))
}

fn render_in(markdown: &str, dir: Option<&str>) -> Rendered {
    render(markdown, &Options { base_dir: dir.map(Path::new), asset_url: &asset })
}

fn html(markdown: &str) -> String {
    render_in(markdown, Some("/docs")).html
}

/// Every `<tag` and attribute name in the output. Text is always escaped, so each `<` in
/// the output starts a real tag.
fn tags_and_attributes(html: &str) -> Vec<(String, Vec<String>)> {
    let mut found = Vec::new();
    let mut rest = html;
    while let Some(i) = rest.find('<') {
        rest = &rest[i + 1..];
        let end = rest.find('>').expect("unterminated tag");
        let inner = rest[..end].trim_end_matches('/');
        rest = &rest[end + 1..];
        if inner.starts_with('/') {
            continue;
        }
        let name_end = inner.find(|c: char| c.is_whitespace()).unwrap_or(inner.len());
        let name = inner[..name_end].to_ascii_lowercase();
        let mut attrs = Vec::new();
        let mut a = &inner[name_end..];
        loop {
            a = a.trim_start();
            if a.is_empty() {
                break;
            }
            let n_end = a.find(|c: char| c == '=' || c.is_whitespace()).unwrap_or(a.len());
            attrs.push(a[..n_end].to_ascii_lowercase());
            a = &a[n_end..];
            if let Some(v) = a.strip_prefix("=\"") {
                let close = v.find('"').expect("unterminated attribute");
                a = &v[close + 1..];
            }
        }
        found.push((name, attrs));
    }
    found
}

const HTML_TAGS: &[&str] = &[
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code", "ul", "ol", "li", "div", "table",
    "thead", "tbody", "tr", "th", "td", "hr", "a", "img", "em", "strong", "del", "sup", "sub", "br", "input",
    "span", "dl", "dt", "dd",
];
const HTML_ATTRS: &[&str] = &[
    "data-line", "data-lang", "data-align", "class", "id", "href", "title", "src", "alt", "loading", "decoding",
    "type", "disabled", "checked", "start",
];

fn is_mathml(tag: &str) -> bool {
    tag == "math" || tag.starts_with('m') || matches!(tag, "semantics" | "annotation" | "none")
}

/// The contract the page relies on to insert the output as HTML.
fn assert_safe(html: &str) {
    for (tag, attrs) in tags_and_attributes(html) {
        assert!(HTML_TAGS.contains(&tag.as_str()) || is_mathml(&tag), "unexpected tag <{tag}> in {html}");
        for attr in attrs {
            assert!(!attr.starts_with("on"), "event handler {attr} in {html}");
            if !is_mathml(&tag) {
                assert!(HTML_ATTRS.contains(&attr.as_str()), "unexpected attribute {attr} on <{tag}> in {html}");
            }
        }
    }
    let lower = html.to_ascii_lowercase();
    for bad in ["href=\"javascript:", "src=\"javascript:", "href=\"vbscript:", "href=\"data:"] {
        assert!(!lower.contains(bad), "{bad} in {html}");
    }
}

#[test]
fn renders_common_markdown() {
    let out = html("# Title\n\nSome *em* and **strong** and `code` and ~~gone~~.\n\n- a\n- b\n\n1. x\n2. y\n\n---\n");
    assert!(out.contains("<h1 id=\"title\" data-line=\"1\">Title</h1>"), "{out}");
    assert!(out.contains("<p data-line=\"3\">Some <em>em</em> and <strong>strong</strong> and <code>code</code> and <del>gone</del>.</p>"), "{out}");
    assert!(out.contains("<ul data-line=\"5\"><li data-line=\"5\">a</li>"), "{out}");
    assert!(out.contains("<ol data-line=\"8\"><li data-line=\"8\">x</li>"), "{out}");
    assert!(out.contains("<hr data-line=\"11\">"), "{out}");
}

#[test]
fn ordered_lists_keep_their_start_number() {
    assert!(html("3. c\n4. d\n").contains("<ol data-line=\"1\" start=\"3\">"));
}

#[test]
fn raw_html_is_shown_not_interpreted() {
    let out = html("<script>alert(1)</script>\n\nhi <img src=x onerror=alert(1)> there\n\n<div onclick=\"x()\">block</div>\n");
    assert!(out.contains("&lt;script&gt;alert(1)&lt;/script&gt;"), "{out}");
    assert!(out.contains("<code class=\"raw-html\">&lt;img src=x onerror=alert(1)&gt;</code>"), "{out}");
    assert!(out.contains("&lt;div onclick=&quot;x()&quot;&gt;") || out.contains("&lt;div onclick=\"x()\"&gt;"), "{out}");
    assert_safe(&out);
}

#[test]
fn unsafe_links_keep_their_text_but_lose_the_link() {
    for md in [
        "[click](javascript:alert(1))",
        "[click](JAVASCRIPT:alert(1))",
        "[click](<java\tscript:alert(1)>)",
        "[click](&#106;avascript:alert(1))",
        "[click](data:text/html;base64,PHNjcmlwdD4=)",
        "[click][r]\n\n[r]: javascript:alert(1)",
        "<javascript:alert(1)>",
    ] {
        let out = html(md);
        assert!(!out.to_ascii_lowercase().contains("javascript:alert") || !out.contains("href="), "{md} → {out}");
        assert_safe(&out);
    }
    assert!(html("[click](javascript:alert(1))").contains("<a class=\"inert-link\">click</a>"));
}

#[test]
fn attribute_values_cannot_break_out() {
    let out = html("[x](https://a.b/\"onmouseover=\"alert(1) \"t\\\"itle\")\n\n![a\"b](x.png \"q'\\\"q\")");
    assert_safe(&out);
    assert!(!out.contains("\"onmouseover"), "{out}");
}

#[test]
fn links_and_autolinks() {
    let out = html("[a](other.md#part \"T\") <https://x.y> <me@x.y>");
    assert!(out.contains("<a href=\"other.md#part\" title=\"T\">a</a>"), "{out}");
    assert!(out.contains("<a href=\"https://x.y\">https://x.y</a>"), "{out}");
    assert!(out.contains("<a href=\"mailto:me@x.y\">me@x.y</a>"), "{out}");
}

#[test]
fn local_images_resolve_to_asset_urls_and_are_reported() {
    let r = render_in("![alt *text*](img/a%20b.png)\n![p](<img/a b.png>)\n![x](../up.png)", Some("/docs"));
    assert!(r.html.contains("<img src=\"asset://localhost/%2Fdocs%2Fimg%2Fa%20b.png\" alt=\"alt text\""), "{}", r.html);
    assert!(r.html.contains("src=\"asset://localhost/%2Fup.png\""), "{}", r.html);
    assert_eq!(r.local_images, vec!["/docs/img/a b.png", "/docs/img/a b.png", "/up.png"]);
}

#[test]
fn images_that_cannot_load_show_their_alt_text() {
    let r = render_in("![a diagram](rel.png) ![](javascript:alert(1))", None);
    assert!(r.html.contains("<span class=\"image-missing\">a diagram</span>"), "{}", r.html);
    assert!(r.html.contains("<span class=\"image-missing\">image</span>"), "{}", r.html);
    assert!(r.local_images.is_empty());
    assert_safe(&r.html);
}

#[test]
fn remote_images_load_directly() {
    let out = html("![r](https://x.y/a.png \"t\")");
    assert!(out.contains("<img src=\"https://x.y/a.png\" alt=\"r\" title=\"t\" loading=\"lazy\" decoding=\"async\">"), "{out}");
}

#[test]
fn headings_get_unique_github_style_ids() {
    let r = render_in("# Intro\n## Intro\n### Intro 1\n#### What's *new*?\n##### \n###### `code` & more\n", None);
    let ids: Vec<_> = r.headings.iter().map(|h| h.id.as_str()).collect();
    assert_eq!(ids, ["intro", "intro-1", "intro-1-1", "whats-new", "section", "code--more"]);
    assert_eq!(r.headings[3].text, "What's new?");
    assert_eq!(r.headings.iter().map(|h| h.level).collect::<Vec<_>>(), [1, 2, 3, 4, 5, 6]);
    assert_eq!(r.headings.iter().map(|h| h.line).collect::<Vec<_>>(), [1, 2, 3, 4, 5, 6]);
}

#[test]
fn setext_headings_and_headings_with_images() {
    let r = render_in("Title ![logo](x.png)\n=====\n\nSub\n---\n", Some("/d"));
    assert_eq!(r.headings.iter().map(|h| (h.level, h.text.as_str(), h.line)).collect::<Vec<_>>(), [(1, "Title logo", 1), (2, "Sub", 4)]);
}

#[test]
fn code_blocks_are_escaped_and_labelled() {
    let out = html("```rust ignore\nfn main() { \"<b>\" }\n```\n\n```\"><script>\nx\n```\n\n    indented <i>\n");
    assert!(out.contains("<pre data-line=\"1\" data-lang=\"rust\"><code class=\"language-rust\">fn main() { \"&lt;b&gt;\" }\n</code></pre>"), "{out}");
    assert!(out.contains("<pre data-line=\"5\"><code>x\n</code></pre>"), "invalid language dropped: {out}");
    assert!(out.contains("<pre data-line=\"9\"><code>indented &lt;i&gt;\n</code></pre>"), "{out}");
    assert_safe(&out);
}

#[test]
fn tables_with_alignment() {
    let out = html("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n| x |\n");
    assert!(out.contains("<div class=\"table-wrap\" data-line=\"1\"><table><thead><tr><th data-align=\"left\">a</th><th data-align=\"center\">b</th><th data-align=\"right\">c</th></tr></thead><tbody>"), "{out}");
    assert!(out.contains("<tr><td data-align=\"left\">1</td><td data-align=\"center\">2</td><td data-align=\"right\">3</td></tr>"), "{out}");
    assert!(out.contains("<tr><td data-align=\"left\">x</td>"), "short rows are padded: {out}");
    assert!(out.ends_with("</tbody></table></div>\n"), "{out}");
}

#[test]
fn task_lists() {
    let out = html("- [x] done\n- [ ] todo\n");
    assert!(out.contains("<li data-line=\"1\"><input type=\"checkbox\" disabled checked> done</li>"), "{out}");
    assert!(out.contains("<li data-line=\"2\"><input type=\"checkbox\" disabled> todo</li>"), "{out}");
}

#[test]
fn math_becomes_mathml() {
    let out = html("Inline $e^{i\\pi}$ and\n\n$$\\frac{a}{b}$$\n");
    assert!(out.contains("<math><msup><mi>e</mi>"), "{out}");
    assert!(out.contains("<math display=\"block\"><mfrac>"), "{out}");
    assert_safe(&out);
}

#[test]
fn invalid_math_shows_the_source() {
    let out = html("$\\frac{a$ and $$\\begin{x}$$");
    assert!(out.contains("<code class=\"math-error\""), "{out}");
    assert!(out.contains("$\\frac{a$"), "{out}");
    assert_safe(&out);
}

#[test]
fn math_links_follow_the_link_policy() {
    let out = html("$\\href{javascript:alert(1)}{x}$");
    assert!(!out.contains("href=\"javascript"), "{out}");
    assert_safe(&out);
    // math-core writes links as <a href="..."> inside <mtext>.
    let mathml = r#"<math><mtext><a href="javascript:alert(1)">x</a></mtext><mtext><a href="https://ok.example/?a=1&amp;b=2">y</a></mtext></math>"#;
    let clean = sanitize_math_links(mathml);
    assert!(clean.contains(r#"<a class="inert-link">x</a>"#), "{clean}");
    assert!(clean.contains(r#"<a href="https://ok.example/?a=1&amp;b=2">y</a>"#), "{clean}");
}

#[test]
fn front_matter_is_shown_as_a_block() {
    let out = html("---\ntitle: <x>\n---\n\n# Body\n");
    assert!(out.starts_with("<pre class=\"front-matter\" data-line=\"1\"><code>title: &lt;x&gt;\n</code></pre>"), "{out}");
}

#[test]
fn footnotes_are_numbered_and_linked() {
    let out = html("A[^note] B[^2].\n\n[^note]: First.\n[^2]: Second.\n");
    assert!(out.contains("<sup class=\"footnote-ref\"><a href=\"#fn-note\">1</a></sup>"), "{out}");
    assert!(out.contains("<sup class=\"footnote-ref\"><a href=\"#fn-2\">2</a></sup>"), "{out}");
    assert!(out.contains("<div class=\"footnote-definition\" id=\"fn-note\" data-line=\"3\"><sup class=\"footnote-label\">1</sup>"), "{out}");
}

#[test]
fn github_alerts() {
    let out = html("> [!WARNING]\n> Careful\n");
    assert!(out.contains("<blockquote data-line=\"1\" class=\"alert alert-warning\"><p class=\"alert-title\">Warning</p>"), "{out}");
}

#[test]
fn line_numbers_follow_crlf_and_blank_lines() {
    let out = html("a\r\n\r\n\r\n# b\r\n");
    assert!(out.contains("<h1 id=\"b\" data-line=\"4\">b</h1>"), "{out}");
}

#[test]
fn empty_and_whitespace_documents() {
    assert_eq!(html(""), "");
    assert_eq!(html("   \n\n\t\n"), "");
}

#[test]
fn large_documents_render_quickly_and_completely() {
    let section = "## Section\n\nText with **bold**, `code`, $x^2$ and a [link](a.md).\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet x = 1;\n```\n\n";
    let doc = section.repeat(5_000);
    let t = std::time::Instant::now();
    let r = render_in(&doc, Some("/d"));
    let elapsed = t.elapsed();
    assert_eq!(r.headings.len(), 5_000);
    assert_eq!(r.headings.last().unwrap().id, "section-4999");
    assert_eq!(r.headings.last().unwrap().line, 4_999 * 12 + 1); // 12 lines per section
    // ~1 MB of markdown; generous bound so debug builds on slow CI pass too.
    assert!(elapsed.as_secs() < 10, "took {elapsed:?}");
}

#[test]
fn deeply_nested_input_does_not_overflow() {
    let quotes = ">".repeat(10_000) + " deep";
    assert_safe(&html(&quotes));
    let lists = (0..2_000).map(|i| format!("{}- item\n", "  ".repeat(i))).collect::<String>();
    assert_safe(&html(&lists));
    let emphasis = "*".repeat(50_000) + "x" + &"*".repeat(50_000);
    assert_safe(&html(&emphasis));
    let brackets = "[".repeat(50_000) + &"](x)".repeat(10);
    assert_safe(&html(&brackets));
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 2_000, ..ProptestConfig::default() })]

    #[test]
    fn output_is_always_safe_markup(md in r#"([#*_`~\[\]()!|$<>"'=:/\\ \n\t&;xa-z0-9-]|javascript:|onerror=|<script>|\$\$|```|\[\^n\]|- \[x\] |> \[!NOTE\]|---\n){0,80}"#) {
        let r = render_in(&md, Some("/d"));
        assert_safe(&r.html);
    }

    #[test]
    fn arbitrary_unicode_never_panics(md in "\\PC{0,200}") {
        let r = render_in(&md, None);
        assert_safe(&r.html);
    }

    #[test]
    fn heading_ids_are_unique(titles in proptest::collection::vec("[a-c1 -]{0,6}", 1..30)) {
        let md: String = titles.iter().map(|t| format!("## {t}\n\n")).collect();
        let r = render_in(&md, None);
        let mut ids: Vec<_> = r.headings.iter().map(|h| h.id.clone()).collect();
        let n = ids.len();
        ids.sort();
        ids.dedup();
        prop_assert_eq!(ids.len(), n);
    }
}
