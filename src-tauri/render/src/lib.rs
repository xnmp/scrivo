//! Markdown → HTML for Scrivo's reading view.
//!
//! Pure and synchronous: no filesystem access, no platform knowledge. The caller says
//! where the document lives and how a local file becomes a URL the page can load.
//!
//! Safety: the output contains no markup taken from the document. Raw HTML is shown as
//! text, link and image URLs pass an allowlist (`url`), every text and attribute value
//! is escaped, and math is rebuilt as MathML from a parse tree. The page can therefore
//! insert the result as HTML directly.

pub mod url;

use math_core::{LatexToMathML, MathCoreConfig, MathDisplay};
use pulldown_cmark::{Alignment, BlockQuoteKind, CodeBlockKind, Event, HeadingLevel, LinkType, Options as MdOptions, Parser, Tag, TagEnd};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::ops::Range;
use std::path::Path;
use url::ImageSource;

pub struct Options<'a> {
    /// Directory that relative image paths resolve against; None for unsaved documents.
    pub base_dir: Option<&'a Path>,
    /// Turns an absolute local file path into a URL the page can load.
    pub asset_url: &'a dyn Fn(&Path) -> String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rendered {
    pub html: String,
    pub headings: Vec<Heading>,
    /// Local files shown as images; the app grants the page access to exactly these.
    pub local_images: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Heading {
    pub level: u8,
    /// Plain text, markup removed.
    pub text: String,
    /// Anchor id (GitHub-style slug, unique within the document).
    pub id: String,
    /// 1-based source line where the heading starts.
    pub line: u32,
}

/// The markdown dialect: CommonMark + GFM (tables, task lists, strikethrough, alerts,
/// footnotes) + `$math$`/`$$math$$` + YAML front matter. Matches the editor's parser.
fn dialect() -> MdOptions {
    MdOptions::ENABLE_TABLES
        | MdOptions::ENABLE_FOOTNOTES
        | MdOptions::ENABLE_STRIKETHROUGH
        | MdOptions::ENABLE_TASKLISTS
        | MdOptions::ENABLE_MATH
        | MdOptions::ENABLE_GFM
        | MdOptions::ENABLE_YAML_STYLE_METADATA_BLOCKS
}

pub fn render(markdown: &str, options: &Options) -> Rendered {
    let mut w = Writer::new(markdown, options);
    for (event, range) in Parser::new_ext(markdown, dialect()).into_offset_iter() {
        w.event(event, range);
    }
    Rendered { html: w.out, headings: w.headings, local_images: w.local_images }
}

struct HeadingState {
    level: u8,
    line: u32,
    /// Where the heading's content starts in `out`; the opening tag is inserted there
    /// once the text (and so the id) is known.
    content_start: usize,
    text: String,
}

struct ImageState {
    source: ImageSource,
    title: String,
    alt: String,
    /// Images can nest inside image descriptions; only the outermost one is emitted.
    depth: usize,
}

struct Writer<'a> {
    out: String,
    options: &'a Options<'a>,
    line_starts: Vec<usize>,
    math: LatexToMathML,
    headings: Vec<Heading>,
    slug_counts: HashMap<String, usize>,
    used_ids: HashSet<String>,
    local_images: Vec<String>,
    footnotes: HashMap<String, usize>,
    heading: Option<HeadingState>,
    image: Option<ImageState>,
    table_alignments: Vec<Alignment>,
    table_cell: usize,
    in_table_head: bool,
}

impl<'a> Writer<'a> {
    fn new(markdown: &str, options: &'a Options<'a>) -> Self {
        let line_starts = std::iter::once(0).chain(markdown.match_indices('\n').map(|(i, _)| i + 1)).collect();
        Writer {
            out: String::with_capacity(markdown.len() + markdown.len() / 2),
            options,
            line_starts,
            // Unknown commands are errors (shown as source): math-core's "ignore" mode
            // echoes them unescaped, e.g. `\<` becomes a raw `<`.
            math: LatexToMathML::new(MathCoreConfig::default()).unwrap_or_default(),
            headings: Vec::new(),
            slug_counts: HashMap::new(),
            used_ids: HashSet::new(),
            local_images: Vec::new(),
            footnotes: HashMap::new(),
            heading: None,
            image: None,
            table_alignments: Vec::new(),
            table_cell: 0,
            in_table_head: false,
        }
    }

    fn line_of(&self, offset: usize) -> u32 {
        let i = self.line_starts.partition_point(|&start| start <= offset);
        i.max(1) as u32
    }

    fn open(&mut self, tag: &str, range: &Range<usize>) {
        let line = self.line_of(range.start);
        let _ = write!(self.out, "<{tag} data-line=\"{line}\">");
    }

    fn event(&mut self, event: Event, range: Range<usize>) {
        if self.image.is_some() {
            return self.image_event(event);
        }
        if let Some(h) = &mut self.heading {
            match &event {
                Event::Text(t) | Event::Code(t) | Event::InlineMath(t) | Event::DisplayMath(t) => h.text.push_str(t),
                Event::SoftBreak | Event::HardBreak => h.text.push(' '),
                _ => {}
            }
        }
        match event {
            Event::Start(tag) => self.start(tag, range),
            Event::End(tag) => self.end(tag),
            Event::Text(text) => escape_text(&mut self.out, &text),
            Event::Code(code) => {
                self.out.push_str("<code>");
                escape_text(&mut self.out, &code);
                self.out.push_str("</code>");
            }
            Event::InlineMath(tex) => self.math(&tex, MathDisplay::Inline),
            Event::DisplayMath(tex) => self.math(&tex, MathDisplay::Block),
            // Raw HTML is shown, never interpreted.
            Event::Html(html) => escape_text(&mut self.out, &html),
            Event::InlineHtml(html) => {
                self.out.push_str("<code class=\"raw-html\">");
                escape_text(&mut self.out, &html);
                self.out.push_str("</code>");
            }
            Event::FootnoteReference(label) => {
                let n = self.footnote_number(&label);
                let id = anchor_id(&label);
                let _ = write!(self.out, "<sup class=\"footnote-ref\"><a href=\"#fn-{id}\">{n}</a></sup>");
            }
            Event::SoftBreak => self.out.push('\n'),
            Event::HardBreak => self.out.push_str("<br>"),
            Event::Rule => self.open("hr", &range),
            Event::TaskListMarker(checked) => {
                self.out.push_str(if checked {
                    "<input type=\"checkbox\" disabled checked> "
                } else {
                    "<input type=\"checkbox\" disabled> "
                });
            }
        }
    }

    fn start(&mut self, tag: Tag, range: Range<usize>) {
        match tag {
            Tag::Paragraph => self.open("p", &range),
            Tag::Heading { level, .. } => {
                self.heading = Some(HeadingState {
                    level: heading_level(level),
                    line: self.line_of(range.start),
                    content_start: self.out.len(),
                    text: String::new(),
                });
            }
            Tag::BlockQuote(kind) => {
                let line = self.line_of(range.start);
                match kind.map(alert) {
                    Some((class, title)) => {
                        let _ = write!(
                            self.out,
                            "<blockquote data-line=\"{line}\" class=\"alert alert-{class}\"><p class=\"alert-title\">{title}</p>"
                        );
                    }
                    None => {
                        let _ = write!(self.out, "<blockquote data-line=\"{line}\">");
                    }
                }
            }
            Tag::CodeBlock(kind) => {
                let line = self.line_of(range.start);
                let lang = match &kind {
                    CodeBlockKind::Fenced(info) => code_language(info),
                    CodeBlockKind::Indented => None,
                };
                match lang {
                    Some(lang) => {
                        let _ = write!(self.out, "<pre data-line=\"{line}\" data-lang=\"{lang}\"><code class=\"language-{lang}\">");
                    }
                    None => {
                        let _ = write!(self.out, "<pre data-line=\"{line}\"><code>");
                    }
                }
            }
            Tag::HtmlBlock => {
                let line = self.line_of(range.start);
                let _ = write!(self.out, "<pre class=\"raw-html\" data-line=\"{line}\"><code>");
            }
            Tag::MetadataBlock(_) => {
                let line = self.line_of(range.start);
                let _ = write!(self.out, "<pre class=\"front-matter\" data-line=\"{line}\"><code>");
            }
            Tag::List(Some(1)) => self.open("ol", &range),
            Tag::List(Some(start)) => {
                let line = self.line_of(range.start);
                let _ = write!(self.out, "<ol data-line=\"{line}\" start=\"{start}\">");
            }
            Tag::List(None) => self.open("ul", &range),
            Tag::Item => self.open("li", &range),
            Tag::FootnoteDefinition(label) => {
                let n = self.footnote_number(&label);
                let id = anchor_id(&label);
                let line = self.line_of(range.start);
                let _ = write!(
                    self.out,
                    "<div class=\"footnote-definition\" id=\"fn-{id}\" data-line=\"{line}\"><sup class=\"footnote-label\">{n}</sup>"
                );
            }
            Tag::Table(alignments) => {
                self.table_alignments = alignments;
                let line = self.line_of(range.start);
                let _ = write!(self.out, "<div class=\"table-wrap\" data-line=\"{line}\"><table>");
            }
            Tag::TableHead => {
                self.in_table_head = true;
                self.table_cell = 0;
                self.out.push_str("<thead><tr>");
            }
            Tag::TableRow => {
                self.table_cell = 0;
                self.out.push_str("<tr>");
            }
            Tag::TableCell => {
                let cell = if self.in_table_head { "th" } else { "td" };
                match self.table_alignments.get(self.table_cell).copied().unwrap_or(Alignment::None) {
                    Alignment::None => {
                        let _ = write!(self.out, "<{cell}>");
                    }
                    a => {
                        let align = match a {
                            Alignment::Left => "left",
                            Alignment::Center => "center",
                            _ => "right",
                        };
                        let _ = write!(self.out, "<{cell} data-align=\"{align}\">");
                    }
                }
            }
            Tag::Emphasis => self.out.push_str("<em>"),
            Tag::Strong => self.out.push_str("<strong>"),
            Tag::Strikethrough => self.out.push_str("<del>"),
            Tag::Superscript => self.out.push_str("<sup>"),
            Tag::Subscript => self.out.push_str("<sub>"),
            Tag::Link { link_type, dest_url, title, .. } => {
                let target = match link_type {
                    LinkType::Email => Some(format!("mailto:{dest_url}")),
                    _ => url::safe_link(&dest_url),
                };
                match target {
                    Some(href) => {
                        self.out.push_str("<a href=\"");
                        escape_attr(&mut self.out, &href);
                        self.out.push('"');
                    }
                    // Unsafe destination: keep the text, drop the link.
                    None => self.out.push_str("<a class=\"inert-link\""),
                }
                if !title.is_empty() {
                    self.out.push_str(" title=\"");
                    escape_attr(&mut self.out, &title);
                    self.out.push('"');
                }
                self.out.push('>');
            }
            Tag::Image { dest_url, title, .. } => {
                let source = url::image_source(&dest_url, self.options.base_dir);
                self.image = Some(ImageState { source, title: title.into_string(), alt: String::new(), depth: 1 });
            }
            Tag::DefinitionList => self.open("dl", &range),
            Tag::DefinitionListTitle => self.out.push_str("<dt>"),
            Tag::DefinitionListDefinition => self.out.push_str("<dd>"),
        }
    }

    fn end(&mut self, tag: TagEnd) {
        match tag {
            TagEnd::Paragraph => self.out.push_str("</p>\n"),
            TagEnd::Heading(_) => self.finish_heading(),
            TagEnd::BlockQuote(_) => self.out.push_str("</blockquote>\n"),
            TagEnd::CodeBlock | TagEnd::HtmlBlock | TagEnd::MetadataBlock(_) => self.out.push_str("</code></pre>\n"),
            TagEnd::List(true) => self.out.push_str("</ol>\n"),
            TagEnd::List(false) => self.out.push_str("</ul>\n"),
            TagEnd::Item => self.out.push_str("</li>\n"),
            TagEnd::FootnoteDefinition => self.out.push_str("</div>\n"),
            TagEnd::Table => self.out.push_str("</tbody></table></div>\n"),
            TagEnd::TableHead => {
                self.in_table_head = false;
                self.out.push_str("</tr></thead><tbody>");
            }
            TagEnd::TableRow => self.out.push_str("</tr>"),
            TagEnd::TableCell => {
                self.out.push_str(if self.in_table_head { "</th>" } else { "</td>" });
                self.table_cell += 1;
            }
            TagEnd::Emphasis => self.out.push_str("</em>"),
            TagEnd::Strong => self.out.push_str("</strong>"),
            TagEnd::Strikethrough => self.out.push_str("</del>"),
            TagEnd::Superscript => self.out.push_str("</sup>"),
            TagEnd::Subscript => self.out.push_str("</sub>"),
            TagEnd::Link => self.out.push_str("</a>"),
            TagEnd::Image => {} // handled in image_event
            TagEnd::DefinitionList => self.out.push_str("</dl>\n"),
            TagEnd::DefinitionListTitle => self.out.push_str("</dt>"),
            TagEnd::DefinitionListDefinition => self.out.push_str("</dd>"),
        }
    }

    fn finish_heading(&mut self) {
        let Some(h) = self.heading.take() else { return };
        let text = h.text.split_whitespace().collect::<Vec<_>>().join(" ");
        let id = self.unique_slug(&text);
        let open = format!("<h{} id=\"{}\" data-line=\"{}\">", h.level, id, h.line);
        self.out.insert_str(h.content_start, &open);
        let _ = writeln!(self.out, "</h{}>", h.level);
        self.headings.push(Heading { level: h.level, text, id, line: h.line });
    }

    /// Inside an image only the alt text matters; everything else is dropped.
    fn image_event(&mut self, event: Event) {
        let Some(img) = &mut self.image else { return };
        match event {
            Event::Start(Tag::Image { .. }) => img.depth += 1,
            Event::End(TagEnd::Image) => {
                img.depth -= 1;
                if img.depth == 0 {
                    let img = self.image.take().expect("image state");
                    if let Some(h) = &mut self.heading {
                        h.text.push_str(&img.alt);
                    }
                    self.write_image(img);
                }
            }
            Event::Text(t) | Event::Code(t) | Event::InlineMath(t) | Event::DisplayMath(t) => img.alt.push_str(&t),
            Event::SoftBreak | Event::HardBreak => img.alt.push(' '),
            _ => {}
        }
    }

    fn write_image(&mut self, img: ImageState) {
        let src = match img.source {
            ImageSource::Remote(url) => Some(url),
            ImageSource::Local(path) => {
                let url = (self.options.asset_url)(&path);
                self.local_images.push(path.to_string_lossy().into_owned());
                Some(url)
            }
            ImageSource::Unavailable => None,
        };
        match src {
            Some(src) => {
                self.out.push_str("<img src=\"");
                escape_attr(&mut self.out, &src);
                self.out.push_str("\" alt=\"");
                escape_attr(&mut self.out, &img.alt);
                self.out.push('"');
                if !img.title.is_empty() {
                    self.out.push_str(" title=\"");
                    escape_attr(&mut self.out, &img.title);
                    self.out.push('"');
                }
                self.out.push_str(" loading=\"lazy\" decoding=\"async\">");
            }
            None => {
                self.out.push_str("<span class=\"image-missing\">");
                escape_text(&mut self.out, if img.alt.is_empty() { "image" } else { &img.alt });
                self.out.push_str("</span>");
            }
        }
    }

    fn math(&mut self, tex: &str, display: MathDisplay) {
        match self.math.convert_with_local_state(tex, display) {
            Ok(result) => self.out.push_str(&sanitize_math_links(&result.mathml)),
            Err(e) => {
                let delim = if display == MathDisplay::Block { "$$" } else { "$" };
                self.out.push_str("<code class=\"math-error\" title=\"");
                escape_attr(&mut self.out, &e.to_string());
                self.out.push_str("\">");
                escape_text(&mut self.out, delim);
                escape_text(&mut self.out, tex);
                escape_text(&mut self.out, delim);
                self.out.push_str("</code>");
            }
        }
    }

    fn footnote_number(&mut self, label: &str) -> usize {
        let next = self.footnotes.len() + 1;
        *self.footnotes.entry(label.to_owned()).or_insert(next)
    }

    /// GitHub's scheme: "intro", then "intro-1", "intro-2", ...; skipping any id that
    /// is already taken (a heading literally titled "intro 1" takes "intro-1").
    fn unique_slug(&mut self, text: &str) -> String {
        let base = match slug(text) {
            s if s.is_empty() => "section".to_owned(),
            s => s,
        };
        let mut n = self.slug_counts.get(&base).copied().unwrap_or(0);
        loop {
            let id = if n == 0 { base.clone() } else { format!("{base}-{n}") };
            n += 1;
            if self.used_ids.insert(id.clone()) {
                self.slug_counts.insert(base, n);
                return id;
            }
        }
    }
}

fn heading_level(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn alert(kind: BlockQuoteKind) -> (&'static str, &'static str) {
    match kind {
        BlockQuoteKind::Note => ("note", "Note"),
        BlockQuoteKind::Tip => ("tip", "Tip"),
        BlockQuoteKind::Important => ("important", "Important"),
        BlockQuoteKind::Warning => ("warning", "Warning"),
        BlockQuoteKind::Caution => ("caution", "Caution"),
    }
}

/// First word of a fence's info string, if it is a plausible language name.
fn code_language(info: &str) -> Option<String> {
    let word = info.split_whitespace().next()?;
    let word = word.trim_start_matches('{').trim_end_matches('}').trim_start_matches('.');
    let valid = !word.is_empty()
        && word.len() <= 32
        && word.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '+' | '#' | '.'));
    valid.then(|| word.to_ascii_lowercase())
}

/// GitHub-style heading anchor: lowercase, spaces to '-', punctuation dropped.
pub fn slug(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.trim().chars() {
        if c.is_alphanumeric() || c == '-' || c == '_' {
            out.extend(c.to_lowercase());
        } else if c.is_whitespace() {
            out.push('-');
        }
    }
    out
}

/// Footnote labels are free text; make them safe as an id fragment.
fn anchor_id(label: &str) -> String {
    label.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect()
}

/// math-core turns `\href{url}{text}` into `<a href="url">` with the URL escaped but
/// unchecked. Apply the same policy as markdown links.
fn sanitize_math_links(mathml: &str) -> std::borrow::Cow<'_, str> {
    const OPEN: &str = "<a href=\"";
    if !mathml.contains(OPEN) {
        return mathml.into();
    }
    let mut out = String::with_capacity(mathml.len());
    let mut rest = mathml;
    while let Some(i) = rest.find(OPEN) {
        out.push_str(&rest[..i]);
        let after = &rest[i + OPEN.len()..];
        let Some(end) = after.find('"') else {
            rest = "";
            break;
        };
        let href = unescape_attr(&after[..end]);
        match url::safe_link(&href) {
            Some(safe) => {
                out.push_str(OPEN);
                escape_attr(&mut out, &safe);
                out.push('"');
            }
            None => out.push_str("<a class=\"inert-link\""),
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out.into()
}

fn unescape_attr(s: &str) -> String {
    s.replace("&quot;", "\"").replace("&#39;", "'").replace("&#x27;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

fn escape_text(out: &mut String, s: &str) {
    escape(out, s, false);
}

fn escape_attr(out: &mut String, s: &str) {
    escape(out, s, true);
}

fn escape(out: &mut String, s: &str, attr: bool) {
    let mut last = 0;
    for (i, b) in s.bytes().enumerate() {
        let rep = match b {
            b'&' => "&amp;",
            b'<' => "&lt;",
            b'>' => "&gt;",
            b'"' if attr => "&quot;",
            b'\'' if attr => "&#39;",
            _ => continue,
        };
        out.push_str(&s[last..i]);
        out.push_str(rep);
        last = i + 1;
    }
    out.push_str(&s[last..]);
}

#[cfg(test)]
mod tests;
